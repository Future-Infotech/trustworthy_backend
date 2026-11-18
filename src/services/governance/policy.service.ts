import type { GovernancePolicy, PolicyStatus, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import type { AuthContext } from '../../middleware/authorize';
import { PERMISSIONS } from '../../rbac/permissions';
import { Errors } from '../../utils/errors';
import { paginate, toSkipTake } from '../../utils/pagination';
import type { CreatePolicyInput, ListPoliciesQuery, UpdatePolicyInput } from '../../validators/governance.validators';
import { auditService } from '../audit.service';
import { nextVersion } from '../modelCard.service';
import { addDays, changes, peopleById, person, slugify, userSelect } from './shared';

const RESOURCE = 'policy';
const DEFAULT_REVIEW_DAYS = 365;

const include = { owner: { select: userSelect } } satisfies Prisma.GovernancePolicyInclude;
type Row = Prisma.GovernancePolicyGetPayload<{ include: typeof include }>;

async function find(id: string) {
  const row = await prisma.governancePolicy.findUnique({ where: { id }, include });
  if (!row) throw Errors.notFound('Policy');
  return row;
}

function requireStatus(row: GovernancePolicy, allowed: PolicyStatus[], action: string) {
  if (!allowed.includes(row.status)) throw Errors.conflict(`A ${row.status.toLowerCase().replace('_', ' ')} policy cannot be ${action}`);
}

async function uniqueSlug(title: string) {
  const base = slugify(title);
  for (let i = 1; ; i++) {
    const slug = i === 1 ? base : `${base}-${i}`;
    if (!(await prisma.governancePolicy.findUnique({ where: { slug }, select: { id: true } }))) return slug;
  }
}

async function present(row: Row, auth: AuthContext) {
  const { owner, ...rest } = row;
  const approver = (await peopleById([row.approvedById])).get(row.approvedById ?? '') ?? null;
  const own = row.ownerId === auth.actor.id;
  const manage = auth.can(PERMISSIONS.POLICIES_MANAGE);
  return {
    ...rest,
    owner: person(owner),
    approvedBy: approver,
    reviewOverdue: row.status === 'ACTIVE' && !!row.reviewDate && row.reviewDate < new Date(),
    permissions: {
      edit: manage && row.status === 'DRAFT',
      submit: manage && row.status === 'DRAFT',
      approve: manage && row.status === 'UNDER_REVIEW' && !own,
      reject: manage && row.status === 'UNDER_REVIEW' && !own,
      revise: manage && row.status === 'ACTIVE',
      retire: manage && (row.status === 'ACTIVE' || row.status === 'DRAFT'),
    },
  };
}

const audit = (auth: AuthContext, row: GovernancePolicy, action: string, to: PolicyStatus, extra: { reason?: string; metadata?: Record<string, unknown> } = {}) => ({
  action: `${RESOURCE}.${action}`,
  resource: RESOURCE,
  resourceId: row.id,
  actor: auth.actor,
  context: auth.ctx,
  before: { status: row.status, version: row.version },
  after: { status: to },
  ...extra,
});

export const policyService = {
  async list(q: ListPoliciesQuery) {
    const where: Prisma.GovernancePolicyWhereInput = {
      status: q.status,
      category: q.category,
      OR: q.search ? [{ title: { contains: q.search } }, { summary: { contains: q.search } }] : undefined,
    };
    const [rows, total] = await Promise.all([
      prisma.governancePolicy.findMany({ where, include, orderBy: [{ status: 'asc' }, { title: 'asc' }], ...toSkipTake(q) }),
      prisma.governancePolicy.count({ where }),
    ]);
    const now = new Date();
    const data = rows.map(({ content: _c, owner, ...r }) => ({ ...r, owner: person(owner), reviewOverdue: r.status === 'ACTIVE' && !!r.reviewDate && r.reviewDate < now }));
    return paginate(data, total, q);
  },

  async get(auth: AuthContext, id: string) {
    return present(await find(id), auth);
  },

  async create(auth: AuthContext, input: CreatePolicyInput) {
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.governancePolicy.create({ data: { ...input, slug: await uniqueSlug(input.title), ownerId: auth.actor.id, createdById: auth.actor.id } });
      await auditService.record({ action: `${RESOURCE}.created`, resource: RESOURCE, resourceId: row.id, actor: auth.actor, context: auth.ctx, after: { title: row.title, category: row.category } }, tx);
      return row;
    });
    return this.get(auth, created.id);
  },

  async update(auth: AuthContext, id: string, input: UpdatePolicyInput) {
    const row = await find(id);
    requireStatus(row, ['DRAFT'], 'edited; revise an active policy first');
    const diff = changes(row as GovernancePolicy, input as Partial<GovernancePolicy>);
    await prisma.$transaction(async (tx) => {
      await tx.governancePolicy.update({ where: { id }, data: { ...input, updatedById: auth.actor.id } });
      await auditService.record({ action: `${RESOURCE}.updated`, resource: RESOURCE, resourceId: id, actor: auth.actor, context: auth.ctx, metadata: { changedFields: diff.keys } }, tx);
    });
    return this.get(auth, id);
  },

  async submit(auth: AuthContext, id: string) {
    const row = await find(id);
    requireStatus(row, ['DRAFT'], 'submitted');
    await prisma.$transaction(async (tx) => {
      await tx.governancePolicy.update({ where: { id }, data: { status: 'UNDER_REVIEW', updatedById: auth.actor.id } });
      await auditService.record(audit(auth, row, 'submitted', 'UNDER_REVIEW'), tx);
    });
    return this.get(auth, id);
  },

  /** The policy owner cannot approve their own policy. */
  async approve(auth: AuthContext, id: string, input: { effectiveDate?: Date | null; reviewDate?: Date | null; comment: string }) {
    const row = await find(id);
    requireStatus(row, ['UNDER_REVIEW'], 'approved');
    if (row.ownerId === auth.actor.id) {
      await auditService.record({ action: `${RESOURCE}.approval_blocked`, resource: RESOURCE, resourceId: id, actor: auth.actor, context: auth.ctx, result: 'DENIED', severity: 'MEDIUM', reason: 'Segregation of duties' });
      throw Errors.forbidden('Segregation of duties: you cannot approve a policy you own');
    }
    const effectiveDate = input.effectiveDate ?? new Date();
    const reviewDate = input.reviewDate ?? row.reviewDate ?? addDays(effectiveDate, DEFAULT_REVIEW_DAYS);
    if (reviewDate <= effectiveDate) throw Errors.validation([{ path: 'reviewDate', message: 'The review date must be after the effective date' }]);
    await prisma.$transaction(async (tx) => {
      await tx.governancePolicy.update({ where: { id }, data: { status: 'ACTIVE', approvedById: auth.actor.id, approvedAt: new Date(), effectiveDate, reviewDate, updatedById: auth.actor.id } });
      await auditService.record(audit(auth, row, 'approved', 'ACTIVE', { reason: input.comment || undefined, metadata: { effectiveDate, reviewDate } }), tx);
    });
    return this.get(auth, id);
  },

  async reject(auth: AuthContext, id: string, comment: string) {
    const row = await find(id);
    requireStatus(row, ['UNDER_REVIEW'], 'returned');
    await prisma.$transaction(async (tx) => {
      await tx.governancePolicy.update({ where: { id }, data: { status: 'DRAFT', updatedById: auth.actor.id } });
      await auditService.record(audit(auth, row, 'returned', 'DRAFT', { reason: comment }), tx);
    });
    return this.get(auth, id);
  },

  /** Reopens an active policy as the next draft version; it must be re-approved before it is active again. */
  async revise(auth: AuthContext, id: string, reason: string) {
    const row = await find(id);
    requireStatus(row, ['ACTIVE'], 'revised');
    const version = nextVersion(row.version);
    await prisma.$transaction(async (tx) => {
      await tx.governancePolicy.update({ where: { id }, data: { status: 'DRAFT', version, approvedById: null, approvedAt: null, updatedById: auth.actor.id } });
      await auditService.record(audit(auth, row, 'revised', 'DRAFT', { reason, metadata: { version } }), tx);
    });
    return this.get(auth, id);
  },

  async retire(auth: AuthContext, id: string, reason: string) {
    const row = await find(id);
    requireStatus(row, ['ACTIVE', 'DRAFT'], 'retired');
    await prisma.$transaction(async (tx) => {
      await tx.governancePolicy.update({ where: { id }, data: { status: 'RETIRED', updatedById: auth.actor.id } });
      await auditService.record(audit(auth, row, 'retired', 'RETIRED', { reason }), tx);
    });
    return this.get(auth, id);
  },

  async history(id: string) {
    await find(id);
    return auditService.history(RESOURCE, id);
  },
};
