import { randomBytes } from 'node:crypto';
import { Prisma, type Certificate, type RoleName } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../config/prisma';
import type { AuthContext } from '../middleware/authorize';
import { PERMISSIONS } from '../rbac/permissions';
import { AppError, Errors } from '../utils/errors';
import { paginate, toSkipTake } from '../utils/pagination';
import type { ListCertificatesQuery } from '../validators/certificate.validators';
import { auditService } from './audit.service';
import { fullName, peopleById, person, userSelect } from './governance/shared';
import { notificationService } from './notification.service';
import { certificatePdf } from './reports/certificatePdf';

const RESOURCE = 'certificate';

/** Minimum grade on every assigned assignment (the course's practical project work). */
export const ASSIGNMENT_PASS_PERCENT = 70;

export type RequirementKey = 'lessons' | 'labs' | 'quizzes' | 'final_exam' | 'assignments' | 'approval';

export interface RequirementItem {
  id: string;
  title: string;
  met: boolean;
  detail: string;
}

export interface Requirement {
  key: RequirementKey;
  label: string;
  met: boolean;
  completed: number;
  total: number;
  detail: string;
  items: RequirementItem[];
}

const pct = (n: number) => `${Math.round(n * 10) / 10}%`;

function requirement(key: RequirementKey, label: string, items: RequirementItem[], emptyDetail: string, unit: string): Requirement {
  const completed = items.filter((i) => i.met).length;
  return {
    key,
    label,
    met: completed === items.length,
    completed,
    total: items.length,
    detail: items.length ? `${completed} of ${items.length} ${unit} complete` : emptyDetail,
    items,
  };
}

/** Evaluates the automatic certification requirements from the learner's recorded activity. */
async function evaluate(userId: string, role: RoleName, courseId: string): Promise<Requirement[]> {
  const [lessonTotal, lessonsDone, labs, quizzes, assignments] = await Promise.all([
    prisma.lesson.count({ where: { module: { courseId } } }),
    prisma.progress.count({ where: { userId, status: 'COMPLETED', lesson: { module: { courseId } } } }),
    prisma.lab.findMany({
      where: { courseId, isRequired: true },
      select: { id: true, title: true, attempts: { where: { userId, status: 'COMPLETED' }, select: { completedAt: true }, take: 1 } },
      orderBy: { title: 'asc' },
    }),
    prisma.quiz.findMany({
      where: { courseId, isPublished: true },
      select: { id: true, title: true, isFinal: true, passingScore: true, attempts: { where: { userId, submittedAt: { not: null } }, select: { percentage: true, passed: true } } },
      orderBy: { title: 'asc' },
    }),
    prisma.assignment.findMany({
      where: { courseId, isPublished: true, OR: [{ targetRoles: { isEmpty: true } }, { targetRoles: { has: role } }] },
      select: { id: true, title: true, maxScore: true, submissions: { where: { userId, status: 'GRADED' }, select: { score: true } } },
      orderBy: { title: 'asc' },
    }),
  ]);

  const lessons: Requirement = {
    key: 'lessons',
    label: 'Complete all course modules',
    met: lessonTotal > 0 && lessonsDone >= lessonTotal,
    completed: lessonsDone,
    total: lessonTotal,
    detail: `${lessonsDone} of ${lessonTotal} lessons complete`,
    items: [],
  };

  const quizItem = (q: (typeof quizzes)[number]): RequirementItem => {
    const best = Math.max(-1, ...q.attempts.map((a) => a.percentage ?? 0));
    const passed = q.attempts.some((a) => a.passed);
    return { id: q.id, title: q.title, met: passed, detail: best < 0 ? 'Not attempted' : `Best score ${pct(best)} (pass mark ${q.passingScore}%)` };
  };

  return [
    lessons,
    requirement(
      'labs',
      'Complete the required labs',
      labs.map((l) => ({ id: l.id, title: l.title, met: l.attempts.length > 0, detail: l.attempts.length ? 'Completed' : 'Not completed' })),
      'This course has no required labs',
      'labs',
    ),
    requirement('quizzes', 'Pass the module quizzes', quizzes.filter((q) => !q.isFinal).map(quizItem), 'This course has no module quizzes', 'quizzes'),
    requirement('final_exam', 'Pass the final certification exam', quizzes.filter((q) => q.isFinal).map(quizItem), 'This course has no final exam', 'exams'),
    requirement(
      'assignments',
      `Score at least ${ASSIGNMENT_PASS_PERCENT}% on your assignments and final project`,
      assignments.map((a) => {
        const best = Math.max(-1, ...a.submissions.map((s) => ((s.score ?? 0) / a.maxScore) * 100));
        return {
          id: a.id,
          title: a.title,
          met: best >= ASSIGNMENT_PASS_PERCENT,
          detail: best < 0 ? 'Not graded yet' : `Graded ${pct(best)}`,
        };
      }),
      'No assignments are assigned to your role in this course',
      'assignments',
    ),
  ];
}

