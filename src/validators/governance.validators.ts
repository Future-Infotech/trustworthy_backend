import { z } from 'zod';
import { paginationSchema } from '../utils/pagination';
import { boolString } from './common.validators';

const text = (max: number) => z.string().trim().max(max);
const required = (label: string, max: number, min = 3) => z.string().trim().min(min, `${label} must be at least ${min} characters`).max(max);
const optionalText = (max: number) => text(max).nullish().transform((v) => v || null);
const optionalId = z.string().uuid().nullish();
const date = z.coerce.date().nullish();
const search = z.string().trim().max(200).optional();
const riskLevel = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

const partial = <T extends z.ZodRawShape>(schema: z.ZodObject<T>) => schema.partial().refine((v) => Object.keys(v).length > 0, 'Nothing to update');

// ── AI system inventory & Shadow AI register ────────────────────────────────

export const aiSystemStatus = z.enum(['PROPOSED', 'DEVELOPMENT', 'ACTIVE', 'SUSPENDED', 'RETIRED']);

export const listAiSystemsQuery = paginationSchema.extend({
  search,
  status: aiSystemStatus.optional(),
  riskLevel: riskLevel.optional(),
  shadow: boolString,
  thirdParty: boolString,
});
export type ListAiSystemsQuery = z.infer<typeof listAiSystemsQuery>;

const aiSystemShape = z.object({
  name: required('Name', 200),
  description: required('Description', 4000, 10),
  businessUnit: optionalText(200),
  ownerId: z.string().uuid().optional(),
  status: aiSystemStatus.default('PROPOSED'),
  isThirdParty: z.boolean().default(false),
  vendorName: optionalText(200),
  isShadowAI: z.boolean().default(false),
  discoveredVia: optionalText(500),
  dataCategories: z.array(text(100).min(1)).max(30).default([]),
  nextReviewAt: date,
});
const vendorRequired = (v: { isThirdParty?: boolean; vendorName?: string | null }) => !v.isThirdParty || !!v.vendorName;
export const createAiSystemSchema = aiSystemShape.refine(vendorRequired, { message: 'Name the vendor of a third-party system', path: ['vendorName'] });
export type CreateAiSystemInput = z.infer<typeof createAiSystemSchema>;
export const updateAiSystemSchema = partial(aiSystemShape.omit({ isShadowAI: true }));
export type UpdateAiSystemInput = z.infer<typeof updateAiSystemSchema>;

/** Resolving a Shadow AI entry: bring it under governance, or prohibit it. */
export const resolveShadowSchema = z.object({
  decision: z.enum(['SANCTION', 'PROHIBIT']),
  reason: required('Reason', 1000, 5),
});

// ── Policies ────────────────────────────────────────────────────────────────

export const listPoliciesQuery = paginationSchema.extend({ search, status: z.enum(['DRAFT', 'UNDER_REVIEW', 'ACTIVE', 'RETIRED']).optional(), category: text(100).optional() });
export type ListPoliciesQuery = z.infer<typeof listPoliciesQuery>;

const policyShape = z.object({
  title: required('Title', 200),
  category: required('Category', 100, 2),
  summary: required('Summary', 1000, 10),
  content: required('Policy text', 50_000, 20),
  reviewDate: date,
});
export const createPolicySchema = policyShape;
export type CreatePolicyInput = z.infer<typeof createPolicySchema>;
export const updatePolicySchema = partial(policyShape);
export type UpdatePolicyInput = z.infer<typeof updatePolicySchema>;
export const approvePolicySchema = z.object({ effectiveDate: date, reviewDate: date, comment: text(1000).default('') });
export const rejectPolicySchema = z.object({ comment: required('Comment', 1000, 5) });

// ── Incidents ───────────────────────────────────────────────────────────────

export const incidentSeverity = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export const incidentStatus = z.enum(['OPEN', 'INVESTIGATING', 'MITIGATED', 'RESOLVED', 'CLOSED']);

export const listIncidentsQuery = paginationSchema.extend({ search, status: incidentStatus.optional(), severity: incidentSeverity.optional(), aiSystemId: z.string().uuid().optional(), mine: boolString });
export type ListIncidentsQuery = z.infer<typeof listIncidentsQuery>;

export const reportIncidentSchema = z.object({
  title: required('Title', 200),
  description: required('Description', 5000, 10),
  severity: incidentSeverity,
  aiSystemId: optionalId,
  modelId: optionalId,
  occurredAt: date,
  impact: optionalText(2000),
});
export type ReportIncidentInput = z.infer<typeof reportIncidentSchema>;

export const updateIncidentSchema = partial(
  z.object({
    status: incidentStatus,
    severity: incidentSeverity,
    assignedToId: optionalId,
    impact: optionalText(2000),
    rootCause: optionalText(5000),
    correctiveActions: optionalText(5000),
    note: text(1000),
  }),
);
export type UpdateIncidentInput = z.infer<typeof updateIncidentSchema>;

// ── Risk register ───────────────────────────────────────────────────────────

const score = z.coerce.number().int().min(1).max(5);
export const riskEntryStatus = z.enum(['OPEN', 'MITIGATING', 'ACCEPTED', 'CLOSED']);
export const listRiskEntriesQuery = paginationSchema.extend({ search, status: riskEntryStatus.optional(), category: text(100).optional(), aiSystemId: z.string().uuid().optional() });
export type ListRiskEntriesQuery = z.infer<typeof listRiskEntriesQuery>;

