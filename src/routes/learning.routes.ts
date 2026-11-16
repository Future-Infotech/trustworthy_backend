import { Router } from 'express';
import { courseController as c, labController as l, quizController as q } from '../controllers/learning.controller';
import { authenticate } from '../middleware/authenticate';
import { requireAnyPermission, requirePermission } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { PERMISSIONS as P } from '../rbac/permissions';
import { asyncHandler as h } from '../utils/asyncHandler';
import { idParam } from '../validators/common.validators';
import {
  completeLabSchema,
  createCourseSchema,
  knowledgeCheckAnswerSchema,
  labSchema,
  lessonProgressSchema,
  lessonSchema,
  listCoursesQuery,
  listQuizzesQuery,
  moduleSchema,
  questionSchema,
  quizSchema,
  reorderSchema,
  submitQuizSchema,
  updateCourseSchema,
  updateLabSchema,
  updateLessonSchema,
  updateModuleSchema,
  updateQuestionSchema,
  updateQuizSchema,
} from '../validators/learning.validators';

const id = validate(idParam, 'params');
const manage = requirePermission(P.COURSES_MANAGE);

export const courseRouter = Router();
courseRouter.use(authenticate, requirePermission(P.COURSES_READ));
courseRouter.get('/', validate(listCoursesQuery, 'query'), h(c.list));
courseRouter.post('/', manage, validate(createCourseSchema), h(c.create));
courseRouter.get('/:id', id, h(c.get));
courseRouter.patch('/:id', manage, id, validate(updateCourseSchema), h(c.update));
courseRouter.post('/:id/enroll', requirePermission(P.PROGRESS_TRACK), id, h(c.enroll));
courseRouter.get('/:id/analytics', requirePermission(P.ANALYTICS_LEARNING), id, h(c.analytics));
courseRouter.post('/:id/modules', manage, id, validate(moduleSchema), h(c.addModule));
courseRouter.put('/:id/modules/order', manage, id, validate(reorderSchema), h(c.reorderModules));

export const moduleRouter = Router();
moduleRouter.use(authenticate, manage);
moduleRouter.patch('/:id', id, validate(updateModuleSchema), h(c.updateModule));
moduleRouter.delete('/:id', id, h(c.deleteModule));
moduleRouter.post('/:id/lessons', id, validate(lessonSchema), h(c.addLesson));
moduleRouter.put('/:id/lessons/order', id, validate(reorderSchema), h(c.reorderLessons));

export const lessonRouter = Router();
lessonRouter.use(authenticate, requirePermission(P.COURSES_READ));
lessonRouter.get('/:id', id, h(c.getLesson));
lessonRouter.patch('/:id', manage, id, validate(updateLessonSchema), h(c.updateLesson));
lessonRouter.delete('/:id', manage, id, h(c.deleteLesson));
lessonRouter.post('/:id/progress', requirePermission(P.PROGRESS_TRACK), id, validate(lessonProgressSchema), h(c.recordProgress));
lessonRouter.post('/:id/knowledge-check', id, validate(knowledgeCheckAnswerSchema), h(c.knowledgeCheck));

const quizManage = requirePermission(P.QUIZZES_MANAGE);

export const quizRouter = Router();
quizRouter.use(authenticate, requireAnyPermission(P.QUIZZES_TAKE, P.QUIZZES_MANAGE));
quizRouter.get('/', validate(listQuizzesQuery, 'query'), h(q.list));
quizRouter.post('/', quizManage, validate(quizSchema), h(q.create));
quizRouter.get('/:id', id, h(q.get));
quizRouter.patch('/:id', quizManage, id, validate(updateQuizSchema), h(q.update));
quizRouter.post('/:id/attempts', requirePermission(P.QUIZZES_TAKE), id, h(q.start));
quizRouter.post('/:id/questions', quizManage, id, validate(questionSchema), h(q.addQuestion));

export const quizAttemptRouter = Router();
quizAttemptRouter.use(authenticate, requirePermission(P.QUIZZES_TAKE));
quizAttemptRouter.get('/:id', id, h(q.viewAttempt));
quizAttemptRouter.post('/:id/submit', id, validate(submitQuizSchema), h(q.submit));

export const questionRouter = Router();
questionRouter.use(authenticate, quizManage);
questionRouter.patch('/:id', id, validate(updateQuestionSchema), h(q.updateQuestion));
questionRouter.delete('/:id', id, h(q.deactivateQuestion));

const labManage = requirePermission(P.LABS_MANAGE);

export const labRouter = Router();
labRouter.use(authenticate, requireAnyPermission(P.LABS_RUN, P.LABS_MANAGE));
labRouter.get('/', h(l.list));
labRouter.post('/', labManage, validate(labSchema), h(l.create));
labRouter.get('/:idOrSlug', h(l.get));
labRouter.patch('/:id', labManage, id, validate(updateLabSchema), h(l.update));
labRouter.post('/:id/attempts', requirePermission(P.LABS_RUN), id, h(l.start));

export const labAttemptRouter = Router();
labAttemptRouter.use(authenticate, requirePermission(P.LABS_RUN));
labAttemptRouter.post('/:id/complete', id, validate(completeLabSchema), h(l.complete));
