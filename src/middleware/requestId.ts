import type { RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';

const VALID_ID = /^[a-zA-Z0-9-]{8,64}$/;

/** Propagates an inbound X-Request-Id (e.g. from Nginx) or generates one. */
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.get('x-request-id');
  req.id = incoming && VALID_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
};
