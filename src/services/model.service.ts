import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { EvaluationStatus, ModelLifecycleStage, Prisma } from '@prisma/client';
import type { DbClient } from '../config/prisma';
import { prisma } from '../config/prisma';
import type { AuthContext } from '../middleware/authorize';
import { PERMISSIONS } from '../rbac/permissions';
import { sha256 } from '../utils/crypto';
import { AppError, Errors } from '../utils/errors';
import { paginate, toSkipTake } from '../utils/pagination';
import type { CreateModelInput, CreateVersionInput, LifecycleInput, ListModelsQuery, UpdateModelInput } from '../validators/asset.validators';
import { auditService, type AuditActor } from './audit.service';
import type { UploadedFile } from './dataset.service';
import { canViewDataset } from './experiments/sources';
import { notificationService } from './notification.service';
import { settingsService } from './settings.service';
import { getStorage } from './storage';

/** Allowed lifecycle moves. Approval and production promotion have additional rules below. */
export const LIFECYCLE_TRANSITIONS: Record<ModelLifecycleStage, ModelLifecycleStage[]> = {
  DEVELOPMENT: ['TESTING', 'RETIRED'],
  TESTING: ['DEVELOPMENT', 'REVIEW', 'RETIRED'],
  REVIEW: ['TESTING', 'APPROVED', 'RETIRED'],
  APPROVED: ['PRODUCTION', 'REVIEW', 'RETIRED'],
  PRODUCTION: ['SUSPENDED', 'RETIRED'],
  SUSPENDED: ['REVIEW', 'PRODUCTION', 'RETIRED'],
  RETIRED: [],
};

/** Formats stored as opaque, non-executable artifacts. Pickle-based formats can execute code when loaded. */
const ARTIFACT_FORMATS: Record<string, string> = { '.onnx': 'onnx', '.skops': 'skops', '.pmml': 'pmml', '.json': 'json' };
const REFUSED_FORMATS = new Set(['.pkl', '.pickle', '.joblib', '.pt', '.pth', '.h5', '.keras', '.sav', '.bin', '.dill', '.npy', '.npz']);

