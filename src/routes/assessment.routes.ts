import { Router, type Request, type Response } from 'express';
import { impactAssessmentController as aia, riskAssessmentController as risk } from '../controllers/assessment.controller';
import { authenticate } from '../middleware/authenticate';
import { requirePermission } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { PERMISSIONS as P, type Permission } from '../rbac/permissions';
import { asyncHandler as h } from '../utils/asyncHandler';
import {
  createAiaSchema,
  createRiskAssessmentSchema,
  listAssessmentsQuery,
  listRiskAssessmentsQuery,
  reviewDecisionSchema,
  scoreRiskSchema,
  updateAiaSchema,
  updateRiskAssessmentSchema,
} from '../validators/assessment.validators';
import { idParam, reasonSchema } from '../validators/common.validators';
import { exportQuery } from '../validators/modelCard.validators';

const id = validate(idParam, 'params');

type Handler = (req: Request, res: Response) => Promise<unknown>;
type WorkflowController = Record<'get' | 'submit' | 'withdraw' | 'startReview' | 'review' | 'retire' | 'remove' | 'history' | 'export', Handler>;

/** Routes shared by every reviewed assessment: author actions need `author`, decisions need `reviewer`. */
function workflowRoutes(router: Router, c: WorkflowController, author: Permission, reviewer: Permission) {
  router.get('/:id', id, h(c.get));
  router.delete('/:id', requirePermission(author), id, h(c.remove));
  router.post('/:id/submit', requirePermission(author), id, h(c.submit));
  router.post('/:id/withdraw', requirePermission(author), id, h(c.withdraw));
  router.post('/:id/start-review', requirePermission(reviewer), id, h(c.startReview));
  router.post('/:id/review', requirePermission(reviewer), id, validate(reviewDecisionSchema), h(c.review));
  router.post('/:id/retire', requirePermission(reviewer), id, validate(reasonSchema), h(c.retire));
  router.get('/:id/history', id, h(c.history));
  router.get('/:id/export', id, validate(exportQuery, 'query'), h(c.export));
}

export const riskAssessmentRouter = Router();
riskAssessmentRouter.use(authenticate, requirePermission(P.RISK_READ));
riskAssessmentRouter.get('/', validate(listRiskAssessmentsQuery, 'query'), h(risk.list));
riskAssessmentRouter.post('/score', requirePermission(P.RISK_ASSESS), validate(scoreRiskSchema), h(risk.score));
riskAssessmentRouter.post('/', requirePermission(P.RISK_ASSESS), validate(createRiskAssessmentSchema), h(risk.create));
riskAssessmentRouter.patch('/:id', requirePermission(P.RISK_ASSESS), id, validate(updateRiskAssessmentSchema), h(risk.update));
workflowRoutes(riskAssessmentRouter, risk, P.RISK_ASSESS, P.RISK_REVIEW);

export const impactAssessmentRouter = Router();
impactAssessmentRouter.use(authenticate, requirePermission(P.AIA_READ));
impactAssessmentRouter.get('/', validate(listAssessmentsQuery, 'query'), h(aia.list));
impactAssessmentRouter.post('/', requirePermission(P.AIA_MANAGE), validate(createAiaSchema), h(aia.create));
impactAssessmentRouter.patch('/:id', requirePermission(P.AIA_MANAGE), id, validate(updateAiaSchema), h(aia.update));
workflowRoutes(impactAssessmentRouter, aia, P.AIA_MANAGE, P.AIA_APPROVE);
