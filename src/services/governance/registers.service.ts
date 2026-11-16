import type { ComplianceRequirement, Prisma, ReviewStatus, RiskRegisterEntry, VendorAssessment } from '@prisma/client';
import { prisma } from '../../config/prisma';
import type { AuthContext } from '../../middleware/authorize';
import { Errors } from '../../utils/errors';
import { paginate, toSkipTake } from '../../utils/pagination';
import {
  vendorFindingsSchema,
  type CreateOversightInput,
  type CreateReviewInput,
  type CreateRiskEntryInput,
  type CreateVendorInput,
  type ListComplianceQuery,
  type ListOversightQuery,
  type ListReviewsQuery,
  type ListRiskEntriesQuery,
  type ListVendorsQuery,
  type UpdateComplianceInput,
  type UpdateRiskEntryInput,
  type UpdateVendorInput,
} from '../../validators/governance.validators';
import { auditService } from '../audit.service';
import { EDITABLE, requireIndependentReviewer, requireStatus } from './reviewWorkflow';
import { addDays, assertRefs, changes, peopleById } from './shared';

// ── Risk register ───────────────────────────────────────────────────────────

const RISK = 'risk_entry';

/** Validates the derived scores and closure rules for a register entry after applying `input`. */
function checkRiskEntry(merged: Pick<RiskRegisterEntry, 'likelihood' | 'impact' | 'residualScore' | 'status' | 'mitigation'>) {
  const inherent = merged.likelihood * merged.impact;
  const issues: { path: string; message: string }[] = [];
  if (merged.residualScore != null && merged.residualScore > inherent) issues.push({ path: 'residualScore', message: `Residual score cannot exceed the inherent score (${inherent})` });
  if ((merged.status === 'ACCEPTED' || merged.status === 'CLOSED') && !merged.mitigation) issues.push({ path: 'mitigation', message: 'Document the mitigation or acceptance rationale' });
  if (issues.length) throw Errors.validation(issues);
  return inherent;
}

export const riskRegisterService = {
  async list(q: ListRiskEntriesQuery) {
    const where: Prisma.RiskRegisterEntryWhereInput = {
      status: q.status,
      category: q.category,
      aiSystemId: q.aiSystemId,
      title: q.search ? { contains: q.search, mode: 'insensitive' } : undefined,
    };
    const [rows, total] = await Promise.all([
      prisma.riskRegisterEntry.findMany({ where, include: { aiSystem: { select: { id: true, name: true } } }, orderBy: [{ inherentScore: 'desc' }, { updatedAt: 'desc' }], ...toSkipTake(q) }),
      prisma.riskRegisterEntry.count({ where }),
    ]);
    const owners = await peopleById(rows.map((r) => r.ownerId));
    const now = new Date();
    return paginate(
      rows.map((r) => ({ ...r, owner: r.ownerId ? (owners.get(r.ownerId) ?? null) : null, reviewOverdue: r.status !== 'CLOSED' && !!r.reviewDate && r.reviewDate < now })),
      total,
      q,
    );
  },

  async create(auth: AuthContext, input: CreateRiskEntryInput) {
    await assertRefs({ aiSystemId: input.aiSystemId, userId: [['ownerId', input.ownerId]] });
    const inherentScore = checkRiskEntry({ ...input, residualScore: input.residualScore ?? null, mitigation: input.mitigation });
    return prisma.$transaction(async (tx) => {
      const row = await tx.riskRegisterEntry.create({ data: { ...input, inherentScore, createdById: auth.actor.id } });
      await auditService.record({ action: `${RISK}.created`, resource: RISK, resourceId: row.id, actor: auth.actor, context: auth.ctx, after: { title: row.title, inherentScore, status: row.status } }, tx);
      return row;
    });
  },

  async update(auth: AuthContext, id: string, input: UpdateRiskEntryInput) {
    const row = await prisma.riskRegisterEntry.findUnique({ where: { id } });
    if (!row) throw Errors.notFound('Risk register entry');
    await assertRefs({ aiSystemId: input.aiSystemId, userId: [['ownerId', input.ownerId]] });
    const merged = { ...row, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) } as RiskRegisterEntry;
    const inherentScore = checkRiskEntry(merged);
    const diff = changes(row, { ...input, inherentScore } as Partial<RiskRegisterEntry>);
    return prisma.$transaction(async (tx) => {
      const updated = await tx.riskRegisterEntry.update({ where: { id }, data: { ...input, inherentScore, updatedById: auth.actor.id } });
      await auditService.record({ action: `${RISK}.updated`, resource: RISK, resourceId: id, actor: auth.actor, context: auth.ctx, before: diff.before, after: diff.after }, tx);
      return updated;
    });
  },
};

