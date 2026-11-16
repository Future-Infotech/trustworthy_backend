import { Router } from 'express';
import { reportController as c } from '../controllers/report.controller';
import { authenticate } from '../middleware/authenticate';
import { requirePermission } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { PERMISSIONS as P } from '../rbac/permissions';
import { asyncHandler as h } from '../utils/asyncHandler';
import { reportFormatQuery, reportParams, reportSourcesQuery } from '../validators/report.validators';

export const reportRouter = Router();
reportRouter.use(authenticate, requirePermission(P.REPORTS_GENERATE));
reportRouter.get('/sources', validate(reportSourcesQuery, 'query'), h(c.sources));
reportRouter.get('/:type/:id', validate(reportParams, 'params'), validate(reportFormatQuery, 'query'), h(c.generate));
