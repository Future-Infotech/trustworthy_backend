import type { RequestHandler } from 'express';
import { env } from '../config/env';
import { Errors } from '../utils/errors';

export const CSRF_HEADER = 'x-csrf-protection';

/**
 * CSRF defence for endpoints authenticated by the refresh-token cookie
 * (refresh / logout). Bearer-token endpoints are not CSRF-prone.
 *
 * 1. The cookie is SameSite=Strict and scoped to /api/auth.
 * 2. A custom header is required, which cross-site forms cannot send and
 *    cross-origin scripts can only send after a CORS preflight we reject.
 * 3. If an Origin header is present it must be an allowed origin.
 */
export const csrfGuard: RequestHandler = (req, _res, next) => {
  if (req.get(CSRF_HEADER) !== '1') return next(Errors.forbidden('Missing CSRF protection header'));
  const origin = req.get('origin');
  if (origin && !env.CORS_ORIGINS.includes(origin)) return next(Errors.forbidden('Origin not allowed'));
  next();
};
