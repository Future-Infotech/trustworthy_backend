import type { Assignment, Prisma, RoleName, Submission } from '@prisma/client';
import { prisma } from '../config/prisma';
import type { AuthContext } from '../middleware/authorize';
import { PERMISSIONS } from '../rbac/permissions';
import { Errors } from '../utils/errors';
import { stringList } from '../utils/jsonList';
import { paginate, toSkipTake } from '../utils/pagination';
import {
  rubricCriterionSchema,
  type CreateAssignmentInput,
  type EvidenceType,
  type GradeSubmissionInput,
  type ListAssignmentsQuery,
  type ListSubmissionsQuery,
  type RubricCriterion,
  type SubmitAssignmentInput,
  type UpdateAssignmentInput,
} from '../validators/assignment.validators';
import { auditService } from './audit.service';
import { changes, person, userSelect } from './governance/shared';
import { notificationService } from './notification.service';

const RESOURCE = 'assignment';

/** Submissions that are waiting for a grader. */
const PENDING: Submission['status'][] = ['SUBMITTED', 'UNDER_REVIEW'];

const round2 = (n: number) => Math.round(n * 100) / 100;
const humanize = (v: string) => v.toLowerCase().replace(/_/g, ' ');

export interface RubricLine extends RubricCriterion {
  maxPoints: number;
}

export interface RubricScore {
  criterion: string;
  weight: number;
  maxPoints: number;
  points: number;
  comment?: string;
}

export interface Evidence {
  type: EvidenceType;
  id: string;
  label: string;
  summary: string;
}

/** The rubric with each criterion's share of the assignment's maximum score. */
export function rubricLines(rubric: unknown, maxScore: number): RubricLine[] {
  const parsed = rubricCriterionSchema.array().safeParse(rubric);
  if (!parsed.success || !parsed.data.length) return [];
  const total = parsed.data.reduce((n, c) => n + c.weight, 0);
  return parsed.data.map((c) => ({ ...c, maxPoints: round2((c.weight / total) * maxScore) }));
}

/** Checks the grader's per-criterion points against the rubric; the total is always computed here, never trusted from the client. */
export function scoreRubric(lines: RubricLine[], scores: NonNullable<GradeSubmissionInput['rubricScores']>, requireAll: boolean) {
  const byName = new Map(scores.map((s) => [s.criterion.trim().toLowerCase(), s]));
  const issues: { path: string; message: string }[] = [];
  const known = new Set(lines.map((l) => l.criterion.toLowerCase()));
  scores.forEach((s, i) => {
    if (!known.has(s.criterion.trim().toLowerCase())) issues.push({ path: `rubricScores.${i}.criterion`, message: `"${s.criterion}" is not a criterion of this rubric` });
  });
  const result: RubricScore[] = [];
  lines.forEach((line) => {
    const given = byName.get(line.criterion.toLowerCase());
    if (!given) {
      if (requireAll) issues.push({ path: 'rubricScores', message: `Score the criterion "${line.criterion}"` });
      return;
    }
    if (given.points > line.maxPoints) issues.push({ path: 'rubricScores', message: `"${line.criterion}" is worth at most ${line.maxPoints} points` });
    result.push({ criterion: line.criterion, weight: line.weight, maxPoints: line.maxPoints, points: round2(given.points), comment: given.comment || undefined });
  });
  if (issues.length) throw Errors.validation(issues);
  return { rubricScores: result, score: round2(result.reduce((n, r) => n + r.points, 0)) };
}

const isStaff = (auth: AuthContext) => auth.can(PERMISSIONS.ASSIGNMENTS_MANAGE) || auth.can(PERMISSIONS.ASSIGNMENTS_GRADE);
const isTargeted = (a: Pick<Assignment, 'targetRoles'>, role: RoleName) => {
  const roles = stringList(a.targetRoles);
  return roles.length === 0 || roles.includes(role);
};

