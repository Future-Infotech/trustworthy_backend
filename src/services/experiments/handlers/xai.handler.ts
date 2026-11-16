import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PERMISSIONS } from '../../../rbac/permissions';
import type { ExperimentHandler } from '../types';
import { columnSchema, seedSchema } from './common';
import { columnsMustExist, sourcedHandler } from './sourced';

const MAX_INSTANCES = 10;
const instances = z.array(z.number().int().min(0)).min(1).max(MAX_INSTANCES).optional();
const label = z.string().trim().min(1).max(200).optional();

export const shapHandler = sourcedHandler({
  type: 'SHAP',
  job: 'xai.shap',
  permission: PERMISSIONS.XAI_RUN,
  kind: 'shap',
  shape: {
    instances,
    classLabel: label,
    backgroundSize: z.number().int().min(20).max(500).default(100),
    sampleSize: z.number().int().min(50).max(1000).default(300),
  },
  maskOutput: true,
  statusField: 'explainabilityStatus',
  metrics: (r) => ({ additivityError: r.additivityError, status: r.assessment?.status }),
});

export const limeHandler = sourcedHandler({
  type: 'LIME',
  job: 'xai.lime',
  permission: PERMISSIONS.XAI_RUN,
  kind: 'lime',
  shape: {
    instances,
    classLabel: label,
    numFeatures: z.number().int().min(2).max(20).default(8),
    numSamples: z.number().int().min(200).max(5000).default(1000),
  },
  maskOutput: true,
  statusField: 'explainabilityStatus',
  metrics: (r) => ({ meanFidelity: r.meanFidelity, meanStability: r.meanStability, status: r.assessment?.status }),
});

export const counterfactualHandler = sourcedHandler({
  type: 'COUNTERFACTUAL',
  job: 'xai.counterfactual',
  permission: PERMISSIONS.XAI_RUN,
  kind: 'counterfactual',
  shape: {
    instance: z.number().int().min(0).default(0),
    desiredLabel: label,
    /** Defaults to the dataset's sensitive columns: recourse should not ask people to change protected traits. */
    immutableFeatures: z.array(columnSchema).max(50).optional(),
    maxChanges: z.number().int().min(1).max(3).default(2),
    count: z.number().int().min(1).max(5).default(3),
  },
  validate: (input, dataset) => columnsMustExist(dataset, input.immutableFeatures ?? [], 'params.immutableFeatures'),
  extraParams: (input, dataset) => ({ immutableFeatures: input.immutableFeatures ?? dataset.sensitiveColumns }),
  maskOutput: true,
  metrics: (r) => ({ found: Array.isArray(r.counterfactuals) ? r.counterfactuals.length : 0 }),
});

const gradCamInput = z.object({
  epochs: z.number().int().min(1).max(40).default(12),
  seed: seedSchema.default(42),
  instances: z.array(z.number().int().min(0)).min(1).max(12).optional(),
  count: z.number().int().min(1).max(12).default(6),
});

interface GradCamResult {
  model: { testAccuracy: number };
  [key: string]: unknown;
}

export const gradCamHandler: ExperimentHandler<z.infer<typeof gradCamInput>> = {
  type: 'GRAD_CAM',
  job: 'xai.gradcam',
  permission: PERMISSIONS.XAI_RUN,
  input: gradCamInput,
  async prepare({ seed }) {
    return { algorithm: 'CNN', randomSeed: seed };
  },
  async jobParams(input) {
    return input;
  },
  async complete(result: GradCamResult) {
    return [{ kind: 'gradcam', metrics: { testAccuracy: result.model.testAccuracy }, data: result as unknown as Prisma.InputJsonValue }];
  },
};
