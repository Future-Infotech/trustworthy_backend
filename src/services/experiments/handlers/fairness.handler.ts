import { z } from 'zod';
import { PERMISSIONS } from '../../../rbac/permissions';
import { Errors } from '../../../utils/errors';
import { columnSchema } from './common';
import { columnsMustExist, sourcedHandler, type SourceDataset } from './sourced';

const mitigation = z.object({
  technique: z.enum(['EXPONENTIATED_GRADIENT', 'THRESHOLD_OPTIMIZER']),
  constraint: z.enum(['DEMOGRAPHIC_PARITY', 'EQUALIZED_ODDS', 'TRUE_POSITIVE_RATE_PARITY']),
});

const DEFAULT_MITIGATIONS: z.infer<typeof mitigation>[] = [
  { technique: 'EXPONENTIATED_GRADIENT', constraint: 'DEMOGRAPHIC_PARITY' },
  { technique: 'THRESHOLD_OPTIMIZER', constraint: 'EQUALIZED_ODDS' },
];

/** The attributes to analyse: explicit ones, or the dataset's sensitive columns. */
function sensitiveOrDefault(explicit: string[] | undefined, dataset: SourceDataset, path: string): string[] {
  const chosen = explicit?.length ? explicit : dataset.sensitiveColumns;
  if (!chosen.length) {
    throw Errors.validation([{ path, message: 'The training dataset has no sensitive columns; choose the attribute(s) to analyse' }]);
  }
  return chosen;
}

export const fairnessAuditHandler = sourcedHandler({
  type: 'FAIRNESS_AUDIT',
  job: 'fairness.audit',
  permission: PERMISSIONS.FAIRNESS_RUN,
  kind: 'fairness_audit',
  shape: {
    /** Defaults to the dataset's sensitive columns. */
    sensitiveFeatures: z.array(columnSchema).min(1).max(3).optional(),
    intersectional: z.boolean().default(true),
  },
  validate: (input, dataset) => {
    const chosen = sensitiveOrDefault(input.sensitiveFeatures, dataset, 'params.sensitiveFeatures');
    columnsMustExist(dataset, chosen, 'params.sensitiveFeatures');
  },
  extraParams: (input, dataset) => ({ sensitiveFeatures: sensitiveOrDefault(input.sensitiveFeatures, dataset, 'params.sensitiveFeatures').slice(0, 3) }),
  statusField: 'fairnessStatus',
  metrics: (r) => {
    const attrs = (r.attributes as { disparities: { demographicParityDifference: number | null } }[] | undefined) ?? [];
    const gaps = attrs.map((a) => a.disparities.demographicParityDifference).filter((v): v is number => v !== null);
    return { status: r.status, maxDemographicParityDifference: gaps.length ? Math.max(...gaps) : null };
  },
});

export const fairnessMitigationHandler = sourcedHandler({
  type: 'FAIRNESS_MITIGATION',
  job: 'fairness.mitigate',
  permission: PERMISSIONS.FAIRNESS_RUN,
  kind: 'fairness_mitigation',
  shape: {
    /** Defaults to the dataset's first sensitive column. */
    sensitiveFeature: columnSchema.optional(),
    mitigations: z
      .array(mitigation)
      .min(1)
      .max(4)
      .refine((list) => new Set(list.map((m) => `${m.technique}:${m.constraint}`)).size === list.length, 'Each mitigation can only be listed once')
      .default(DEFAULT_MITIGATIONS),
  },
  validate: (input, dataset) => {
    const [chosen] = sensitiveOrDefault(input.sensitiveFeature ? [input.sensitiveFeature] : undefined, dataset, 'params.sensitiveFeature');
    columnsMustExist(dataset, [chosen], 'params.sensitiveFeature');
  },
  extraParams: (input, dataset) => ({ sensitiveFeature: input.sensitiveFeature ?? sensitiveOrDefault(undefined, dataset, 'params.sensitiveFeature')[0] }),
  metrics: (r) => {
    const list = (r.mitigations as { label: string; tradeoff: { disparityChange: number | null; accuracyChange: number } }[] | undefined) ?? [];
    return { mitigations: list.length, improved: list.filter((m) => (m.tradeoff.disparityChange ?? 0) < 0).length };
  },
});
