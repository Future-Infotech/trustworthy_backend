import type { AlgorithmicImpactAssessment, Prisma, ReviewStatus } from '@prisma/client';
import { prisma, type DbClient } from '../config/prisma';
import type { AuthContext } from '../middleware/authorize';
import { PERMISSIONS } from '../rbac/permissions';
import { AppError, Errors } from '../utils/errors';
import { paginate, toSkipTake } from '../utils/pagination';
import {
  AIA_SECTIONS,
  aiaSectionsSchema,
  type AiaSections,
  type CreateAiaInput,
  type ListAssessmentsQuery,
  type ReviewDecisionInput,
  type UpdateAiaInput,
} from '../validators/assessment.validators';
import { auditService } from './audit.service';
import { DECISION_STATUS, EDITABLE, requireIndependentReviewer, requireOwner, requireStatus, workflowPermissions } from './governance/reviewWorkflow';
import { notificationService } from './notification.service';
import { toMarkdown, toPdf, type ReportDocument } from './reports/document';

const RESOURCE = 'impact_assessment';
const NOUN = 'impact assessment';
const MIN_SECTION_LENGTH = 10;

const include = {
  owner: { select: { id: true, firstName: true, lastName: true } },
  aiSystem: { select: { id: true, name: true, riskLevel: true } },
} satisfies Prisma.AlgorithmicImpactAssessmentInclude;
type Row = Prisma.AlgorithmicImpactAssessmentGetPayload<{ include: typeof include }>;