// ── Compliance checklist ────────────────────────────────────────────────────

const COMPLIANCE = 'compliance_requirement';

/**
 * Status rules. There is no "compliant" outcome: REVIEWED only records that a person reviewed the
 * evidence, and requirements flagged for legal review must pass through NEEDS_LEGAL_REVIEW first.
 */
function checkCompliance(row: ComplianceRequirement, input: UpdateComplianceInput) {
  const to = input.status;
  if (!to || to === row.status) return;
  const evidence = input.evidence === undefined ? row.evidence : input.evidence;
  const issues: { path: string; message: string }[] = [];
  if ((to === 'EVIDENCE_PROVIDED' || to === 'NEEDS_LEGAL_REVIEW' || to === 'REVIEWED') && !evidence) issues.push({ path: 'evidence', message: 'Attach or describe the evidence first' });
  if (to === 'REVIEWED' && row.requiresLegalReview && row.status !== 'NEEDS_LEGAL_REVIEW') issues.push({ path: 'status', message: 'This requirement must go through legal review before it is marked reviewed' });
  if (to === 'REVIEWED' && !input.note) issues.push({ path: 'note', message: 'Record who reviewed the evidence and their conclusion' });
  if (issues.length) throw Errors.validation(issues);
}

export const complianceService = {
  async list(q: ListComplianceQuery) {
    const where: Prisma.ComplianceRequirementWhereInput = {
      framework: q.framework,
      status: q.status,
      OR: q.search ? [{ title: { contains: q.search, mode: 'insensitive' } }, { code: { contains: q.search, mode: 'insensitive' } }] : undefined,
    };
    const [rows, total, frameworks] = await Promise.all([
      prisma.complianceRequirement.findMany({ where, orderBy: [{ framework: 'asc' }, { code: 'asc' }], ...toSkipTake(q) }),
      prisma.complianceRequirement.count({ where }),
      prisma.complianceRequirement.findMany({ distinct: ['framework'], select: { framework: true }, orderBy: { framework: 'asc' } }),
    ]);
    const owners = await peopleById(rows.map((r) => r.ownerId));
    return {
      ...paginate(
        rows.map((r) => ({ ...r, owner: r.ownerId ? (owners.get(r.ownerId) ?? null) : null })),
        total,
        q,
      ),
      frameworks: frameworks.map((f) => f.framework),
      disclaimer: 'Potential compliance considerations only. Statuses track internal review progress and never indicate that a legal requirement is satisfied; qualified human and legal review is required.',
    };
  },

  async update(auth: AuthContext, id: string, input: UpdateComplianceInput) {
    const row = await prisma.complianceRequirement.findUnique({ where: { id } });
    if (!row) throw Errors.notFound('Compliance requirement');
    checkCompliance(row, input);
    await assertRefs({ userId: [['ownerId', input.ownerId]] });
    const { note, ...fields } = input;
    const diff = changes(row, fields as Partial<ComplianceRequirement>);
    return prisma.$transaction(async (tx) => {
      const updated = await tx.complianceRequirement.update({
        where: { id },
        data: { ...fields, lastReviewedAt: fields.status === 'REVIEWED' ? new Date() : undefined, updatedById: auth.actor.id },
      });
      await auditService.record(
        { action: diff.keys.includes('status') ? `${COMPLIANCE}.status_changed` : `${COMPLIANCE}.updated`, resource: COMPLIANCE, resourceId: id, actor: auth.actor, context: auth.ctx, before: diff.before, after: diff.after, reason: note || undefined },
        tx,
      );
      return updated;
    });
  },
};

// ── Vendor AI assessments ───────────────────────────────────────────────────

const VENDOR = 'vendor_assessment';
type VendorDecision = 'START_REVIEW' | 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES';
const VENDOR_DECISION: Record<VendorDecision, { from: ReviewStatus[]; to: ReviewStatus }> = {
  START_REVIEW: { from: ['DRAFT', 'SUBMITTED', 'CHANGES_REQUESTED'], to: 'UNDER_REVIEW' },
  APPROVE: { from: ['UNDER_REVIEW'], to: 'APPROVED' },
  REJECT: { from: ['UNDER_REVIEW'], to: 'REJECTED' },
  REQUEST_CHANGES: { from: ['UNDER_REVIEW'], to: 'CHANGES_REQUESTED' },
};

const presentVendor = (row: VendorAssessment & { aiSystem: { id: string; name: string } | null }, assessor: { id: string; name: string } | null) => ({
  ...row,
  findings: vendorFindingsSchema.parse(row.findings ?? {}),
  assessor,
});

