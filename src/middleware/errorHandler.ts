import { Prisma } from '@prisma/client';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { isProduction } from '../config/env';
import { logger } from '../config/logger';
import { AppError, Errors } from '../utils/errors';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.path} not found`));
};

function normalise(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return Errors.conflict('A record with these unique values already exists');
    if (err.code === 'P2025') return Errors.notFound();
    if (err.code === 'P2003') return Errors.badRequest('Referenced record does not exist');
  }
  if (err instanceof SyntaxError && 'body' in err) return Errors.badRequest('Malformed JSON body');
  if (typeof err === 'object' && err && 'type' in err && (err as { type: string }).type === 'entity.too.large') {
    return new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  }
  return new AppError(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const appError = normalise(err);
  const log = appError.statusCode >= 500 ? logger.error.bind(logger) : logger.warn.bind(logger);
  log(
    { err: appError.statusCode >= 500 ? err : undefined, code: appError.code, requestId: req.id, path: req.path, method: req.method },
    appError.message,
  );
  res.status(appError.statusCode).json({
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details !== undefined ? { details: appError.details } : {}),
      requestId: req.id,
      ...(!isProduction && appError.statusCode >= 500 && err instanceof Error ? { debug: err.message } : {}),
    },
  });
};
