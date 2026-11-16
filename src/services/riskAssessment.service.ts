import type { Prisma, RiskAssessment, RiskLevel } from '@prisma/client';
import { prisma } from '../config/prisma';
import type { AuthContext } from '../middleware/authorize';
import { PERMISSIONS } from '../rbac/permissions';
import { Errors } from '../utils/errors';
import { paginate, toSkipTake } from '../utils/pagination';
import type {
  CreateRiskAssessmentInput,
  ListRiskAssessmentsQuery,
  ReviewDecisionInput,
  UpdateRiskAssessmentInput,
} from '../validators/assessment.validators';
import { auditService } from './audit.service';
import { DECISION_STATUS, EDITABLE, requireIndependentReviewer, requireOwner, requireStatus, workflowPermissions } from './governance/reviewWorkflow';
import { notificationService } from './notification.service';
import { toMarkdown, toPdf, type ReportDocument } from './reports/document';
import { RISK_SCORING_VERSION, riskAnswersSchema, scoreRiskAssessment, type RiskAnswers, type RiskResult } from './riskScoring.service';

const RESOURCE = 'risk_assessment';
const NOUN = 'risk assessment';

const include = {
  assessor: { select: { id: true, firstName: true, lastName: true } },
  aiSystem: { select: { id: true, name: true } },
  model: { select: { id: true, name: true } },
} satisfies Prisma.RiskAssessmentInclude;
type Row = Prisma.RiskAssessmentGetPayload<{ include: typeof include }>;

