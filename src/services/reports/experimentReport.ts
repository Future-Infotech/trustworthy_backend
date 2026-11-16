import type { ReportDocument, ReportSection } from './document';

type Cell = string | number | null | undefined;
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export type ReportCategory = 'xai' | 'fairness' | 'robustness';

export const REPORT_CATEGORY: Partial<Record<string, ReportCategory>> = {
  SHAP: 'xai',
  LIME: 'xai',
  COUNTERFACTUAL: 'xai',
  GRAD_CAM: 'xai',
  FAIRNESS_AUDIT: 'fairness',
  FAIRNESS_MITIGATION: 'fairness',
  FGSM: 'robustness',
  PGD: 'robustness',
  ADVERSARIAL_TRAINING: 'robustness',
};

const CATEGORY_TITLE: Record<ReportCategory, string> = { xai: 'Explainability Report', fairness: 'Fairness Report', robustness: 'Robustness Report' };

export interface ExperimentForReport {
  id: string;
  name: string | null;
  type: string;
  algorithm: string | null;
  randomSeed: number;
  configHash: string;
  isEducational: boolean;
  completedAt: Date | null;
  durationMs: number | null;
  owner: string;
  dataset: string | null;
  modelVersion: string | null;
  results: { kind: string; data: unknown }[];
}

const num = (v: unknown, digits = 4): Cell => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10 ** digits) / 10 ** digits : v === null || v === undefined ? null : String(v));
const pct = (v: unknown): Cell => (typeof v === 'number' && Number.isFinite(v) ? `${Math.round(v * 1000) / 10}%` : null);
const text = (v: unknown): Cell => (v === null || v === undefined ? null : typeof v === 'object' ? JSON.stringify(v) : String(v));
const humanize = (v: unknown) => String(v ?? '').toLowerCase().replace(/_/g, ' ');
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);

function assessmentSection(heading: string, a: Json | undefined): ReportSection {
  return {
    heading,
    fields: [['Status', humanize(a?.status ?? 'NOT_ASSESSED')]],
    bullets: list(a?.reasons),
  };
}

function notesSections(r: Json): ReportSection[] {
  const out: ReportSection[] = [];
  if (list(r.warnings).length) out.push({ heading: 'Warnings', bullets: list(r.warnings) });
  if (list(r.notes).length) out.push({ heading: 'Notes', bullets: list(r.notes) });
  return out;
}

const changesText = (changes: unknown) =>
  arr(changes)
    .map((c) => `${c.feature}: ${text(c.from)} → ${text(c.to)}`)
    .join('; ') || '—';

// ── Explainability ───────────────────────────────────────────────────────────

function shap(r: Json): ReportSection[] {
  return [
    {
      heading: 'SHAP summary',
      fields: [
        ['Method', r.method],
        ['Explained class', r.explainedClass],
        ['Output space', r.outputSpace],
        ['Base value (expected model output)', num(r.baseValue)],
        ['Background sample size', r.backgroundSize],
        ['Explained sample size', r.sampleSize],
        ['Additivity error', num(r.additivityError, 6)],
      ],
    },
    assessmentSection('Explanation quality assessment', r.assessment),
    {
      heading: 'Global feature importance',
      paragraphs: ['Mean absolute SHAP value per feature across the explained sample. The signed mean shows the average direction of the effect on the explained class.'],
      table: { headers: ['Feature', 'Mean |SHAP|', 'Mean SHAP'], rows: arr(r.globalImportance).slice(0, 25).map((g) => [g.feature, num(g.meanAbsShap), num(g.meanShap)]) },
    },
    ...arr(r.local)
      .slice(0, 5)
      .map((l) => ({
        heading: `Local explanation: dataset row ${l.datasetRow}`,
        fields: [
          ['Actual', l.actual],
          ['Predicted', `${l.predicted} (${pct(l.probability)})`],
          ['Base value → model output', `${num(l.baseValue)} → ${num(l.output)}`],
        ] as [string, Cell][],
        table: {
          headers: ['Feature', 'Value', 'Contribution'],
          rows: [...arr(l.contributions)]
            .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
            .slice(0, 10)
            .map((c) => [c.feature, text(c.value), num(c.contribution)]),
        },
      })),
    ...notesSections(r),
  ];
}

