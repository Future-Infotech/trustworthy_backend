import { prisma } from '../../config/prisma';
import type { AuthContext } from '../../middleware/authorize';
import { PERMISSIONS } from '../../rbac/permissions';
import { addDays, peopleById } from './shared';

const DUE_SOON_DAYS = 30;
const HIGH_INHERENT_SCORE = 15;

const countBy = <K extends string>(rows: { key: K; n: number }[]) => Object.fromEntries(rows.map((r) => [r.key, r.n])) as Partial<Record<K, number>>;

export interface ApprovalItem {
  type: 'RISK_ASSESSMENT' | 'IMPACT_ASSESSMENT' | 'POLICY' | 'MODEL_CARD' | 'VENDOR_ASSESSMENT';
  id: string;
  title: string;
  status: string;
  submittedAt: Date | null;
  owner: { id: string; name: string } | null;
  link: string;
  canAct: boolean;
}

export const governanceOverviewService = {
  /** Headline counts for the governance dashboard; every figure is a live query. */
  async overview() {
    const now = new Date();
    const soon = addDays(now, DUE_SOON_DAYS);
    const [systemsByStatus, systemsByRisk, shadow, unassessed, incidents, risks, highRisks, compliance, policies, policiesDue, reviewsOverdue, reviewsDue, systemsOverdue] = await Promise.all([
      prisma.aISystem.groupBy({ by: ['status'], where: { isShadowAI: false }, _count: true }),
      prisma.aISystem.groupBy({ by: ['riskLevel'], where: { isShadowAI: false, status: { not: 'RETIRED' } }, _count: true }),
      prisma.aISystem.count({ where: { isShadowAI: true, status: { not: 'RETIRED' } } }),
      prisma.aISystem.count({ where: { isShadowAI: false, riskLevel: null, status: { not: 'RETIRED' } } }),
      prisma.aIIncident.groupBy({ by: ['severity'], where: { status: { in: ['OPEN', 'INVESTIGATING', 'MITIGATED'] } }, _count: true }),
      prisma.riskRegisterEntry.count({ where: { status: { not: 'CLOSED' } } }),
      prisma.riskRegisterEntry.count({ where: { status: { not: 'CLOSED' }, inherentScore: { gte: HIGH_INHERENT_SCORE } } }),
      prisma.complianceRequirement.groupBy({ by: ['status'], _count: true }),
      prisma.governancePolicy.groupBy({ by: ['status'], _count: true }),
      prisma.governancePolicy.count({ where: { status: 'ACTIVE', reviewDate: { lte: soon } } }),
      prisma.reviewSchedule.count({ where: { nextReviewAt: { lt: now } } }),
      prisma.reviewSchedule.count({ where: { nextReviewAt: { gte: now, lte: soon } } }),
      prisma.aISystem.count({ where: { isShadowAI: false, status: { not: 'RETIRED' }, nextReviewAt: { lt: now } } }),
    ]);
    return {
      systems: {
        byStatus: countBy(systemsByStatus.map((r) => ({ key: r.status, n: r._count }))),
        byRisk: countBy(systemsByRisk.map((r) => ({ key: r.riskLevel ?? 'UNASSESSED', n: r._count }))),
        shadowAI: shadow,
        unassessed,
        reviewOverdue: systemsOverdue,
      },
      incidents: { openBySeverity: countBy(incidents.map((r) => ({ key: r.severity, n: r._count }))) },
      riskRegister: { open: risks, high: highRisks },
      compliance: { byStatus: countBy(compliance.map((r) => ({ key: r.status, n: r._count }))) },
      policies: { byStatus: countBy(policies.map((r) => ({ key: r.status, n: r._count }))), reviewDueSoon: policiesDue },
      reviews: { overdue: reviewsOverdue, dueSoon: reviewsDue },
      disclaimer: 'Governance indicators summarise internal records. They are not a compliance determination; legal requirements need qualified human review.',
    };
  },

  /** Everything awaiting a decision, limited to the item types the caller can read. */
  async approvals(auth: AuthContext) {
    const me = auth.actor.id;
    const items: ApprovalItem[] = [];
    const [risks, aias, policies, cards, vendors] = await Promise.all([
      auth.can(PERMISSIONS.RISK_READ)
        ? prisma.riskAssessment.findMany({ where: { status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } }, select: { id: true, title: true, status: true, submittedAt: true, assessorId: true } })
        : [],
      auth.can(PERMISSIONS.AIA_READ)
        ? prisma.algorithmicImpactAssessment.findMany({ where: { status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } }, select: { id: true, title: true, status: true, submittedAt: true, ownerId: true } })
        : [],
      prisma.governancePolicy.findMany({ where: { status: 'UNDER_REVIEW' }, select: { id: true, title: true, status: true, updatedAt: true, ownerId: true } }),
      auth.can(PERMISSIONS.MODEL_CARDS_PUBLISH)
        ? prisma.modelCard.findMany({ where: { status: 'IN_REVIEW' }, select: { id: true, name: true, version: true, status: true, updatedAt: true, ownerId: true } })
        : [],
      prisma.vendorAssessment.findMany({ where: { status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } }, select: { id: true, vendorName: true, productName: true, status: true, updatedAt: true, assessorId: true } }),
    ]);
    const people = await peopleById([...risks.map((r) => r.assessorId), ...aias.map((a) => a.ownerId), ...policies.map((p) => p.ownerId), ...cards.map((c) => c.ownerId), ...vendors.map((v) => v.assessorId)]);
    const who = (id: string) => people.get(id) ?? null;

    for (const r of risks) items.push({ type: 'RISK_ASSESSMENT', id: r.id, title: r.title, status: r.status, submittedAt: r.submittedAt, owner: who(r.assessorId), link: `/risk-assessments/${r.id}`, canAct: auth.can(PERMISSIONS.RISK_REVIEW) && r.assessorId !== me });
    for (const a of aias) items.push({ type: 'IMPACT_ASSESSMENT', id: a.id, title: a.title, status: a.status, submittedAt: a.submittedAt, owner: who(a.ownerId), link: `/impact-assessments/${a.id}`, canAct: auth.can(PERMISSIONS.AIA_APPROVE) && a.ownerId !== me });
    for (const p of policies) items.push({ type: 'POLICY', id: p.id, title: p.title, status: p.status, submittedAt: p.updatedAt, owner: who(p.ownerId), link: `/governance/policies/${p.id}`, canAct: auth.can(PERMISSIONS.POLICIES_MANAGE) && p.ownerId !== me });
    for (const c of cards) items.push({ type: 'MODEL_CARD', id: c.id, title: `${c.name} v${c.version}`, status: c.status, submittedAt: c.updatedAt, owner: who(c.ownerId), link: `/model-cards/${c.id}`, canAct: c.ownerId !== me });
    for (const v of vendors) items.push({ type: 'VENDOR_ASSESSMENT', id: v.id, title: `${v.vendorName}: ${v.productName}`, status: v.status, submittedAt: v.updatedAt, owner: who(v.assessorId), link: '/governance/vendors', canAct: auth.can(PERMISSIONS.GOVERNANCE_MANAGE) && v.assessorId !== me });

    items.sort((a, b) => (a.submittedAt?.getTime() ?? 0) - (b.submittedAt?.getTime() ?? 0));
    return { items };
  },
};
