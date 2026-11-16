import type { Request, Response } from 'express';
import { authContext } from '../middleware/authorize';
import { reportService as svc } from '../services/report.service';
import { sendFile } from '../utils/sendFile';
import type { ReportFormat, ReportSourcesQuery, ReportType } from '../validators/report.validators';

export const reportController = {
  sources: async (req: Request, res: Response) => res.json(await svc.sources(authContext(req), req.query as unknown as ReportSourcesQuery)),
  generate: async (req: Request, res: Response) => {
    const file = await svc.generate(authContext(req), req.params.type as ReportType, req.params.id, req.query.format as ReportFormat);
    sendFile(res, file.body, file.fileName, file.contentType);
  },
};