function lime(r: Json): ReportSection[] {
  return [
    {
      heading: 'LIME summary',
      fields: [
        ['Method', r.method],
        ['Explained class', r.explainedClass],
        ['Perturbation samples', r.numSamples],
        ['Features per explanation', r.numFeatures],
        ['Mean local fidelity (R²)', num(r.meanFidelity)],
        ['Mean stability across re-runs', num(r.meanStability)],
      ],
    },
    assessmentSection('Explanation quality assessment', r.assessment),
    ...arr(r.local)
      .slice(0, 5)
      .map((l) => ({
        heading: `Local explanation: dataset row ${l.datasetRow}`,
        fields: [
          ['Actual', l.actual],
          ['Predicted', `${l.predicted} (${pct(l.probability)})`],
          ['Fidelity', num(l.fidelity)],
          ['Stability', num(l.stability)],
        ] as [string, Cell][],
        table: { headers: ['Condition', 'Weight'], rows: arr(l.weights).map((w) => [w.condition, num(w.weight)]) },
      })),
    ...notesSections(r),
  ];
}

function counterfactual(r: Json): ReportSection[] {
  const inst = (r.instance ?? {}) as Json;
  return [
    {
      heading: 'Counterfactual search',
      fields: [
        ['Method', r.method],
        ['Explained instance', `Dataset row ${inst.datasetRow}: predicted ${inst.predicted} (${pct(inst.probability)}), actual ${inst.actual}`],
        ['Desired outcome', r.desiredClass],
        ['Counterfactual found', r.found ? 'Yes' : 'No'],
        ['Candidates evaluated', r.candidatesEvaluated],
        ['Maximum features changed', r.maxChanges],
        ['Immutable features', list(r.immutableFeatures).join(', ') || null],
      ],
    },
    {
      heading: 'Counterfactual explanations',
      paragraphs: r.found ? [] : ['No counterfactual reaching the desired outcome was found within the search limits. This is a result, not an error.'],
      table: { headers: ['Changes', 'Probability of desired outcome', 'Distance'], rows: arr(r.counterfactuals).map((c) => [changesText(c.changes), pct(c.probability), num(c.distance)]) },
    },
    ...notesSections(r),
  ];
}

function gradcam(r: Json): ReportSection[] {
  const m = (r.model ?? {}) as Json;
  return [
    {
      heading: 'Grad-CAM summary',
      fields: [
        ['Method', r.method],
        ['Dataset', r.dataset],
        ['Architecture', list(m.architecture).join(' → ')],
        ['Parameters', m.parameters],
        ['Training epochs', m.epochs],
        ['Train accuracy', pct(m.trainAccuracy)],
        ['Test accuracy', pct(m.testAccuracy)],
      ],
    },
    {
      heading: 'Explained images',
      paragraphs: ['Heatmaps are available in the interactive lab view; this report lists the predictions they explain.'],
      table: {
        headers: ['Image', 'Label', 'Predicted', 'Confidence', 'Correct'],
        rows: arr(r.instances).map((i) => [i.index, i.label, i.predicted, pct(i.confidence), i.correct ? 'Yes' : 'No']),
      },
    },
    ...notesSections(r),
  ];
}

// ── Fairness ─────────────────────────────────────────────────────────────────

const DISPARITY_LABELS: [string, string][] = [
  ['demographicParityDifference', 'Demographic parity difference'],
  ['demographicParityRatio', 'Demographic parity ratio'],
  ['equalOpportunityDifference', 'Equal opportunity difference'],
  ['falsePositiveRateDifference', 'False positive rate difference'],
  ['equalizedOddsDifference', 'Equalized odds difference'],
  ['accuracyDifference', 'Accuracy difference'],
];

const groupTable = (groups: unknown) => ({
  headers: ['Group', 'Count', 'Selection rate', 'Base rate', 'Accuracy', 'TPR', 'FPR', 'Reliable sample'],
  rows: arr(groups).map((g) => [g.group, g.count, pct(g.selectionRate), pct(g.baseRate), pct(g.accuracy), pct(g.tpr), pct(g.fpr), g.reliable ? 'Yes' : 'No (small group)']),
});

