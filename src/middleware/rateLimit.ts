import type { RequestHandler } from 'express';
import rateLimit, { type Options } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { env, isTest } from '../config/env';
import { getRedis } from '../config/redis';

function store(prefix: string): Options['store'] | undefined {
  const redis = getRedis();
  if (!redis) return undefined;
  return new RedisStore({
    prefix: `rl:${prefix}:`,
    sendCommand: (...args: string[]) => redis.call(args[0], ...args.slice(1)) as never,
  });
}

const handler: Options['handler'] = (_req, res, _next, options) => {
  res.status(options.statusCode).json({
    error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later' },
  });
};

function limiter(prefix: string, max: number, extra: Partial<Options> = {}): RequestHandler {
  return rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    store: store(prefix),
    handler,
    skip: () => isTest && process.env.ENABLE_RATE_LIMIT_IN_TESTS !== 'true',
    ...extra,
  });
}

/** Global per-IP limit for the whole API. */
export const apiRateLimit = limiter('api', env.RATE_LIMIT_MAX);

/** Unauthenticated certificate verification: enough for real lookups, too few to enumerate codes. */
export const verifyRateLimit = limiter('verify', 60);

/** Stricter limit for credential endpoints, keyed by IP + submitted email. */
export const authRateLimit = limiter('auth', env.AUTH_RATE_LIMIT_MAX, {
  keyGenerator: (req) => `${req.ip}:${String(req.body?.email ?? '').toLowerCase().slice(0, 254)}`,
});
