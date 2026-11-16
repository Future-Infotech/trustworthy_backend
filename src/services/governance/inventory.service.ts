import type { AISystem, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import type { AuthContext } from '../../middleware/authorize';
import { AppError, Errors } from '../../utils/errors';
import { paginate, toSkipTake } from '../../utils/pagination';
import type { CreateAiSystemInput, ListAiSystemsQuery, UpdateAiSystemInput } from '../../validators/governance.validators';
import { auditService } from '../audit.service';
import { addDays, assertRefs, changes, person, userSelect } from './shared';

const RESOURCE = 'ai_system';
const SANCTION_REVIEW_DAYS = 30;

const listInclude = {
  owner: { select: userSelect },
  _count: { select: { models: true, incidents: { where: { status: { in: ['OPEN', 'INVESTIGATING'] } } }, riskRegister: { where: { status: { not: 'CLOSED' } } } } },
} satisfies Prisma.AISystemInclude;

const detailInclude = {
  owner: { select: userSelect },
  models: { select: { id: true, name: true, lifecycleStage: true, riskLevel: true, fairnessStatus: true, securityStatus: true, explainabilityStatus: true }, orderBy: { name: 'asc' } },
  riskAssessments: { select: { id: true, title: true, status: true, score: true, riskLevel: true, updatedAt: true }, orderBy: { updatedAt: 'desc' }, take: 10 },
  impactAssessments: { select: { id: true, title: true, status: true, version: true, updatedAt: true }, orderBy: { updatedAt: 'desc' }, take: 10 },
  incidents: { select: { id: true, title: true, severity: true, status: true, detectedAt: true }, orderBy: { detectedAt: 'desc' }, take: 10 },
  riskRegister: { select: { id: true, title: true, category: true, inherentScore: true, residualScore: true, status: true }, orderBy: { inherentScore: 'desc' } },
  vendorAssessments: { select: { id: true, vendorName: true, productName: true, status: true, riskLevel: true }, orderBy: { assessmentDate: 'desc' } },
  oversightRecords: { select: { id: true, decisionReference: true, decision: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 10 },
} satisfies Prisma.AISystemInclude;

type DetailRow = Prisma.AISystemGetPayload<{ include: typeof detailInclude }>;

async function find(id: string) {
  const row = await prisma.aISystem.findUnique({ where: { id }, include: detailInclude });
  if (!row) throw Errors.notFound('AI system');
  return row;
}

/** Controls checked before a system may go live; returned to the UI so owners can see what is outstanding. */
async function activationGate(system: Pick<AISystem, 'id' | 'riskLevel' | 'isShadowAI'>) {
  const blockers: string[] = [];
  if (system.isShadowAI) blockers.push('Resolve the Shadow AI entry first (sanction it into the governed inventory).');
  const approvedRisk = await prisma.riskAssessment.count({ where: { aiSystemId: system.id, status: 'APPROVED' } });
  if (!approvedRisk) blockers.push('An approved risk assessment is required.');
  if (system.riskLevel === 'HIGH' || system.riskLevel === 'CRITICAL') {
    const approvedAia = await prisma.algorithmicImpactAssessment.count({ where: { aiSystemId: system.id, status: 'APPROVED' } });
    if (!approvedAia) blockers.push(`${system.riskLevel} risk systems need an approved algorithmic impact assessment.`);
  }
  return blockers;
}

async function present(row: DetailRow) {
  const { owner, ...rest } = row;
  return { ...rest, owner: person(owner), activationBlockers: row.status === 'ACTIVE' ? [] : await activationGate(row) };
}

export const inventoryService = {
  async list(q: ListAiSystemsQuery) {
    const where: Prisma.AISystemWhereInput = {
      status: q.status,
      riskLevel: q.riskLevel,
      isShadowAI: q.shadow,
      isThirdParty: q.thirdParty,
      OR: q.search
        ? [{ name: { contains: q.search, mode: 'insensitive' } }, { businessUnit: { contains: q.search, mode: 'insensitive' } }, { vendorName: { contains: q.search, mode: 'insensitive' } }]
        : undefined,
    };
    const [rows, total] = await Promise.all([
      prisma.aISystem.findMany({ where, include: listInclude, orderBy: [{ isShadowAI: 'desc' }, { name: 'asc' }], ...toSkipTake(q) }),
      prisma.aISystem.count({ where }),
    ]);
    const data = rows.map(({ owner, _count, ...r }) => ({ ...r, owner: person(owner), modelCount: _count.models, openIncidents: _count.incidents, openRisks: _count.riskRegister }));
    return paginate(data, total, q);
  },

  async get(id: string) {
    return present(await find(id));
  },

  async create(auth: AuthContext, input: CreateAiSystemInput) {
    const ownerId = input.ownerId ?? auth.actor.id;
    await assertRefs({ userId: [['ownerId', ownerId]] });
    if (input.status === 'ACTIVE' && !input.isShadowAI) {
      throw Errors.validation([{ path: 'status', message: 'New systems cannot start as active; record a risk assessment and approval first' }]);
    }
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.aISystem.create({ data: { ...input, ownerId, createdById: auth.actor.id } });
      await auditService.record(
        { action: input.isShadowAI ? `${RESOURCE}.shadow_reported` : `${RESOURCE}.created`, resource: RESOURCE, resourceId: row.id, actor: auth.actor, context: auth.ctx, after: { name: row.name, status: row.status, isShadowAI: row.isShadowAI } },
        tx,
      );
      return row;
    });
    return this.get(created.id);
  },

  async update(auth: AuthContext, id: string, input: UpdateAiSystemInput) {
    const row = await find(id);
    await assertRefs({ userId: [['ownerId', input.ownerId]] });
    if ((input.isThirdParty ?? row.isThirdParty) && !(input.vendorName === undefined ? row.vendorName : input.vendorName)) {
      throw Errors.validation([{ path: 'vendorName', message: 'Name the vendor of a third-party system' }]);
    }
    if (input.status === 'ACTIVE' && row.status !== 'ACTIVE') {
      const blockers = await activationGate(row);
      if (blockers.length) throw new AppError(409, 'GOVERNANCE_GATE', 'This system cannot be activated yet', blockers.map((message) => ({ path: 'status', message })));
    }
    const diff = changes(row as AISystem, input as Partial<AISystem>);
    if (!diff.keys.length) return this.get(id);
    await prisma.$transaction(async (tx) => {
      await tx.aISystem.update({ where: { id }, data: { ...input, updatedById: auth.actor.id } });
      await auditService.record(
        { action: diff.keys.includes('status') ? `${RESOURCE}.status_changed` : `${RESOURCE}.updated`, resource: RESOURCE, resourceId: id, actor: auth.actor, context: auth.ctx, before: diff.before, after: diff.after },
        tx,
      );
    });
    return this.get(id);
  },

  /** Sanctioning moves a Shadow AI entry into the governed inventory with a near-term review; prohibiting retires it while keeping the record. */
  async resolveShadow(auth: AuthContext, id: string, { decision, reason }: { decision: 'SANCTION' | 'PROHIBIT'; reason: string }) {
    const row = await find(id);
    if (!row.isShadowAI) throw Errors.conflict('This system is not on the Shadow AI register');
    if (row.status === 'RETIRED') throw Errors.conflict('This Shadow AI entry has already been prohibited');
    const data: Prisma.AISystemUpdateInput =
      decision === 'SANCTION'
        ? { isShadowAI: false, status: 'PROPOSED', nextReviewAt: addDays(new Date(), SANCTION_REVIEW_DAYS), updatedById: auth.actor.id }
        : { status: 'RETIRED', updatedById: auth.actor.id };
    await prisma.$transaction(async (tx) => {
      await tx.aISystem.update({ where: { id }, data });
      await auditService.record(
        {
          action: decision === 'SANCTION' ? `${RESOURCE}.shadow_sanctioned` : `${RESOURCE}.shadow_prohibited`,
          resource: RESOURCE,
          resourceId: id,
          actor: auth.actor,
          context: auth.ctx,
          before: { status: row.status, isShadowAI: true },
          after: { status: data.status, isShadowAI: decision !== 'SANCTION' },
          reason,
          severity: 'MEDIUM',
        },
        tx,
      );
    });
    return this.get(id);
  },

  history(id: string) {
    return auditService.history(RESOURCE, id);
  },
};