const overallFields = (o: Json | undefined): [string, Cell][] => [
  ['Accuracy', pct(o?.accuracy)],
  ['Balanced accuracy', pct(o?.balancedAccuracy)],
  ['F1 score', num(o?.f1)],
  ['Selection rate', pct(o?.selectionRate)],
  ...(o?.rocAuc !== undefined && o?.rocAuc !== null ? ([['ROC AUC', num(o.rocAuc)]] as [string, Cell][]) : []),
];

const TRADEOFF_NOTE =
  'Fairness criteria can conflict: when base rates differ between groups, demographic parity, equalized odds and calibration generally cannot all be satisfied at once, and reducing one disparity may increase another or reduce accuracy. Which criterion matters depends on the decision context and must be chosen by accountable humans.';

function fairnessAudit(r: Json): ReportSection[] {
  const attributes = arr(r.attributes);
  const unfavourable = attributes.filter((a) => a.status === 'FAILED' || a.status === 'WARNING');
  return [
    {
      heading: 'Audit summary',
      fields: [['Algorithm', r.algorithm], ['Favourable outcome', r.positiveLabel], ['Test rows', r.testRows], ['Overall fairness status', humanize(r.status)], ...overallFields(r.overall)],
      bullets: list(r.assessment?.reasons),
    },
    {
      heading: 'Unfavourable findings',
      paragraphs: unfavourable.length
        ? ['The following attributes show disparities above the configured thresholds. They are reported in full and must be reviewed before the model is used.']
        : ['No attribute exceeded the configured disparity thresholds in this test sample. This does not establish that the model is fair in deployment.'],
      bullets: unfavourable.flatMap((a) => [`${a.attribute} (${humanize(a.status)})`, ...list(a.findings).map((f) => `  ${f}`)]),
    },
    ...attributes.map((a) => ({
      heading: `Attribute: ${a.attribute}`,
      fields: [
        ['Status', humanize(a.status)],
        ['Used as a model feature', a.usedAsFeature ? 'Yes' : 'No'],
        ['Four-fifths rule', a.fourFifthsPassed === null || a.fourFifthsPassed === undefined ? 'Not applicable' : a.fourFifthsPassed ? 'Passed' : 'Not met'],
        ['Demographic parity 95% interval', Array.isArray(a.dpInterval) ? `${num(a.dpInterval[0])} to ${num(a.dpInterval[1])}` : null],
        ...DISPARITY_LABELS.map(([k, label]) => [label, num(a.disparities?.[k])] as [string, Cell]),
      ] as [string, Cell][],
      bullets: list(a.findings),
      table: groupTable(a.groups),
    })),
    { heading: 'Trade-offs and limitations', paragraphs: [TRADEOFF_NOTE] },
    ...notesSections(r),
  ];
}

const disparityLabel = (key: unknown) => DISPARITY_LABELS.find(([k]) => k === key)?.[1] ?? humanize(key);

/** Disparities a mitigation made worse than the baseline; ratios worsen when they fall, differences when they rise. */
function worsenedDisparities(baseline: Json | undefined, after: Json | undefined): string[] {
  return DISPARITY_LABELS.flatMap(([key, label]) => {
    const b = baseline?.[key];
    const a = after?.[key];
    if (typeof b !== 'number' || typeof a !== 'number') return [];
    const worse = key === 'demographicParityRatio' ? b - a : a - b;
    return worse > 0.01 ? [`${label} worsened from ${num(b, 3)} to ${num(a, 3)}`] : [];
  });
}

