import { ExperimentStatus, ExperimentType } from '@prisma/client';
import { z } from 'zod';
import { paginationSchema } from '../utils/pagination';

export const createExperimentSchema = z.object({
  type: z.nativeEnum(ExperimentType),
  name: z.string().trim().min(1).max(120).optional(),
  params: z.record(z.unknown()),
});

export const listExperimentsQuery = paginationSchema.extend({
  type: z.nativeEnum(ExperimentType).optional(),
  /** Comma-separated list of types, e.g. "SHAP,LIME"; ignored when `type` is set. */
  types: z
    .string()
    .transform((s) => s.split(',').filter(Boolean))
    .pipe(z.array(z.nativeEnum(ExperimentType)).min(1).max(20))
    .optional(),
  status: z.nativeEnum(ExperimentStatus).optional(),
  datasetId: z.string().uuid().optional(),
  modelVersionId: z.string().uuid().optional(),
  /** Only honoured for users who can read all experiments; others always see their own. */
  scope: z.enum(['mine', 'all']).default('mine'),
});

export type CreateExperimentInput = z.infer<typeof createExperimentSchema>;
export type ListExperimentsQuery = z.infer<typeof listExperimentsQuery>;