function approvalRequirement(cert: (Certificate & { approver?: { name: string } | null }) | null): Requirement {
  const detail = !cert
    ? 'Request your certificate once every other requirement is met'
    : cert.status === 'PENDING_APPROVAL'
      ? 'Awaiting faculty approval'
      : cert.status === 'ISSUED'
        ? `Approved${cert.approver ? ` by ${cert.approver.name}` : ''} on ${cert.issuedAt?.toISOString().slice(0, 10)}`
        : `Revoked on ${cert.revokedAt?.toISOString().slice(0, 10)}`;
  const met = cert?.status === 'ISSUED';
  return { key: 'approval', label: 'Faculty approval', met, completed: met ? 1 : 0, total: 1, detail, items: [] };
}

const verificationUrl = (code: string) => `${env.APP_PUBLIC_URL.replace(/\/$/, '')}/verify/${code}`;

const include = {
  user: { select: { ...userSelect, email: true } },
  course: { select: { id: true, title: true } },
} satisfies Prisma.CertificateInclude;
type Row = Prisma.CertificateGetPayload<{ include: typeof include }>;

const canManage = (auth: AuthContext) => auth.can(PERMISSIONS.CERTIFICATES_MANAGE);

async function find(auth: AuthContext, id: string) {
  const row = await prisma.certificate.findUnique({ where: { id }, include });
  if (!row || (row.userId !== auth.actor.id && !canManage(auth))) throw Errors.notFound('Certificate');
  return row;
}

async function holderRole(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { role: { select: { name: true } } } });
  return user.role.name;
}

function notEligible(requirements: Requirement[], message: string) {
  const unmet = requirements.filter((r) => !r.met && r.key !== 'approval').map((r) => ({ path: r.key, message: `${r.label}: ${r.detail}` }));
  return new AppError(422, 'CERTIFICATE_NOT_ELIGIBLE', message, unmet);
}