/** Ids of published assignments a learner role may see (untargeted, or targeting that role). Target roles are a JSON list, so this filters in code. */
export async function learnerAssignmentIds(role: RoleName, courseId?: string): Promise<string[]> {
  const rows = await prisma.assignment.findMany({ where: { isPublished: true, courseId }, select: { id: true, targetRoles: true } });
  return rows.filter((r) => isTargeted(r, role)).map((r) => r.id);
}

const include = {
  course: { select: { id: true, title: true } },
  module: { select: { id: true, title: true, order: true } },
} satisfies Prisma.AssignmentInclude;
type Row = Prisma.AssignmentGetPayload<{ include: typeof include }>;

const submissionInclude = {
  user: { select: { ...userSelect, email: true, role: { select: { name: true } } } },
  gradedBy: { select: userSelect },
  assignment: { select: { id: true, title: true, maxScore: true, rubric: true, dueDate: true, courseId: true, course: { select: { title: true } } } },
} satisfies Prisma.SubmissionInclude;
type SubmissionRow = Prisma.SubmissionGetPayload<{ include: typeof submissionInclude }>;

async function findVisible(auth: AuthContext, id: string) {
  const row = await prisma.assignment.findUnique({ where: { id }, include });
  if (!row || (!isStaff(auth) && !(row.isPublished && isTargeted(row, auth.actor.role)))) throw Errors.notFound('Assignment');
  return row;
}

async function stats(assignmentIds: string[]) {
  const groups = assignmentIds.length
    ? await prisma.submission.groupBy({ by: ['assignmentId', 'status'], where: { assignmentId: { in: assignmentIds } }, _count: { _all: true } })
    : [];
  const out = new Map<string, { total: number; pending: number; graded: number; returned: number }>();
  for (const id of assignmentIds) out.set(id, { total: 0, pending: 0, graded: 0, returned: 0 });
  for (const g of groups) {
    const s = out.get(g.assignmentId)!;
    s.total += g._count._all;
    if (PENDING.includes(g.status)) s.pending += g._count._all;
    if (g.status === 'GRADED') s.graded += g._count._all;
    if (g.status === 'RETURNED') s.returned += g._count._all;
  }
  return out;
}

const attemptSummary = (s: Submission) => ({
  id: s.id,
  attemptNumber: s.attemptNumber,
  status: s.status,
  score: s.score,
  late: s.late,
  submittedAt: s.submittedAt,
  gradedAt: s.gradedAt,
});

/** Why the caller can or cannot submit (another attempt). */
function submitState(auth: AuthContext, row: Assignment, latest: Submission | undefined) {
  if (!auth.can(PERMISSIONS.ASSIGNMENTS_SUBMIT)) return { canSubmit: false, reason: 'Your role does not submit assignments' };
  if (!row.isPublished) return { canSubmit: false, reason: 'This assignment is not published yet' };
  if (!isTargeted(row, auth.actor.role)) return { canSubmit: false, reason: 'This assignment is not assigned to your role' };
  if (latest && PENDING.includes(latest.status)) return { canSubmit: false, reason: 'Your submission is awaiting grading' };
  if (latest?.status === 'GRADED') return { canSubmit: false, reason: 'Your submission has been graded' };
  return { canSubmit: true, reason: latest?.status === 'RETURNED' ? 'Your previous attempt was returned for revision' : null };
}

async function assertCourseAndModule(courseId: string, moduleId: string | null | undefined) {
  const course = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true } });
  if (!course) throw Errors.validation([{ path: 'courseId', message: 'Course not found' }]);
  if (moduleId) {
    const mod = await prisma.module.findUnique({ where: { id: moduleId }, select: { courseId: true } });
    if (!mod || mod.courseId !== courseId) throw Errors.validation([{ path: 'moduleId', message: 'Module not found in this course' }]);
  }
}

