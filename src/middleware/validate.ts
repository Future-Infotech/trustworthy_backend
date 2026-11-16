import type { RequestHandler } from 'express';
import type { ZodTypeAny } from 'zod';
import { Errors } from '../utils/errors';

type Source = 'body' | 'query' | 'params';

/**
 * Validates and coerces a request part with a Zod schema. The parsed value
 * replaces the original so handlers only see validated, typed input.
 */
export function validate(schema: ZodTypeAny, source: Source = 'body'): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return next(
        Errors.validation(result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message, code: i.code }))),
      );
    }
    if (source === 'query') {
      Object.defineProperty(req, 'query', { value: result.data, writable: true, configurable: true, enumerable: true });
    } else {
      req[source] = result.data;
    }
    next();
  };
}