function fairnessMitigation(r: Json): ReportSection[] {
  const baseline = (r.baseline ?? {}) as Json;
  const mitigations = arr(r.mitigations);
  const sideEffects = mitigations.flatMap((m) => worsenedDisparities(baseline.disparities, m.disparities).map((w) => `${m.label}: ${w}.`));
  return [
    {
      heading: 'Mitigation summary',
      fields: [['Algorithm', r.algorithm], ['Sensitive attribute', r.attribute], ['Favourable outcome', r.positiveLabel]],
    },
    {
      heading: 'Baseline (before mitigation)',
      fields: [...overallFields(baseline.overall), ...DISPARITY_LABELS.map(([k, label]) => [label, num(baseline.disparities?.[k])] as [string, Cell])],
      table: groupTable(baseline.groups),
    },
    {
      heading: 'Before and after comparison',
      table: {
        headers: ['Mitigation', 'Accuracy', 'Accuracy change', 'Target disparity', 'Before', 'After', 'Disparity change'],
        rows: mitigations.map((m) => [
          m.label,
          pct(m.overall?.accuracy),
          pct(m.tradeoff?.accuracyChange),
          disparityLabel(m.tradeoff?.targetMetric),
          num(m.tradeoff?.before),
          num(m.tradeoff?.after),
          num(m.tradeoff?.disparityChange),
        ]),
      },
    },
    {
      heading: 'Trade-offs',
      paragraphs: [TRADEOFF_NOTE],
      bullets: [
        ...mitigations.map((m) => `${m.label}: ${m.tradeoff?.summary ?? ''}`),
        ...mitigations
          .filter((m) => m.usesSensitiveAtPrediction)
          .map((m) => `${m.label} uses the sensitive attribute at prediction time. Potential compliance consideration: this may be restricted in some jurisdictions and requires legal review.`),
      ],
    },
    {
      heading: 'Unfavourable side effects',
      paragraphs: sideEffects.length
        ? ['Metrics that the mitigation was not targeting can get worse. These increases are reported in full:']
        : ['No other disparity metric worsened by more than 0.01 after mitigation in this test sample.'],
      bullets: sideEffects,
    },
    ...mitigations.map((m) => ({
      heading: `After mitigation: ${m.label}`,
      fields: [...overallFields(m.overall), ...DISPARITY_LABELS.map(([k, label]) => [label, num(m.disparities?.[k])] as [string, Cell])],
      table: groupTable(m.groups),
    })),
    ...notesSections(r),
  ];
}

// ── Robustness ───────────────────────────────────────────────────────────────

const curveTable = (curve: unknown, unit: string) => ({
  headers: [`ε (${unit})`, 'Adversarial accuracy', 'Random-noise accuracy', 'Attack success rate', 'Prediction flip rate'],
  rows: arr(curve).map((p) => [num(p.epsilon), pct(p.accuracy), pct(p.randomNoiseAccuracy), pct(p.attackSuccessRate), pct(p.flipRate)]),
});

function robustnessAssessment(a: Json | undefined): ReportSection {
  return {
    heading: 'Robustness assessment',
    fields: [
      ['Status', humanize(a?.status ?? 'NOT_ASSESSED')],
      ['Reference ε', num(a?.referenceEpsilon)],
      ['Accuracy drop at reference ε', pct(a?.accuracyDrop)],
    ],
    bullets: list(a?.reasons),
  };
}

function robustnessTabular(r: Json): ReportSection[] {
  return [
    {
      heading: `${r.attack} attack configuration`,
      fields: [
        ['Algorithm', r.algorithm],
        ['Target', r.target],
        ['Attack steps', r.steps],
        ['Threat model', r.threatModel ? `${humanize(r.threatModel.mode)}: ${r.threatModel.description}` : null],
        ['Surrogate agreement', pct(r.threatModel?.surrogateAgreement)],
        ['Mutable features', list(r.mutableFeatures).join(', ') || null],
        ['Immutable features', list(r.immutableFeatures).join(', ') || null],
        ['Test rows', r.testRows],
      ],
    },
    robustnessAssessment(r.assessment),
    { heading: 'Accuracy under attack', table: curveTable(r.curve, r.unit ?? 'units') },
    {
      heading: `Adversarial examples at ε = ${num(r.exampleEpsilon)}`,
      table: {
        headers: ['Dataset row', 'Actual', 'Prediction', 'Adversarial prediction', 'Feature changes'],
        rows: arr(r.examples)
          .slice(0, 10)
          .map((e) => [e.datasetRow, e.actual, `${e.predicted} (${pct(e.probability)})`, `${e.adversarialPredicted} (${pct(e.adversarialProbability)})`, changesText(e.changes)]),
      },
    },
    ...notesSections(r),
  ];
}

