import type { Request, Response } from 'express';
import { authContext } from '../middleware/authorize';
import { certificateService as svc } from '../services/certificate.service';
import { sendFile } from '../utils/sendFile';
import type { ListCertificatesQuery } from '../validators/certificate.validators';

export const certificateController = {
  eligibility: async (req: Request, res: Response) => res.json(await svc.eligibility(authContext(req), req.query.courseId as string | undefined)),
  request: async (req: Request, res: Response) => res.status(201).json(await svc.request(authContext(req), req.body.courseId)),
  list: async (req: Request, res: Response) => res.json(await svc.list(authContext(req), req.query as unknown as ListCertificatesQuery)),
  get: async (req: Request, res: Response) => res.json(await svc.get(authContext(req), req.params.id)),
  approve: async (req: Request, res: Response) => res.json(await svc.approve(authContext(req), req.params.id, req.body.comment)),
  decline: async (req: Request, res: Response) => {
    await svc.decline(authContext(req), req.params.id, req.body.reason);
    res.status(204).end();
  },
  revoke: async (req: Request, res: Response) => res.json(await svc.revoke(authContext(req), req.params.id, req.body.reason)),
  history: async (req: Request, res: Response) => res.json(await svc.history(authContext(req), req.params.id)),
  pdf: async (req: Request, res: Response) => {
    const file = await svc.pdf(authContext(req), req.params.id);
    sendFile(res, file.body, file.fileName, file.contentType);
  },
  verify: async (req: Request, res: Response) => res.json(await svc.verify(req.params.code)),
};