const riskEntryShape = z.object({
  title: required('Title', 200),
  description: required('Description', 4000, 10),
  category: required('Category', 100, 2),
  aiSystemId: optionalId,
  likelihood: score,
  impact: score,
  residualScore: z.coerce.number().int().min(1).max(25).nullish(),
  mitigation: optionalText(4000),
  status: riskEntryStatus.default('OPEN'),
  ownerId: optionalId,
  reviewDate: date,
});
export const createRiskEntrySchema = riskEntryShape;
export type CreateRiskEntryInput = z.infer<typeof createRiskEntrySchema>;
export const updateRiskEntrySchema = partial(riskEntryShape);
export type UpdateRiskEntryInput = z.infer<typeof updateRiskEntrySchema>;

// ── Compliance checklist ────────────────────────────────────────────────────

/** Mirrors the ComplianceStatus enum, which deliberately has no "compliant" value. */
export const complianceStatus = z.enum(['NOT_STARTED', 'IN_PROGRESS', 'EVIDENCE_PROVIDED', 'NEEDS_LEGAL_REVIEW', 'REVIEWED']);
export const listComplianceQuery = paginationSchema.extend({ search, framework: text(100).optional(), status: complianceStatus.optional() });
export type ListComplianceQuery = z.infer<typeof listComplianceQuery>;
export const updateComplianceSchema = partial(
  z.object({
    status: complianceStatus,
    evidence: optionalText(10_000),
    ownerId: optionalId,
    nextReviewAt: date,
    note: text(1000),
  }),
);
export type UpdateComplianceInput = z.infer<typeof updateComplianceSchema>;

// ── Vendor AI assessments ───────────────────────────────────────────────────

export const vendorFindingsSchema = z.object({
  documentation: text(4000).default(''),
  auditRights: text(4000).default(''),
  dataUse: text(4000).default(''),
  security: text(4000).default(''),
  fairnessEvidence: text(4000).default(''),
  openQuestions: z.array(text(500).min(1)).max(30).default([]),
});
export const listVendorsQuery = paginationSchema.extend({ search, status: z.enum(['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'RETIRED']).optional() });
export type ListVendorsQuery = z.infer<typeof listVendorsQuery>;
const vendorShape = z.object({
  vendorName: required('Vendor name', 200, 2),
  productName: required('Product name', 200, 2),
  aiSystemId: optionalId,
  riskLevel: riskLevel.nullish(),
  findings: vendorFindingsSchema,
});
export const createVendorSchema = vendorShape;
export type CreateVendorInput = z.infer<typeof createVendorSchema>;
export const updateVendorSchema = partial(vendorShape);
export type UpdateVendorInput = z.infer<typeof updateVendorSchema>;
export const decideVendorSchema = z
  .object({ decision: z.enum(['START_REVIEW', 'APPROVE', 'REJECT', 'REQUEST_CHANGES']), comment: text(2000).default('') })
  .refine((v) => v.decision === 'APPROVE' || v.decision === 'START_REVIEW' || v.comment.length >= 5, { message: 'Explain the decision (at least 5 characters)', path: ['comment'] });

// ── Human oversight records ─────────────────────────────────────────────────

export const listOversightQuery = paginationSchema.extend({ aiSystemId: z.string().uuid().optional(), modelId: z.string().uuid().optional(), decision: z.enum(['ACCEPTED_RECOMMENDATION', 'OVERRODE_RECOMMENDATION', 'ESCALATED', 'DEFERRED']).optional() });
export type ListOversightQuery = z.infer<typeof listOversightQuery>;
export const createOversightSchema = z
  .object({
    aiSystemId: optionalId,
    modelId: optionalId,
    decisionReference: required('Decision reference', 200, 2),
    decision: z.enum(['ACCEPTED_RECOMMENDATION', 'OVERRODE_RECOMMENDATION', 'ESCALATED', 'DEFERRED']),
    rationale: required('Rationale', 4000, 10),
  })
  .refine((v) => v.aiSystemId || v.modelId, { message: 'Link the record to an AI system or model', path: ['aiSystemId'] });
export type CreateOversightInput = z.infer<typeof createOversightSchema>;

// ── Review schedules ────────────────────────────────────────────────────────

export const REVIEWABLE_RESOURCES = ['AISystem', 'AIModel', 'GovernancePolicy', 'ComplianceRequirement'] as const;
export const listReviewsQuery = paginationSchema.extend({ dueWithinDays: z.coerce.number().int().min(0).max(3650).optional(), resourceType: z.enum(REVIEWABLE_RESOURCES).optional() });
export type ListReviewsQuery = z.infer<typeof listReviewsQuery>;
export const createReviewSchema = z.object({
  resourceType: z.enum(REVIEWABLE_RESOURCES),
  resourceId: z.string().uuid(),
  title: required('Title', 200),
  frequencyDays: z.coerce.number().int().min(7).max(1095),
  nextReviewAt: z.coerce.date(),
  assigneeId: optionalId,
});
export type CreateReviewInput = z.infer<typeof createReviewSchema>;
export const completeReviewSchema = z.object({ notes: required('Review notes', 2000, 5) });