const summarySelect = {
  id: true,
  name: true,
  description: true,
  purpose: true,
  framework: true,
  algorithm: true,
  riskLevel: true,
  fairnessStatus: true,
  securityStatus: true,
  explainabilityStatus: true,
  lifecycleStage: true,
  nextReviewAt: true,
  tags: true,
  createdAt: true,
  updatedAt: true,
  owner: { select: { id: true, firstName: true, lastName: true } },
  trainingDataset: { select: { id: true, name: true } },
  aiSystem: { select: { id: true, name: true } },
  versions: { select: { id: true, version: true, metrics: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 1 },
  _count: { select: { versions: true, modelCards: true } },
} satisfies Prisma.AIModelSelect;

type SummaryRow = Prisma.AIModelGetPayload<{ select: typeof summarySelect }>;

const person = (u: { id: string; firstName: string; lastName: string } | null) => (u ? { id: u.id, name: `${u.firstName} ${u.lastName}`.trim() } : null);

function toSummary({ owner, versions, _count, ...m }: SummaryRow) {
  return { ...m, owner: person(owner), latestVersion: versions[0] ?? null, versionCount: _count.versions, modelCardCount: _count.modelCards };
}

const canEdit = (model: { ownerId: string }, auth: AuthContext) => model.ownerId === auth.actor.id || auth.can(PERMISSIONS.MODELS_MANAGE);

async function findModel(id: string) {
  const model = await prisma.aIModel.findUnique({ where: { id } });
  if (!model) throw Errors.notFound('Model');
  return model;
}

async function assertReferences(input: { trainingDatasetId?: string | null; aiSystemId?: string | null }, auth: AuthContext) {
  if (input.trainingDatasetId) {
    const dataset = await prisma.dataset.findUnique({ where: { id: input.trainingDatasetId } });
    if (!dataset || !canViewDataset(dataset, auth)) throw Errors.validation([{ path: 'trainingDatasetId', message: 'Dataset not found' }]);
  }
  if (input.aiSystemId && !(await prisma.aISystem.findUnique({ where: { id: input.aiSystemId } }))) {
    throw Errors.validation([{ path: 'aiSystemId', message: 'AI system not found' }]);
  }
}

async function notifyHighRisk(model: { id: string; name: string; riskLevel: string | null }, db: DbClient) {
  if (model.riskLevel !== 'HIGH' && model.riskLevel !== 'CRITICAL') return;
  const admins = await db.user.findMany({ where: { status: 'ACTIVE', role: { name: { in: ['ADMIN', 'SUPER_ADMIN'] } } }, select: { id: true } });
  for (const a of admins) {
    await notificationService.notify(
      a.id,
      { type: 'HIGH_RISK_MODEL_DETECTED', title: `${model.riskLevel} risk model`, message: `${model.name} is classified as ${model.riskLevel.toLowerCase()} risk and needs governance oversight.`, link: `/models/${model.id}` },
      db,
    );
  }
}

/** Reasons a lifecycle transition is blocked; empty when allowed. */
async function transitionBlockers(model: Prisma.AIModelGetPayload<object>, to: ModelLifecycleStage, auth: AuthContext): Promise<string[]> {
  const blockers: string[] = [];
  if (!LIFECYCLE_TRANSITIONS[model.lifecycleStage].includes(to)) {
    return [`A model in ${model.lifecycleStage.toLowerCase()} cannot move to ${to.toLowerCase()}`];
  }
  if (to === 'APPROVED' || to === 'PRODUCTION') {
    if (!auth.can(PERMISSIONS.MODELS_MANAGE)) blockers.push('Approval and production promotion require the models:manage permission');
    if (model.ownerId === auth.actor.id) blockers.push('Segregation of duties: the model owner cannot approve or promote their own model');
  }
  if (to === 'REVIEW' && (await prisma.modelVersion.count({ where: { modelId: model.id } })) === 0) {
    blockers.push('Register at least one version before requesting review');
  }
  if (to === 'PRODUCTION') {
    if (!model.riskLevel) blockers.push('Assess the risk level before promoting to production');
    const failed = (['fairnessStatus', 'securityStatus', 'explainabilityStatus'] as const).filter((k) => model[k] === 'FAILED');
    if (failed.length) blockers.push(`Resolve failed evaluations first: ${failed.map((f) => f.replace('Status', '')).join(', ')}`);
    if (model.riskLevel === 'HIGH' || model.riskLevel === 'CRITICAL') {
      const approved = await prisma.riskAssessment.count({ where: { modelId: model.id, status: 'APPROVED' } });
      if (!approved) blockers.push('High and critical risk models need an approved risk assessment before production');
    }
  }
  return blockers;
}

export const modelService = {
  async list(auth: AuthContext, query: ListModelsQuery) {
    const where: Prisma.AIModelWhereInput = {
      ...(query.mine && { ownerId: auth.actor.id }),
      ...(query.lifecycleStage && { lifecycleStage: query.lifecycleStage }),
      ...(query.riskLevel && { riskLevel: query.riskLevel }),
      ...(query.search && { OR: [{ name: { contains: query.search, mode: 'insensitive' } }, { purpose: { contains: query.search, mode: 'insensitive' } }, { tags: { has: query.search } }] }),
    };
    const [rows, total] = await prisma.$transaction([
      prisma.aIModel.findMany({ where, select: summarySelect, orderBy: { updatedAt: 'desc' }, ...toSkipTake(query) }),
      prisma.aIModel.count({ where }),
    ]);
    return paginate(rows.map(toSummary), total, query);
  },

  async get(auth: AuthContext, id: string) {
    const model = await prisma.aIModel.findUnique({
      where: { id },
      select: {
        ...summarySelect,
        ownerId: true,
        versions: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            version: true,
            description: true,
            metrics: true,
            parameters: true,
            featureColumns: true,
            targetColumn: true,
            randomSeed: true,
            fingerprint: true,
            artifactChecksum: true,
            artifactFormat: true,
            artifactSizeBytes: true,
            createdAt: true,
            dataset: { select: { id: true, name: true } },
            trainingExperimentId: true,
            _count: { select: { experiments: true } },
          },
        },
        modelCards: { select: { id: true, name: true, version: true, status: true, updatedAt: true }, orderBy: { updatedAt: 'desc' } },
        riskAssessments: { select: { id: true, title: true, riskLevel: true, status: true, updatedAt: true }, orderBy: { updatedAt: 'desc' } },
      },
    });
    if (!model) throw Errors.notFound('Model');
    const versionIds = model.versions.map((v) => v.id);
    const evaluations = await prisma.experiment.findMany({
      where: { modelVersionId: { in: versionIds }, status: 'COMPLETED' },
      select: { id: true, type: true, name: true, completedAt: true, modelVersionId: true, results: { select: { kind: true, metrics: true }, take: 1 } },
      orderBy: { completedAt: 'desc' },
      take: 20,
    });
    const { versions, _count, owner, ownerId, ...rest } = model;
    const editable = canEdit({ ownerId }, auth);
    const record = await findModel(id);
    const nextStages = await Promise.all(
      LIFECYCLE_TRANSITIONS[model.lifecycleStage].map(async (stage) => ({
        stage,
        blockers: editable ? await transitionBlockers(record, stage, auth) : ['Only the owner or a model manager can change the lifecycle'],
      })),
    );
    return {
      ...rest,
      owner: person(owner),
      versionCount: _count.versions,
      modelCardCount: _count.modelCards,
      versions: versions.map(({ _count: c, ...v }) => ({ ...v, evaluationCount: c.experiments, analysable: !!v.dataset && !!v.parameters })),
      evaluations: evaluations.map(({ results, ...e }) => ({ ...e, headline: results[0] ?? null })),
      canEdit: editable,
      nextStages,
    };
  },

  async create(auth: AuthContext, input: CreateModelInput) {
    await assertReferences(input, auth);
    const model = await prisma.$transaction(async (tx) => {
      const created = await tx.aIModel.create({ data: { ...input, ownerId: auth.actor.id, createdById: auth.actor.id } });
      await auditService.record({ action: 'model.created', resource: 'model', resourceId: created.id, actor: auth.actor, context: auth.ctx, after: input }, tx);
      await notifyHighRisk(created, tx);
      return created;
    });
    return this.get(auth, model.id);
  },

  async update(auth: AuthContext, id: string, input: UpdateModelInput) {
    const before = await findModel(id);
    if (!canEdit(before, auth)) throw Errors.forbidden('Only the owner or a model manager can edit this model');
    await assertReferences(input, auth);
    await prisma.$transaction(async (tx) => {
      const after = await tx.aIModel.update({ where: { id }, data: { ...input, updatedById: auth.actor.id } });
      const fields = Object.keys(input) as (keyof UpdateModelInput)[];
      await auditService.record(
        {
          action: 'model.updated',
          resource: 'model',
          resourceId: id,
          actor: auth.actor,
          context: auth.ctx,
          before: Object.fromEntries(fields.map((f) => [f, before[f as keyof typeof before]])),
          after: Object.fromEntries(fields.map((f) => [f, after[f as keyof typeof after]])),
          severity: input.riskLevel !== undefined && input.riskLevel !== before.riskLevel ? 'LOW' : 'INFO',
        },
        tx,
      );
      if (input.riskLevel && input.riskLevel !== before.riskLevel) await notifyHighRisk(after, tx);
    });
    return this.get(auth, id);
  },

  async transition(auth: AuthContext, id: string, { stage, reason }: LifecycleInput) {
    const model = await findModel(id);
    if (!canEdit(model, auth)) throw Errors.forbidden('Only the owner or a model manager can change the lifecycle');
    const blockers = await transitionBlockers(model, stage, auth);
    if (blockers.length) {
      await auditService.record({
        action: 'model.lifecycle_blocked',
        resource: 'model',
        resourceId: id,
        actor: auth.actor,
        context: auth.ctx,
        result: 'DENIED',
        reason,
        metadata: { from: model.lifecycleStage, to: stage, blockers },
      });
      throw new AppError(409, 'LIFECYCLE_BLOCKED', blockers[0], blockers);
    }
    await prisma.$transaction(async (tx) => {
      await tx.aIModel.update({ where: { id }, data: { lifecycleStage: stage, updatedById: auth.actor.id } });
      await auditService.record(
        {
          action: 'model.lifecycle_changed',
          resource: 'model',
          resourceId: id,
          actor: auth.actor,
          context: auth.ctx,
          before: { lifecycleStage: model.lifecycleStage },
          after: { lifecycleStage: stage },
          reason,
          severity: stage === 'PRODUCTION' || stage === 'SUSPENDED' ? 'MEDIUM' : 'LOW',
        },
        tx,
      );
      if (model.ownerId !== auth.actor.id) {
        await notificationService.notify(
          model.ownerId,
          { type: 'SYSTEM', title: 'Model lifecycle changed', message: `${model.name} moved from ${model.lifecycleStage.toLowerCase()} to ${stage.toLowerCase()}: ${reason}`, link: `/models/${id}` },
          tx,
        );
      }
    });
    return this.get(auth, id);
  },

  /**
   * Registers a version without training lineage (e.g. a model built elsewhere). Metrics stay empty:
   * they are only recorded from real evaluation runs. An optional artifact is stored, never loaded.
   */
  async createVersion(auth: AuthContext, modelId: string, input: CreateVersionInput, file?: UploadedFile) {
    const model = await findModel(modelId);
    if (!canEdit(model, auth)) throw Errors.forbidden('Only the owner or a model manager can add versions');
    if (await prisma.modelVersion.findUnique({ where: { modelId_version: { modelId, version: input.version } } })) {
      throw Errors.conflict(`Version ${input.version} already exists`);
    }
    const versionId = randomUUID();
    let artifact: { key: string; checksum: string; format: string; size: number } | null = null;
    if (file) {
      const ext = path.extname(file.originalname).toLowerCase();
      if (REFUSED_FORMATS.has(ext)) {
        await auditService.record({ action: 'model.artifact_refused', resource: 'model', resourceId: modelId, actor: auth.actor, context: auth.ctx, result: 'DENIED', severity: 'MEDIUM', metadata: { fileName: file.originalname } });
        throw Errors.validation([{ path: 'file', message: `${ext} files can execute code when loaded and are not accepted. Export the model to ONNX or skops.` }]);
      }
      const format = ARTIFACT_FORMATS[ext];
      if (!format) throw Errors.validation([{ path: 'file', message: `Accepted artifact formats: ${Object.keys(ARTIFACT_FORMATS).join(', ')}` }]);
      const maxMb = await settingsService.get('uploads.maxModelSizeMb');
      if (file.size > maxMb * 1024 * 1024) throw new AppError(413, 'PAYLOAD_TOO_LARGE', `The artifact exceeds the ${maxMb} MB limit`);
      const key = `models/${modelId}/${versionId}${ext}`;
      await getStorage().put(key, file.buffer, 'application/octet-stream');
      artifact = { key, checksum: sha256(file.buffer), format, size: file.size };
    }
    const version = await prisma.$transaction(async (tx) => {
      const created = await tx.modelVersion.create({
        data: {
          id: versionId,
          modelId,
          version: input.version,
          description: input.description,
          artifactKey: artifact?.key,
          artifactChecksum: artifact?.checksum,
          artifactFormat: artifact?.format,
          artifactSizeBytes: artifact?.size,
          createdById: auth.actor.id,
        },
      });
      await auditService.record(
        { action: 'model.version_registered', resource: 'model', resourceId: modelId, actor: auth.actor, context: auth.ctx, after: { version: input.version, versionId, artifactSha256: artifact?.checksum ?? null, lineage: false } },
        tx,
      );
      return created;
    });
    return version;
  },

  async getVersion(id: string) {
    const version = await prisma.modelVersion.findUnique({
      where: { id },
      include: { model: { select: { id: true, name: true, lifecycleStage: true } }, dataset: { select: { id: true, name: true } } },
    });
    if (!version) throw Errors.notFound('Model version');
    const { artifactKey, ...rest } = version;
    return { ...rest, hasArtifact: !!artifactKey, analysable: !!version.datasetId && !!version.parameters };
  },

  async downloadArtifact(auth: AuthContext, versionId: string) {
    const version = await prisma.modelVersion.findUnique({ where: { id: versionId }, include: { model: true } });
    if (!version) throw Errors.notFound('Model version');
    if (!version.artifactKey) throw Errors.notFound('Model artifact');
    const body = await getStorage().get(version.artifactKey);
    await auditService.record({ action: 'model.artifact_downloaded', resource: 'model', resourceId: version.modelId, actor: auth.actor, context: auth.ctx, metadata: { versionId } });
    const safeName = version.model.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60);
    return { body, fileName: `${safeName}-${version.version}${path.extname(version.artifactKey)}` };
  },
};

/** Records the outcome of an evaluation run on the registered model (called by experiment handlers). */
export async function applyEvaluationStatus(
  tx: Prisma.TransactionClient,
  { modelVersionId, experimentId, actor }: { modelVersionId: string | null; experimentId: string; actor: AuditActor },
  field: EvaluationField,
  status: EvaluationStatus,
) {
  if (!modelVersionId) return;
  const version = await tx.modelVersion.findUnique({
    where: { id: modelVersionId },
    select: { modelId: true, version: true, model: { select: { fairnessStatus: true, securityStatus: true, explainabilityStatus: true } } },
  });
  if (!version) return;
  const before = version.model[field];
  await tx.aIModel.update({ where: { id: version.modelId }, data: { [field]: status } });
  await auditService.record(
    {
      action: 'model.evaluation_recorded',
      resource: 'model',
      resourceId: version.modelId,
      actor,
      before: { [field]: before },
      after: { [field]: status },
      metadata: { versionId: modelVersionId, version: version.version, experimentId },
    },
    tx,
  );
}

export type EvaluationField = 'fairnessStatus' | 'securityStatus' | 'explainabilityStatus';