export const vendorService = {
  async list(q: ListVendorsQuery) {
    const where: Prisma.VendorAssessmentWhereInput = {
      status: q.status,
      OR: q.search ? [{ vendorName: { contains: q.search, mode: 'insensitive' } }, { productName: { contains: q.search, mode: 'insensitive' } }] : undefined,
    };
    const [rows, total] = await Promise.all([
      prisma.vendorAssessment.findMany({ where, include: { aiSystem: { select: { id: true, name: true } } }, orderBy: { assessmentDate: 'desc' }, ...toSkipTake(q) }),
      prisma.vendorAssessment.count({ where }),
    ]);
    const people = await peopleById(rows.map((r) => r.assessorId));
    return paginate(
      rows.map((r) => presentVendor(r, people.get(r.assessorId) ?? null)),
      total,
      q,
    );
  },

  async create(auth: AuthContext, input: CreateVendorInput) {
    await assertRefs({ aiSystemId: input.aiSystemId });
    return prisma.$transaction(async (tx) => {
      const row = await tx.vendorAssessment.create({ data: { ...input, findings: input.findings as Prisma.InputJsonValue, assessorId: auth.actor.id } });
      await auditService.record({ action: `${VENDOR}.created`, resource: VENDOR, resourceId: row.id, actor: auth.actor, context: auth.ctx, after: { vendorName: row.vendorName, productName: row.productName } }, tx);
      return row;
    });
  },

  async update(auth: AuthContext, id: string, input: UpdateVendorInput) {
    const row = await prisma.vendorAssessment.findUnique({ where: { id } });
    if (!row) throw Errors.notFound('Vendor assessment');
    requireStatus(row.status, EDITABLE, 'vendor assessment', 'edited');
    await assertRefs({ aiSystemId: input.aiSystemId });
    const diff = changes(row, input as Partial<VendorAssessment>);
    return prisma.$transaction(async (tx) => {
      const updated = await tx.vendorAssessment.update({ where: { id }, data: { ...input, findings: input.findings as Prisma.InputJsonValue | undefined } });
      await auditService.record({ action: `${VENDOR}.updated`, resource: VENDOR, resourceId: id, actor: auth.actor, context: auth.ctx, metadata: { changedFields: diff.keys } }, tx);
      return updated;
    });
  },

  /** The assessor cannot approve their own vendor assessment. */
  async decide(auth: AuthContext, id: string, { decision, comment }: { decision: VendorDecision; comment: string }) {
    const row = await prisma.vendorAssessment.findUnique({ where: { id } });
    if (!row) throw Errors.notFound('Vendor assessment');
    const rule = VENDOR_DECISION[decision];
    requireStatus(row.status, rule.from, 'vendor assessment', decision === 'START_REVIEW' ? 'taken into review' : 'decided');
    if (decision !== 'START_REVIEW') await requireIndependentReviewer(row.assessorId, auth, VENDOR, id, 'vendor assessment');
    return prisma.$transaction(async (tx) => {
      const updated = await tx.vendorAssessment.update({ where: { id }, data: { status: rule.to } });
      await auditService.record(
        { action: `${VENDOR}.${decision.toLowerCase()}`, resource: VENDOR, resourceId: id, actor: auth.actor, context: auth.ctx, before: { status: row.status }, after: { status: rule.to }, reason: comment || undefined },
        tx,
      );
      return updated;
    });
  },
};

// ── Human oversight records (append-only evidence) ──────────────────────────

const OVERSIGHT = 'oversight_record';

