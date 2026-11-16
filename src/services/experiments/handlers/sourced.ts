import type { EvaluationStatus, ExperimentType, Prisma } from '@prisma/client';
import { z, type ZodRawShape } from 'zod';
import { prisma } from '../../../config/prisma';
import type { Permission } from '../../../rbac/permissions';
import { applyEvaluationStatus, type EvaluationField } from '../../model.service';
import { maskedColumnsFor } from '../sources';
import type { CompletionContext, ExperimentHandler, PreparedExperiment } from '../types';
import { assertColumnsExist, modelJobBase, prepareModelSource, sourcedInput, sourceOf } from './common';

export interface Assessed {
  assessment?: { status: EvaluationStatus; reasons: string[] };
  [key: string]: unknown;
}

type SourcedInput<S extends ZodRawShape> = z.infer<ReturnType<typeof sourcedInput<S>>>;

/** Dataset context available when preparing or executing an analysis. */
export interface SourceDataset {
  id: string;
  columns: string[];
  sensitiveColumns: string[];
}

async function datasetContext(datasetId: string): Promise<SourceDataset> {
  const dataset = await prisma.dataset.findUniqueOrThrow({
    where: { id: datasetId },
    select: { id: true, sensitiveColumns: true, columns: { select: { name: true }, orderBy: { position: 'asc' } } },
  });
  return { id: dataset.id, sensitiveColumns: dataset.sensitiveColumns, columns: dataset.columns.map((c) => c.name) };
}

/**
 * Builds a handler for an analysis of a registered model version or one of the caller's training
 * runs. The ML service rebuilds the model deterministically and checks its prediction fingerprint.
 */
export function sourcedHandler<S extends ZodRawShape>(options: {
  type: ExperimentType;
  job: string;
  permission: Permission;
  shape: S;
  kind: string;
  metrics: (result: Assessed) => Record<string, unknown>;
  /** Extra validation against the training dataset (column names, defaults that need data). */
  validate?: (input: SourcedInput<S>, dataset: SourceDataset) => void;
  /** Execution-time parameters derived from the dataset (e.g. defaults from its sensitive columns). */
  extraParams?: (input: SourcedInput<S>, dataset: SourceDataset) => Record<string, unknown>;
  /** Mask sensitive values in row-level output for users who may not see them. */
  maskOutput?: boolean;
  /** Registry evaluation status set from `result.assessment` when run against a registered version. */
  statusField?: EvaluationField;
}): ExperimentHandler<SourcedInput<S>> {
  return {
    type: options.type,
    job: options.job,
    permission: options.permission,
    input: sourcedInput(options.shape),

    async prepare(input, auth): Promise<PreparedExperiment> {
      const { resolved, prepared } = await prepareModelSource(sourceOf(input), auth);
      if (options.validate) options.validate(input, await datasetContext(resolved.datasetId));
      return { ...prepared, randomSeed: resolved.spec.seed };
    },

    async jobParams(input, experiment) {
      const { modelVersionId: _v, trainingExperimentId: _t, ...rest } = input as SourcedInput<S> & { modelVersionId?: string; trainingExperimentId?: string };
      const { resolved, base } = await modelJobBase(sourceOf(input));
      const dataset = await datasetContext(resolved.datasetId);
      const extra = options.extraParams?.(input, dataset) ?? {};
      const mask = options.maskOutput ? { maskColumns: await maskedColumnsFor(resolved.datasetId, experiment.userId) } : {};
      return { ...base, ...rest, ...extra, ...mask };
    },

    async complete(result: Assessed, _input, { tx, experiment, actor }: CompletionContext) {
      if (options.statusField && result.assessment) {
        await applyEvaluationStatus(tx, { modelVersionId: experiment.modelVersionId, experimentId: experiment.id, actor }, options.statusField, result.assessment.status);
      }
      return [{ kind: options.kind, metrics: options.metrics(result) as Prisma.InputJsonValue, data: result as Prisma.InputJsonValue }];
    },
  };
}

export function columnsMustExist(dataset: SourceDataset, names: string[], path: string) {
  assertColumnsExist(dataset.columns, names, path);
}
