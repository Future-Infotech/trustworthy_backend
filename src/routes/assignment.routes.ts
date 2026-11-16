import { Router } from 'express';
import { assignmentController as a, submissionController as s } from '../controllers/assignment.controller';
import { authenticate } from '../middleware/authenticate';
import { requireAnyPermission, requirePermission } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { PERMISSIONS as P } from '../rbac/permissions';
import { asyncHandler as h } from '../utils/asyncHandler';
import {
  createAssignmentSchema,
  gradeSubmissionSchema,
  listAssignmentsQuery,
  listSubmissionsQuery,
  submitAssignmentSchema,
  updateAssignmentSchema,
} from '../validators/assignment.validators';
import { idParam } from '../validators/common.validators';

const id = validate(idParam, 'params');
const manage = requirePermission(P.ASSIGNMENTS_MANAGE);
const grade = requirePermission(P.ASSIGNMENTS_GRADE);

export const assignmentRouter = Router();
assignmentRouter.use(authenticate, requireAnyPermission(P.ASSIGNMENTS_SUBMIT, P.ASSIGNMENTS_MANAGE, P.ASSIGNMENTS_GRADE));
assignmentRouter.get('/', validate(listAssignmentsQuery, 'query'), h(a.list));
assignmentRouter.post('/', manage, validate(createAssignmentSchema), h(a.create));
assignmentRouter.get('/:id', id, h(a.get));
assignmentRouter.patch('/:id', manage, id, validate(updateAssignmentSchema), h(a.update));
assignmentRouter.get('/:id/history', requireAnyPermission(P.ASSIGNMENTS_MANAGE, P.ASSIGNMENTS_GRADE), id, h(a.history));
assignmentRouter.post('/:id/submissions', requirePermission(P.ASSIGNMENTS_SUBMIT), id, validate(submitAssignmentSchema), h(a.submit));
assignmentRouter.get('/:id/submissions', grade, id, validate(listSubmissionsQuery, 'query'), h(a.listSubmissions));

export const submissionRouter = Router();
submissionRouter.use(authenticate, requireAnyPermission(P.ASSIGNMENTS_SUBMIT, P.ASSIGNMENTS_GRADE));
submissionRouter.get('/:id', id, h(s.get));
submissionRouter.post('/:id/grade', grade, id, validate(gradeSubmissionSchema), h(s.grade));
