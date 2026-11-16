import type { Request, RequestHandler } from 'express';
import type { Permission } from '../rbac/permissions';
import { auditService, type AuditActor } from '../services/audit.service';
import { asyncHandler } from '../utils/asyncHandler';
import { Errors } from '../utils/errors';
import { getRequestContext, type RequestContext } from '../utils/requestContext';

export function actorFrom(req: Request): AuditActor {
  if (!req.user) throw Errors.unauthorized();
  return { id: req.user.id, email: req.user.email, role: req.user.role };
}

/** Everything a service needs to authorise and audit an action on behalf of the caller. */
export interface AuthContext {
  actor: AuditActor;
  ctx: RequestContext;
  can(permission: Permission): boolean;
}

export function authContext(req: Request): AuthContext {
  const actor = actorFrom(req);
  const granted = req.user!.permissions;
  return { actor, ctx: getRequestContext(req), can: (p) => granted.has(p) };
}

function guard(mode: 'all' | 'any', permissions: Permission[]): RequestHandler {
  return asyncHandler(async (req, _res, next) => {
    if (!req.user) throw Errors.unauthorized();
    const granted = req.user.permissions;
    const ok = mode === 'all' ? permissions.every((p) => granted.has(p)) : permissions.some((p) => granted.has(p));
    if (ok) return next();

    await auditService.record({
      action: 'access.denied',
      resource: 'endpoint',
      resourceId: `${req.method} ${req.baseUrl}${req.route?.path ?? req.path}`,
      actor: actorFrom(req),
      context: getRequestContext(req),
      result: 'DENIED',
      severity: 'MEDIUM',
      reason: `Missing permission(s): ${permissions.filter((p) => !granted.has(p)).join(', ')}`,
    });
    throw Errors.forbidden();
  });
}

/** Requires every listed permission. */
export const requirePermission = (...permissions: Permission[]) => guard('all', permissions);

/** Requires at least one of the listed permissions. */
export const requireAnyPermission = (...permissions: Permission[]) => guard('any', permissions);
