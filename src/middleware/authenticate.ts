import type { RequestHandler } from 'express';
import { userRepository } from '../repositories/user.repository';
import { permissionService } from '../services/permission.service';
import { tokenService } from '../services/token.service';
import { asyncHandler } from '../utils/asyncHandler';
import { Errors } from '../utils/errors';

/**
 * Verifies the bearer access token and loads the current user.
 * The user's status and role are re-read on every request so suspensions and
 * role changes take effect immediately rather than when the token expires.
 */
export const authenticate: RequestHandler = asyncHandler(async (req, _res, next) => {
  const header = req.get('authorization');
  if (!header?.startsWith('Bearer ')) throw Errors.unauthorized();
  const claims = tokenService.verifyAccessToken(header.slice(7).trim());

  const user = await userRepository.findById(claims.sub);
  if (!user || user.status !== 'ACTIVE') throw Errors.unauthorized('Account is not active');
  if (user.passwordChangedAt && claims.iat < Math.floor(user.passwordChangedAt.getTime() / 1000)) {
    throw Errors.unauthorized('Session invalidated by password change');
  }

  req.user = {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role.name,
    permissions: await permissionService.forRole(user.role.name),
  };
  next();
});
