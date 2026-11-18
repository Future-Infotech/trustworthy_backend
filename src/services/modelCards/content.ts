import type { ExperimentType, ModelCard, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { Errors } from '../../utils/errors';
import { stringList } from '../../utils/jsonList';
import type { ModelCardContent } from '../../validators/modelCard.validators';
import type { ReportDocument } from '../reports/document';

export const PERFORMANCE_LABELS: Record<string, string> = {
  accuracy: 'Accuracy',
  balancedAccuracy: 'Balanced accuracy',
  precision: 'Precision',
  recall: 'Recall',
  f1: 'F1 score',
  rocAuc: 'ROC AUC',
};

/** Fairness metrics taken from an audit, with the platform's review thresholds. */
const FAIRNESS_KEYS: { key: string; label: string; threshold: number }[] = [
  { key: 'demographicParityDifference', label: 'Demographic parity difference', threshold: 0.1 },
  { key: 'equalizedOddsDifference', label: 'Equalized odds difference', threshold: 0.1 },
  { key: 'demographicParityRatio', label: 'Selection-rate ratio', threshold: 0.8 },
];

const ALGORITHM_LABELS: Record<string, string> = {
  LOGISTIC_REGRESSION: 'Logistic Regression',
  DECISION_TREE: 'Decision Tree',
  RANDOM_FOREST: 'Random Forest',
  GRADIENT_BOOSTING: 'Gradient Boosting',
};

const TOLERANCE = 5e-4;
const round4 = (v: number) => Math.round(v * 1e4) / 1e4;

type Json = Record<string, any>;

interface Evidence {
  id: string;
  completedAt: Date | null;
  data: Json;
}

async function latestResult(versionId: string, types: ExperimentType[]): Promise<Evidence | null> {
  const exp = await prisma.experiment.findFirst({
    where: { modelVersionId: versionId, type: { in: types }, status: 'COMPLETED' },
    orderBy: { completedAt: 'desc' },
    select: { id: true, completedAt: true, results: { select: { data: true }, take: 1 } },
  });
  const data = exp?.results[0]?.data;
  return exp && data && typeof data === 'object' ? { id: exp.id, completedAt: exp.completedAt, data: data as Json } : null;
}

const testMetrics = (metrics: Prisma.JsonValue | null): Json => {
  const m = (metrics ?? {}) as Json;
  return (m.test && typeof m.test === 'object' ? m.test : m) as Json;
};

function evidence(e: Evidence | null) {
  if (!e?.data.assessment) return undefined;
  const a = e.data.assessment as { status: 'PASSED' | 'WARNING' | 'FAILED'; reasons?: string[] };
  return { status: a.status, summary: (a.reasons ?? []).slice(0, 3).join(' '), experimentId: e.id, recordedAt: e.completedAt?.toISOString() };
}

/**
 * Draft content assembled from the registry and real evaluation runs. Fields that need human
 * judgement (intended use limits, licence, oversight, ethics) are left for the author.
 */
export async function prefill(modelId: string, versionId?: string) {
  const model = await prisma.aIModel.findUnique({
    where: { id: modelId },
    include: { owner: { select: { firstName: true, lastName: true } }, versions: { orderBy: { createdAt: 'desc' }, include: { dataset: true } } },
  });
  if (!model) throw Errors.notFound('Model');
  const version = versionId ? model.versions.find((v) => v.id === versionId) : model.versions[0];
  if (versionId && !version) throw Errors.validation([{ path: 'versionId', message: 'Version does not belong to this model' }]);

  const warnings: string[] = [];
  const sources: Record<string, string> = { modelName: 'Model registry', developer: 'Model owner', intendedUse: 'Model purpose' };
  const content: ModelCardContent = {
    modelName: model.name,
    developer: `${model.owner.firstName} ${model.owner.lastName}`.trim(),
    version: version?.version ?? '1.0',
    architecture: `${ALGORITHM_LABELS[model.algorithm] ?? model.algorithm} (${model.framework})`,
    license: '',
    intendedUse: model.purpose,
    outOfScopeUse: '',
    trainingData: '',
    evaluationData: '',
    performanceMetrics: [],
    evaluatedSubgroups: [],
    fairnessMetrics: [],
    fairnessThreshold: '',
    mitigationTechnique: '',
    privacyMechanisms: '',
    securityMechanisms: '',
    humanOversight: '',
    knownLimitations: '',
    ethicalConsiderations: '',
    deploymentRequirements: '',
    basedOnVersion: version ? { id: version.id, version: version.version } : null,
    evaluations: {},
  };
  if (!version) {
    warnings.push('The model has no registered version, so no metrics or evaluations can be filled in.');
    return { content, sources, warnings };
  }

  const spec = (version.parameters ?? {}) as Json;
  const hp = Object.entries((spec.hyperparameters ?? {}) as Json).filter(([, v]) => v !== null && v !== undefined);
  if (hp.length) content.architecture += `; hyperparameters: ${hp.map(([k, v]) => `${k}=${v}`).join(', ')}`;
  sources.architecture = `Version ${version.version} specification`;

  if (version.dataset) {
    const d = version.dataset;
    const features = stringList(version.featureColumns);
    content.trainingData = [
      `${d.name}: ${d.rowCount ?? '?'} rows, ${d.columnCount ?? '?'} columns (SHA-256 ${d.checksumSha256?.slice(0, 12) ?? 'n/a'}…).`,
      version.targetColumn ? `Target: ${version.targetColumn}.` : '',
      features.length ? `Features: ${features.join(', ')}.` : '',
    ]
      .filter(Boolean)
      .join(' ');
    content.evaluatedSubgroups = stringList(d.sensitiveColumns);
    sources.trainingData = 'Training dataset';
    sources.evaluatedSubgroups = 'Dataset sensitive columns';
  }
  const split = (spec.testSize ?? spec.split?.testSize) as number | undefined;
  if (split) {
    content.evaluationData = `Held-out ${Math.round(split * 100)}% test split of the training dataset (seed ${version.randomSeed ?? spec.seed ?? '?'}), not used for fitting.`;
    sources.evaluationData = `Version ${version.version} specification`;
  }

  const metrics = testMetrics(version.metrics);
  for (const [key, label] of Object.entries(PERFORMANCE_LABELS)) {
    if (typeof metrics[key] === 'number') content.performanceMetrics.push({ name: label, key, value: round4(metrics[key]), dataset: 'Held-out test split', source: 'VERSION' });
  }
  if (content.performanceMetrics.length) sources.performanceMetrics = `Version ${version.version} evaluation`;
  else warnings.push('The version has no recorded evaluation metrics.');

  const [audit, mitigation, explain, attack] = await Promise.all([
    latestResult(version.id, ['FAIRNESS_AUDIT']),
    latestResult(version.id, ['FAIRNESS_MITIGATION']),
    latestResult(version.id, ['SHAP', 'LIME']),
    latestResult(version.id, ['FGSM', 'PGD']),
  ]);

  if (audit) {
    for (const a of (audit.data.attributes ?? []) as Json[]) {
      if (a.includedInStatus === false) continue;
      for (const f of FAIRNESS_KEYS) {
        const value = a.disparities?.[f.key];
        if (typeof value === 'number') content.fairnessMetrics.push({ attribute: a.attribute, metric: f.label, key: f.key, value: round4(value), threshold: f.threshold, source: 'EXPERIMENT', experimentId: audit.id });
      }
    }
    content.fairnessThreshold = 'Demographic parity and equalized odds differences at most 0.10 (platform review threshold); selection-rate ratio at least 0.80 (four-fifths rule of thumb).';
    content.evaluations.fairness = evidence(audit);
    sources.fairnessMetrics = `Fairness audit ${audit.id.slice(0, 8)}`;
  } else {
    warnings.push('No completed fairness audit for this version. Run one in the Fairness lab before publishing.');
  }

  if (mitigation) {
    const items = ((mitigation.data.mitigations ?? []) as Json[]).map((m) => `${m.label}: ${m.tradeoff?.summary ?? ''}`.trim());
    content.mitigationTechnique = `Compared in experiment ${mitigation.id.slice(0, 8)}. ${items.join(' ')}`.trim();
    sources.mitigationTechnique = `Mitigation comparison ${mitigation.id.slice(0, 8)}`;
  }

  if (explain) {
    content.evaluations.explainability = evidence(explain);
    const top = ((explain.data.globalImportance ?? []) as Json[]).slice(0, 3).map((g) => g.feature);
    if (top.length && content.evaluations.explainability) content.evaluations.explainability.summary = `Most influential features (SHAP): ${top.join(', ')}. ${content.evaluations.explainability.summary}`.slice(0, 2000);
  } else {
    warnings.push('No completed SHAP or LIME explanation for this version.');
  }

  if (attack) {
    const a = attack.data;
    content.evaluations.security = evidence(attack);
    content.securityMechanisms = `Evasion robustness evaluated with ${a.attack} (${a.threatModel?.mode === 'WHITE_BOX' ? 'white-box' : 'transfer'} attack): accuracy drop ${(a.assessment?.accuracyDrop * 100).toFixed(1)}% at ε = ${a.assessment?.referenceEpsilon} standard deviations.`;
    sources.securityMechanisms = `Robustness test ${attack.id.slice(0, 8)}`;
  } else {
    warnings.push('No completed adversarial robustness test for this version.');
  }

  return { content, sources, warnings };
}

type Issue = { path: string; message: string };

/** Rejects evidence-backed values that differ from what the platform actually recorded. */
export async function verifyEvidence(content: ModelCardContent, modelId: string | null | undefined): Promise<void> {
  const issues: Issue[] = [];
  const versionRef = content.basedOnVersion;
  const version = versionRef ? await prisma.modelVersion.findUnique({ where: { id: versionRef.id } }) : null;
  if (versionRef && (!version || (modelId && version.modelId !== modelId))) {
    issues.push({ path: 'content.basedOnVersion', message: 'The referenced version does not belong to this model' });
  }
  const metrics = testMetrics(version?.metrics ?? null);

  content.performanceMetrics.forEach((m, i) => {
    if (m.source === 'MANUAL') return;
    const recorded = m.source === 'VERSION' && m.key ? metrics[m.key] : undefined;
    if (typeof recorded !== 'number' || m.value === null || Math.abs(recorded - m.value) > TOLERANCE) {
      issues.push({ path: `content.performanceMetrics.${i}.value`, message: `${m.name} does not match the recorded evaluation; mark it as manual or restore the recorded value` });
    }
  });

  const experimentIds = [...new Set([...content.fairnessMetrics.map((f) => f.experimentId), ...Object.values(content.evaluations).map((e) => e?.experimentId)].filter((x): x is string => !!x))];
  const experiments = new Map(
    (await prisma.experiment.findMany({ where: { id: { in: experimentIds } }, select: { id: true, type: true, status: true, modelVersionId: true, results: { select: { data: true }, take: 1 } } })).map((e) => [
      e.id,
      { ...e, data: (e.results[0]?.data ?? {}) as Json },
    ]),
  );

  content.fairnessMetrics.forEach((f, i) => {
    if (f.source === 'MANUAL') return;
    const exp = f.experimentId ? experiments.get(f.experimentId) : undefined;
    const attr = exp?.type === 'FAIRNESS_AUDIT' && exp.status === 'COMPLETED' ? ((exp.data.attributes ?? []) as Json[]).find((a) => a.attribute === f.attribute) : undefined;
    const recorded = f.key ? attr?.disparities?.[f.key] : undefined;
    if (f.source !== 'EXPERIMENT' || typeof recorded !== 'number' || f.value === null || Math.abs(recorded - f.value) > TOLERANCE) {
      issues.push({ path: `content.fairnessMetrics.${i}.value`, message: `${f.metric} for ${f.attribute} does not match the referenced fairness audit` });
    }
  });

  for (const [area, e] of Object.entries(content.evaluations)) {
    if (!e) continue;
    const exp = e.experimentId ? experiments.get(e.experimentId) : undefined;
    const recorded = exp?.status === 'COMPLETED' ? (exp.data.assessment as Json | undefined)?.status : undefined;
    if (e.status !== 'NOT_ASSESSED' && recorded !== e.status) {
      issues.push({ path: `content.evaluations.${area}.status`, message: `The ${area} status must match a completed evaluation run` });
    }
  }
  if (issues.length) throw Errors.validation(issues, 'The card misstates recorded evidence');
}

const REQUIRED_TEXT: [keyof ModelCardContent, string][] = [
  ['modelName', 'Model name'],
  ['developer', 'Developer'],
  ['version', 'Version'],
  ['architecture', 'Architecture'],
  ['intendedUse', 'Intended use'],
  ['outOfScopeUse', 'Out-of-scope use'],
  ['trainingData', 'Training data'],
  ['evaluationData', 'Evaluation data'],
  ['humanOversight', 'Human oversight'],
  ['knownLimitations', 'Known limitations'],
  ['ethicalConsiderations', 'Ethical considerations'],
];

/** What must be completed before review, plus non-blocking concerns shown to author and reviewer. */
export function readiness(content: ModelCardContent) {
  const missing: Issue[] = REQUIRED_TEXT.filter(([k]) => !String(content[k] ?? '').trim()).map(([k, label]) => ({ path: `content.${k}`, message: `${label} is required before review` }));
  if (!content.performanceMetrics.length) missing.push({ path: 'content.performanceMetrics', message: 'Add at least one performance metric' });
  if (content.evaluatedSubgroups.length && !content.fairnessMetrics.length) {
    missing.push({ path: 'content.fairnessMetrics', message: 'Subgroups are listed, so report their fairness metrics (run a fairness audit)' });
  }
  if (content.fairnessMetrics.length && !content.fairnessThreshold.trim()) missing.push({ path: 'content.fairnessThreshold', message: 'State the fairness threshold used' });

  const concerns: string[] = [];
  for (const [area, e] of Object.entries(content.evaluations)) {
    if (e?.status === 'FAILED') concerns.push(`The latest ${area} evaluation FAILED; the card must explain how this is addressed.`);
    if (e?.status === 'WARNING') concerns.push(`The latest ${area} evaluation raised warnings.`);
  }
  for (const area of ['explainability', 'fairness', 'security'] as const) {
    if (!content.evaluations[area]) concerns.push(`No ${area} evaluation is referenced.`);
  }
  const breaches = content.fairnessMetrics.filter((f) => f.value !== null && f.threshold != null && (f.key === 'demographicParityRatio' ? f.value < f.threshold : f.value > f.threshold));
  if (breaches.length) concerns.push(`${breaches.length} fairness metric(s) are outside their stated threshold.`);
  if (content.performanceMetrics.some((m) => m.source === 'MANUAL') || content.fairnessMetrics.some((f) => f.source === 'MANUAL')) {
    concerns.push('Some metrics were entered manually and are not backed by platform evidence.');
  }
  return { ready: missing.length === 0, missing, concerns };
}

const fmt = (v: number | null | undefined) => (v === null || v === undefined ? '—' : String(round4(v)));
const SOURCE_LABEL = { MANUAL: 'Manual entry', VERSION: 'Registered version', EXPERIMENT: 'Platform experiment' } as const;

export function toDocument(card: Pick<ModelCard, 'id' | 'status' | 'version' | 'publishedAt' | 'updatedAt'>, content: ModelCardContent, owner: string): ReportDocument {
  const { concerns } = readiness(content);
  const evaluations = Object.entries(content.evaluations).filter(([, e]) => e) as [string, NonNullable<ModelCardContent['evaluations']['fairness']>][];
  return {
    title: `Model Card: ${content.modelName}`,
    subtitle: `Version ${card.version} · ${card.status.replace('_', ' ').toLowerCase()}`,
    watermark: card.status === 'PUBLISHED' ? undefined : `${card.status.replace('_', ' ')}: not a published model card`,
    meta: [
      ['Card ID', card.id],
      ['Developer', content.developer],
      ['Owner', owner],
      ['Based on model version', content.basedOnVersion?.version ?? null],
      ['Published', card.publishedAt?.toISOString() ?? null],
      ['Last updated', card.updatedAt.toISOString()],
    ],
    sections: [
      { heading: 'Model details', fields: [['Architecture', content.architecture], ['License', content.license]] },
      { heading: 'Intended use', fields: [['Intended use', content.intendedUse], ['Out-of-scope use', content.outOfScopeUse]] },
      { heading: 'Data', fields: [['Training data', content.trainingData], ['Evaluation data', content.evaluationData]] },
      {
        heading: 'Performance',
        table: { headers: ['Metric', 'Value', 'Data', 'Source'], rows: content.performanceMetrics.map((m) => [m.name, fmt(m.value), m.dataset ?? '', SOURCE_LABEL[m.source]]) },
        paragraphs: content.performanceMetrics.length ? [] : ['No performance metrics reported.'],
      },
      {
        heading: 'Fairness',
        fields: [
          ['Evaluated subgroups', content.evaluatedSubgroups.join(', ')],
          ['Fairness threshold', content.fairnessThreshold],
          ['Mitigation technique', content.mitigationTechnique],
        ],
        table: { headers: ['Attribute', 'Metric', 'Value', 'Threshold', 'Source'], rows: content.fairnessMetrics.map((f) => [f.attribute, f.metric, fmt(f.value), fmt(f.threshold), SOURCE_LABEL[f.source]]) },
      },
      {
        heading: 'Evaluation evidence',
        table: { headers: ['Area', 'Status', 'Summary', 'Experiment'], rows: evaluations.map(([area, e]) => [area, e.status, e.summary, e.experimentId ?? '']) },
        paragraphs: evaluations.length ? [] : ['No platform evaluations are referenced.'],
      },
      {
        heading: 'Safeguards',
        fields: [
          ['Privacy mechanisms', content.privacyMechanisms],
          ['Security mechanisms', content.securityMechanisms],
          ['Human oversight', content.humanOversight],
        ],
      },
      {
        heading: 'Limitations and ethics',
        fields: [
          ['Known limitations', content.knownLimitations],
          ['Ethical considerations', content.ethicalConsiderations],
          ['Deployment requirements', content.deploymentRequirements],
        ],
      },
      ...(concerns.length ? [{ heading: 'Open concerns', bullets: concerns }] : []),
    ],
    disclaimer:
      'This model card documents the model as evaluated on the stated data. Evaluation results are evidence for human review, not proof of regulatory compliance. Potential compliance considerations require human and, where appropriate, legal review.',
    generatedAt: new Date(),
  };
}
