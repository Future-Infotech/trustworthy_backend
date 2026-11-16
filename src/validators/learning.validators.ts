import { z } from 'zod';
import { paginationSchema } from '../utils/pagination';

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();
const slug = z
  .string()
  .trim()
  .min(3)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and single hyphens');
const httpsUrl = z
  .string()
  .trim()
  .url()
  .refine((u) => u.startsWith('https://'), 'Only https:// URLs are allowed');

export const courseStatusEnum = z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']);

export const listCoursesQuery = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  status: courseStatusEnum.optional(),
  enrolled: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
});
export type ListCoursesQuery = z.infer<typeof listCoursesQuery>;

export const createCourseSchema = z.object({
  title: text(200),
  slug,
  summary: text(500),
  description: text(20_000),
  coverImageUrl: httpsUrl.optional().nullable(),
  level: z.enum(['Beginner', 'Intermediate', 'Advanced']).default('Intermediate'),
  durationHours: z.number().int().min(1).max(500).optional().nullable(),
  instructorId: z.string().uuid().optional().nullable(),
});
export type CreateCourseInput = z.infer<typeof createCourseSchema>;

export const updateCourseSchema = createCourseSchema.partial().extend({ status: courseStatusEnum.optional() });
export type UpdateCourseInput = z.infer<typeof updateCourseSchema>;

export const moduleSchema = z.object({
  title: text(200),
  summary: text(2000),
  objectives: z.array(text(300)).max(20).default([]),
  estimatedMinutes: z.number().int().min(1).max(1000).optional().nullable(),
  isRequired: z.boolean().default(true),
});
export type ModuleInput = z.infer<typeof moduleSchema>;
export const updateModuleSchema = moduleSchema.partial();

const optionSchema = z.object({ id: z.string().trim().min(1).max(10), text: text(500) });

export const knowledgeCheckSchema = z
  .object({
    prompt: text(1000),
    options: z.array(optionSchema).min(2).max(8),
    correctOptionIds: z.array(z.string()).min(1),
    explanation: text(2000),
  })
  .refine((k) => k.correctOptionIds.every((id) => k.options.some((o) => o.id === id)), {
    message: 'Correct answers must reference existing options',
    path: ['correctOptionIds'],
  });

export const lessonSchema = z.object({
  title: text(200),
  type: z.enum(['TEXT', 'VIDEO', 'IMAGE', 'CODE', 'KNOWLEDGE_CHECK', 'EXERCISE']).default('TEXT'),
  content: z.string().max(100_000).default(''),
  media: z
    .array(z.object({ type: z.enum(['image', 'video']), url: httpsUrl, caption: optionalText(300) }))
    .max(20)
    .optional()
    .nullable(),
  codeSnippet: z.string().max(20_000).optional().nullable(),
  codeLanguage: z.enum(['python', 'typescript', 'javascript', 'sql', 'bash', 'json', 'text']).optional().nullable(),
  videoUrl: httpsUrl.optional().nullable(),
  knowledgeCheck: z.array(knowledgeCheckSchema).max(10).optional().nullable(),
  estimatedMinutes: z.number().int().min(1).max(600).optional().nullable(),
});
export type LessonInput = z.infer<typeof lessonSchema>;
export const updateLessonSchema = lessonSchema.partial();

export const reorderSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(200) });

export const lessonProgressSchema = z.object({
  /** Seconds spent since the previous report; capped to discourage inflated values. */
  timeSpentSeconds: z.number().int().min(0).max(3600).default(0),
  completed: z.boolean().optional(),
});

export const knowledgeCheckAnswerSchema = z.object({
  index: z.number().int().min(0).max(20),
  answers: z.array(z.string().max(10)).min(1).max(8),
});

// Quizzes
export const listQuizzesQuery = z.object({ courseId: z.string().uuid().optional() });

export const quizSchema = z.object({
  courseId: z.string().uuid().optional().nullable(),
  moduleId: z.string().uuid().optional().nullable(),
  title: text(200),
  description: optionalText(2000),
  passingScore: z.number().int().min(1).max(100).default(70),
  timeLimitSeconds: z.number().int().min(60).max(4 * 3600).optional().nullable(),
  attemptLimit: z.number().int().min(1).max(50).optional().nullable(),
  randomizeQuestions: z.boolean().default(true),
  questionsPerAttempt: z.number().int().min(1).max(200).optional().nullable(),
  isFinal: z.boolean().default(false),
  isPublished: z.boolean().default(false),
});
export type QuizInput = z.infer<typeof quizSchema>;
export const updateQuizSchema = quizSchema.partial();

const questionBase = z.object({
  type: z.enum(['MULTIPLE_CHOICE', 'MULTIPLE_ANSWER', 'TRUE_FALSE', 'SCENARIO']),
  prompt: text(2000),
  scenario: optionalText(5000),
  options: z.array(optionSchema).min(2).max(8),
  correctOptionIds: z.array(z.string().min(1).max(10)).min(1),
  explanation: text(3000),
  points: z.number().int().min(1).max(100).default(1),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).default('MEDIUM'),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
});

function questionRules<T extends z.ZodTypeAny>(schema: T) {
  return schema.superRefine((q: Partial<z.infer<typeof questionBase>>, ctx) => {
    if (!q.options || !q.correctOptionIds) return;
    const ids = new Set(q.options.map((o) => o.id));
    if (ids.size !== q.options.length) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Option ids must be unique' });
    if (!q.correctOptionIds.every((id) => ids.has(id))) {
      ctx.addIssue({ code: 'custom', path: ['correctOptionIds'], message: 'Correct answers must reference existing options' });
    }
    if (q.type && q.type !== 'MULTIPLE_ANSWER' && q.correctOptionIds.length !== 1) {
      ctx.addIssue({ code: 'custom', path: ['correctOptionIds'], message: 'This question type has exactly one correct answer' });
    }
    if (q.type === 'TRUE_FALSE' && q.options.length !== 2) {
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'True/false questions have exactly two options' });
    }
  });
}

export const questionSchema = questionRules(questionBase);
export type QuestionInput = z.infer<typeof questionBase>;
export const updateQuestionSchema = questionRules(questionBase.partial().extend({ isActive: z.boolean().optional() }));

export const submitQuizSchema = z.object({
  answers: z.record(z.string().uuid(), z.array(z.string().max(10)).max(8)),
});

// Labs
export const labSchema = z.object({
  courseId: z.string().uuid().optional().nullable(),
  moduleId: z.string().uuid().optional().nullable(),
  slug,
  title: text(200),
  type: z.enum(['XAI', 'FAIRNESS', 'ROBUSTNESS', 'MODEL_CARD', 'RISK_ASSESSMENT', 'GOVERNANCE']),
  description: text(2000),
  instructions: text(10_000),
  config: z.record(z.unknown()).optional().nullable(),
  isRequired: z.boolean().default(false),
  estimatedMinutes: z.number().int().min(1).max(600).optional().nullable(),
});
export type LabInput = z.infer<typeof labSchema>;
export const updateLabSchema = labSchema.partial();

export const completeLabSchema = z.object({
  experimentId: z.string().uuid().optional(),
  notes: z.string().trim().max(5000).optional(),
});