/** Tells enrolled learners in the target roles about a newly published assignment. */
async function notifyAssigned(row: Pick<Assignment, 'id' | 'title' | 'courseId' | 'targetRoles' | 'dueDate'>, tx: Prisma.TransactionClient, excludeId: string) {
  const targetRoles = stringList(row.targetRoles) as RoleName[];
  const learners = await tx.enrollment.findMany({
    where: {
      courseId: row.courseId,
      status: { not: 'DROPPED' },
      userId: { not: excludeId },
      user: { status: 'ACTIVE', ...(targetRoles.length ? { role: { name: { in: targetRoles } } } : {}) },
    },
    select: { userId: true },
  });
  for (const { userId } of learners) {
    await notificationService.notify(
      userId,
      {
        type: 'ASSIGNMENT_ASSIGNED',
        title: 'New assignment',
        message: row.dueDate ? `${row.title} is due ${row.dueDate.toISOString().slice(0, 10)}.` : `${row.title} has been assigned to you.`,
        link: `/assignments/${row.id}`,
      },
      tx,
    );
  }
}

/** Resolves evidence to the caller's own artefacts and snapshots a description for the grader. */
async function resolveEvidence(userId: string, items: SubmitAssignmentInput['evidence']): Promise<Evidence[]> {
  const out: Evidence[] = [];
  const issues: { path: string; message: string }[] = [];
  for (const [i, { type, id }] of items.entries()) {
    const fail = (message: string) => issues.push({ path: `evidence.${i}`, message });
    if (type === 'experiment') {
      const e = await prisma.experiment.findUnique({ where: { id }, select: { userId: true, name: true, type: true, status: true, completedAt: true } });
      if (!e || e.userId !== userId) fail('Experiment not found among your experiments');
      else if (e.status !== 'COMPLETED') fail('Only completed experiments can be attached');
      else out.push({ type, id, label: e.name ?? `${humanize(e.type)} experiment`, summary: `${humanize(e.type)} experiment completed ${e.completedAt?.toISOString().slice(0, 10) ?? ''}`.trim() });
    } else if (type === 'model_card') {
      const c = await prisma.modelCard.findUnique({ where: { id }, select: { ownerId: true, name: true, version: true, status: true } });
      if (!c || c.ownerId !== userId) fail('Model card not found among your model cards');
      else out.push({ type, id, label: c.name, summary: `Model card version ${c.version} (${humanize(c.status)})` });
    } else if (type === 'risk_assessment') {
      const r = await prisma.riskAssessment.findUnique({ where: { id }, select: { assessorId: true, title: true, status: true, riskLevel: true, score: true } });
      if (!r || r.assessorId !== userId) fail('Risk assessment not found among your assessments');
      else out.push({ type, id, label: r.title, summary: `Risk assessment: ${r.riskLevel ?? 'unscored'} (score ${r.score ?? '—'}), ${humanize(r.status)}` });
    } else if (type === 'impact_assessment') {
      const a = await prisma.algorithmicImpactAssessment.findUnique({ where: { id }, select: { ownerId: true, title: true, version: true, status: true } });
      if (!a || a.ownerId !== userId) fail('Impact assessment not found among your assessments');
      else out.push({ type, id, label: a.title, summary: `Algorithmic impact assessment version ${a.version}, ${humanize(a.status)}` });
    } else {
      const p = await prisma.governancePolicy.findUnique({ where: { id }, select: { ownerId: true, title: true, version: true, status: true } });
      if (!p || p.ownerId !== userId) fail('Policy not found among the policies you own');
      else out.push({ type, id, label: p.title, summary: `Governance policy version ${p.version}, ${humanize(p.status)}` });
    }
  }
  if (issues.length) throw Errors.validation(issues);
  return out;
}

