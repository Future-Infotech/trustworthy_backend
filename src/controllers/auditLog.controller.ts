import type { Request, Response } from 'express';
import { actorFrom } from '../middleware/authorize';
import { auditLogService } from '../services/auditLog.service';
import { getRequestContext } from '../utils/requestContext';
import type { ExportAuditLogsQuery, ListAuditLogsQuery } from '../validators/auditLog.validators';

export const auditLogController = {
  async list(req: Request, res: Response) {
    res.json(await auditLogService.list(req.query as unknown as ListAuditLogsQuery));
  },

  async facets(_req: Request, res: Response) {
    res.json(await auditLogService.facets());
  },

  async get(req: Request, res: Response) {
    res.json(await auditLogService.get(req.params.id));
  },

  async export(req: Request, res: Response) {
    const file = await auditLogService.export(req.query as unknown as ExportAuditLogsQuery, actorFrom(req), getRequestContext(req));
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    res.setHeader('Content-Type', `${file.contentType}; charset=utf-8`);
    res.setHeader('Content-Disposition', `attachment; filename="audit-logs-${stamp}.${file.extension}"`);
    res.send(file.body);
  },
};
