import { Router } from 'express';
import { datasetRouter, experimentRouter, modelRouter, modelVersionRouter } from './aiAssets.routes';
import { impactAssessmentRouter, riskAssessmentRouter } from './assessment.routes';
import { assignmentRouter, submissionRouter } from './assignment.routes';
import { auditLogRouter } from './auditLog.routes';
import { authRouter } from './auth.routes';
import { certificateRouter, verifyRouter } from './certificate.routes';
import {
  courseRouter,
  labAttemptRouter,
  labRouter,
  lessonRouter,
  moduleRouter,
  questionRouter,
  quizAttemptRouter,
  quizRouter,
} from './learning.routes';
import { governanceRouter } from './governance.routes';
import { modelCardRouter } from './modelCard.routes';
import { analyticsRouter, healthRouter, notificationRouter, settingsRouter } from './platform.routes';
import { reportRouter } from './report.routes';
import { roleRouter, userRouter } from './user.routes';

export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/users', userRouter);
apiRouter.use('/roles', roleRouter);
apiRouter.use('/audit-logs', auditLogRouter);
apiRouter.use('/analytics', analyticsRouter);
apiRouter.use('/settings', settingsRouter);
apiRouter.use('/notifications', notificationRouter);

apiRouter.use('/courses', courseRouter);
apiRouter.use('/modules', moduleRouter);
apiRouter.use('/lessons', lessonRouter);
apiRouter.use('/quizzes', quizRouter);
apiRouter.use('/quiz-attempts', quizAttemptRouter);
apiRouter.use('/questions', questionRouter);
apiRouter.use('/labs', labRouter);
apiRouter.use('/lab-attempts', labAttemptRouter);
apiRouter.use('/assignments', assignmentRouter);
apiRouter.use('/submissions', submissionRouter);
apiRouter.use('/certificates', certificateRouter);
apiRouter.use('/verify', verifyRouter);
apiRouter.use('/reports', reportRouter);

apiRouter.use('/datasets', datasetRouter);
apiRouter.use('/models', modelRouter);
apiRouter.use('/model-versions', modelVersionRouter);
apiRouter.use('/experiments', experimentRouter);
apiRouter.use('/model-cards', modelCardRouter);
apiRouter.use('/risk-assessments', riskAssessmentRouter);
apiRouter.use('/impact-assessments', impactAssessmentRouter);
apiRouter.use('/governance', governanceRouter);
