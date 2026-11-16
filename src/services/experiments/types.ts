import type { Experiment, ExperimentType, Prisma } from '@prisma/client';
import type { ZodType } from 'zod';
import type { AuthContext } from '../../middleware/authorize';
import type { Permission } from '../../rbac/permissions';
import type { AuditActor } from '../audit.service';

export interface PreparedExperiment {
  datasetId?: string | null;
  modelVersionId?: string | null;
  algorithm?: string | null;
  randomSeed: number;
  /** Extra inputs that identify the configuration (e.g. dataset checksum) but are not stored as parameters. */
  hashInputs?: Record<string, unknown>;
}

export interface ResultRecord {
  kind: string;
  metrics?: Prisma.InputJsonValue | null;
  data: Prisma.InputJsonValue;
}

export interface CompletionContext {
  tx: Prisma.TransactionClient;
  experiment: Experiment;
  actor: AuditActor;
}

/**
 * One experiment type. `input` validates the stored parameters; `prepare` checks access to the
 * referenced resources at creation (auth is null for trusted system-created runs); `jobParams`
 * loads data at execution time; `complete` persists results and side effects atomically.
 */
export interface ExperimentHandler<I = any> {
  type: ExperimentType;
  job: string;
  /** ML job for this input when one experiment type has several targets; defaults to `job`. */
  jobFor?(input: I): string;
  permission: Permission;
  input: ZodType<I, any, any>;
  prepare(input: I, auth: AuthContext | null): Promise<PreparedExperiment>;
  jobParams(input: I, experiment: Experiment): Promise<unknown>;
  complete(result: any, input: I, ctx: CompletionContext): Promise<ResultRecord[]>;
  /** Parameters to drop when re-running (e.g. one-off registration requests). */
  rerunInput?(input: I): I;
  notifyOnSuccess?: boolean;
}
