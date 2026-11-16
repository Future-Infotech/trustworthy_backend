import type { Prisma } from '@prisma/client';
import type { AuthContext } from '../middleware/authorize';
import { prisma, type DbClient } from '../config/prisma';
import { PERMISSIONS } from '../rbac/permissions';
import { Errors } from '../utils/errors';
import { paginate, toSkipTake } from '../utils/pagination';
import type {
  CreateCourseInput,
  LessonInput,
  ListCoursesQuery,
  ModuleInput,
  UpdateCourseInput,
} from '../validators/learning.validators';
import { auditService } from './audit.service';
import { notificationService } from './notification.service';

interface KnowledgeCheckItem {
  prompt: string;
  options: { id: string; text: string }[];
  correctOptionIds: string[];
  explanation: string;
}

const personName = (u: { firstName: string; lastName: string } | null) => (u ? `${u.firstName} ${u.lastName}` : null);
const json = (v: unknown) => (v === undefined ? undefined : v === null ? undefined : (v as Prisma.InputJsonValue));
const canManage = (auth: AuthContext) => auth.can(PERMISSIONS.COURSES_MANAGE);

/** Strips answers so knowledge checks can be shown before the learner responds. */
function publicKnowledgeCheck(raw: unknown) {
  if (!Array.isArray(raw)) return null;
  return (raw as KnowledgeCheckItem[]).map((k, index) => ({
    index,
    prompt: k.prompt,
    options: k.options,
    multipleAnswers: k.correctOptionIds.length > 1,
  }));
}

async function findCourseOrThrow(id: string, auth: AuthContext) {
  const course = await prisma.course.findUnique({ where: { id } });
  if (!course || (course.status !== 'PUBLISHED' && !canManage(auth))) throw Errors.notFound('Course');
  return course;
}

/** Recomputes enrolment progress from lesson completion and handles course completion. */
async function recomputeEnrollment(userId: string, courseId: string, db: DbClient) {
  const [total, completed, enrollment] = await Promise.all([
    db.lesson.count({ where: { module: { courseId } } }),
    db.progress.count({ where: { userId, status: 'COMPLETED', lesson: { module: { courseId } } } }),
    db.enrollment.findUnique({ where: { userId_courseId: { userId, courseId } }, include: { course: { select: { title: true } } } }),
  ]);
  if (!enrollment) return null;
  const progressPercent = total === 0 ? 0 : Math.round((completed / total) * 1000) / 10;
  const justCompleted = progressPercent >= 100 && enrollment.status === 'ACTIVE';
  const updated = await db.enrollment.update({
    where: { id: enrollment.id },
    data: {
      progressPercent,
      ...(justCompleted ? { status: 'COMPLETED', completedAt: new Date() } : {}),
    },
  });
  if (justCompleted) {
    await notificationService.notify(
      userId,
      {
        type: 'COURSE_COMPLETED',
        title: 'Course completed',
        message: `You completed every lesson in "${enrollment.course.title}". Check the certificate requirements to continue.`,
        link: '/certificates',
      },
      db,
    );
  }
  return updated;
}

/** Re-sequences children atomically despite the (parent, order) unique constraint. */
async function reorder(
  tx: Prisma.TransactionClient,
  model: 'module' | 'lesson',
  ids: string[],
  existing: { id: string }[],
) {
  const known = new Set(existing.map((e) => e.id));
  if (ids.length !== known.size || !ids.every((id) => known.has(id)) || new Set(ids).size !== ids.length) {
    throw Errors.badRequest('The ordering must contain every item exactly once');
  }
  const delegate = (model === 'module' ? tx.module : tx.lesson) as unknown as {
    update(args: { where: { id: string }; data: { order: number } }): Promise<unknown>;
  };
  for (const [i, id] of ids.entries()) await delegate.update({ where: { id }, data: { order: -(i + 1) } });
  for (const [i, id] of ids.entries()) await delegate.update({ where: { id }, data: { order: i + 1 } });
}

