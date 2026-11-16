import { Prisma, type ExperimentType } from '@prisma/client';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { prisma } from '../../config/prisma';
import type { AuthContext } from '../../middleware/authorize';
import { PERMISSIONS } from '../../rbac/permissions';
import { sha256, stableStringify } from '../../utils/crypto';
import { AppError, Errors } from '../../utils/errors';
import { paginate, toSkipTake } from '../../utils/pagination';
import type { CreateExperimentInput, ListExperimentsQuery } from '../../validators/experiment.validators';
import { auditService } from '../audit.service';
import { mlClient, MlServiceError } from '../ml/mlClient';
import { notificationService } from '../notification.service';
import { settingsService } from '../settings.service';
import { handlerFor } from './handlers';
import { WorkQueue } from './queue';
import type { ExperimentHandler, PreparedExperiment } from './types';

type LogLevel = 'info' | 'warn' | 'error';
const log = (level: LogLevel, message: string) => ({ at: new Date().toISOString(), level, message });
const FAILURE_FALLBACK = 'The experiment failed unexpectedly. The error has been logged.';

const summarySelect = {
  id: true,
  name: true,
  type: true,
  status: true,
  progress: true,
  algorithm: true,
  randomSeed: true,
  configHash: true,
  isEducational: true,
  error: true,
  createdAt: true,
  startedAt: true,
  completedAt: true,
  durationMs: true,
  userId: true,
  user: { select: { id: true, firstName: true, lastName: true } },
  dataset: { select: { id: true, name: true } },
  modelVersion: { select: { id: true, version: true, model: { select: { id: true, name: true } } } },
  results: { select: { kind: true, metrics: true }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.ExperimentSelect;

type SummaryRow = Prisma.ExperimentGetPayload<{ select: typeof summarySelect }>;

function toSummary({ user, results, ...e }: SummaryRow) {
  return { ...e, user: { id: user.id, name: `${user.firstName} ${user.lastName}`.trim() }, headline: results[0] ? { kind: results[0].kind, metrics: results[0].metrics } : null };
}

function requireHandler(type: ExperimentType): ExperimentHandler {
  const handler = handlerFor(type);
  if (!handler) throw Errors.badRequest(`Experiment type ${type} is not available`);
  return handler;
}

function parseInput(handler: ExperimentHandler, params: unknown) {
  const parsed = handler.input.safeParse(params);
  if (!parsed.success) {
    throw Errors.validation(parsed.error.issues.map((i) => ({ path: ['params', ...i.path].join('.'), message: i.message, code: i.code })));
  }
  return parsed.data;
}

async function execute(id: string): Promise<void> {
  const started = Date.now();
  const claimed = await prisma.experiment.updateMany({ where: { id, status: 'QUEUED' }, data: { status: 'RUNNING', startedAt: new Date(), progress: 10 } });
  if (!claimed.count) return;
  const experiment = await prisma.experiment.findUniqueOrThrow({ where: { id }, include: { user: { include: { role: true } } } });
  const handler = requireHandler(experiment.type);
  const actor = { id: experiment.user.id, email: experiment.user.email, role: experiment.user.role.name };
  const logs: ReturnType<typeof log>[] = [];
  const link = `/experiments/${id}`;
  const title = experiment.name ?? experiment.type;

  try {
    const input = handler.input.parse(experiment.parameters);
    const job = handler.jobFor?.(input) ?? handler.job;
    logs.push(log('info', `Dispatched "${job}" to the sandboxed ML service`));
    const jobParams = await handler.jobParams(input, experiment);
    const timeoutSeconds = await settingsService.get('ml.maxExperimentSeconds');
    const { result, durationMs } = await mlClient.runJob<Record<string, unknown>>(job, jobParams, { timeoutSeconds, requestId: `exp-${id}` });
    const warnings = Array.isArray(result.warnings) ? (result.warnings as unknown[]) : [];
    logs.push(log('info', `ML job finished in ${durationMs} ms`), ...warnings.map((w) => log('warn', typeof w === 'string' ? w : JSON.stringify(w))));

    const completed = await prisma.$transaction(
      async (tx) => {
        const current = await tx.experiment.findUnique({ where: { id }, select: { status: true } });
        if (current?.status !== 'RUNNING') return false;
        const records = await handler.complete(result, input, { tx, experiment, actor });
        if (records.length) {
          await tx.experimentResult.createMany({ data: records.map((r) => ({ experimentId: id, kind: r.kind, metrics: r.metrics ?? undefined, data: r.data })) });
        }
        await tx.experiment.update({
          where: { id },
          data: { status: 'COMPLETED', progress: 100, completedAt: new Date(), durationMs: Date.now() - started, logs: logs as Prisma.InputJsonValue },
        });
        return true;
      },
      { timeout: 30_000 },
    );
    if (completed && handler.notifyOnSuccess !== false) {
      await notificationService.notify(experiment.userId, { type: 'SYSTEM', title: 'Experiment completed', message: `${title} finished successfully.`, link });
    }
  } catch (err) {
    const known = err instanceof MlServiceError || err instanceof AppError;
    const message = err instanceof MlServiceError ? err.userMessage : err instanceof AppError ? err.message : FAILURE_FALLBACK;
    if (!known) logger.error({ err, experimentId: id }, 'experiment failed');
    logs.push(log('error', message));
    const { count } = await prisma.experiment.updateMany({
      where: { id, status: 'RUNNING' },
      data: { status: 'FAILED', error: message, completedAt: new Date(), durationMs: Date.now() - started, logs: logs as Prisma.InputJsonValue },
    });
    if (count) await notificationService.notify(experiment.userId, { type: 'SYSTEM', title: 'Experiment failed', message: `${title}: ${message}`, link });
  }
}

export const experimentQueue = new WorkQueue(env.EXPERIMENT_WORKERS, execute);

async function insert(type: ExperimentType, name: string | undefined, input: unknown, prepared: PreparedExperiment, userId: string, auth: AuthContext | null) {
  const configHash = sha256(stableStringify({ type, input, ...prepared.hashInputs }));
  const experiment = await prisma.$transaction(async (tx) => {
    const created = await tx.experiment.create({
      data: {
        name,
        type,
        userId,
        datasetId: prepared.datasetId ?? null,
        modelVersionId: prepared.modelVersionId ?? null,
        algorithm: prepared.algorithm ?? null,
        parameters: input as Prisma.InputJsonValue,
        randomSeed: prepared.randomSeed,
        configHash,
        logs: [log('info', 'Queued')] as Prisma.InputJsonValue,
      },
      select: summarySelect,
    });
    if (auth) {
      await auditService.record(
        { action: 'experiment.created', resource: 'experiment', resourceId: created.id, actor: auth.actor, context: auth.ctx, after: { type, configHash, seed: prepared.randomSeed } },
        tx,
      );
    }
    return created;
  });
  experimentQueue.enqueue(experiment.id);
  return toSummary(experiment);
}

function canReadAll(auth: AuthContext) {
  return auth.can(PERMISSIONS.EXPERIMENTS_READ_ALL);
}

async function findVisible(id: string, auth: AuthContext) {
  const experiment = await prisma.experiment.findUnique({ where: { id } });
  if (!experiment || (experiment.userId !== auth.actor.id && !canReadAll(auth))) throw Errors.notFound('Experiment');
  return experiment;
}

export const experimentService = {
  async create(auth: AuthContext, { type, name, params }: CreateExperimentInput) {
    const handler = requireHandler(type);
    if (!auth.can(handler.permission)) throw Errors.forbidden(`You do not have permission to run ${type.toLowerCase().replace(/_/g, ' ')} experiments`);
    const input = parseInput(handler, params);
    const limit = await settingsService.get('ml.maxConcurrentJobsPerUser');
    const active = await prisma.experiment.count({ where: { userId: auth.actor.id, status: { in: ['QUEUED', 'RUNNING'] } } });
    if (active >= limit) throw Errors.tooManyRequests(`You can have at most ${limit} experiment(s) queued or running at once`);
    const prepared = await handler.prepare(input, auth);
    return insert(type, name, input, prepared, auth.actor.id, auth);
  },

  /** Platform-initiated runs (e.g. profiling after an upload); bypasses per-user limits. */
  async createSystem(type: ExperimentType, params: unknown, userId: string, name?: string) {
    const handler = requireHandler(type);
    const input = parseInput(handler, params);
    return insert(type, name, input, await handler.prepare(input, null), userId, null);
  },

  async list(auth: AuthContext, query: ListExperimentsQuery) {
    const where: Prisma.ExperimentWhereInput = {
      ...(query.scope === 'all' && canReadAll(auth) ? {} : { userId: auth.actor.id }),
      ...(query.type ? { type: query.type } : query.types && { type: { in: query.types } }),
      ...(query.status && { status: query.status }),
      ...(query.datasetId && { datasetId: query.datasetId }),
      ...(query.modelVersionId && { modelVersionId: query.modelVersionId }),
    };
    const [rows, total] = await prisma.$transaction([
      prisma.experiment.findMany({ where, select: summarySelect, orderBy: { createdAt: 'desc' }, ...toSkipTake(query) }),
      prisma.experiment.count({ where }),
    ]);
    return paginate(rows.map(toSummary), total, query);
  },

  /**
   * Models the caller can analyse in the labs: registered versions with training lineage (for
   * users who can read the registry) and the caller's own completed training runs.
   */
  async sources(auth: AuthContext) {
    const liveDataset = { status: { not: 'DELETED' as const } };
    const datasetSelect = { select: { id: true, name: true, sensitiveColumns: true, columns: { select: { name: true }, orderBy: { position: 'asc' as const } } } };
    const [versions, runs] = await Promise.all([
      auth.can(PERMISSIONS.MODELS_READ)
        ? prisma.modelVersion.findMany({
            where: { parameters: { not: Prisma.AnyNull }, dataset: liveDataset },
            select: {
              id: true,
              version: true,
              metrics: true,
              featureColumns: true,
              targetColumn: true,
              createdAt: true,
              parameters: true,
              model: { select: { id: true, name: true, lifecycleStage: true } },
              dataset: datasetSelect,
            },
            orderBy: { createdAt: 'desc' },
            take: 100,
          })
        : [],
      prisma.experiment.findMany({
        where: { userId: auth.actor.id, type: 'TRAINING', status: 'COMPLETED', dataset: liveDataset },
        select: { id: true, name: true, algorithm: true, parameters: true, completedAt: true, dataset: datasetSelect, results: { where: { kind: 'training' }, select: { metrics: true } } },
        orderBy: { completedAt: 'desc' },
        take: 50,
      }),
    ]);
    const datasetInfo = (d: { id: string; name: string; sensitiveColumns: string[]; columns: { name: string }[] }) => ({
      id: d.id,
      name: d.name,
      sensitiveColumns: d.sensitiveColumns,
      columns: d.columns.map((c) => c.name),
    });
    return {
      versions: versions.map((v) => ({
        id: v.id,
        label: `${v.model.name} ${v.version}`,
        model: v.model,
        version: v.version,
        algorithm: (v.parameters as { algorithm?: string } | null)?.algorithm ?? null,
        target: v.targetColumn,
        features: v.featureColumns,
        accuracy: ((v.metrics as { test?: { accuracy?: number } } | null)?.test?.accuracy as number | undefined) ?? null,
        dataset: datasetInfo(v.dataset!),
        createdAt: v.createdAt,
      })),
      trainingRuns: runs.map((r) => {
        const model = (r.parameters as { model?: { target?: string; features?: string[] } }).model ?? {};
        return {
          id: r.id,
          label: r.name ?? `Training run ${r.id.slice(0, 8)}`,
          algorithm: r.algorithm,
          target: model.target ?? null,
          features: model.features ?? r.dataset!.columns.map((c) => c.name).filter((c) => c !== model.target),
          accuracy: ((r.results[0]?.metrics as { accuracy?: number } | null)?.accuracy as number | undefined) ?? null,
          dataset: datasetInfo(r.dataset!),
          createdAt: r.completedAt,
        };
      }),
    };
  },

  async get(auth: AuthContext, id: string) {
    await findVisible(id, auth);
    const experiment = await prisma.experiment.findUniqueOrThrow({
      where: { id },
      select: {
        ...summarySelect,
        parameters: true,
        logs: true,
        results: { select: { id: true, kind: true, metrics: true, data: true, plots: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
        trainedVersions: { select: { id: true, version: true, model: { select: { id: true, name: true } } } },
      },
    });
    const { results, trainedVersions, parameters, logs, ...rest } = experiment;
    return {
      ...toSummary({ ...rest, results }),
      parameters,
      logs,
      results,
      registeredVersions: trainedVersions,
      canCancel: experiment.userId === auth.actor.id && (experiment.status === 'QUEUED' || experiment.status === 'RUNNING'),
      disclaimer: await settingsService.get('platform.educationalDisclaimer'),
    };
  },

  async cancel(auth: AuthContext, id: string) {
    const experiment = await findVisible(id, auth);
    if (experiment.userId !== auth.actor.id) throw Errors.forbidden('Only the experiment owner can cancel it');
    if (experiment.status !== 'QUEUED' && experiment.status !== 'RUNNING') throw Errors.conflict(`A ${experiment.status.toLowerCase()} experiment cannot be cancelled`);
    experimentQueue.remove(id);
    const { count } = await prisma.experiment.updateMany({
      where: { id, status: { in: ['QUEUED', 'RUNNING'] } },
      data: { status: 'CANCELLED', completedAt: new Date(), error: 'Cancelled by the user' },
    });
    if (!count) throw Errors.conflict('The experiment finished before it could be cancelled');
    await auditService.record({ action: 'experiment.cancelled', resource: 'experiment', resourceId: id, actor: auth.actor, context: auth.ctx });
  },

  /** Re-runs with identical parameters and seed; the config hash shows whether inputs are unchanged. */
  async rerun(auth: AuthContext, id: string) {
    const experiment = await findVisible(id, auth);
    const handler = requireHandler(experiment.type);
    const input = parseInput(handler, experiment.parameters);
    return this.create(auth, { type: experiment.type, name: `${experiment.name ?? experiment.type} (re-run)`, params: handler.rerunInput?.(input) ?? input });
  },

  async algorithms() {
    try {
      return await mlClient.algorithms();
    } catch {
      throw Errors.serviceUnavailable('The ML service is unavailable; algorithm options cannot be loaded right now');
    }
  },
};

/** After a restart: RUNNING jobs were lost with the process, QUEUED ones are resumed. */
export async function recoverExperiments(): Promise<void> {
  const interrupted = await prisma.experiment.updateMany({
    where: { status: 'RUNNING' },
    data: { status: 'FAILED', error: 'Interrupted by a service restart. Re-run the experiment.', completedAt: new Date() },
  });
  const queued = await prisma.experiment.findMany({ where: { status: 'QUEUED' }, select: { id: true }, orderBy: { createdAt: 'asc' } });
  queued.forEach((e) => experimentQueue.enqueue(e.id));
  if (interrupted.count || queued.length) logger.info({ interrupted: interrupted.count, resumed: queued.length }, 'experiment queue recovered');
}
