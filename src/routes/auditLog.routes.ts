import { Router } from 'express';
import { auditLogController } from '../controllers/auditLog.controller';
import { authenticate } from '../middleware/authenticate';
import { requirePermission } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { PERMISSIONS } from '../rbac/permissions';
import { asyncHandler } from '../utils/asyncHandler';
import { exportAuditLogsQuery, listAuditLogsQuery } from '../validators/auditLog.validators';
import { idParam } from '../validators/common.validators';

/** Read-only by design: there are no create, update or delete endpoints for audit logs. */
export const auditLogRouter = Router();
auditLogRouter.use(authenticate, requirePermission(PERMISSIONS.AUDIT_LOGS_READ));

auditLogRouter.get('/', validate(listAuditLogsQuery, 'query'), asyncHandler(auditLogController.list));
auditLogRouter.get('/facets', asyncHandler(auditLogController.facets));
auditLogRouter.get(
  '/export',
  requirePermission(PERMISSIONS.AUDIT_LOGS_EXPORT),
  validate(exportAuditLogsQuery, 'query'),
  asyncHandler(auditLogController.export),
);
auditLogRouter.get('/:id', validate(idParam, 'params'), asyncHandler(auditLogController.get));