/** Sequential human-readable number per year, e.g. TAI-2026-000042. */
async function nextNumber(tx: Prisma.TransactionClient, year: number) {
  const prefix = `TAI-${year}-`;
  const last = await tx.certificate.findFirst({ where: { certificateNumber: { startsWith: prefix } }, orderBy: { certificateNumber: 'desc' }, select: { certificateNumber: true } });
  const seq = last ? Number(last.certificateNumber.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(seq).padStart(6, '0')}`;
}

function present(row: Row, auth: AuthContext, approver: { id: string; name: string } | null) {
  const { user, metadata, ...rest } = row;
  const manager = canManage(auth);
  const own = row.userId === auth.actor.id;
  const meta = (metadata ?? {}) as { requirements?: Requirement[]; approvalComment?: string };
  return {
    ...rest,
    holder: { ...person(user)!, email: manager ? user.email : undefined },
    approvedBy: approver,
    approvalComment: meta.approvalComment ?? null,
    revokedReason: row.revokedReason,
    verificationUrl: row.status === 'PENDING_APPROVAL' ? null : verificationUrl(row.verificationCode),
    verificationCode: row.status === 'PENDING_APPROVAL' ? null : row.verificationCode,
    requirementsAtRequest: meta.requirements ?? [],
    permissions: {
      canApprove: manager && !own && row.status === 'PENDING_APPROVAL',
      canDecline: manager && !own && row.status === 'PENDING_APPROVAL',
      canRevoke: manager && !own && row.status === 'ISSUED',
      canDownload: row.status === 'ISSUED',
    },
  };
}

export const certificateService = {
  /** Live requirement checklist for one course, or every course the caller is enrolled in. */
  async eligibility(auth: AuthContext, courseId?: string) {
    const enrollments = await prisma.enrollment.findMany({
      where: { userId: auth.actor.id, status: { not: 'DROPPED' }, ...(courseId ? { courseId } : {}) },
      select: { courseId: true, course: { select: { id: true, title: true } } },
      orderBy: { enrolledAt: 'asc' },
    });
    if (courseId && !enrollments.length) {
      const course = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true, title: true } });
      if (!course) throw Errors.notFound('Course');
      return [{ course, enrolled: false, eligible: false, requirements: [] as Requirement[], certificate: null }];
    }
    const certs = await prisma.certificate.findMany({ where: { userId: auth.actor.id, courseId: { in: enrollments.map((e) => e.courseId) } } });
    const approvers = await peopleById(certs.map((c) => c.approvedById));
    return Promise.all(
      enrollments.map(async (e) => {
        const requirements = await evaluate(auth.actor.id, auth.actor.role, e.courseId);
        const cert = certs.find((c) => c.courseId === e.courseId) ?? null;
        return {
          course: e.course,
          enrolled: true,
          eligible: requirements.every((r) => r.met),
          requirements: [...requirements, approvalRequirement(cert && { ...cert, approver: cert.approvedById ? approvers.get(cert.approvedById) : null })],
          certificate: cert && { id: cert.id, status: cert.status, certificateNumber: cert.certificateNumber },
        };
      }),
    );
  },

  async request(auth: AuthContext, courseId: string) {
    const enrollment = await prisma.enrollment.findUnique({ where: { userId_courseId: { userId: auth.actor.id, courseId } }, include: { course: { select: { title: true } } } });
    if (!enrollment || enrollment.status === 'DROPPED') throw Errors.conflict('Enrol in the course before requesting a certificate');
    const existing = await prisma.certificate.findUnique({ where: { userId_courseId: { userId: auth.actor.id, courseId } } });
    if (existing) {
      throw Errors.conflict(
        existing.status === 'REVOKED' ? 'Your certificate for this course was revoked; contact your faculty' : `You already have a ${existing.status === 'ISSUED' ? 'certificate' : 'pending request'} for this course`,
      );
    }
    const requirements = await evaluate(auth.actor.id, auth.actor.role, courseId);
    if (!requirements.every((r) => r.met)) throw notEligible(requirements, 'Complete every requirement before requesting a certificate');
    const holder = await prisma.user.findUniqueOrThrow({ where: { id: auth.actor.id }, select: userSelect });

    const now = new Date();
    for (let attempt = 0; ; attempt++) {
      try {
        const created = await prisma.$transaction(async (tx) => {
          const row = await tx.certificate.create({
            data: {
              userId: auth.actor.id,
              courseId,
              certificateNumber: await nextNumber(tx, now.getUTCFullYear()),
              verificationCode: randomBytes(18).toString('base64url'),
              status: 'PENDING_APPROVAL',
              metadata: { requestedAt: now.toISOString(), role: auth.actor.role, requirements } as unknown as Prisma.InputJsonValue,
            },
          });
          await auditService.record(
            { action: `${RESOURCE}.requested`, resource: RESOURCE, resourceId: row.id, actor: auth.actor, context: auth.ctx, after: { courseId, certificateNumber: row.certificateNumber } },
            tx,
          );
          await notificationService.notifyPermissionHolders(
            PERMISSIONS.CERTIFICATES_MANAGE,
            {
              type: 'SYSTEM',
              title: 'Certificate awaiting approval',
              message: `${fullName(holder)} completed every requirement of ${enrollment.course.title} and requested a certificate.`,
              link: `/certificates/${row.id}`,
            },
            tx,
            { exclude: [auth.actor.id] },
          );
          return row;
        });
        return this.get(auth, created.id);
      } catch (err) {
        const numberTaken = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && String(err.meta?.target ?? '').includes('certificateNumber');
        if (!numberTaken || attempt >= 4) throw err;
      }
    }
  },

  async list(auth: AuthContext, q: ListCertificatesQuery) {
    const all = canManage(auth) && !q.mine;
    const search = q.search
      ? {
          OR: [
            { certificateNumber: { contains: q.search, mode: 'insensitive' as const } },
            { user: { OR: [{ firstName: { contains: q.search, mode: 'insensitive' as const } }, { lastName: { contains: q.search, mode: 'insensitive' as const } }] } },
            { course: { title: { contains: q.search, mode: 'insensitive' as const } } },
          ],
        }
      : {};
    const where: Prisma.CertificateWhereInput = { ...(all ? {} : { userId: auth.actor.id }), status: q.status, ...search };
    const [rows, total, pending] = await Promise.all([
      prisma.certificate.findMany({ where, include, orderBy: { createdAt: 'desc' }, ...toSkipTake(q) }),
      prisma.certificate.count({ where }),
      all ? prisma.certificate.count({ where: { status: 'PENDING_APPROVAL', userId: { not: auth.actor.id } } }) : Promise.resolve(0),
    ]);
    const data = rows.map(({ user, metadata: _m, verificationCode: _v, ...r }) => ({ ...r, holder: { ...person(user)!, email: all ? user.email : undefined } }));
    return { ...paginate(data, total, q), pendingApprovals: pending };
  },

  async get(auth: AuthContext, id: string) {
    const row = await find(auth, id);
    const approvers = await peopleById([row.approvedById]);
    const result = present(row, auth, row.approvedById ? approvers.get(row.approvedById) ?? null : null);
    const liveRequirements = row.status === 'PENDING_APPROVAL' && canManage(auth) ? await evaluate(row.userId, await holderRole(row.userId), row.courseId) : null;
    return { ...result, liveRequirements };
  },

  /** Faculty sign-off; the requirements are re-checked so progress lost since the request cannot slip through. */
  async approve(auth: AuthContext, id: string, comment?: string) {
    const row = await find(auth, id);
    if (row.userId === auth.actor.id) throw Errors.forbidden('You cannot approve your own certificate');
    if (row.status !== 'PENDING_APPROVAL') throw Errors.conflict(`This certificate is already ${row.status.toLowerCase().replace('_', ' ')}`);
    const requirements = await evaluate(row.userId, await holderRole(row.userId), row.courseId);
    if (!requirements.every((r) => r.met)) throw notEligible(requirements, 'The learner no longer meets every requirement');
    const enrollment = await prisma.enrollment.findUnique({ where: { userId_courseId: { userId: row.userId, courseId: row.courseId } }, select: { completedAt: true } });
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.certificate.updateMany({
        where: { id, status: 'PENDING_APPROVAL' },
        data: {
          status: 'ISSUED',
          issuedAt: now,
          completionDate: enrollment?.completedAt ?? now,
          approvedById: auth.actor.id,
          metadata: { ...((row.metadata ?? {}) as object), approvalComment: comment || undefined, requirementsAtApproval: requirements } as unknown as Prisma.InputJsonValue,
        },
      });
      if (!count) throw Errors.conflict('This certificate was decided by someone else');
      await auditService.record(
        { action: `${RESOURCE}.issued`, resource: RESOURCE, resourceId: id, actor: auth.actor, context: auth.ctx, before: { status: row.status }, after: { status: 'ISSUED' }, reason: comment || undefined, metadata: { holderId: row.userId, certificateNumber: row.certificateNumber } },
        tx,
      );
      await notificationService.notify(
        row.userId,
        { type: 'CERTIFICATE_ISSUED', title: 'Certificate issued', message: `Your certificate for ${row.course.title} (${row.certificateNumber}) has been issued.`, link: `/certificates/${id}` },
        tx,
      );
    });
    return this.get(auth, id);
  },

  /** Rejects a pending request; the record is removed so the learner can request again once ready. */
  async decline(auth: AuthContext, id: string, reason: string) {
    const row = await find(auth, id);
    if (row.userId === auth.actor.id) throw Errors.forbidden('You cannot decide your own certificate request');
    if (row.status !== 'PENDING_APPROVAL') throw Errors.conflict('Only pending requests can be declined');
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.certificate.deleteMany({ where: { id, status: 'PENDING_APPROVAL' } });
      if (!count) throw Errors.conflict('This certificate was decided by someone else');
      await auditService.record(
        { action: `${RESOURCE}.declined`, resource: RESOURCE, resourceId: id, actor: auth.actor, context: auth.ctx, before: { status: row.status, certificateNumber: row.certificateNumber }, reason, metadata: { holderId: row.userId, courseId: row.courseId } },
        tx,
      );
      await notificationService.notify(
        row.userId,
        { type: 'SYSTEM', title: 'Certificate request declined', message: `${row.course.title}: ${reason}`, link: '/certificates' },
        tx,
      );
    });
  },

  async revoke(auth: AuthContext, id: string, reason: string) {
    const row = await find(auth, id);
    if (row.userId === auth.actor.id) throw Errors.forbidden('You cannot revoke your own certificate');
    if (row.status !== 'ISSUED') throw Errors.conflict('Only issued certificates can be revoked');
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.certificate.update({ where: { id }, data: { status: 'REVOKED', revokedAt: now, revokedReason: reason } });
      await auditService.record(
        { action: `${RESOURCE}.revoked`, resource: RESOURCE, resourceId: id, actor: auth.actor, context: auth.ctx, before: { status: 'ISSUED' }, after: { status: 'REVOKED' }, reason, severity: 'MEDIUM', metadata: { holderId: row.userId, certificateNumber: row.certificateNumber } },
        tx,
      );
      await notificationService.notify(
        row.userId,
        { type: 'SYSTEM', title: 'Certificate revoked', message: `Your certificate ${row.certificateNumber} for ${row.course.title} was revoked: ${reason}`, link: `/certificates/${id}` },
        tx,
      );
    });
    return this.get(auth, id);
  },

  async history(auth: AuthContext, id: string) {
    await find(auth, id);
    return auditService.history(RESOURCE, id);
  },

  async pdf(auth: AuthContext, id: string) {
    const row = await find(auth, id);
    if (row.status !== 'ISSUED') throw Errors.conflict(row.status === 'REVOKED' ? 'Revoked certificates cannot be downloaded' : 'The certificate has not been issued yet');
    const approvers = await peopleById([row.approvedById]);
    const body = await certificatePdf({
      holderName: fullName(row.user),
      courseTitle: row.course.title,
      certificateNumber: row.certificateNumber,
      issuedAt: row.issuedAt!,
      completionDate: row.completionDate,
      approvedBy: row.approvedById ? approvers.get(row.approvedById)?.name ?? null : null,
      verificationUrl: verificationUrl(row.verificationCode),
    });
    await auditService.record({ action: `${RESOURCE}.downloaded`, resource: RESOURCE, resourceId: id, actor: auth.actor, context: auth.ctx });
    return { body, fileName: `${row.certificateNumber}.pdf`, contentType: 'application/pdf' };
  },

  /** Public verification: only what is printed on the certificate itself; never contact details. */
  async verify(code: string) {
    const row = await prisma.certificate.findUnique({ where: { verificationCode: code }, include: { user: { select: userSelect }, course: { select: { title: true } } } });
    if (!row || row.status === 'PENDING_APPROVAL') throw Errors.notFound('Certificate');
    return {
      valid: row.status === 'ISSUED',
      status: row.status,
      certificateNumber: row.certificateNumber,
      holderName: fullName(row.user),
      courseTitle: row.course.title,
      issuedAt: row.issuedAt,
      completionDate: row.completionDate,
      revokedAt: row.revokedAt,
      issuer: 'TrustAI360',
    };
  },
};
