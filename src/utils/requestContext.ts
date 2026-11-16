import type { Request } from 'express';

export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

export function getRequestContext(req: Request): RequestContext {
  return {
    ip: req.ip ?? req.socket?.remoteAddress ?? null,
    userAgent: req.get('user-agent')?.slice(0, 512) ?? null,
    requestId: req.id ? String(req.id) : null,
  };
}