export const oversightService = {
  async list(q: ListOversightQuery) {
    const where: Prisma.OversightRecordWhereInput = { aiSystemId: q.aiSystemId, modelId: q.modelId, decision: q.decision };
    const [rows, total] = await Promise.all([
      prisma.oversightRecord.findMany({ where, include: { aiSystem: { select: { id: true, name: true } }, model: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' }, ...toSkipTake(q) }),
      prisma.oversightRecord.count({ where }),
    ]);
    const people = await peopleById(rows.map((r) => r.reviewerId));
    return paginate(
      rows.map((r) => ({ ...r, reviewer: people.get(r.reviewerId) ?? null })),
      total,
      q,
    );
  },

  async create(auth: AuthContext, input: CreateOversightInput) {
    await assertRefs({ aiSystemId: input.aiSystemId, modelId: input.modelId });
    return prisma.$transaction(async (tx) => {
      const row = await tx.oversightRecord.create({ data: { ...input, reviewerId: auth.actor.id } });
      await auditService.record(
        {
          action: `${OVERSIGHT}.created`,
          resource: OVERSIGHT,
          resourceId: row.id,
          actor: auth.actor,
          context: auth.ctx,
          severity: input.decision === 'OVERRODE_RECOMMENDATION' || input.decision === 'ESCALATED' ? 'MEDIUM' : 'INFO',
          after: { decision: row.decision, decisionReference: row.decisionReference },
        },
        tx,
      );
      return row;
    });
  },
};

// ── Review schedules ────────────────────────────────────────────────────────

const REVIEW = 'review_schedule';
type Reviewable = CreateReviewInput['resourceType'];

async function resourceNames(items: { resourceType: string; resourceId: string }[]) {
  const ids = (type: Reviewable) => items.filter((i) => i.resourceType === type).map((i) => i.resourceId);
  const [systems, models, policies, reqs] = await Promise.all([
    prisma.aISystem.findMany({ where: { id: { in: ids('AISystem') } }, select: { id: true, name: true } }),
    prisma.aIModel.findMany({ where: { id: { in: ids('AIModel') } }, select: { id: true, name: true } }),
    prisma.governancePolicy.findMany({ where: { id: { in: ids('GovernancePolicy') } }, select: { id: true, title: true } }),
    prisma.complianceRequirement.findMany({ where: { id: { in: ids('ComplianceRequirement') } }, select: { id: true, code: true, title: true } }),
  ]);
  return new Map<string, string>([
    ...systems.map((s) => [s.id, s.name] as const),
    ...models.map((m) => [m.id, m.name] as const),
    ...policies.map((p) => [p.id, p.title] as const),
    ...reqs.map((r) => [r.id, `${r.code} ${r.title}`] as const),
  ]);
}

/** Keeps the reviewed resource's own review dates in step with its schedule. */
async function syncResourceDates(tx: Prisma.TransactionClient, type: string, id: string, reviewedAt: Date, nextReviewAt: Date) {
  if (type === 'AISystem') await tx.aISystem.update({ where: { id }, data: { lastReviewedAt: reviewedAt, nextReviewAt } });
  else if (type === 'AIModel') await tx.aIModel.update({ where: { id }, data: { nextReviewAt } });
  else if (type === 'GovernancePolicy') await tx.governancePolicy.update({ where: { id }, data: { reviewDate: nextReviewAt } });
  else if (type === 'ComplianceRequirement') await tx.complianceRequirement.update({ where: { id }, data: { nextReviewAt } });
}

export const reviewScheduleService = {
  async list(q: ListReviewsQuery) {
    const where: Prisma.ReviewScheduleWhereInput = {
      resourceType: q.resourceType,
      nextReviewAt: q.dueWithinDays !== undefined ? { lte: addDays(new Date(), q.dueWithinDays) } : undefined,
    };
    const [rows, total] = await Promise.all([prisma.reviewSchedule.findMany({ where, orderBy: { nextReviewAt: 'asc' }, ...toSkipTake(q) }), prisma.reviewSchedule.count({ where })]);
    const [names, people] = await Promise.all([resourceNames(rows), peopleById(rows.map((r) => r.assigneeId))]);
    const now = new Date();
    return paginate(
      rows.map((r) => ({ ...r, resourceName: names.get(r.resourceId) ?? 'Deleted resource', assignee: r.assigneeId ? (people.get(r.assigneeId) ?? null) : null, overdue: r.nextReviewAt < now })),
      total,
      q,
    );
  },

  async create(auth: AuthContext, input: CreateReviewInput) {
    await assertRefs({ userId: [['assigneeId', input.assigneeId]] });
    if (!(await resourceNames([input])).has(input.resourceId)) throw Errors.validation([{ path: 'resourceId', message: 'The resource to review was not found' }]);
    return prisma.$transaction(async (tx) => {
      const row = await tx.reviewSchedule.create({ data: input });
      await auditService.record({ action: `${REVIEW}.created`, resource: REVIEW, resourceId: row.id, actor: auth.actor, context: auth.ctx, after: input }, tx);
      return row;
    });
  },

  async complete(auth: AuthContext, id: string, notes: string) {
    const row = await prisma.reviewSchedule.findUnique({ where: { id } });
    if (!row) throw Errors.notFound('Review schedule');
    const now = new Date();
    const nextReviewAt = addDays(now, row.frequencyDays);
    return prisma.$transaction(async (tx) => {
      const updated = await tx.reviewSchedule.update({ where: { id }, data: { lastReviewedAt: now, nextReviewAt } });
      await syncResourceDates(tx, row.resourceType, row.resourceId, now, nextReviewAt);
      await auditService.record(
        { action: `${REVIEW}.completed`, resource: REVIEW, resourceId: id, actor: auth.actor, context: auth.ctx, reason: notes, before: { nextReviewAt: row.nextReviewAt }, after: { lastReviewedAt: now, nextReviewAt }, metadata: { resourceType: row.resourceType, resourceId: row.resourceId } },
        tx,
      );
      return updated;
    });
  },
};

