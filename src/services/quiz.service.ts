import type { Prisma, Question, Quiz, QuizAttempt } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { prisma } from '../config/prisma';
import type { AuthContext } from '../middleware/authorize';
import { PERMISSIONS } from '../rbac/permissions';
import { Errors } from '../utils/errors';
import type { QuestionInput, QuizInput } from '../validators/learning.validators';
import { auditService } from './audit.service';

/** Submissions arriving shortly after the timer expires are accepted to absorb network latency. */
export const SUBMISSION_GRACE_MS = 30_000;

type Answers = Record<string, string[]>;
const canManage = (auth: AuthContext) => auth.can(PERMISSIONS.QUIZZES_MANAGE);

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const sameSet = (a: string[], b: string[]) => {
  const x = [...new Set(a)].sort();
  const y = [...new Set(b)].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

function publicQuestion(q: Question) {
  return {
    id: q.id,
    type: q.type,
    prompt: q.prompt,
    scenario: q.scenario,
    options: q.options as { id: string; text: string }[],
    points: q.points,
    multipleAnswers: q.type === 'MULTIPLE_ANSWER',
  };
}

export function gradeAttempt(questions: Question[], answers: Answers) {
  let score = 0;
  let maxScore = 0;
  const review = questions.map((q) => {
    const selected = answers[q.id] ?? [];
    const correct = selected.length > 0 && sameSet(selected, q.correctOptionIds);
    maxScore += q.points;
    if (correct) score += q.points;
    return { ...publicQuestion(q), selected, correct, correctOptionIds: q.correctOptionIds, explanation: q.explanation };
  });
  const percentage = maxScore === 0 ? 0 : Math.round((score / maxScore) * 1000) / 10;
  return { score, maxScore, percentage, review };
}

async function loadQuiz(auth: AuthContext, id: string) {
  const quiz = await prisma.quiz.findUnique({ where: { id }, include: { course: { select: { id: true, title: true, status: true } } } });
  const visible = quiz && (canManage(auth) || (quiz.isPublished && (!quiz.course || quiz.course.status === 'PUBLISHED')));
  if (!quiz || !visible) throw Errors.notFound('Quiz');
  return quiz;
}

async function orderedQuestions(ids: string[]) {
  const rows = await prisma.question.findMany({ where: { id: { in: ids } } });
  const byId = new Map(rows.map((q) => [q.id, q]));
  return ids.map((id) => byId.get(id)).filter((q): q is Question => Boolean(q));
}

function attemptSummary(a: QuizAttempt) {
  return {
    id: a.id,
    attemptNumber: a.attemptNumber,
    startedAt: a.startedAt,
    expiresAt: a.expiresAt,
    submittedAt: a.submittedAt,
    score: a.score,
    maxScore: a.maxScore,
    percentage: a.percentage,
    passed: a.passed,
  };
}

/** Finalises an attempt whose time ran out without a submission. */
async function expireAttempt(a: QuizAttempt, quiz: Quiz) {
  const questions = await orderedQuestions(a.questionIds);
  const graded = gradeAttempt(questions, {});
  await prisma.quizAttempt.updateMany({
    where: { id: a.id, submittedAt: null },
    data: { answers: {}, score: 0, maxScore: graded.maxScore, percentage: 0, passed: quiz.passingScore <= 0, submittedAt: a.expiresAt ?? new Date() },
  });
}

const isExpired = (a: QuizAttempt, now = Date.now()) => a.expiresAt !== null && now > a.expiresAt.getTime() + SUBMISSION_GRACE_MS;

export const quizService = {
  async list(auth: AuthContext, courseId?: string) {
    const manager = canManage(auth);
    const quizzes = await prisma.quiz.findMany({
      where: {
        ...(courseId ? { courseId } : {}),
        ...(manager ? {} : { isPublished: true, OR: [{ courseId: null }, { course: { status: 'PUBLISHED' } }] }),
      },
      orderBy: [{ isFinal: 'asc' }, { createdAt: 'asc' }],
      include: {
        course: { select: { id: true, title: true } },
        module: { select: { id: true, title: true, order: true } },
        attempts: { where: { userId: auth.actor.id }, orderBy: { attemptNumber: 'desc' } },
        _count: { select: { questions: { where: { isActive: true } } } },
      },
    });
    return quizzes.map(({ attempts, _count, ...q }) => {
      const submitted = attempts.filter((a) => a.submittedAt);
      return {
        id: q.id,
        title: q.title,
        description: q.description,
        course: q.course,
        module: q.module,
        passingScore: q.passingScore,
        timeLimitSeconds: q.timeLimitSeconds,
        attemptLimit: q.attemptLimit,
        questionsPerAttempt: q.questionsPerAttempt ?? _count.questions,
        questionCount: _count.questions,
        isFinal: q.isFinal,
        isPublished: q.isPublished,
        myAttempts: {
          used: attempts.length,
          bestPercentage: submitted.length ? Math.max(...submitted.map((a) => a.percentage ?? 0)) : null,
          passed: submitted.some((a) => a.passed),
          inProgressId: attempts.find((a) => !a.submittedAt && !isExpired(a))?.id ?? null,
        },
      };
    });
  },

  async get(auth: AuthContext, id: string) {
    const quiz = await loadQuiz(auth, id);
    const manager = canManage(auth);
    const [attempts, questions] = await Promise.all([
      prisma.quizAttempt.findMany({ where: { quizId: id, userId: auth.actor.id }, orderBy: { attemptNumber: 'desc' } }),
      manager ? prisma.question.findMany({ where: { quizId: id }, orderBy: [{ isActive: 'desc' }, { order: 'asc' }] }) : null,
    ]);
    const activeCount = await prisma.question.count({ where: { quizId: id, isActive: true } });
    return {
      ...quiz,
      questionCount: activeCount,
      questionsPerAttempt: quiz.questionsPerAttempt ?? activeCount,
      attempts: attempts.map(attemptSummary),
      attemptsRemaining: quiz.attemptLimit ? Math.max(0, quiz.attemptLimit - attempts.length) : null,
      questions,
    };
  },

  async start(auth: AuthContext, quizId: string) {
    const quiz = await loadQuiz(auth, quizId);
    if (!quiz.isPublished) throw Errors.badRequest('This quiz is not published');
    const attempts = await prisma.quizAttempt.findMany({ where: { quizId, userId: auth.actor.id }, orderBy: { attemptNumber: 'desc' } });

    const open = attempts.find((a) => !a.submittedAt);
    if (open) {
      if (!isExpired(open)) return this.view(auth, open.id);
      await expireAttempt(open, quiz);
    }
    if (quiz.attemptLimit && attempts.length >= quiz.attemptLimit) {
      throw Errors.conflict(`You have used all ${quiz.attemptLimit} attempts for this quiz`);
    }

    const pool = await prisma.question.findMany({ where: { quizId, isActive: true }, orderBy: { order: 'asc' }, select: { id: true } });
    if (pool.length === 0) throw Errors.badRequest('This quiz has no questions yet');
    const ordered = quiz.randomizeQuestions ? shuffle(pool) : pool;
    const selected = ordered.slice(0, quiz.questionsPerAttempt ?? pool.length).map((q) => q.id);
    const now = new Date();

    const attempt = await prisma.quizAttempt.create({
      data: {
        quizId,
        userId: auth.actor.id,
        attemptNumber: (attempts[0]?.attemptNumber ?? 0) + 1,
        questionIds: selected,
        startedAt: now,
        expiresAt: quiz.timeLimitSeconds ? new Date(now.getTime() + quiz.timeLimitSeconds * 1000) : null,
      },
    });
    await auditService.record({
      action: 'quiz.attempt_start',
      resource: 'quiz',
      resourceId: quizId,
      actor: auth.actor,
      context: auth.ctx,
      metadata: { attemptId: attempt.id, attemptNumber: attempt.attemptNumber },
    });
    return this.view(auth, attempt.id);
  },

  /** In-progress attempts never expose answers; submitted attempts include the full review. */
  async view(auth: AuthContext, attemptId: string) {
    const attempt = await prisma.quizAttempt.findUnique({
      where: { id: attemptId },
      include: { quiz: { select: { id: true, title: true, passingScore: true, timeLimitSeconds: true, isFinal: true } } },
    });
    if (!attempt || attempt.userId !== auth.actor.id) throw Errors.notFound('Quiz attempt');
    const questions = await orderedQuestions(attempt.questionIds);
    const base = { ...attemptSummary(attempt), quiz: attempt.quiz, serverTime: new Date().toISOString() };
    if (!attempt.submittedAt) return { ...base, status: 'IN_PROGRESS' as const, questions: questions.map(publicQuestion) };
    const graded = gradeAttempt(questions, (attempt.answers as Answers | null) ?? {});
    return { ...base, status: 'SUBMITTED' as const, review: graded.review };
  },

  async submit(auth: AuthContext, attemptId: string, answers: Answers) {
    const attempt = await prisma.quizAttempt.findUnique({ where: { id: attemptId }, include: { quiz: true } });
    if (!attempt || attempt.userId !== auth.actor.id) throw Errors.notFound('Quiz attempt');
    if (attempt.submittedAt) throw Errors.conflict('This attempt has already been submitted');

    const late = isExpired(attempt);
    const allowed = new Set(attempt.questionIds);
    const accepted: Answers = late ? {} : Object.fromEntries(Object.entries(answers).filter(([qid]) => allowed.has(qid)));
    const questions = await orderedQuestions(attempt.questionIds);
    const graded = gradeAttempt(questions, accepted);
    const passed = graded.percentage >= attempt.quiz.passingScore;

    const { count } = await prisma.quizAttempt.updateMany({
      where: { id: attemptId, submittedAt: null },
      data: {
        answers: accepted as Prisma.InputJsonValue,
        score: graded.score,
        maxScore: graded.maxScore,
        percentage: graded.percentage,
        passed,
        submittedAt: new Date(),
      },
    });
    if (count === 0) throw Errors.conflict('This attempt has already been submitted');
    await auditService.record({
      action: 'quiz.attempt_submit',
      resource: 'quiz',
      resourceId: attempt.quizId,
      actor: auth.actor,
      context: auth.ctx,
      metadata: { attemptId, percentage: graded.percentage, passed, late },
    });
    return { ...(await this.view(auth, attemptId)), late };
  },

  async create(auth: AuthContext, input: QuizInput) {
    const quiz = await prisma.quiz.create({ data: { ...input, createdById: auth.actor.id, updatedById: auth.actor.id } });
    await auditService.record({ action: 'quiz.create', resource: 'quiz', resourceId: quiz.id, actor: auth.actor, context: auth.ctx, after: quiz });
    return quiz;
  },

  async update(auth: AuthContext, id: string, input: Partial<QuizInput>) {
    const before = await prisma.quiz.findUnique({ where: { id } });
    if (!before) throw Errors.notFound('Quiz');
    if (input.isPublished && !before.isPublished && (await prisma.question.count({ where: { quizId: id, isActive: true } })) === 0) {
      throw Errors.badRequest('Add at least one question before publishing');
    }
    const quiz = await prisma.quiz.update({ where: { id }, data: { ...input, updatedById: auth.actor.id } });
    await auditService.record({ action: 'quiz.update', resource: 'quiz', resourceId: id, actor: auth.actor, context: auth.ctx, before, after: quiz });
    return quiz;
  },

  async addQuestion(auth: AuthContext, quizId: string, input: QuestionInput) {
    if (!(await prisma.quiz.findUnique({ where: { id: quizId } }))) throw Errors.notFound('Quiz');
    const last = await prisma.question.aggregate({ where: { quizId }, _max: { order: true } });
    const question = await prisma.question.create({
      data: { ...input, quizId, order: (last._max.order ?? 0) + 1, createdById: auth.actor.id, updatedById: auth.actor.id },
    });
    await auditService.record({ action: 'question.create', resource: 'question', resourceId: question.id, actor: auth.actor, context: auth.ctx, metadata: { quizId } });
    return question;
  },

  async updateQuestion(auth: AuthContext, id: string, input: Partial<QuestionInput> & { isActive?: boolean }) {
    const before = await prisma.question.findUnique({ where: { id } });
    if (!before) throw Errors.notFound('Question');
    const merged = { ...before, ...input };
    const ids = new Set((merged.options as { id: string }[]).map((o) => o.id));
    if (!merged.correctOptionIds.every((c) => ids.has(c))) throw Errors.badRequest('Correct answers must reference existing options');
    const question = await prisma.question.update({ where: { id }, data: { ...input, updatedById: auth.actor.id } });
    await auditService.record({ action: 'question.update', resource: 'question', resourceId: id, actor: auth.actor, context: auth.ctx, before, after: question });
    return question;
  },

  /** Questions are deactivated rather than deleted so historical attempts remain reviewable. */
  async deactivateQuestion(auth: AuthContext, id: string) {
    return this.updateQuestion(auth, id, { isActive: false });
  },
};
