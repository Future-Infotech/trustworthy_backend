import type { ExperimentType, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import type { AuthContext } from '../middleware/authorize';
import { PERMISSIONS } from '../rbac/permissions';
import { Errors } from '../utils/errors';
import type { ReportFormat, ReportSourcesQuery, ReportType } from '../validators/report.validators';
import { auditService } from './audit.service';
import { fullName } from './governance/shared';
import { impactAssessmentService } from './impactAssessment.service';
import { modelCardService, visibilityFilter as modelCardVisibility } from './modelCard.service';
import { toMarkdown, toPdf } from './reports/document';
import { experimentReport, hasReportableResult, REPORT_CATEGORY, REPORTABLE_KINDS, type ReportCategory } from './reports/experimentReport';
import { riskAssessmentService } from './riskAssessment.service';
import { settingsService } from './settings.service';

const REPORTABLE_TYPES = Object.keys(REPORT_CATEGORY) as ExperimentType[];
const SOURCE_LIMIT = 100;

const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'report';

const canReadAllExperiments = (auth: AuthContext) => auth.can(PERMISSIONS.EXPERIMENTS_READ_ALL);

async function experimentFile(auth: AuthContext, id: string, format: ReportFormat) {
  const e = await prisma.experiment.findUnique({
    where: { id },
    include: {
      user: { select: { firstName: true, lastName: true } },
      dataset: { select: { name: true } },
      modelVersion: { select: { version: true, model: { select: { name: true } } } },
      results: { select: { kind: true, metrics: true, data: true }, orderBy: { createdAt: 'asc' } },
    },
  });
  if (!e || (e.userId !== auth.actor.id && !canReadAllExperiments(auth))) throw Errors.notFound('Experiment');
  if (!REPORT_CATEGORY[e.type]) throw Errors.badRequest('Reports are available for explainability, fairness and robustness experiments');
  if (e.status !== 'COMPLETED' || !hasReportableResult(e.results)) throw Errors.conflict('Only completed experiments with results can be reported');

  const disclaimer = await settingsService.get('platform.educationalDisclaimer');
  const base = `${REPORT_CATEGORY[e.type]}-report-${slug(e.name ?? e.type)}`;
  if (format === 'json') {
    const body = {
      reportType: REPORT_CATEGORY[e.type],
      experiment: { id: e.id, name: e.name, type: e.type, algorithm: e.algorithm, randomSeed: e.randomSeed, configHash: e.configHash, isEducational: e.isEducational, completedAt: e.completedAt, parameters: e.parameters },
      results: e.results,
      disclaimer,
      generatedAt: new Date().toISOString(),
    };
    return { body: Buffer.from(JSON.stringify(body, null, 2)), fileName: `${base}.json`, contentType: 'application/json' };
  }
  const doc = experimentReport(
    {
      ...e,
      owner: fullName(e.user),
      dataset: e.dataset?.name ?? null,
      modelVersion: e.modelVersion ? `${e.modelVersion.model.name} ${e.modelVersion.version}` : null,
    },
    disclaimer,
  );
  if (format === 'md') return { body: Buffer.from(toMarkdown(doc)), fileName: `${base}.md`, contentType: 'text/markdown; charset=utf-8' };
  return { body: await toPdf(doc), fileName: `${base}.pdf`, contentType: 'application/pdf' };
}

function requireRead(auth: AuthContext, permission: (typeof PERMISSIONS)[keyof typeof PERMISSIONS], noun: string) {
  if (!auth.can(permission)) throw Errors.forbidden(`You do not have permission to read ${noun}`);
}

export const reportService = {
  /** What the caller can generate reports from, grouped by report type. */
  async sources(auth: AuthContext, q: ReportSourcesQuery) {
    const experimentWhere: Prisma.ExperimentWhereInput = {
      type: { in: REPORTABLE_TYPES },
      status: 'COMPLETED',
      results: { some: { kind: { in: REPORTABLE_KINDS } } },
      ...(q.scope === 'all' && canReadAllExperiments(auth) ? {} : { userId: auth.actor.id }),
    };
    const [experiments, modelCards, risks, aias] = await Promise.all([
      prisma.experiment.findMany({
        where: experimentWhere,
        select: { id: true, name: true, type: true, completedAt: true, isEducational: true, user: { select: { firstName: true, lastName: true } } },
        orderBy: { completedAt: 'desc' },
        take: SOURCE_LIMIT,
      }),
      auth.can(PERMISSIONS.MODEL_CARDS_READ)
        ? prisma.modelCard.findMany({
            where: modelCardVisibility(auth),
            select: { id: true, name: true, version: true, status: true, updatedAt: true },
            orderBy: { updatedAt: 'desc' },
            take: SOURCE_LIMIT,
          })
        : [],
      auth.can(PERMISSIONS.RISK_READ)
        ? prisma.riskAssessment.findMany({ select: { id: true, title: true, status: true, riskLevel: true, updatedAt: true }, orderBy: { updatedAt: 'desc' }, take: SOURCE_LIMIT })
        : [],
      auth.can(PERMISSIONS.AIA_READ)
        ? prisma.algorithmicImpactAssessment.findMany({ select: { id: true, title: true, status: true, version: true, updatedAt: true }, orderBy: { updatedAt: 'desc' }, take: SOURCE_LIMIT })
        : [],
    ]);
    const byCategory = (c: ReportCategory) =>
      experiments
        .filter((e) => REPORT_CATEGORY[e.type] === c)
        .map((e) => ({ id: e.id, label: e.name ?? e.type, type: e.type, owner: fullName(e.user), isEducational: e.isEducational, date: e.completedAt }));
    return {
      xai: byCategory('xai'),
      fairness: byCategory('fairness'),
      robustness: byCategory('robustness'),
      model_card: modelCards.map((c) => ({ id: c.id, label: `${c.name} v${c.version}`, status: c.status, date: c.updatedAt })),
      risk_assessment: risks.map((r) => ({ id: r.id, label: r.title, status: r.status, riskLevel: r.riskLevel, date: r.updatedAt })),
      impact_assessment: aias.map((a) => ({ id: a.id, label: `${a.title} (v${a.version})`, status: a.status, date: a.updatedAt })),
      canReadAllExperiments: canReadAllExperiments(auth),
    };
  },

  async generate(auth: AuthContext, type: ReportType, id: string, format: ReportFormat) {
    let file: { body: Buffer; fileName: string; contentType: string };
    if (type === 'experiment') {
      file = await experimentFile(auth, id, format);
      await auditService.record({ action: 'report.generated', resource: 'experiment', resourceId: id, actor: auth.actor, context: auth.ctx, metadata: { reportType: type, format } });
    } else if (type === 'model_card') {
      requireRead(auth, PERMISSIONS.MODEL_CARDS_READ, 'model cards');
      file = await modelCardService.export(auth, id, format);
    } else if (type === 'risk_assessment') {
      requireRead(auth, PERMISSIONS.RISK_READ, 'risk assessments');
      file = await riskAssessmentService.export(auth, id, format);
    } else {
      requireRead(auth, PERMISSIONS.AIA_READ, 'impact assessments');
      file = await impactAssessmentService.export(auth, id, format);
    }
    return file;
  },
};
