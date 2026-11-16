import { z } from 'zod';
import { paginationSchema } from '../utils/pagination';

const text = (max = 5000) => z.string().trim().max(max).default('');
const evaluationStatus = z.enum(['NOT_ASSESSED', 'PASSED', 'WARNING', 'FAILED']);

/**
 * Where a metric came from. Evidence-backed values (VERSION, EXPERIMENT) are checked against the
 * stored results on every save, so a card cannot misstate its evidence; MANUAL values are labelled.
 */
const metricSource = z.enum(['MANUAL', 'VERSION', 'EXPERIMENT']);

export const performanceMetricSchema = z.object({
  name: z.string().trim().min(1).max(120),
  key: z.string().trim().max(60).optional(),
  value: z.number().finite().nullable(),
  dataset: z.string().trim().max(300).optional(),
  source: metricSource.default('MANUAL'),
  experimentId: z.string().uuid().optional(),
});

export const fairnessMetricSchema = z.object({
  attribute: z.string().trim().min(1).max(200),
  metric: z.string().trim().min(1).max(120),
  key: z.string().trim().max(60).optional(),
  value: z.number().finite().nullable(),
  threshold: z.number().finite().nullable().optional(),
  source: metricSource.default('MANUAL'),
  experimentId: z.string().uuid().optional(),
  notes: z.string().trim().max(1000).optional(),
});

const evidenceSchema = z.object({
  status: evaluationStatus,
  summary: z.string().trim().max(2000),
  experimentId: z.string().uuid().optional(),
  recordedAt: z.string().max(40).optional(),
});

export const modelCardContentSchema = z.object({
  modelName: text(200),
  developer: text(200),
  version: text(40),
  architecture: text(2000),
  license: text(300),
  intendedUse: text(),
  outOfScopeUse: text(),
  trainingData: text(),
  evaluationData: text(),
  performanceMetrics: z.array(performanceMetricSchema).max(30).default([]),
  evaluatedSubgroups: z.array(z.string().trim().min(1).max(200)).max(30).default([]),
  fairnessMetrics: z.array(fairnessMetricSchema).max(60).default([]),
  fairnessThreshold: text(1000),
  mitigationTechnique: text(2000),
  privacyMechanisms: text(),
  securityMechanisms: text(),
  humanOversight: text(),
  knownLimitations: text(),
  ethicalConsiderations: text(),
  deploymentRequirements: text(),
  /** Registered version the evidence refers to. */
  basedOnVersion: z.object({ id: z.string().uuid(), version: z.string().max(60) }).nullable().optional(),
  /** Latest platform evaluations at the time the card was prepared. */
  evaluations: z.object({ explainability: evidenceSchema.optional(), fairness: evidenceSchema.optional(), security: evidenceSchema.optional() }).default({}),
});
export type ModelCardContent = z.infer<typeof modelCardContentSchema>;

export const createModelCardSchema = z.object({
  modelId: z.string().uuid().nullable().optional(),
  content: modelCardContentSchema.refine((c) => c.modelName.length > 0, { message: 'Model name is required', path: ['modelName'] }).refine((c) => c.version.length > 0, {
    message: 'Version is required',
    path: ['version'],
  }),
});
export type CreateModelCardInput = z.infer<typeof createModelCardSchema>;

export const updateModelCardSchema = z.object({ content: createModelCardSchema.shape.content });
export type UpdateModelCardInput = z.infer<typeof updateModelCardSchema>;

export const listModelCardsQuery = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  status: z.enum(['DRAFT', 'IN_REVIEW', 'PUBLISHED', 'ARCHIVED']).optional(),
  modelId: z.string().uuid().optional(),
  mine: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type ListModelCardsQuery = z.infer<typeof listModelCardsQuery>;

export const prefillQuery = z.object({ modelId: z.string().uuid(), versionId: z.string().uuid().optional() });

export const reviewModelCardSchema = z.object({
  decision: z.enum(['PUBLISH', 'REQUEST_CHANGES']),
  comment: z.string().trim().max(2000).default(''),
}).refine((v) => v.decision === 'PUBLISH' || v.comment.length >= 5, { message: 'Explain the requested changes', path: ['comment'] });

export const newVersionSchema = z.object({ version: z.string().trim().min(1).max(40).optional() });

export const archiveSchema = z.object({ reason: z.string().trim().min(5).max(1000) });

export const exportQuery = z.object({ format: z.enum(['json', 'md', 'pdf']).default('json') });
