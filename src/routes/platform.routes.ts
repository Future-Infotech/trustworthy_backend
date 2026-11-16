import { Router } from 'express';
import {
  analyticsController,
  healthController,
  notificationController,
  settingsController,
} from '../controllers/platform.controller';
import { authenticate } from '../middleware/authenticate';
import { requirePermission } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { PERMISSIONS } from '../rbac/permissions';
import { asyncHandler } from '../utils/asyncHandler';
import { idParam, listNotificationsQuery, settingKeyParam, updateSettingSchema } from '../validators/common.validators';

export const healthRouter = Router();
healthRouter.get('/', healthController.liveness);
healthRouter.get('/ready', asyncHandler(healthController.readiness));

export const analyticsRouter = Router();
analyticsRouter.use(authenticate);
analyticsRouter.get('/admin-dashboard', requirePermission(PERMISSIONS.ANALYTICS_ADMIN), asyncHandler(analyticsController.admin));
analyticsRouter.get(
  '/executive-dashboard',
  requirePermission(PERMISSIONS.ANALYTICS_EXECUTIVE),
  asyncHandler(analyticsController.executive),
);
analyticsRouter.get('/me', asyncHandler(analyticsController.me));

export const settingsRouter = Router();
settingsRouter.use(authenticate);
settingsRouter.get('/', requirePermission(PERMISSIONS.SETTINGS_READ), asyncHandler(settingsController.list));
settingsRouter.patch(
  '/:key',
  requirePermission(PERMISSIONS.SETTINGS_MANAGE),
  validate(settingKeyParam, 'params'),
  validate(updateSettingSchema),
  asyncHandler(settingsController.update),
);

export const notificationRouter = Router();
notificationRouter.use(authenticate, requirePermission(PERMISSIONS.NOTIFICATIONS_READ));
notificationRouter.get('/', validate(listNotificationsQuery, 'query'), asyncHandler(notificationController.list));
notificationRouter.get('/unread-count', asyncHandler(notificationController.unreadCount));
notificationRouter.post('/read-all', asyncHandler(notificationController.markAllRead));
notificationRouter.patch('/:id/read', validate(idParam, 'params'), asyncHandler(notificationController.markRead));