function presentSubmission(row: SubmissionRow, auth: AuthContext) {
  const { user, gradedBy, assignment, attachments, rubricScores, ...rest } = row;
  const own = row.userId === auth.actor.id;
  const grader = auth.can(PERMISSIONS.ASSIGNMENTS_GRADE);
  return {
    ...rest,
    author: { ...person(user)!, email: grader ? user.email : undefined, role: user.role.name },
    gradedBy: person(gradedBy),
    assignment: {
      id: assignment.id,
      title: assignment.title,
      maxScore: assignment.maxScore,
      dueDate: assignment.dueDate,
      course: { id: assignment.courseId, title: assignment.course.title },
      rubric: rubricLines(assignment.rubric, assignment.maxScore),
    },
    evidence: (attachments ?? []) as unknown as Evidence[],
    rubricScores: (rubricScores ?? null) as unknown as RubricScore[] | null,
    percentage: row.score === null ? null : round2((row.score / assignment.maxScore) * 100),
    permissions: { canGrade: grader && !own && PENDING.includes(row.status) },
  };
}

async function findSubmission(auth: AuthContext, id: string) {
  const row = await prisma.submission.findUnique({ where: { id }, include: submissionInclude });
  if (!row || (row.userId !== auth.actor.id && !auth.can(PERMISSIONS.ASSIGNMENTS_GRADE))) throw Errors.notFound('Submission');
  return row;
}

