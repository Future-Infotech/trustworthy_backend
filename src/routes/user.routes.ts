import { Router } from 'express';
import { roleController } from '../controllers/role.controller';
import { userController } from '../controllers/user.controller';
import { authenticate } from '../middleware/authenticate';
import { requirePermission } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { PERMISSIONS } from '../rbac/permissions';
import { asyncHandler } from '../utils/asyncHandler';
import { idParam } from '../validators/common.validators';
import { createUserSchema, deleteUserSchema, listUsersQuery, updateUserSchema } from '../validators/user.validators';

export const userRouter = Router();
userRouter.use(authenticate);

userRouter.get('/', requirePermission(PERMISSIONS.USERS_READ), validate(listUsersQuery, 'query'), asyncHandler(userController.list));
userRouter.post('/', requirePermission(PERMISSIONS.USERS_MANAGE), validate(createUserSchema), asyncHandler(userController.create));
userRouter.get('/:id', requirePermission(PERMISSIONS.USERS_READ), validate(idParam, 'params'), asyncHandler(userController.get));
userRouter.patch(
  '/:id',
  requirePermission(PERMISSIONS.USERS_MANAGE),
  validate(idParam, 'params'),
  validate(updateUserSchema),
  asyncHandler(userController.update),
);
userRouter.delete(
  '/:id',
  requirePermission(PERMISSIONS.USERS_MANAGE),
  validate(idParam, 'params'),
  validate(deleteUserSchema),
  asyncHandler(userController.remove),
);

export const roleRouter = Router();
roleRouter.get('/', authenticate, requirePermission(PERMISSIONS.ROLES_READ), asyncHandler(roleController.list));
