import { z } from 'zod';
import type { AuthContext } from '../../../middleware/authorize';
import { Errors } from '../../../utils/errors';
import { mlClient } from '../../ml/mlClient';
import { loadDatasetCsv, resolveModelSource, type ModelSource } from '../sources';

export const ALGORITHMS = ['LOGISTIC_REGRESSION', 'DECISION_TREE', 'RANDOM_FOREST', 'GRADIENT_BOOSTING'] as const;
export const seedSchema = z.number().int().min(0).max(2_147_483_647);
const column = z.string().trim().min(1).max(200);

export const modelSpecSchema = z
  .object({
    target: column,
    features: z.array(column).min(1).max(200).optional(),
    algorithm: z.enum(ALGORITHMS),
    hyperparameters: z.record(z.union([z.number(), z.string(), z.boolean(), z.null()])).default({}),
    testSize: z.number().min(0.1).max(0.5).default(0.25),
    seed: seedSchema.default(42),
    positiveLabel: z.string().max(200).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.features?.includes(v.target)) ctx.addIssue({ code: 'custom', path: ['features'], message: 'The target cannot also be a feature' });
    if (v.features && new Set(v.features).size !== v.features.length) ctx.addIssue({ code: 'custom', path: ['features'], message: 'Features must be unique' });
  });

const sourceShape = { modelVersionId: z.string().uuid().optional(), trainingExperimentId: z.string().uuid().optional() };
const exactlyOneSource = (v: { modelVersionId?: string; trainingExperimentId?: string }) => !!v.modelVersionId !== !!v.trainingExperimentId;
const sourceIssue = { message: 'Choose exactly one model version or training run', path: ['modelVersionId'] };

/** Downstream analyses run against a registered model version or a completed training run. */
export const modelSourceSchema = z.object(sourceShape).refine(exactlyOneSource, sourceIssue);

/** Input schema for an analysis of a model source plus analysis-specific fields. */
export function sourcedInput<S extends z.ZodRawShape>(shape: S) {
  return z.object({ ...sourceShape, ...shape }).refine(exactlyOneSource, sourceIssue);
}

export const columnSchema = column;

export function sourceOf(input: { modelVersionId?: string; trainingExperimentId?: string }) {
  return { modelVersionId: input.modelVersionId, trainingExperimentId: input.trainingExperimentId };
}

export function assertColumnsExist(columns: string[], names: (string | undefined)[], path: string) {
  const missing = names.filter((n): n is string => !!n && !columns.includes(n));
  if (missing.length) throw Errors.validation(missing.map((n) => ({ path, message: `Column "${n}" does not exist in the dataset` })));
}

/**
 * Validates hyperparameters against the ML service catalogue when it is reachable, so users get
 * immediate feedback; otherwise the ML service validates them again when the job runs.
 */
export async function precheckHyperparameters(algorithm: string, hyperparameters: Record<string, unknown>) {
  const catalogue = await mlClient.algorithms().catch(() => null);
  const spec = catalogue?.find((a) => a.key === algorithm);
  if (!spec) return;
  const issues = Object.keys(hyperparameters)
    .filter((k) => !spec.params.some((p) => p.name === k))
    .map((k) => ({ path: `params.model.hyperparameters.${k}`, message: `Unknown hyperparameter for ${spec.label}` }));
  for (const p of spec.params) {
    const v = hyperparameters[p.name];
    if (v === undefined || (v === null && p.nullable)) continue;
    if (p.kind === 'choice' ? !p.choices.includes(v) : typeof v !== 'number' || (p.minimum !== null && v < p.minimum) || (p.maximum !== null && v > p.maximum)) {
      issues.push({ path: `params.model.hyperparameters.${p.name}`, message: `${p.name} is outside the allowed range` });
    }
  }
  if (issues.length) throw Errors.validation(issues);
}

/** Resolves a model source and loads its training data for a downstream ML job. */
export async function modelJobBase(source: { modelVersionId?: string; trainingExperimentId?: string }) {
  const resolved: ModelSource = await resolveModelSource(source, null);
  const { csv, sha256 } = await loadDatasetCsv(resolved.datasetId);
  return { resolved, base: { dataset: { csv, sha256 }, model: resolved.spec, expectedFingerprint: resolved.fingerprint ?? undefined } };
}

export async function prepareModelSource(source: { modelVersionId?: string; trainingExperimentId?: string }, auth: AuthContext | null) {
  const resolved = await resolveModelSource(source, auth);
  return {
    resolved,
    prepared: {
      datasetId: resolved.datasetId,
      modelVersionId: resolved.modelVersionId,
      algorithm: resolved.spec.algorithm,
      hashInputs: { spec: resolved.spec, fingerprint: resolved.fingerprint },
    },
  };
}
