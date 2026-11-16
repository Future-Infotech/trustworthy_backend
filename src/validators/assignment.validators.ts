import { z } from 'zod';
import { paginationSchema } from '../utils/pagination';
import { boolString } from './common.validators';

export const ROLE_NAMES = ['SUPER_ADMIN', 'ADMIN', 'FACULTY', 'STUDENT', 'DEVELOPER', 'PRODUCT_DEVELOPER', 'EXECUTIVE'] as const;

export const rubricCriterionSchema = z.object({
  criterion: z.string().trim().min(3).max(200),
  weight: z.number().int().min(1).max(100),
  description: z.string().trim().max(1000).optional(),
});

export const rubricSchema = z
  .array(rubricCriterionSchema)
  .min(1, 'Add at least one rubric criterion')
  .max(12)
  .superRefine((rubric, ctx) => {
    const total = rubric.reduce((n, c) => n + c.weight, 0);
    if (total !== 100) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Rubric weights must add up to 100 (currently ${total})` });
    const names = rubric.map((c) => c.criterion.toLowerCase());
    if (new Set(names).size !== names.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Rubric criteria must be unique' });
  });

export type RubricCriterion = z.infer<typeof rubricCriterionSchema>;

const assignmentFields = {
  courseId: z.string().uuid(),
  moduleId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(10).max(2000),
  instructions: z.string().trim().min(10).max(10_000),
  targetRoles: z.array(z.enum(ROLE_NAMES)).max(ROLE_NAMES.length).default([]),
  dueDate: z.coerce.date().nullable().optional(),
  maxScore: z.number().int().min(1).max(1000).default(100),
  rubric: rubricSchema,
  isPublished: z.boolean().default(false),
};

export const createAssignmentSchema = z.object(assignmentFields);
export type CreateAssignmentInput = z.infer<typeof createAssignmentSchema>;

export const updateAssignmentSchema = z
  .object({
    moduleId: assignmentFields.moduleId,
    title: assignmentFields.title.optional(),
    description: assignmentFields.description.optional(),
    instructions: assignmentFields.instructions.optional(),
    targetRoles: z.array(z.enum(ROLE_NAMES)).max(ROLE_NAMES.length).optional(),
    dueDate: assignmentFields.dueDate,
    maxScore: z.number().int().min(1).max(1000).optional(),
    rubric: rubricSchema.optional(),
    isPublished: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Provide at least one field to update');
export type UpdateAssignmentInput = z.infer<typeof updateAssignmentSchema>;

export const listAssignmentsQuery = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  courseId: z.string().uuid().optional(),
  published: boolString,
});
export type ListAssignmentsQuery = z.infer<typeof listAssignmentsQuery>;

export const EVIDENCE_TYPES = ['experiment', 'model_card', 'risk_assessment', 'impact_assessment', 'policy'] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export const submitAssignmentSchema = z.object({
  content: z.string().trim().min(50, 'Write at least 50 characters').max(20_000),
  evidence: z
    .array(z.object({ type: z.enum(EVIDENCE_TYPES), id: z.string().uuid() }))
    .max(10)
    .default([])
    .refine((items) => new Set(items.map((e) => `${e.type}:${e.id}`)).size === items.length, 'Each evidence item can only be attached once'),
});
export type SubmitAssignmentInput = z.infer<typeof submitAssignmentSchema>;

export const SUBMISSION_STATUSES = ['SUBMITTED', 'UNDER_REVIEW', 'GRADED', 'RETURNED'] as const;

export const listSubmissionsQuery = paginationSchema.extend({
  status: z.enum(SUBMISSION_STATUSES).optional(),
});
export type ListSubmissionsQuery = z.infer<typeof listSubmissionsQuery>;

export const gradeSubmissionSchema = z
  .object({
    decision: z.enum(['GRADE', 'RETURN']),
    feedback: z.string().trim().min(10, 'Write at least 10 characters of feedback').max(5000),
    rubricScores: z
      .array(z.object({ criterion: z.string().trim().min(1).max(200), points: z.number().min(0), comment: z.string().trim().max(1000).optional() }))
      .max(12)
      .optional(),
  })
  .refine((v) => v.decision === 'RETURN' || (v.rubricScores && v.rubricScores.length > 0), {
    path: ['rubricScores'],
    message: 'Score every rubric criterion to grade a submission',
  });
export type GradeSubmissionInput = z.infer<typeof gradeSubmissionSchema>;
