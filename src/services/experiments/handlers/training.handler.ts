import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../../config/prisma';
import { PERMISSIONS } from '../../../rbac/permissions';
import { sha256 } from '../../../utils/crypto';
import { Errors } from '../../../utils/errors';
import { versionLabel } from '../../../validators/asset.validators';
import { auditService } from '../../audit.service';
import { getStorage } from '../../storage';
import { getUsableDataset, loadDatasetCsv } from '../sources';
import type { ExperimentHandler, ResultRecord } from '../types';
import { assertColumnsExist, modelSpecSchema, precheckHyperparameters } from './common';

const ALGORITHM_LABELS: Record<string, string> = {
  LOGISTIC_REGRESSION: 'Logistic Regression',
  DECISION_TREE: 'Decision Tree',
  RANDOM_FOREST: 'Random Forest',
  GRADIENT_BOOSTING: 'Gradient Boosting',
};

const input = z.object({
  datasetId: z.string().uuid(),
  model: modelSpecSchema,
  /** Register the trained model in the model registry as a new version. */
  register: z
    .object({
      modelId: z.string().uuid().optional(),
      newModel: z.object({ name: z.string().trim().min(2).max(120), purpose: z.string().trim().min(10).max(2000) }).optional(),
      version: versionLabel.optional(),
      description: z.string().trim().max(2000).optional(),
    })
    .refine((v) => !!v.modelId !== !!v.newModel, { message: 'Choose an existing model or describe a new one', path: ['modelId'] })
    .optional(),
});

type TrainingInput = z.infer<typeof input>;

interface TrainingResult {
  metrics: Record<string, unknown>;
  trainMetrics: Record<string, unknown>;
  features: { numeric: string[]; categorical: string[]; dropped: unknown[] };
  reproducibility: { datasetSha256: string; seed: number; fingerprint: string };
  hyperparameters: Record<string, unknown>;
  artifact: { format: string; sha256: string; sizeBytes: number; base64: string } | null;
  warnings: string[];
  [key: string]: unknown;
}

async function nextVersionLabel(tx: Prisma.TransactionClient, modelId: string) {
  const count = await tx.modelVersion.count({ where: { modelId } });
  for (let n = count + 1; ; n++) {
    const label = `v${n}`;
    if (!(await tx.modelVersion.findUnique({ where: { modelId_version: { modelId, version: label } } }))) return label;
  }
}

export const trainingHandler: ExperimentHandler<TrainingInput> = {
  type: 'TRAINING',
  job: 'model.train',
  permission: PERMISSIONS.EXPERIMENTS_RUN,
  input,
  notifyOnSuccess: true,

  async prepare({ datasetId, model, register }, auth) {
    const dataset = auth ? await getUsableDataset(datasetId, auth) : await prisma.dataset.findUniqueOrThrow({ where: { id: datasetId }, include: { columns: true } });
    const columns = dataset.columns.map((c) => c.name);
    assertColumnsExist(columns, [model.target], 'params.model.target');
    assertColumnsExist(columns, model.features ?? [], 'params.model.features');
    await precheckHyperparameters(model.algorithm, model.hyperparameters);

    if (register && auth) {
      if (!auth.can(PERMISSIONS.MODELS_UPLOAD) && !auth.can(PERMISSIONS.MODELS_MANAGE)) {
        throw Errors.forbidden('You do not have permission to register models');
      }
      if (register.modelId) {
        const target = await prisma.aIModel.findUnique({ where: { id: register.modelId } });
        if (!target) throw Errors.notFound('Model');
        if (target.ownerId !== auth.actor.id && !auth.can(PERMISSIONS.MODELS_MANAGE)) throw Errors.forbidden('Only the model owner can add versions');
        if (register.version && (await prisma.modelVersion.findUnique({ where: { modelId_version: { modelId: target.id, version: register.version } } }))) {
          throw Errors.conflict(`Version ${register.version} already exists for this model`);
        }
      }
    }
    return { datasetId, algorithm: model.algorithm, randomSeed: model.seed, hashInputs: { sha256: dataset.checksumSha256 } };
  },

  async jobParams({ datasetId, model, register }) {
    const { csv, sha256: digest } = await loadDatasetCsv(datasetId);
    return { dataset: { csv, sha256: digest }, model, includeArtifact: !!register };
  },

  rerunInput: ({ register: _register, ...rest }) => rest,

  async complete(result: TrainingResult, { datasetId, model, register }, { tx, experiment, actor }) {
    const { artifact, ...summary } = result;
    const records: ResultRecord[] = [{ kind: 'training', metrics: result.metrics as Prisma.InputJsonValue, data: summary as unknown as Prisma.InputJsonValue }];
    if (!register) return records;

    const aiModel = register.modelId
      ? await tx.aIModel.findUniqueOrThrow({ where: { id: register.modelId } })
      : await tx.aIModel.create({
          data: {
            name: register.newModel!.name,
            purpose: register.newModel!.purpose,
            ownerId: actor.id,
            framework: 'scikit-learn',
            algorithm: ALGORITHM_LABELS[model.algorithm],
            trainingDatasetId: datasetId,
            createdById: actor.id,
          },
        });
    const label = register.version ?? (await nextVersionLabel(tx, aiModel.id));
    const versionId = randomUUID();

    let stored: { key: string; checksum: string; format: string; size: number } | null = null;
    if (artifact) {
      const blob = Buffer.from(artifact.base64, 'base64');
      if (sha256(blob) !== artifact.sha256) throw new Error('Model artifact checksum mismatch');
      const key = `models/${aiModel.id}/${versionId}.skops`;
      await getStorage().put(key, blob, 'application/octet-stream');
      stored = { key, checksum: artifact.sha256, format: artifact.format, size: blob.length };
    }

    const version = await tx.modelVersion.create({
      data: {
        id: versionId,
        modelId: aiModel.id,
        version: label,
        description: register.description,
        artifactKey: stored?.key,
        artifactChecksum: stored?.checksum,
        artifactFormat: stored?.format,
        artifactSizeBytes: stored?.size,
        metrics: { test: result.metrics, train: result.trainMetrics } as Prisma.InputJsonValue,
        parameters: { ...model, hyperparameters: result.hyperparameters } as Prisma.InputJsonValue,
        featureColumns: [...result.features.numeric, ...result.features.categorical],
        targetColumn: model.target,
        randomSeed: model.seed,
        datasetId,
        fingerprint: result.reproducibility.fingerprint,
        trainingExperimentId: experiment.id,
        createdById: actor.id,
      },
    });
    if (!aiModel.trainingDatasetId) await tx.aIModel.update({ where: { id: aiModel.id }, data: { trainingDatasetId: datasetId } });
    await auditService.record(
      {
        action: register.modelId ? 'model.version_registered' : 'model.created',
        resource: 'model',
        resourceId: aiModel.id,
        actor,
        after: { version: label, versionId: version.id, trainingExperimentId: experiment.id, artifactSha256: stored?.checksum ?? null },
      },
      tx,
    );
    return [...records, { kind: 'model_registration', data: { modelId: aiModel.id, modelName: aiModel.name, versionId: version.id, version: label } }];
  },
};