const fullName = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`.trim();
const isApprover = (auth: AuthContext) => auth.can(PERMISSIONS.AIA_APPROVE);
const parseSections = (row: Pick<AlgorithmicImpactAssessment, 'sections'>): AiaSections => aiaSectionsSchema.parse(row.sections ?? {});

export function readiness(sections: AiaSections) {
  const missing: { path: string; message: string }[] = [];
  for (const [key, label] of AIA_SECTIONS) {
    if (sections[key].length < MIN_SECTION_LENGTH) missing.push({ path: `sections.${key}`, message: `${label} is required` });
  }
  if (sections.harms.length === 0) missing.push({ path: 'sections.harms', message: 'Identify at least one potential harm' });
  sections.harms.forEach((h, i) => {
    if ((h.severity === 'HIGH' || h.severity === 'CRITICAL') && !h.mitigation) {
      missing.push({ path: `sections.harms.${i}.mitigation`, message: `Harm ${i + 1} is ${h.severity.toLowerCase()} severity and needs a mitigation` });
    }
  });
  const concerns: string[] = [];
  const severe = sections.harms.filter((h) => h.severity === 'CRITICAL' || (h.severity === 'HIGH' && h.likelihood !== 'LOW'));
  if (severe.length) concerns.push(`${severe.length} harm${severe.length === 1 ? ' is' : 's are'} rated high severity with non-trivial likelihood`);
  return { ready: missing.length === 0, missing, concerns };
}

async function linkedRisk(aiSystemId: string | null) {
  if (!aiSystemId) return null;
  return prisma.riskAssessment.findFirst({
    where: { aiSystemId, status: { not: 'RETIRED' } },
    orderBy: [{ reviewedAt: 'desc' }, { updatedAt: 'desc' }],
    select: { id: true, title: true, status: true, score: true, riskLevel: true },
  });
}

async function present(row: Row, auth: AuthContext) {
  const { owner, ...rest } = row;
  const sections = parseSections(row);
  const risk = await linkedRisk(row.aiSystemId);
  const check = readiness(sections);
  if (row.aiSystemId && !risk) check.concerns.push('The linked AI system has no risk assessment');
  if (risk && risk.status !== 'APPROVED') check.concerns.push('The linked risk assessment has not been approved');
  return {
    ...rest,
    sections,
    owner: { id: owner.id, name: fullName(owner) },
    linkedRiskAssessment: risk,
    readiness: check,
    permissions: workflowPermissions(row.status, row.ownerId === auth.actor.id, isApprover(auth), !!row.submittedAt),
  };
}

async function find(id: string) {
  const row = await prisma.algorithmicImpactAssessment.findUnique({ where: { id }, include });
  if (!row) throw Errors.notFound('Impact assessment');
  return row;
}

async function assertSystem(aiSystemId?: string | null) {
  if (aiSystemId && !(await prisma.aISystem.findUnique({ where: { id: aiSystemId }, select: { id: true } }))) {
    throw Errors.validation([{ path: 'aiSystemId', message: 'AI system not found' }]);
  }
}

/** Records a status change in both the AIA history (with a snapshot of the sections) and the audit log. */
async function recordTransition(
  db: DbClient,
  auth: AuthContext,
  row: Pick<AlgorithmicImpactAssessment, 'id' | 'sections'>,
  from: ReviewStatus | null,
  to: ReviewStatus,
  action: string,
  comment?: string,
) {
  await db.aIAStatusHistory.create({
    data: { assessmentId: row.id, fromStatus: from, toStatus: to, actorId: auth.actor.id, comment: comment || null, snapshot: row.sections as Prisma.InputJsonValue },
  });
  await auditService.record(
    { action: `${RESOURCE}.${action}`, resource: RESOURCE, resourceId: row.id, actor: auth.actor, context: auth.ctx, before: from ? { status: from } : undefined, after: { status: to }, reason: comment || undefined },
    db,
  );
}

export const impactAssessmentService = {
  async list(auth: AuthContext, q: ListAssessmentsQuery) {
    const where: Prisma.AlgorithmicImpactAssessmentWhereInput = {
      status: q.status,
      aiSystemId: q.aiSystemId,
      ownerId: q.mine ? auth.actor.id : undefined,
      title: q.search ? { contains: q.search } : undefined,
    };
    const [rows, total] = await Promise.all([
      prisma.algorithmicImpactAssessment.findMany({ where, include, orderBy: { updatedAt: 'desc' }, ...toSkipTake(q) }),
      prisma.algorithmicImpactAssessment.count({ where }),
    ]);
    const data = rows.map(({ sections, owner, ...r }) => ({
      ...r,
      owner: { id: owner.id, name: fullName(owner) },
      harmCount: parseSections({ sections }).harms.length,
    }));
    return paginate(data, total, q);
  },

  async get(auth: AuthContext, id: string) {
    return present(await find(id), auth);
  },

  async create(auth: AuthContext, input: CreateAiaInput) {
    await assertSystem(input.aiSystemId);
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.algorithmicImpactAssessment.create({
        data: { title: input.title, aiSystemId: input.aiSystemId ?? null, sections: input.sections as Prisma.InputJsonValue, ownerId: auth.actor.id, createdById: auth.actor.id },
      });
      await recordTransition(tx, auth, row, null, 'DRAFT', 'created');
      return row;
    });
    return this.get(auth, created.id);
  },

  async update(auth: AuthContext, id: string, input: UpdateAiaInput) {
    const row = await find(id);
    requireOwner(row.ownerId, auth, NOUN, 'edit it');
    requireStatus(row.status, EDITABLE, NOUN, 'edited');
    if (input.aiSystemId !== undefined) await assertSystem(input.aiSystemId);
    const before = parseSections(row);
    const changed = input.sections ? (Object.keys(input.sections) as (keyof AiaSections)[]).filter((k) => JSON.stringify(input.sections![k]) !== JSON.stringify(before[k])) : [];
    await prisma.$transaction(async (tx) => {
      await tx.algorithmicImpactAssessment.update({
        where: { id },
        data: { title: input.title, aiSystemId: input.aiSystemId, sections: input.sections as Prisma.InputJsonValue | undefined, updatedById: auth.actor.id },
      });
      await auditService.record({ action: `${RESOURCE}.updated`, resource: RESOURCE, resourceId: id, actor: auth.actor, context: auth.ctx, metadata: { changedSections: changed } }, tx);
    });
    return this.get(auth, id);
  },

  /** Resubmitting after a change request starts a new version so each reviewed revision stays identifiable. */
  async submit(auth: AuthContext, id: string) {
    const row = await find(id);
    requireOwner(row.ownerId, auth, NOUN, 'submit it');
    requireStatus(row.status, EDITABLE, NOUN, 'submitted');
    const check = readiness(parseSections(row));
    if (!check.ready) throw new AppError(422, 'AIA_INCOMPLETE', 'Complete every section before submitting for review', check.missing);
    await prisma.$transaction(async (tx) => {
      await tx.algorithmicImpactAssessment.update({
        where: { id },
        data: { status: 'SUBMITTED', submittedAt: new Date(), version: row.status === 'CHANGES_REQUESTED' ? { increment: 1 } : undefined, updatedById: auth.actor.id },
      });
      await recordTransition(tx, auth, row, row.status, 'SUBMITTED', 'submitted');
      await notificationService.notifyPermissionHolders(
        PERMISSIONS.AIA_APPROVE,
        { type: 'GOVERNANCE_REVIEW_REQUIRED', title: 'Impact assessment awaiting review', message: `${row.title} was submitted for governance approval.`, link: `/impact-assessments/${id}` },
        tx,
        { exclude: [row.ownerId] },
      );
    });
    return this.get(auth, id);
  },

  async withdraw(auth: AuthContext, id: string) {
    const row = await find(id);
    requireOwner(row.ownerId, auth, NOUN, 'withdraw it');
    requireStatus(row.status, ['SUBMITTED'], NOUN, 'withdrawn');
    await prisma.$transaction(async (tx) => {
      await tx.algorithmicImpactAssessment.update({ where: { id }, data: { status: 'DRAFT', updatedById: auth.actor.id } });
      await recordTransition(tx, auth, row, row.status, 'DRAFT', 'withdrawn');
    });
    return this.get(auth, id);
  },

  async startReview(auth: AuthContext, id: string) {
    const row = await find(id);
    requireStatus(row.status, ['SUBMITTED'], NOUN, 'taken into review');
    await requireIndependentReviewer(row.ownerId, auth, RESOURCE, id, NOUN);
    await prisma.$transaction(async (tx) => {
      await tx.algorithmicImpactAssessment.update({ where: { id }, data: { status: 'UNDER_REVIEW', updatedById: auth.actor.id } });
      await recordTransition(tx, auth, row, row.status, 'UNDER_REVIEW', 'review_started');
    });
    return this.get(auth, id);
  },

  async review(auth: AuthContext, id: string, { decision, comment }: ReviewDecisionInput) {
    const row = await find(id);
    requireStatus(row.status, ['UNDER_REVIEW'], NOUN, 'decided; start the review first');
    await requireIndependentReviewer(row.ownerId, auth, RESOURCE, id, NOUN);
    const to = DECISION_STATUS[decision];
    await prisma.$transaction(async (tx) => {
      await tx.algorithmicImpactAssessment.update({
        where: { id },
        data: { status: to, ...(to === 'APPROVED' ? { approvedAt: new Date(), approvedById: auth.actor.id } : {}), updatedById: auth.actor.id },
      });
      await recordTransition(tx, auth, row, row.status, to, decision === 'APPROVE' ? 'approved' : decision === 'REJECT' ? 'rejected' : 'changes_requested', comment);
      await notificationService.notify(
        row.ownerId,
        {
          type: 'SYSTEM',
          title: `Impact assessment ${to === 'CHANGES_REQUESTED' ? 'needs changes' : to.toLowerCase()}`,
          message: comment ? `${row.title}: ${comment}` : `${row.title} was ${to.toLowerCase()}.`,
          link: `/impact-assessments/${id}`,
        },
        tx,
      );
    });
    return this.get(auth, id);
  },

  async retire(auth: AuthContext, id: string, reason: string) {
    const row = await find(id);
    if (!isApprover(auth)) throw Errors.forbidden('Only approvers can retire impact assessments');
    requireStatus(row.status, ['APPROVED', 'REJECTED'], NOUN, 'retired');
    await prisma.$transaction(async (tx) => {
      await tx.algorithmicImpactAssessment.update({ where: { id }, data: { status: 'RETIRED', retiredAt: new Date(), updatedById: auth.actor.id } });
      await recordTransition(tx, auth, row, row.status, 'RETIRED', 'retired', reason);
    });
    return this.get(auth, id);
  },

  async remove(auth: AuthContext, id: string) {
    const row = await find(id);
    requireOwner(row.ownerId, auth, NOUN, 'delete it');
    if (row.status !== 'DRAFT' || row.submittedAt) throw Errors.conflict('Only never-submitted drafts can be deleted');
    await prisma.$transaction(async (tx) => {
      await tx.algorithmicImpactAssessment.delete({ where: { id } });
      await auditService.record({ action: `${RESOURCE}.deleted`, resource: RESOURCE, resourceId: id, actor: auth.actor, context: auth.ctx, before: { title: row.title } }, tx);
    });
  },

  /** Complete status history, oldest first, with the actor's name. Snapshots are returned so reviewers can see what was decided on. */
  async history(id: string) {
    await find(id);
    const rows = await prisma.aIAStatusHistory.findMany({ where: { assessmentId: id }, orderBy: { createdAt: 'asc' } });
    const actors = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.actorId))] } }, select: { id: true, firstName: true, lastName: true } });
    const names = new Map(actors.map((a) => [a.id, fullName(a)]));
    return {
      history: rows.map((r) => ({
        id: r.id,
        fromStatus: r.fromStatus,
        toStatus: r.toStatus,
        comment: r.comment,
        createdAt: r.createdAt,
        actor: { id: r.actorId, name: names.get(r.actorId) ?? 'Unknown user' },
        snapshot: r.snapshot ? aiaSectionsSchema.parse(r.snapshot) : null,
      })),
    };
  },

  async export(auth: AuthContext, id: string, format: 'json' | 'md' | 'pdf') {
    const row = await find(id);
    const sections = parseSections(row);
    const base = `impact-assessment-${row.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}-v${row.version}`;
    await auditService.record({ action: `${RESOURCE}.exported`, resource: RESOURCE, resourceId: id, actor: auth.actor, context: auth.ctx, metadata: { format } });
    const { history } = await this.history(id);
    if (format === 'json') {
      const body = { id: row.id, title: row.title, version: row.version, status: row.status, aiSystem: row.aiSystem, sections, history: history.map(({ snapshot: _s, ...h }) => h), exportedAt: new Date().toISOString() };
      return { body: Buffer.from(JSON.stringify(body, null, 2)), fileName: `${base}.json`, contentType: 'application/json' };
    }
    const doc = toDocument(row, sections, history);
    if (format === 'md') return { body: Buffer.from(toMarkdown(doc)), fileName: `${base}.md`, contentType: 'text/markdown; charset=utf-8' };
    return { body: await toPdf(doc), fileName: `${base}.pdf`, contentType: 'application/pdf' };
  },
};

const lower = (v: string) => v.toLowerCase().replace(/_/g, ' ');

function toDocument(row: Row, sections: AiaSections, history: { toStatus: ReviewStatus; comment: string | null; createdAt: Date; actor: { name: string } }[]): ReportDocument {
  return {
    title: `Algorithmic Impact Assessment: ${row.title}`,
    subtitle: `Version ${row.version} · ${lower(row.status)}`,
    watermark: row.status === 'APPROVED' ? undefined : `${lower(row.status).toUpperCase()}: not an approved impact assessment`,
    meta: [
      ['Assessment ID', row.id],
      ['AI system', row.aiSystem?.name ?? null],
      ['Owner', fullName(row.owner)],
      ['Submitted', row.submittedAt?.toISOString() ?? null],
      ['Approved', row.approvedAt?.toISOString() ?? null],
    ],
    sections: [
      ...AIA_SECTIONS.filter(([key]) => key !== 'potentialHarms').map(([key, label]) => ({ heading: label, paragraphs: [sections[key] || 'Not provided.'] })),
      {
        heading: 'Potential harms',
        paragraphs: [sections.potentialHarms || 'Not provided.'],
        table: { headers: ['Harm', 'Affected group', 'Likelihood', 'Severity', 'Mitigation'], rows: sections.harms.map((h) => [h.description, h.affectedGroup, lower(h.likelihood), lower(h.severity), h.mitigation]) },
      },
      {
        heading: 'Status history',
        table: { headers: ['Date', 'Status', 'By', 'Comment'], rows: history.map((h) => [h.createdAt.toISOString().slice(0, 16).replace('T', ' '), lower(h.toStatus), h.actor.name, h.comment ?? '']) },
      },
    ],
    disclaimer:
      'This assessment records the organisation’s own analysis of potential impacts. Approval reflects an internal governance decision; it is not a legal determination and does not establish that any regulatory requirement is satisfied.',
    generatedAt: new Date(),
  };
}