function robustnessImage(r: Json): ReportSection[] {
  const m = (r.model ?? {}) as Json;
  return [
    {
      heading: `${r.attack} attack configuration`,
      fields: [
        ['Dataset', r.dataset],
        ['Attack steps', r.steps],
        ['Architecture', list(m.architecture).join(' → ')],
        ['Clean test accuracy', pct(m.testAccuracy)],
      ],
    },
    robustnessAssessment(r.assessment),
    { heading: 'Accuracy under attack', table: curveTable(r.curve, r.unit ?? 'pixel intensity') },
    {
      heading: `Adversarial examples at ε = ${num(r.exampleEpsilon)}`,
      table: {
        headers: ['Image', 'Label', 'Prediction', 'Adversarial prediction', 'Fooled'],
        rows: arr(r.examples).map((e) => [e.index, e.label, `${e.predicted} (${pct(e.confidence)})`, `${e.adversarialPredicted} (${pct(e.adversarialConfidence)})`, e.fooled ? 'Yes' : 'No']),
      },
    },
    ...notesSections(r),
  ];
}

function adversarialTraining(r: Json): ReportSection[] {
  const std = (r.standard ?? {}) as Json;
  const adv = (r.adversarial ?? {}) as Json;
  const rows: Cell[][] = [];
  for (const attack of Object.keys(std.curves ?? {})) {
    const advCurve = arr(adv.curves?.[attack]);
    arr(std.curves[attack]).forEach((p, i) => rows.push([attack, num(p.epsilon), pct(p.accuracy), pct(advCurve[i]?.accuracy)]));
  }
  return [
    {
      heading: 'Adversarial training configuration',
      fields: [
        ['Dataset', r.dataset],
        ['Training attack', r.trainAttack],
        ['Training ε', num(r.trainEpsilon)],
        ['Training attack steps', r.trainSteps],
        ['Evaluation attack steps', r.evalSteps],
      ],
      bullets: list(r.summary),
    },
    robustnessAssessment(r.assessment),
    {
      heading: 'Clean accuracy trade-off',
      fields: [
        ['Standard model clean test accuracy', pct(std.model?.testAccuracy)],
        ['Adversarially trained model clean test accuracy', pct(adv.model?.testAccuracy)],
      ],
      paragraphs: ['Adversarial training commonly improves robustness at the cost of some clean accuracy and extra training time; both are reported here.'],
    },
    { heading: 'Accuracy under attack: standard vs adversarially trained', table: { headers: ['Attack', 'ε', 'Standard model', 'Adversarially trained'], rows } },
    ...notesSections(r),
  ];
}

const BUILDERS: Record<string, (r: Json) => ReportSection[]> = {
  shap,
  lime,
  counterfactual,
  gradcam,
  fairness_audit: fairnessAudit,
  fairness_mitigation: fairnessMitigation,
  robustness_tabular: robustnessTabular,
  robustness_image: robustnessImage,
  adversarial_training: adversarialTraining,
};

export const REPORTABLE_KINDS = Object.keys(BUILDERS);

export const hasReportableResult = (results: { kind: string }[]) => results.some((r) => r.kind in BUILDERS);

/** Renders the stored results of a completed experiment; nothing in the report is computed or invented here. */
export function experimentReport(e: ExperimentForReport, disclaimer: string): ReportDocument {
  const category = REPORT_CATEGORY[e.type] ?? 'xai';
  const sections = e.results.filter((r) => r.kind in BUILDERS).flatMap((r) => BUILDERS[r.kind]((r.data ?? {}) as Json));
  return {
    title: `${CATEGORY_TITLE[category]}: ${e.name ?? humanize(e.type)}`,
    subtitle: `${humanize(e.type)} experiment`,
    watermark: e.isEducational ? 'EDUCATIONAL SIMULATION: these results are not evidence of regulatory compliance' : undefined,
    meta: [
      ['Experiment ID', e.id],
      ['Run by', e.owner],
      ['Dataset', e.dataset],
      ['Model', e.modelVersion],
      ['Algorithm', e.algorithm],
      ['Random seed', e.randomSeed],
      ['Configuration hash', e.configHash],
      ['Completed', e.completedAt?.toISOString() ?? null],
      ['Duration', e.durationMs === null ? null : `${(e.durationMs / 1000).toFixed(1)} s`],
    ],
    sections: [
      ...sections,
      {
        heading: 'Interpretation and limitations',
        paragraphs: [
          'These results describe the behaviour of this model on this dataset sample under the stated configuration. They are reproducible from the random seed and configuration hash above, but they do not establish causal effects, real-world fairness or security, and they must be reviewed by qualified people before informing decisions.',
        ],
      },
    ],
    disclaimer,
    generatedAt: new Date(),
  };
}