export const assignmentService = {
  async list(auth: AuthContext, q: ListAssignmentsQuery) {
    const staff = isStaff(auth);
    const where: Prisma.AssignmentWhereInput = {
      ...(staff ? { isPublished: q.published } : { isPublished: true, id: { in: await learnerAssignmentIds(auth.actor.role, q.courseId) } }),
      courseId: q.courseId,
      title: q.search ? { contains: q.search } : undefined,
    };
    // MySQL/MariaDB cannot order "due date ascending, undated last" in a query, so order the (small) key set in code, then load one page.
    const keys = await prisma.assignment.findMany({ where, select: { id: true, dueDate: true, createdAt: true } });
    keys.sort((a, b) => {
      if (a.dueDate && b.dueDate && a.dueDate.getTime() !== b.dueDate.getTime()) return a.dueDate.getTime() - b.dueDate.getTime();
      if (!a.dueDate !== !b.dueDate) return a.dueDate ? -1 : 1;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });
    const { skip, take } = toSkipTake(q);
    const pageIds = keys.slice(skip, skip + take).map((k) => k.id);
    const found = await prisma.assignment.findMany({
      where: { id: { in: pageIds } },
      include: { ...include, submissions: { where: { userId: auth.actor.id }, orderBy: { attemptNumber: 'desc' }, take: 1 } },
    });
    const byId = new Map(found.map((r) => [r.id, r]));
    const rows = pageIds.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => !!r);
    const total = keys.length;
    const counts = staff ? await stats(rows.map((r) => r.id)) : null;
    const now = new Date();
    const data = rows.map(({ submissions, instructions: _i, rubric: _r, ...r }) => ({
      ...r,
      overdue: !!r.dueDate && r.dueDate < now && !submissions[0],
      mySubmission: submissions[0] ? attemptSummary(submissions[0]) : null,
      stats: counts?.get(r.id) ?? null,
    }));
    return paginate(data, total, q);
  },

  async get(auth: AuthContext, id: string) {
    const row = await findVisible(auth, id);
    const attempts = await prisma.submission.findMany({
      where: { assignmentId: id, userId: auth.actor.id },
      include: { gradedBy: { select: userSelect } },
      orderBy: { attemptNumber: 'desc' },
    });
    const staff = isStaff(auth);
    const now = new Date();
    return {
      ...row,
      rubric: rubricLines(row.rubric, row.maxScore),
      overdue: !!row.dueDate && row.dueDate < now,
      mySubmissions: attempts.map((s) => ({ ...attemptSummary(s), feedback: s.feedback, rubricScores: s.rubricScores, gradedBy: person(s.gradedBy) })),
      ...submitState(auth, row, attempts[0]),
      stats: staff ? (await stats([id])).get(id)! : null,
      permissions: { canEdit: auth.can(PERMISSIONS.ASSIGNMENTS_MANAGE), canGrade: auth.can(PERMISSIONS.ASSIGNMENTS_GRADE) },
    };
  },

  async create(auth: AuthContext, input: CreateAssignmentInput) {
    await assertCourseAndModule(input.courseId, input.moduleId);
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.assignment.create({
        data: { ...input, moduleId: input.moduleId ?? null, dueDate: input.dueDate ?? null, rubric: input.rubric as Prisma.InputJsonValue, createdById: auth.actor.id },
      });
      await auditService.record(
        { action: `${RESOURCE}.created`, resource: RESOURCE, resourceId: row.id, actor: auth.actor, context: auth.ctx, after: { title: row.title, isPublished: row.isPublished, targetRoles: row.targetRoles } },
        tx,
      );
      if (row.isPublished) await notifyAssigned(row, tx, auth.actor.id);
      return row;
    });
    return this.get(auth, created.id);
  },

  async update(auth: AuthContext, id: string, input: UpdateAssignmentInput) {
    const row = await findVisible(auth, id);
    if (input.moduleId !== undefined) await assertCourseAndModule(row.courseId, input.moduleId);
    if ((input.rubric || input.maxScore !== undefined) && (await prisma.submission.count({ where: { assignmentId: id, status: 'GRADED' } }))) {
      const sameRubric = !input.rubric || JSON.stringify(input.rubric) === JSON.stringify(row.rubric);
      if (!sameRubric || (input.maxScore !== undefined && input.maxScore !== row.maxScore)) {
        throw Errors.conflict('The rubric and maximum score cannot change after submissions have been graded');
      }
    }
    const diff = changes(row, input as Partial<Row>);
    if (!diff.keys.length) return this.get(auth, id);
    await prisma.$transaction(async (tx) => {
      const updated = await tx.assignment.update({
        where: { id },
        data: { ...input, rubric: input.rubric as Prisma.InputJsonValue | undefined, updatedById: auth.actor.id },
      });
      await auditService.record(
        { action: `${RESOURCE}.updated`, resource: RESOURCE, resourceId: id, actor: auth.actor, context: auth.ctx, before: diff.before, after: diff.after, metadata: { changedFields: diff.keys } },
        tx,
      );
      if (!row.isPublished && updated.isPublished) await notifyAssigned(updated, tx, auth.actor.id);
    });
    return this.get(auth, id);
  },

  async submit(auth: AuthContext, assignmentId: string, input: SubmitAssignmentInput) {
    const row = await findVisible(auth, assignmentId);
    const latest = await prisma.submission.findFirst({ where: { assignmentId, userId: auth.actor.id }, orderBy: { attemptNumber: 'desc' } });
    const state = submitState(auth, row, latest ?? undefined);
    if (!state.canSubmit) throw Errors.conflict(state.reason ?? 'You cannot submit this assignment');
    const evidence = await resolveEvidence(auth.actor.id, input.evidence);
    const now = new Date();
    const late = !!row.dueDate && now > row.dueDate;
    const created = await prisma.$transaction(async (tx) => {
      const sub = await tx.submission.create({
        data: {
          assignmentId,
          userId: auth.actor.id,
          attemptNumber: (latest?.attemptNumber ?? 0) + 1,
          content: input.content,
          attachments: evidence as unknown as Prisma.InputJsonValue,
          status: 'SUBMITTED',
          late,
          submittedAt: now,
        },
      });
      await auditService.record(
        {
          action: 'submission.created',
          resource: 'submission',
          resourceId: sub.id,
          actor: auth.actor,
          context: auth.ctx,
          after: { assignmentId, attemptNumber: sub.attemptNumber, late, evidence: evidence.map((e) => `${e.type}:${e.id}`) },
        },
        tx,
      );
      await notificationService.notifyPermissionHolders(
        PERMISSIONS.ASSIGNMENTS_GRADE,
        {
          type: 'SYSTEM',
          title: 'Submission awaiting grading',
          message: `A new ${late ? 'late ' : ''}submission for "${row.title}" (attempt ${sub.attemptNumber}) is ready to grade.`,
          link: `/assignments/${assignmentId}/submissions/${sub.id}`,
        },
        tx,
        { exclude: [auth.actor.id] },
      );
      return sub;
    });
    return this.getSubmission(auth, created.id);
  },

  async listSubmissions(auth: AuthContext, assignmentId: string, q: ListSubmissionsQuery) {
    await findVisible(auth, assignmentId);
    const where: Prisma.SubmissionWhereInput = { assignmentId, status: q.status };
    const [rows, total] = await Promise.all([
      prisma.submission.findMany({
        where,
        include: { user: { select: { ...userSelect, role: { select: { name: true } } } }, gradedBy: { select: userSelect } },
        orderBy: [{ submittedAt: 'desc' }],
        ...toSkipTake(q),
      }),
      prisma.submission.count({ where }),
    ]);
    const data = rows.map((s) => ({
      ...attemptSummary(s),
      author: { ...person(s.user)!, role: s.user.role.name },
      gradedBy: person(s.gradedBy),
      ownSubmission: s.userId === auth.actor.id,
    }));
    return paginate(data, total, q);
  },

  async getSubmission(auth: AuthContext, id: string) {
    return presentSubmission(await findSubmission(auth, id), auth);
  },

  async grade(auth: AuthContext, id: string, input: GradeSubmissionInput) {
    const row = await findSubmission(auth, id);
    if (row.userId === auth.actor.id) throw Errors.forbidden('You cannot grade your own submission');
    if (!PENDING.includes(row.status)) throw Errors.conflict(`This submission is already ${humanize(row.status)}`);
    const lines = rubricLines(row.assignment.rubric, row.assignment.maxScore);
    const grading = input.decision === 'GRADE';
    if (grading && !lines.length) throw Errors.conflict('This assignment has no rubric to grade against');
    const scored = input.rubricScores?.length ? scoreRubric(lines, input.rubricScores, grading) : null;
    const status = grading ? 'GRADED' : 'RETURNED';
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.submission.updateMany({
        where: { id, status: { in: PENDING } },
        data: {
          status,
          score: grading ? scored!.score : null,
          rubricScores: (scored?.rubricScores ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
          feedback: input.feedback,
          gradedById: auth.actor.id,
          gradedAt: now,
        },
      });
      if (!count) throw Errors.conflict('This submission was graded by someone else');
      await auditService.record(
        {
          action: grading ? 'submission.graded' : 'submission.returned',
          resource: 'submission',
          resourceId: id,
          actor: auth.actor,
          context: auth.ctx,
          before: { status: row.status, score: row.score },
          after: { status, score: grading ? scored!.score : null, maxScore: row.assignment.maxScore },
          metadata: { assignmentId: row.assignmentId, studentId: row.userId, attemptNumber: row.attemptNumber },
        },
        tx,
      );
      await notificationService.notify(
        row.userId,
        {
          type: 'ASSIGNMENT_GRADED',
          title: grading ? 'Assignment graded' : 'Assignment returned for revision',
          message: grading
            ? `${row.assignment.title}: ${scored!.score} / ${row.assignment.maxScore}.`
            : `${row.assignment.title} was returned with feedback. You can submit a revised attempt.`,
          link: `/assignments/${row.assignmentId}`,
        },
        tx,
      );
    });
    return this.getSubmission(auth, id);
  },

  async history(auth: AuthContext, id: string) {
    await findVisible(auth, id);
    const submissions = await prisma.submission.findMany({ where: { assignmentId: id }, select: { id: true } });
    return auditService.history(RESOURCE, id, { related: [{ resource: 'submission', ids: submissions.map((s) => s.id) }] });
  },
};
