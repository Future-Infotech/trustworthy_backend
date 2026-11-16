import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PERMISSIONS } from '../../../rbac/permissions';
import type { ExperimentHandler } from '../types';
import { columnSchema, seedSchema } from './common';
import { columnsMustExist, sourcedHandler } from './sourced';
import { variantHandler } from './variant';

type Attack = 'FGSM' | 'PGD';

interface CurvePoint {
  epsilon: number;
  accuracy: number;
}

interface RobustnessResult {
  curve?: CurvePoint[];
  assessment?: { status: string; referenceEpsilon: number; accuracyDrop: number };
  [key: string]: unknown;
}

/** The built-in digits CNN; any other target is a registered tabular model or training run. */
export const IMAGE_TARGET = 'DIGITS_CNN';

const isImageTarget = (params: unknown) => typeof params === 'object' && params !== null && (params as { target?: unknown }).target === IMAGE_TARGET;

function curveMetrics(r: RobustnessResult) {
  const at = (eps: number) => r.curve?.find((p) => Math.abs(p.epsilon - eps) < 1e-9)?.accuracy ?? null;
  const reference = r.assessment?.referenceEpsilon ?? 0;
  return { status: r.assessment?.status, cleanAccuracy: at(0), attackedAccuracy: at(reference), accuracyDrop: r.assessment?.accuracyDrop, referenceEpsilon: reference };
}

const epsilons = (max: number) => z.array(z.number().positive().max(max)).min(1).max(8);
const pgdSteps = (attack: Attack, max: number): z.ZodRawShape => (attack === 'PGD' ? { steps: z.number().int().min(1).max(max).default(10) } : {});

function tabularAttack(attack: Attack) {
  return sourcedHandler({
    type: attack,
    job: 'robustness.tabular',
    permission: PERMISSIONS.ROBUSTNESS_RUN,
    kind: 'robustness_tabular',
    shape: {
      /** In standard deviations of each numeric feature. */
      epsilons: epsilons(3).default([0.1, 0.25, 0.5, 1]),
      referenceEpsilon: z.number().positive().max(3).default(0.25),
      ...pgdSteps(attack, 50),
      /** Defaults to the dataset's sensitive columns: an attack should not need to alter protected traits. */
      immutableFeatures: z.array(columnSchema).max(50).optional(),
      count: z.number().int().min(1).max(10).default(5),
    },
    validate: (input, dataset) => columnsMustExist(dataset, input.immutableFeatures ?? [], 'params.immutableFeatures'),
    extraParams: (input, dataset) => ({ attack, immutableFeatures: input.immutableFeatures ?? dataset.sensitiveColumns }),
    maskOutput: true,
    statusField: 'securityStatus',
    metrics: (r) => curveMetrics(r as RobustnessResult),
  });
}

function imageAttack(attack: Attack): ExperimentHandler {
  const input = z.object({
    target: z.literal(IMAGE_TARGET),
    /** Per-pixel L∞ budget on the 0–1 intensity scale. */
    epsilons: epsilons(0.5).default([0.02, 0.05, 0.1, 0.15, 0.2, 0.3]),
    referenceEpsilon: z.number().positive().max(0.5).default(0.1),
    ...pgdSteps(attack, 40),
    epochs: z.number().int().min(1).max(40).default(12),
    seed: seedSchema.default(42),
    count: z.number().int().min(1).max(10).default(6),
  });
  return {
    type: attack,
    job: 'robustness.image',
    permission: PERMISSIONS.ROBUSTNESS_RUN,
    input,
    async prepare({ seed }: z.infer<typeof input>) {
      return { algorithm: 'CNN', randomSeed: seed };
    },
    async jobParams({ target: _target, ...rest }: z.infer<typeof input>) {
      return { ...rest, attack };
    },
    async complete(result: RobustnessResult) {
      return [{ kind: 'robustness_image', metrics: curveMetrics(result), data: result as Prisma.InputJsonValue }];
    },
  };
}

function attackHandler(attack: Attack): ExperimentHandler {
  const tabular = tabularAttack(attack);
  const image = imageAttack(attack);
  return variantHandler(attack, PERMISSIONS.ROBUSTNESS_RUN, (params) => (isImageTarget(params) ? image : tabular));
}

export const fgsmHandler = attackHandler('FGSM');
export const pgdHandler = attackHandler('PGD');

const adversarialTrainingInput = z.object({
  trainAttack: z.enum(['FGSM', 'PGD']).default('PGD'),
  trainEpsilon: z.number().positive().max(0.3).default(0.1),
  trainSteps: z.number().int().min(1).max(10).default(5),
  evalEpsilons: epsilons(0.5).max(6).default([0.05, 0.1, 0.15, 0.2]),
  evalSteps: z.number().int().min(1).max(20).default(10),
  epochs: z.number().int().min(1).max(20).default(10),
  seed: seedSchema.default(42),
});

interface AdversarialTrainingResult {
  trainEpsilon: number;
  standard: { model: { testAccuracy: number }; curves: { PGD: CurvePoint[] } };
  adversarial: { model: { testAccuracy: number }; curves: { PGD: CurvePoint[] } };
  [key: string]: unknown;
}

export const adversarialTrainingHandler: ExperimentHandler<z.infer<typeof adversarialTrainingInput>> = {
  type: 'ADVERSARIAL_TRAINING',
  job: 'robustness.adversarial_training',
  permission: PERMISSIONS.ROBUSTNESS_RUN,
  input: adversarialTrainingInput,
  async prepare({ seed }) {
    return { algorithm: 'CNN', randomSeed: seed };
  },
  async jobParams(input) {
    return input;
  },
  async complete(r: AdversarialTrainingResult) {
    const robust = (m: AdversarialTrainingResult['standard']) => m.curves.PGD.find((p) => Math.abs(p.epsilon - r.trainEpsilon) < 1e-9)?.accuracy ?? null;
    const metrics = {
      standardCleanAccuracy: r.standard.model.testAccuracy,
      adversarialCleanAccuracy: r.adversarial.model.testAccuracy,
      standardRobustAccuracy: robust(r.standard),
      adversarialRobustAccuracy: robust(r.adversarial),
    };
    return [{ kind: 'adversarial_training', metrics, data: r as unknown as Prisma.InputJsonValue }];
  },
};