export const courseService = {
  async list(auth: AuthContext, query: ListCoursesQuery) {
    const where: Prisma.CourseWhereInput = {};
    if (!canManage(auth)) where.status = 'PUBLISHED';
    else if (query.status) where.status = query.status;
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { summary: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.enrolled !== undefined) {
      where.enrollments = query.enrolled ? { some: { userId: auth.actor.id } } : { none: { userId: auth.actor.id } };
    }
    const { skip, take } = toSkipTake(query);
    const [items, total] = await prisma.$transaction([
      prisma.course.findMany({
        where,
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        skip,
        take,
        include: {
          instructor: { select: { id: true, firstName: true, lastName: true } },
          enrollments: { where: { userId: auth.actor.id }, select: { status: true, progressPercent: true } },
          _count: { select: { modules: true, enrollments: true } },
          modules: { select: { _count: { select: { lessons: true } } } },
        },
      }),
      prisma.course.count({ where }),
    ]);
    return paginate(
      items.map((c) => ({
        id: c.id,
        title: c.title,
        slug: c.slug,
        summary: c.summary,
        coverImageUrl: c.coverImageUrl,
        level: c.level,
        durationHours: c.durationHours,
        status: c.status,
        publishedAt: c.publishedAt,
        instructor: c.instructor ? { id: c.instructor.id, name: personName(c.instructor) } : null,
        moduleCount: c._count.modules,
        lessonCount: c.modules.reduce((n, m) => n + m._count.lessons, 0),
        enrolledCount: c._count.enrollments,
        enrollment: c.enrollments[0] ?? null,
      })),
      total,
      query,
    );
  },

  async get(auth: AuthContext, id: string) {
    await findCourseOrThrow(id, auth);
    const manager = canManage(auth);
    const course = await prisma.course.findUniqueOrThrow({
      where: { id },
      include: {
        instructor: { select: { id: true, firstName: true, lastName: true } },
        modules: {
          orderBy: { order: 'asc' },
          include: { lessons: { orderBy: { order: 'asc' }, select: { id: true, title: true, type: true, order: true, estimatedMinutes: true } } },
        },
        quizzes: {
          where: manager ? {} : { isPublished: true },
          select: {
            id: true,
            title: true,
            moduleId: true,
            isFinal: true,
            isPublished: true,
            passingScore: true,
            timeLimitSeconds: true,
            _count: { select: { questions: { where: { isActive: true } } } },
          },
        },
        labs: { select: { id: true, slug: true, title: true, type: true, moduleId: true, isRequired: true, estimatedMinutes: true } },
        enrollments: { where: { userId: auth.actor.id } },
        _count: { select: { enrollments: true } },
      },
    });
    const progress = await prisma.progress.findMany({
      where: { userId: auth.actor.id, lesson: { module: { courseId: id } } },
      select: { lessonId: true, status: true },
    });
    const statusByLesson = new Map(progress.map((p) => [p.lessonId, p.status]));
    const enrollment = course.enrollments[0] ?? null;

    return {
      id: course.id,
      title: course.title,
      slug: course.slug,
      summary: course.summary,
      description: course.description,
      coverImageUrl: course.coverImageUrl,
      level: course.level,
      durationHours: course.durationHours,
      status: course.status,
      publishedAt: course.publishedAt,
      instructor: course.instructor ? { id: course.instructor.id, name: personName(course.instructor) } : null,
      modules: course.modules.map((m) => {
        const lessons = m.lessons.map((l) => ({ ...l, status: statusByLesson.get(l.id) ?? 'NOT_STARTED' }));
        return {
          id: m.id,
          title: m.title,
          summary: m.summary,
          order: m.order,
          objectives: m.objectives,
          estimatedMinutes: m.estimatedMinutes,
          isRequired: m.isRequired,
          lessons,
          completedLessons: lessons.filter((l) => l.status === 'COMPLETED').length,
          totalLessons: lessons.length,
        };
      }),
      quizzes: course.quizzes.map(({ _count, ...q }) => ({ ...q, questionCount: _count.questions })),
      labs: course.labs,
      enrollment: enrollment && {
        status: enrollment.status,
        progressPercent: enrollment.progressPercent,
        enrolledAt: enrollment.enrolledAt,
        completedAt: enrollment.completedAt,
      },
      stats: {
        moduleCount: course.modules.length,
        lessonCount: course.modules.reduce((n, m) => n + m.lessons.length, 0),
        enrolledCount: course._count.enrollments,
      },
      canManage: manager,
    };
  },

  async create(auth: AuthContext, input: CreateCourseInput) {
    return prisma.$transaction(async (tx) => {
      const course = await tx.course.create({
        data: { ...input, instructorId: input.instructorId ?? auth.actor.id, createdById: auth.actor.id, updatedById: auth.actor.id },
      });
      await auditService.record(
        { action: 'course.create', resource: 'course', resourceId: course.id, actor: auth.actor, context: auth.ctx, after: course, severity: 'LOW' },
        tx,
      );
      return course;
    });
  },

  async update(auth: AuthContext, id: string, input: UpdateCourseInput) {
    const before = await prisma.course.findUnique({ where: { id }, include: { _count: { select: { modules: true } } } });
    if (!before) throw Errors.notFound('Course');
    if (input.status === 'PUBLISHED' && before.status !== 'PUBLISHED') {
      const lessons = await prisma.lesson.count({ where: { module: { courseId: id } } });
      if (lessons === 0) throw Errors.badRequest('A course needs at least one lesson before it can be published');
    }
    return prisma.$transaction(async (tx) => {
      const course = await tx.course.update({
        where: { id },
        data: {
          ...input,
          updatedById: auth.actor.id,
          ...(input.status === 'PUBLISHED' && !before.publishedAt ? { publishedAt: new Date() } : {}),
        },
      });
      const statusChanged = input.status !== undefined && input.status !== before.status;
      await auditService.record(
        {
          action: statusChanged ? `course.${input.status!.toLowerCase()}` : 'course.update',
          resource: 'course',
          resourceId: id,
          actor: auth.actor,
          context: auth.ctx,
          before,
          after: course,
          severity: statusChanged ? 'MEDIUM' : 'LOW',
        },
        tx,
      );
      return course;
    });
  },

  async addModule(auth: AuthContext, courseId: string, input: ModuleInput) {
    if (!(await prisma.course.findUnique({ where: { id: courseId } }))) throw Errors.notFound('Course');
    return prisma.$transaction(async (tx) => {
      const last = await tx.module.aggregate({ where: { courseId }, _max: { order: true } });
      const created = await tx.module.create({
        data: { ...input, courseId, order: (last._max.order ?? 0) + 1, createdById: auth.actor.id, updatedById: auth.actor.id },
      });
      await auditService.record(
        { action: 'module.create', resource: 'module', resourceId: created.id, actor: auth.actor, context: auth.ctx, after: created, metadata: { courseId } },
        tx,
      );
      return created;
    });
  },

  async updateModule(auth: AuthContext, id: string, input: Partial<ModuleInput>) {
    const before = await prisma.module.findUnique({ where: { id } });
    if (!before) throw Errors.notFound('Module');
    const updated = await prisma.module.update({ where: { id }, data: { ...input, updatedById: auth.actor.id } });
    await auditService.record({ action: 'module.update', resource: 'module', resourceId: id, actor: auth.actor, context: auth.ctx, before, after: updated });
    return updated;
  },

  async deleteModule(auth: AuthContext, id: string) {
    const mod = await prisma.module.findUnique({ where: { id }, include: { _count: { select: { progress: true } } } });
    if (!mod) throw Errors.notFound('Module');
    if (mod._count.progress > 0) throw Errors.conflict('Learners have progress in this module; archive the course instead of deleting content');
    await prisma.$transaction(async (tx) => {
      await tx.module.delete({ where: { id } });
      const rest = await tx.module.findMany({ where: { courseId: mod.courseId }, orderBy: { order: 'asc' }, select: { id: true } });
      await reorder(tx, 'module', rest.map((r) => r.id), rest);
      await auditService.record(
        { action: 'module.delete', resource: 'module', resourceId: id, actor: auth.actor, context: auth.ctx, before: mod, severity: 'MEDIUM' },
        tx,
      );
    });
  },

  async reorderModules(auth: AuthContext, courseId: string, ids: string[]) {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.module.findMany({ where: { courseId }, select: { id: true } });
      if (existing.length === 0) throw Errors.notFound('Course');
      await reorder(tx, 'module', ids, existing);
      await auditService.record({ action: 'module.reorder', resource: 'course', resourceId: courseId, actor: auth.actor, context: auth.ctx, after: { ids } }, tx);
    });
  },

  async addLesson(auth: AuthContext, moduleId: string, input: LessonInput) {
    if (!(await prisma.module.findUnique({ where: { id: moduleId } }))) throw Errors.notFound('Module');
    return prisma.$transaction(async (tx) => {
      const last = await tx.lesson.aggregate({ where: { moduleId }, _max: { order: true } });
      const created = await tx.lesson.create({
        data: {
          ...input,
          media: json(input.media),
          knowledgeCheck: json(input.knowledgeCheck),
          moduleId,
          order: (last._max.order ?? 0) + 1,
          createdById: auth.actor.id,
          updatedById: auth.actor.id,
        },
      });
      await auditService.record(
        { action: 'lesson.create', resource: 'lesson', resourceId: created.id, actor: auth.actor, context: auth.ctx, metadata: { moduleId, title: created.title } },
        tx,
      );
      return created;
    });
  },

  async updateLesson(auth: AuthContext, id: string, input: Partial<LessonInput>) {
    const before = await prisma.lesson.findUnique({ where: { id } });
    if (!before) throw Errors.notFound('Lesson');
    const updated = await prisma.lesson.update({
      where: { id },
      data: {
        ...input,
        media: input.media === null ? (null as unknown as Prisma.InputJsonValue) : json(input.media),
        knowledgeCheck: input.knowledgeCheck === null ? (null as unknown as Prisma.InputJsonValue) : json(input.knowledgeCheck),
        updatedById: auth.actor.id,
      },
    });
    await auditService.record({
      action: 'lesson.update',
      resource: 'lesson',
      resourceId: id,
      actor: auth.actor,
      context: auth.ctx,
      metadata: { fields: Object.keys(input) },
    });
    return updated;
  },

  async deleteLesson(auth: AuthContext, id: string) {
    const lesson = await prisma.lesson.findUnique({ where: { id }, include: { _count: { select: { progress: true } } } });
    if (!lesson) throw Errors.notFound('Lesson');
    if (lesson._count.progress > 0) throw Errors.conflict('Learners have progress on this lesson; archive the course instead of deleting content');
    await prisma.$transaction(async (tx) => {
      await tx.lesson.delete({ where: { id } });
      const rest = await tx.lesson.findMany({ where: { moduleId: lesson.moduleId }, orderBy: { order: 'asc' }, select: { id: true } });
      if (rest.length) await reorder(tx, 'lesson', rest.map((r) => r.id), rest);
      await auditService.record(
        { action: 'lesson.delete', resource: 'lesson', resourceId: id, actor: auth.actor, context: auth.ctx, metadata: { title: lesson.title }, severity: 'MEDIUM' },
        tx,
      );
    });
  },

  async reorderLessons(auth: AuthContext, moduleId: string, ids: string[]) {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.lesson.findMany({ where: { moduleId }, select: { id: true } });
      if (existing.length === 0) throw Errors.notFound('Module');
      await reorder(tx, 'lesson', ids, existing);
      await auditService.record({ action: 'lesson.reorder', resource: 'module', resourceId: moduleId, actor: auth.actor, context: auth.ctx, after: { ids } }, tx);
    });
  },

  async enroll(auth: AuthContext, courseId: string) {
    const course = await findCourseOrThrow(courseId, auth);
    if (course.status !== 'PUBLISHED') throw Errors.badRequest('Only published courses accept enrolments');
    const existing = await prisma.enrollment.findUnique({ where: { userId_courseId: { userId: auth.actor.id, courseId } } });
    if (existing && existing.status !== 'DROPPED') return existing;
    const enrollment = existing
      ? await prisma.enrollment.update({ where: { id: existing.id }, data: { status: 'ACTIVE' } })
      : await prisma.enrollment.create({ data: { userId: auth.actor.id, courseId } });
    await auditService.record({ action: 'course.enroll', resource: 'course', resourceId: courseId, actor: auth.actor, context: auth.ctx });
    return (await recomputeEnrollment(auth.actor.id, courseId, prisma)) ?? enrollment;
  },

  async getLesson(auth: AuthContext, id: string) {
    const lesson = await prisma.lesson.findUnique({
      where: { id },
      include: {
        module: {
          include: {
            course: { select: { id: true, title: true, status: true } },
            lessons: { orderBy: { order: 'asc' }, select: { id: true, title: true, order: true } },
          },
        },
      },
    });
    if (!lesson) throw Errors.notFound('Lesson');
    const manager = canManage(auth);
    const courseId = lesson.module.course.id;
    if (!manager) {
      if (lesson.module.course.status !== 'PUBLISHED') throw Errors.notFound('Lesson');
      const enrollment = await prisma.enrollment.findUnique({ where: { userId_courseId: { userId: auth.actor.id, courseId } } });
      if (!enrollment || enrollment.status === 'DROPPED') throw Errors.forbidden('Enrol in the course to access its lessons');
    }

    const progress = manager
      ? await prisma.progress.findUnique({ where: { userId_lessonId: { userId: auth.actor.id, lessonId: id } } })
      : await prisma.progress.upsert({
          where: { userId_lessonId: { userId: auth.actor.id, lessonId: id } },
          create: { userId: auth.actor.id, lessonId: id, moduleId: lesson.moduleId, status: 'IN_PROGRESS' },
          update: { lastAccessedAt: new Date() },
        });

    const allLessons = await prisma.lesson.findMany({
      where: { module: { courseId } },
      orderBy: [{ module: { order: 'asc' } }, { order: 'asc' }],
      select: { id: true, title: true },
    });
    const position = allLessons.findIndex((l) => l.id === id);

    return {
      id: lesson.id,
      title: lesson.title,
      type: lesson.type,
      content: lesson.content,
      media: lesson.media,
      codeSnippet: lesson.codeSnippet,
      codeLanguage: lesson.codeLanguage,
      videoUrl: lesson.videoUrl,
      estimatedMinutes: lesson.estimatedMinutes,
      order: lesson.order,
      knowledgeCheck: manager ? lesson.knowledgeCheck : publicKnowledgeCheck(lesson.knowledgeCheck),
      module: { id: lesson.module.id, title: lesson.module.title, order: lesson.module.order },
      course: { id: courseId, title: lesson.module.course.title },
      progress: progress && { status: progress.status, timeSpentSeconds: progress.timeSpentSeconds, completedAt: progress.completedAt },
      navigation: {
        position: position + 1,
        total: allLessons.length,
        previous: allLessons[position - 1] ?? null,
        next: allLessons[position + 1] ?? null,
      },
    };
  },

  async recordProgress(auth: AuthContext, lessonId: string, input: { timeSpentSeconds: number; completed?: boolean }) {
    const lesson = await prisma.lesson.findUnique({ where: { id: lessonId }, include: { module: { select: { courseId: true } } } });
    if (!lesson) throw Errors.notFound('Lesson');
    const courseId = lesson.module.courseId;
    const enrollment = await prisma.enrollment.findUnique({ where: { userId_courseId: { userId: auth.actor.id, courseId } } });
    if (!enrollment || enrollment.status === 'DROPPED') throw Errors.forbidden('Enrol in the course to track progress');

    return prisma.$transaction(async (tx) => {
      const existing = await tx.progress.findUnique({ where: { userId_lessonId: { userId: auth.actor.id, lessonId } } });
      const completing = input.completed === true && existing?.status !== 'COMPLETED';
      const status = input.completed === true || existing?.status === 'COMPLETED' ? 'COMPLETED' : 'IN_PROGRESS';
      const progress = await tx.progress.upsert({
        where: { userId_lessonId: { userId: auth.actor.id, lessonId } },
        create: {
          userId: auth.actor.id,
          lessonId,
          moduleId: lesson.moduleId,
          status,
          timeSpentSeconds: input.timeSpentSeconds,
          completedAt: status === 'COMPLETED' ? new Date() : null,
        },
        update: {
          status,
          timeSpentSeconds: { increment: input.timeSpentSeconds },
          lastAccessedAt: new Date(),
          ...(completing ? { completedAt: new Date() } : {}),
        },
      });
      const updatedEnrollment = completing ? await recomputeEnrollment(auth.actor.id, courseId, tx) : enrollment;
      return {
        progress: { lessonId, status: progress.status, timeSpentSeconds: progress.timeSpentSeconds, completedAt: progress.completedAt },
        enrollment: updatedEnrollment && { status: updatedEnrollment.status, progressPercent: updatedEnrollment.progressPercent },
      };
    });
  },

  async answerKnowledgeCheck(auth: AuthContext, lessonId: string, input: { index: number; answers: string[] }) {
    const lesson = await prisma.lesson.findUnique({ where: { id: lessonId }, include: { module: { select: { courseId: true } } } });
    if (!lesson) throw Errors.notFound('Lesson');
    if (!canManage(auth)) {
      const enrollment = await prisma.enrollment.findUnique({
        where: { userId_courseId: { userId: auth.actor.id, courseId: lesson.module.courseId } },
      });
      if (!enrollment || enrollment.status === 'DROPPED') throw Errors.forbidden('Enrol in the course to answer knowledge checks');
    }
    const checks = Array.isArray(lesson.knowledgeCheck) ? (lesson.knowledgeCheck as unknown as KnowledgeCheckItem[]) : [];
    const check = checks[input.index];
    if (!check) throw Errors.notFound('Knowledge check');
    const expected = [...check.correctOptionIds].sort();
    const given = [...new Set(input.answers)].sort();
    return {
      correct: expected.length === given.length && expected.every((v, i) => v === given[i]),
      correctOptionIds: check.correctOptionIds,
      explanation: check.explanation,
    };
  },

  async analytics(courseId: string) {
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      include: { modules: { orderBy: { order: 'asc' }, include: { _count: { select: { lessons: true } } } } },
    });
    if (!course) throw Errors.notFound('Course');
    const [enrollments, progressRows, quizzes] = await Promise.all([
      prisma.enrollment.findMany({
        where: { courseId },
        orderBy: { progressPercent: 'desc' },
        include: { user: { select: { id: true, firstName: true, lastName: true, email: true, role: { select: { name: true } } } } },
      }),
      prisma.progress.groupBy({
        by: ['moduleId', 'userId'],
        where: { status: 'COMPLETED', module: { courseId } },
        _count: { _all: true },
      }),
      prisma.quiz.findMany({
        where: { courseId },
        select: { id: true, title: true, passingScore: true, attempts: { where: { submittedAt: { not: null } }, select: { percentage: true, passed: true } } },
      }),
    ]);
    const lastActivity = await prisma.progress.groupBy({
      by: ['userId'],
      where: { module: { courseId } },
      _max: { lastAccessedAt: true },
    });
    const lastByUser = new Map(lastActivity.map((r) => [r.userId, r._max.lastAccessedAt]));
    const buckets = [
      { label: '0%', min: 0, max: 0 },
      { label: '1-25%', min: 0.01, max: 25 },
      { label: '26-50%', min: 25.01, max: 50 },
      { label: '51-75%', min: 50.01, max: 75 },
      { label: '76-99%', min: 75.01, max: 99.99 },
      { label: '100%', min: 100, max: 100 },
    ];
    return {
      course: { id: course.id, title: course.title },
      enrolled: enrollments.length,
      completed: enrollments.filter((e) => e.status === 'COMPLETED').length,
      averageProgress: enrollments.length ? Math.round(enrollments.reduce((n, e) => n + e.progressPercent, 0) / enrollments.length) : 0,
      distribution: buckets.map((b) => ({
        label: b.label,
        count: enrollments.filter((e) => e.progressPercent >= b.min && e.progressPercent <= b.max).length,
      })),
      modules: course.modules.map((m) => {
        const completedLearners = progressRows.filter((r) => r.moduleId === m.id && r._count._all >= m._count.lessons && m._count.lessons > 0).length;
        return {
          moduleId: m.id,
          title: m.title,
          order: m.order,
          completedLearners,
          completionRate: enrollments.length ? Math.round((completedLearners / enrollments.length) * 100) : 0,
        };
      }),
      quizzes: quizzes.map((q) => ({
        quizId: q.id,
        title: q.title,
        attempts: q.attempts.length,
        averagePercentage: q.attempts.length ? Math.round(q.attempts.reduce((n, a) => n + (a.percentage ?? 0), 0) / q.attempts.length) : null,
        passRate: q.attempts.length ? Math.round((q.attempts.filter((a) => a.passed).length / q.attempts.length) * 100) : null,
      })),
      learners: enrollments.map((e) => ({
        userId: e.user.id,
        name: personName(e.user),
        email: e.user.email,
        role: e.user.role.name,
        status: e.status,
        progressPercent: e.progressPercent,
        enrolledAt: e.enrolledAt,
        completedAt: e.completedAt,
        lastActivityAt: lastByUser.get(e.user.id) ?? null,
      })),
    };
  },
};
