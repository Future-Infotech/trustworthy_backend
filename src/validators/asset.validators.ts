import { z } from 'zod';
import { paginationSchema } from '../utils/pagination';
import { boolString } from './common.validators';

const columnName = z.string().trim().min(1).max(200);
/** Multipart fields arrive as strings; arrays are sent as JSON. */
const jsonStringArray = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (!v) return [];
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) return parsed as string[];
    } catch {
      // fall through
    }
    ctx.addIssue({ code: 'custom', message: 'Expected a JSON array of column names' });
    return z.NEVER;
  })
  .pipe(z.array(columnName).max(50));

// ── Datasets ──────────────────────────────────────────────────────────────────

export const listDatasetsQuery = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['UPLOADED', 'PROCESSING', 'READY', 'INVALID']).optional(),
  mine: boolString,
});

export const uploadDatasetSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).optional(),
  targetColumn: columnName.optional(),
  sensitiveColumns: jsonStringArray,
  isShared: boolString,
  containsPersonalData: boolString,
  isSynthetic: boolString,
});

export const updateDatasetSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(2000).nullable(),
    targetColumn: columnName.nullable(),
    sensitiveColumns: z.array(columnName).max(50),
    isShared: z.boolean(),
    containsPersonalData: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');

export const previewQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

export const reasonSchema = z.object({ reason: z.string().trim().min(5, 'Give a reason of at least 5 characters').max(500) });

// ── Models ────────────────────────────────────────────────────────────────────

const LIFECYCLE = ['DEVELOPMENT', 'TESTING', 'REVIEW', 'APPROVED', 'PRODUCTION', 'SUSPENDED', 'RETIRED'] as const;
const RISK = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export const listModelsQuery = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  lifecycleStage: z.enum(LIFECYCLE).optional(),
  riskLevel: z.enum(RISK).optional(),
  mine: boolString,
});

export const createModelSchema = z.object({
  name: z.string().trim().min(2).max(120),
  purpose: z.string().trim().min(10).max(2000),
  description: z.string().trim().max(4000).optional(),
  framework: z.string().trim().min(1).max(60).default('scikit-learn'),
  algorithm: z.string().trim().min(1).max(100),
  trainingDatasetId: z.string().uuid().nullable().optional(),
  aiSystemId: z.string().uuid().nullable().optional(),
  riskLevel: z.enum(RISK).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
});

export const updateModelSchema = createModelSchema
  .partial()
  .extend({ nextReviewAt: z.coerce.date().nullable().optional() })
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');

export const lifecycleSchema = z.object({
  stage: z.enum(LIFECYCLE),
  reason: z.string().trim().min(5).max(1000),
});

export const versionLabel = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/, 'Use letters, digits, dots, dashes or underscores (max 40)');

export const createVersionSchema = z.object({
  version: versionLabel,
  description: z.string().trim().max(2000).optional(),
});

export type ListDatasetsQuery = z.infer<typeof listDatasetsQuery>;
export type UploadDatasetInput = z.infer<typeof uploadDatasetSchema>;
export type UpdateDatasetInput = z.infer<typeof updateDatasetSchema>;
export type ListModelsQuery = z.infer<typeof listModelsQuery>;
export type CreateModelInput = z.infer<typeof createModelSchema>;
export type UpdateModelInput = z.infer<typeof updateModelSchema>;
export type LifecycleInput = z.infer<typeof lifecycleSchema>;
export type CreateVersionInput = z.infer<typeof createVersionSchema>;
