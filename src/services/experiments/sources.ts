import type { Dataset, Prisma } from '@prisma/client';
import type { DbClient } from '../../config/prisma';
import { prisma } from '../../config/prisma';
import type { AuthContext } from '../../middleware/authorize';
import { PERMISSIONS } from '../../rbac/permissions';
import { sha256 } from '../../utils/crypto';
import { AppError, Errors } from '../../utils/errors';
import { stringList } from '../../utils/jsonList';
import { permissionService } from '../permission.service';
import { settingsService } from '../settings.service';
import { getStorage } from '../storage';

/** Rebuild recipe for a trained model, as accepted by the ML service ("ModelSpec"). */
export interface ModelSpec {
  target: string;
  features?: string[];
  algorithm: string;
  hyperparameters: Record<string, unknown>;
  testSize: number;
  seed: number;
  positiveLabel?: string;
}

export interface ModelSource {
  datasetId: string;
  spec: ModelSpec;
  fingerprint: string | null;
  modelVersionId: string | null;
  trainingExperimentId: string | null;
  label: string;
}

export const canManageDatasets = (auth: AuthContext) => auth.can(PERMISSIONS.DATASETS_MANAGE);

export function canViewDataset(dataset: Pick<Dataset, 'ownerId' | 'isShared' | 'status'>, auth: AuthContext): boolean {
  if (dataset.status === 'DELETED') return false;
  return dataset.ownerId === auth.actor.id || dataset.isShared || canManageDatasets(auth);
}

export const datasetVisibilityWhere = (auth: AuthContext): Prisma.DatasetWhereInput =>
  canManageDatasets(auth) ? { status: { not: 'DELETED' } } : { status: { not: 'DELETED' }, OR: [{ ownerId: auth.actor.id }, { isShared: true }] };

/** Loads a dataset the caller may use; hides existence of datasets they cannot see. */
export async function getUsableDataset(id: string, auth: AuthContext, db: DbClient = prisma) {
  const dataset = await db.dataset.findUnique({ where: { id }, include: { columns: { orderBy: { position: 'asc' } } } });
  if (!dataset || !canViewDataset(dataset, auth)) throw Errors.notFound('Dataset');
  if (dataset.status !== 'READY') throw Errors.conflict(`Dataset is ${dataset.status.toLowerCase()} and cannot be used`);
  return dataset;
}

/** Reads dataset bytes and verifies them against the checksum recorded at upload. */
export async function loadDatasetCsv(datasetId: string): Promise<{ csv: string; sha256: string; name: string }> {
  const dataset = await prisma.dataset.findUnique({ where: { id: datasetId } });
  if (!dataset || dataset.status === 'DELETED') throw new AppError(410, 'DATASET_GONE', 'The dataset used by this experiment has been deleted');
  const csv = (await getStorage().get(dataset.storageKey)).toString('utf8');
  if (sha256(csv) !== dataset.checksumSha256) throw new AppError(409, 'DATASET_INTEGRITY', 'The stored dataset no longer matches its checksum');
  return { csv, sha256: dataset.checksumSha256, name: dataset.name };
}

/**
 * Sensitive columns whose values must be masked in results shown to `userId`: the same rule as the
 * dataset preview (masking enabled, and the user is neither the dataset owner nor a data manager).
 * Models still use the real values; only what is displayed is masked.
 */
export async function maskedColumnsFor(datasetId: string, userId: string): Promise<string[]> {
  const [dataset, user, enabled] = await Promise.all([
    prisma.dataset.findUnique({ where: { id: datasetId }, select: { ownerId: true, sensitiveColumns: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { role: { select: { name: true } } } }),
    settingsService.get('privacy.maskSensitiveFields'),
  ]);
  if (!dataset || !enabled || dataset.ownerId === userId) return [];
  const granted = user ? await permissionService.forRole(user.role.name) : new Set<string>();
  return granted.has(PERMISSIONS.DATASETS_MANAGE) ? [] : stringList(dataset.sensitiveColumns);
}

function specFromJson(value: Prisma.JsonValue): ModelSpec {
  const p = value as Record<string, unknown>;
  return {
    target: String(p.target),
    features: (p.features as string[] | undefined) ?? undefined,
    algorithm: String(p.algorithm),
    hyperparameters: (p.hyperparameters as Record<string, unknown>) ?? {},
    testSize: Number(p.testSize ?? 0.25),
    seed: Number(p.seed),
    positiveLabel: (p.positiveLabel as string | undefined) ?? undefined,
  };
}

/**
 * Resolves the model an analysis runs against: either a registered model version or one of the
 * caller's own completed training runs. Both carry the full spec needed for a deterministic rebuild.
 * `auth` is null when an already-authorised experiment resolves its source at execution time.
 */
export async function resolveModelSource(
  input: { modelVersionId?: string; trainingExperimentId?: string },
  auth: AuthContext | null,
): Promise<ModelSource> {
  if (input.modelVersionId) {
    const version = await prisma.modelVersion.findUnique({ where: { id: input.modelVersionId }, include: { model: true } });
    if (!version || (auth && !auth.can(PERMISSIONS.MODELS_READ))) throw Errors.notFound('Model version');
    if (!version.datasetId || !version.parameters) {
      throw Errors.conflict('This model version was registered without training lineage, so it cannot be analysed on the platform');
    }
    const dataset = await prisma.dataset.findUnique({ where: { id: version.datasetId } });
    if (!dataset || dataset.status === 'DELETED') throw Errors.conflict('The training dataset of this model version has been deleted');
    return {
      datasetId: version.datasetId,
      spec: specFromJson(version.parameters),
      fingerprint: version.fingerprint,
      modelVersionId: version.id,
      trainingExperimentId: version.trainingExperimentId,
      label: `${version.model.name} ${version.version}`,
    };
  }
  if (input.trainingExperimentId) {
    const run = await prisma.experiment.findUnique({ where: { id: input.trainingExperimentId } });
    const visible = run && (!auth || run.userId === auth.actor.id || auth.can(PERMISSIONS.EXPERIMENTS_READ_ALL));
    if (!run || !visible || run.type !== 'TRAINING') throw Errors.notFound('Training experiment');
    if (run.status !== 'COMPLETED' || !run.datasetId) throw Errors.conflict('The training experiment has not completed successfully');
    const params = run.parameters as Record<string, unknown>;
    const summary = await prisma.experimentResult.findFirst({ where: { experimentId: run.id, kind: 'training' }, select: { data: true } });
    const fingerprint = ((summary?.data as Record<string, any> | undefined)?.reproducibility?.fingerprint as string | undefined) ?? null;
    return {
      datasetId: run.datasetId,
      spec: specFromJson(params.model as Prisma.JsonValue),
      fingerprint,
      modelVersionId: null,
      trainingExperimentId: run.id,
      label: run.name ?? `Training run ${run.id.slice(0, 8)}`,
    };
  }
  throw Errors.validation([{ path: 'params.modelVersionId', message: 'Choose a model version or a completed training run' }]);
}
