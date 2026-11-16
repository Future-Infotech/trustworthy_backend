import { Router } from 'express';
import { authController } from '../controllers/auth.controller';
import { authenticate } from '../middleware/authenticate';
import { csrfGuard } from '../middleware/csrf';
import { authRateLimit } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { changePasswordSchema, loginSchema, registerSchema } from '../validators/auth.validators';

export const authRouter = Router();

authRouter.get('/registration-options', asyncHandler(authController.registrationOptions));
authRouter.post('/register', authRateLimit, validate(registerSchema), asyncHandler(authController.register));
authRouter.post('/login', authRateLimit, validate(loginSchema), asyncHandler(authController.login));
authRouter.post('/refresh', csrfGuard, asyncHandler(authController.refresh));
authRouter.post('/logout', csrfGuard, asyncHandler(authController.logout));
authRouter.get('/me', authenticate, asyncHandler(authController.me));
authRouter.post(
  '/change-password',
  authenticate,
  authRateLimit,
  validate(changePasswordSchema),
  asyncHandler(authController.changePassword),
);
