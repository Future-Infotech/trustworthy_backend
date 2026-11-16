import { z } from 'zod';
import { riskAnswersSchema } from '../services/riskScoring.service';
import { paginationSchema } from '../utils/pagination';
import { boolString } from './common.validators';

const reviewStatus = z.enum(['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'RETIRED']);
const optionalId = z.string().uuid().nullish();
const title = z.string().trim().min(3, 'Title must be at least 3 characters').max(200);

/** Reviewer decision shared by risk assessments and AIAs. Rejections and change requests must be explained. */
export const reviewDecisionSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT', 'REQUEST_CHANGES']),
    comment: z.string().trim().max(2000).default(''),
  })
  .refine((v) => v.decision === 'APPROVE' || v.comment.length >= 5, { message: 'Explain the decision (at least 5 characters)', path: ['comment'] });
export type ReviewDecisionInput = z.infer<typeof reviewDecisionSchema>;

export const listAssessmentsQuery = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  status: reviewStatus.optional(),
  aiSystemId: z.string().uuid().optional(),
  mine: boolString,
});
export type ListAssessmentsQuery = z.infer<typeof listAssessmentsQuery>;

// ── Risk assessments ─────────────────────────────────────────────────────────

export const scoreRiskSchema = z.object({ answers: riskAnswersSchema });

export const createRiskAssessmentSchema = z.object({
  title,
  aiSystemId: optionalId,
  modelId: optionalId,
  answers: riskAnswersSchema,
});
export type CreateRiskAssessmentInput = z.infer<typeof createRiskAssessmentSchema>;

export const updateRiskAssessmentSchema = createRiskAssessmentSchema.partial().refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type UpdateRiskAssessmentInput = z.infer<typeof updateRiskAssessmentSchema>;

export const listRiskAssessmentsQuery = listAssessmentsQuery.extend({
  riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
});
export type ListRiskAssessmentsQuery = z.infer<typeof listRiskAssessmentsQuery>;

// ── Algorithmic impact assessments ───────────────────────────────────────────

export const AIA_SECTIONS = [
  ['systemInformation', 'System information'],
  ['purpose', 'Purpose'],
  ['stakeholders', 'Stakeholders'],
  ['affectedGroups', 'Affected groups'],
  ['dataSources', 'Data sources'],
  ['modelDescription', 'Model description'],
  ['potentialHarms', 'Potential harms'],
  ['fairnessAnalysis', 'Fairness analysis'],
  ['privacyAnalysis', 'Privacy analysis'],
  ['securityAnalysis', 'Security analysis'],
  ['humanOversight', 'Human oversight'],
  ['explainability', 'Explainability'],
  ['monitoring', 'Monitoring'],
  ['incidentResponse', 'Incident response'],
  ['governanceApproval', 'Governance approval'],
] as const;
export type AiaSectionKey = (typeof AIA_SECTIONS)[number][0];

export const harmSchema = z.object({
  description: z.string().trim().min(3, 'Describe the harm').max(500),
  affectedGroup: z.string().trim().min(1, 'Name the affected group').max(200),
  likelihood: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  mitigation: z.string().trim().max(1000).default(''),
});
export type Harm = z.infer<typeof harmSchema>;

const sectionText = z.string().trim().max(10_000).default('');
export const aiaSectionsSchema = z.object({
  ...(Object.fromEntries(AIA_SECTIONS.map(([key]) => [key, sectionText])) as Record<AiaSectionKey, typeof sectionText>),
  harms: z.array(harmSchema).max(50).default([]),
});
export type AiaSections = z.infer<typeof aiaSectionsSchema>;

export const createAiaSchema = z.object({ title, aiSystemId: optionalId, sections: aiaSectionsSchema });
export type CreateAiaInput = z.infer<typeof createAiaSchema>;

export const updateAiaSchema = createAiaSchema.partial().refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type UpdateAiaInput = z.infer<typeof updateAiaSchema>;