const fullName = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`.trim();
const isReviewer = (auth: AuthContext) => auth.can(PERMISSIONS.RISK_REVIEW);

/** Days until the next scheduled review for each approved risk level. */
export const REVIEW_INTERVAL_DAYS: Record<RiskLevel, number> = { LOW: 365, MEDIUM: 180, HIGH: 90, CRITICAL: 30 };

function scoredFields(answers: RiskAnswers) {
  const r = scoreRiskAssessment(answers);
  return {
    answers: answers as Prisma.InputJsonValue,
    score: r.score,
    riskLevel: r.level,
    riskFactors: r.factors as unknown as Prisma.InputJsonValue,
    recommendedControls: r.recommendedControls as unknown as Prisma.InputJsonValue,
    requiredOversight: r.requiredOversight,
    complianceConsiderations: r.complianceConsiderations as unknown as Prisma.InputJsonValue,
    scoringVersion: RISK_SCORING_VERSION,
  };
}

/** The stored result, plus the derived fields (escalations, review route) recomputed from the stored answers. */
function resultOf(row: RiskAssessment): RiskResult | null {
  const parsed = riskAnswersSchema.safeParse(row.answers);
  if (!parsed.success) return null;
  const live = scoreRiskAssessment(parsed.data);
  if (row.scoringVersion !== RISK_SCORING_VERSION) return { ...live, score: row.score ?? live.score, level: row.riskLevel ?? live.level, scoringVersion: row.scoringVersion };
  return live;
}

function present(row: Row, auth: AuthContext) {
  const { assessor, ...rest } = row;
  const own = row.assessorId === auth.actor.id;
  return {
    ...rest,
    assessor: { id: assessor.id, name: fullName(assessor) },
    result: resultOf(row),
    permissions: workflowPermissions(row.status, own, isReviewer(auth), !!row.submittedAt),
  };
}

async function find(id: string) {
  const row = await prisma.riskAssessment.findUnique({ where: { id }, include });
  if (!row) throw Errors.notFound('Risk assessment');
  return row;
}

async function assertLinks(aiSystemId?: string | null, modelId?: string | null) {
  const issues: { path: string; message: string }[] = [];
  if (aiSystemId && !(await prisma.aISystem.findUnique({ where: { id: aiSystemId }, select: { id: true } }))) issues.push({ path: 'aiSystemId', message: 'AI system not found' });
  if (modelId) {
    const model = await prisma.aIModel.findUnique({ where: { id: modelId }, select: { aiSystemId: true } });
    if (!model) issues.push({ path: 'modelId', message: 'Model not found' });
    else if (aiSystemId && model.aiSystemId && model.aiSystemId !== aiSystemId) issues.push({ path: 'modelId', message: 'The model belongs to a different AI system' });
  }
  if (issues.length) throw Errors.validation(issues);
}

const transition = (
  auth: AuthContext,
  row: Pick<RiskAssessment, 'id' | 'status'>,
  to: RiskAssessment['status'],
  { action, ...extra }: Partial<Parameters<typeof auditService.record>[0]> = {},
) => ({
  action: `${RESOURCE}.${action ?? to.toLowerCase()}`,
  resource: RESOURCE,
  resourceId: row.id,
  actor: auth.actor,
  context: auth.ctx,
  before: { status: row.status },
  after: { status: to },
  ...extra,
});

export const riskAssessmentService = {
  /** Scores answers without saving, for the wizard's live preview. */
  score(answers: RiskAnswers) {
    return scoreRiskAssessment(answers);
  },

  async list(auth: AuthContext, q: ListRiskAssessmentsQuery) {
    const where: Prisma.RiskAssessmentWhereInput = {
      status: q.status,
      riskLevel: q.riskLevel,
      aiSystemId: q.aiSystemId,
      assessorId: q.mine ? auth.actor.id : undefined,
      title: q.search ? { contains: q.search, mode: 'insensitive' } : undefined,
    };
    const [rows, total] = await Promise.all([
      prisma.riskAssessment.findMany({ where, include, orderBy: { updatedAt: 'desc' }, ...toSkipTake(q) }),
      prisma.riskAssessment.count({ where }),
    ]);
    const data = rows.map(({ answers: _a, riskFactors: _f, recommendedControls: _c, complianceConsiderations: _cc, assessor, ...r }) => ({
      ...r,
      assessor: { id: assessor.id, name: fullName(assessor) },
    }));
    return paginate(data, total, q);
  },

  async get(auth: AuthContext, id: string) {
    return present(await find(id), auth);
  },

  async create(auth: AuthContext, input: CreateRiskAssessmentInput) {
    await assertLinks(input.aiSystemId, input.modelId);
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.riskAssessment.create({
        data: { title: input.title, aiSystemId: input.aiSystemId ?? null, modelId: input.modelId ?? null, assessorId: auth.actor.id, createdById: auth.actor.id, ...scoredFields(input.answers) },
      });
      await auditService.record(
        { action: `${RESOURCE}.created`, resource: RESOURCE, resourceId: row.id, actor: auth.actor, context: auth.ctx, after: { title: row.title, score: row.score, riskLevel: row.riskLevel } },
        tx,
      );
      return row;
    });
    return this.get(auth, created.id);
  },

  async update(auth: AuthContext, id: string, input: UpdateRiskAssessmentInput) {
    const row = await find(id);
    requireOwner(row.assessorId, auth, NOUN, 'edit it');
    requireStatus(row.status, EDITABLE, NOUN, 'edited');
    const aiSystemId = input.aiSystemId === undefined ? row.aiSystemId : input.aiSystemId;
    const modelId = input.modelId === undefined ? row.modelId : input.modelId;
    await assertLinks(aiSystemId, modelId);
    await prisma.$transaction(async (tx) => {
      const updated = await tx.riskAssessment.update({
        where: { id },
        data: { title: input.title, aiSystemId, modelId, updatedById: auth.actor.id, ...(input.answers ? scoredFields(input.answers) : {}) },
      });
      await auditService.record(
        {
          action: `${RESOURCE}.updated`,
          resource: RESOURCE,
          resourceId: id,
          actor: auth.actor,
          context: auth.ctx,
          before: { score: row.score, riskLevel: row.riskLevel },
          after: { score: updated.score, riskLevel: updated.riskLevel },
          metadata: { changedFields: Object.keys(input) },
        },
        tx,
      );
    });
    return this.get(auth, id);
  },

  async submit(auth: AuthContext, id: string) {
    const row = await find(id);
    requireOwner(row.assessorId, auth, NOUN, 'submit it');
    requireStatus(row.status, EDITABLE, NOUN, 'submitted');
    await prisma.$transaction(async (tx) => {
      await tx.riskAssessment.update({ where: { id }, data: { status: 'SUBMITTED', submittedAt: new Date(), reviewerId: null, reviewComment: null, updatedById: auth.actor.id } });
      await auditService.record(transition(auth, row, 'SUBMITTED', { metadata: { score: row.score, riskLevel: row.riskLevel } }), tx);
      await notificationService.notifyPermissionHolders(
        PERMISSIONS.RISK_REVIEW,
        {
          type: 'RISK_ASSESSMENT_SUBMITTED',
          title: `${row.riskLevel ?? 'Unscored'} risk assessment awaiting review`,
          message: `${row.title} (score ${row.score ?? '—'}) was submitted for governance review.`,
          link: `/risk-assessments/${id}`,
        },
        tx,
        { exclude: [row.assessorId] },
      );
    });
    return this.get(auth, id);
  },

  async withdraw(auth: AuthContext, id: string) {
    const row = await find(id);
    requireOwner(row.assessorId, auth, NOUN, 'withdraw it');
    requireStatus(row.status, ['SUBMITTED'], NOUN, 'withdrawn');
    await prisma.$transaction(async (tx) => {
      await tx.riskAssessment.update({ where: { id }, data: { status: 'DRAFT', updatedById: auth.actor.id } });
      await auditService.record(transition(auth, row, 'DRAFT', { action: 'withdrawn' }), tx);
    });
    return this.get(auth, id);
  },

  async startReview(auth: AuthContext, id: string) {
    const row = await find(id);
    requireStatus(row.status, ['SUBMITTED'], NOUN, 'taken into review');
    await requireIndependentReviewer(row.assessorId, auth, RESOURCE, id, NOUN);
    await prisma.$transaction(async (tx) => {
      await tx.riskAssessment.update({ where: { id }, data: { status: 'UNDER_REVIEW', reviewerId: auth.actor.id, updatedById: auth.actor.id } });
      await auditService.record(transition(auth, row, 'UNDER_REVIEW', { action: 'review_started' }), tx);
    });
    return this.get(auth, id);
  },

  /** Approval sets the risk level of the linked AI system and model and schedules their next review. */
  async review(auth: AuthContext, id: string, { decision, comment }: ReviewDecisionInput) {
    const row = await find(id);
    requireStatus(row.status, ['UNDER_REVIEW'], NOUN, 'decided; start the review first');
    await requireIndependentReviewer(row.assessorId, auth, RESOURCE, id, NOUN);
    const to = DECISION_STATUS[decision];
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.riskAssessment.update({ where: { id }, data: { status: to, reviewerId: auth.actor.id, reviewComment: comment || null, reviewedAt: now, updatedById: auth.actor.id } });
      if (to === 'APPROVED' && row.riskLevel) {
        const nextReviewAt = new Date(now.getTime() + REVIEW_INTERVAL_DAYS[row.riskLevel] * 86_400_000);
        if (row.aiSystemId) await tx.aISystem.update({ where: { id: row.aiSystemId }, data: { riskLevel: row.riskLevel, lastReviewedAt: now, nextReviewAt, updatedById: auth.actor.id } });
        if (row.modelId) await tx.aIModel.update({ where: { id: row.modelId }, data: { riskLevel: row.riskLevel, nextReviewAt } });
      }
      await auditService.record(
        transition(auth, row, to, { action: decision === 'APPROVE' ? 'approved' : decision === 'REJECT' ? 'rejected' : 'changes_requested', reason: comment || undefined, severity: to === 'APPROVED' ? 'LOW' : 'INFO' }),
        tx,
      );
      await notificationService.notify(
        row.assessorId,
        {
          type: 'SYSTEM',
          title: `Risk assessment ${to === 'CHANGES_REQUESTED' ? 'needs changes' : to.toLowerCase()}`,
          message: comment ? `${row.title}: ${comment}` : `${row.title} was ${to.toLowerCase()}.`,
          link: `/risk-assessments/${id}`,
        },
        tx,
      );
    });
    return this.get(auth, id);
  },

  async retire(auth: AuthContext, id: string, reason: string) {
    const row = await find(id);
    if (!isReviewer(auth)) throw Errors.forbidden('Only reviewers can retire risk assessments');
    requireStatus(row.status, ['APPROVED', 'REJECTED'], NOUN, 'retired');
    await prisma.$transaction(async (tx) => {
      await tx.riskAssessment.update({ where: { id }, data: { status: 'RETIRED', updatedById: auth.actor.id } });
      await auditService.record(transition(auth, row, 'RETIRED', { action: 'retired', reason }), tx);
    });
    return this.get(auth, id);
  },

  async remove(auth: AuthContext, id: string) {
    const row = await find(id);
    requireOwner(row.assessorId, auth, NOUN, 'delete it');
    if (row.status !== 'DRAFT' || row.submittedAt) throw Errors.conflict('Only never-submitted drafts can be deleted');
    await prisma.$transaction(async (tx) => {
      await tx.riskAssessment.delete({ where: { id } });
      await auditService.record({ action: `${RESOURCE}.deleted`, resource: RESOURCE, resourceId: id, actor: auth.actor, context: auth.ctx, before: { title: row.title } }, tx);
    });
  },

  async history(id: string) {
    await find(id);
    return auditService.history(RESOURCE, id);
  },

  async export(auth: AuthContext, id: string, format: 'json' | 'md' | 'pdf') {
    const row = await find(id);
    const result = resultOf(row);
    const base = `risk-assessment-${row.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}`;
    await auditService.record({ action: `${RESOURCE}.exported`, resource: RESOURCE, resourceId: id, actor: auth.actor, context: auth.ctx, metadata: { format } });
    if (format === 'json') {
      const body = { id: row.id, title: row.title, status: row.status, aiSystem: row.aiSystem, model: row.model, answers: row.answers, result, reviewComment: row.reviewComment, exportedAt: new Date().toISOString() };
      return { body: Buffer.from(JSON.stringify(body, null, 2)), fileName: `${base}.json`, contentType: 'application/json' };
    }
    const doc = toDocument(row, result);
    if (format === 'md') return { body: Buffer.from(toMarkdown(doc)), fileName: `${base}.md`, contentType: 'text/markdown; charset=utf-8' };
    return { body: await toPdf(doc), fileName: `${base}.pdf`, contentType: 'application/pdf' };
  },
};

const ANSWER_LABELS: Record<keyof RiskAnswers, string> = {
  purpose: 'Purpose',
  domain: 'Application domain',
  users: 'Users',
  affectedPopulation: 'Affected people',
  affectedScale: 'Scale of impact',
  dataSensitivity: 'Data sensitivity',
  decisionImpact: 'Decision impact',
  automationLevel: 'Automation level',
  humanOversight: 'Human oversight',
  fairnessRisk: 'Fairness risk',
  usesProtectedAttributes: 'Uses protected attributes or proxies',
  privacyRisk: 'Privacy risk',
  securityExposure: 'Security exposure',
  adversarialThreat: 'Adversarial threat',
  explainabilityRequirement: 'Explainability requirement',
  modelTransparency: 'Model transparency',
  regulatoryContext: 'Regulatory context',
};

const humanize = (v: unknown): string =>
  Array.isArray(v) ? v.map(humanize).join(', ') : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v ?? '').toLowerCase().replace(/_/g, ' ');

export function toDocument(row: Row, result: RiskResult | null): ReportDocument {
  const answers = (row.answers ?? {}) as Partial<RiskAnswers>;
  return {
    title: `AI Risk Assessment: ${row.title}`,
    subtitle: `Status: ${humanize(row.status)}`,
    watermark: row.status === 'APPROVED' ? undefined : `${humanize(row.status).toUpperCase()}: not an approved risk assessment`,
    meta: [
      ['Assessment ID', row.id],
      ['AI system', row.aiSystem?.name ?? null],
      ['Model', row.model?.name ?? null],
      ['Assessor', fullName(row.assessor)],
      ['Submitted', row.submittedAt?.toISOString() ?? null],
      ['Reviewed', row.reviewedAt?.toISOString() ?? null],
      ['Scoring rules version', row.scoringVersion],
    ],
    sections: [
      {
        heading: 'Executive summary',
        fields: [
          ['Risk score', result ? `${result.score} / 100` : row.score],
          ['Risk category', result?.level ?? row.riskLevel],
          ['Required human oversight', result?.requiredOversight ?? row.requiredOversight],
          ['Review route', result ? humanize(result.reviewRequirement) : null],
          ['Reviewer comment', row.reviewComment],
        ],
        bullets: result?.escalations,
      },
      {
        heading: 'Methodology',
        paragraphs: [
          'The score is computed by documented, rule-based criteria: each answer awards a fixed number of points, normalised to 0–100. Bands are LOW (<25), MEDIUM (25–49), HIGH (50–74) and CRITICAL (75+); escalation rules can raise the category regardless of score.',
        ],
      },
      { heading: 'Assessment answers', fields: (Object.keys(ANSWER_LABELS) as (keyof RiskAnswers)[]).map((k) => [ANSWER_LABELS[k], humanize(answers[k])]) },
      {
        heading: 'Risk factors',
        table: { headers: ['Factor', 'Points', 'Max', 'Rationale'], rows: (result?.factors ?? []).map((f) => [f.label, f.points, f.maxPoints, f.rationale]) },
      },
      {
        heading: 'Recommended controls',
        table: { headers: ['Control', 'Pillar', 'Priority', 'Description'], rows: (result?.recommendedControls ?? []).map((c) => [c.title, humanize(c.pillar), humanize(c.priority), c.description]) },
      },
      {
        heading: 'Potential compliance considerations',
        paragraphs: ['These are prompts for human and legal review, not determinations that any requirement applies or is satisfied.'],
        bullets: (result?.complianceConsiderations ?? []).map((c) => `${c.topic}: ${c.consideration}${c.requiresLegalReview ? ' (legal review required)' : ''}`),
      },
    ],
    disclaimer: result?.disclaimer,
    generatedAt: new Date(),
  };
}
