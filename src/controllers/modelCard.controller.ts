import type { Request, Response } from 'express';
import { authContext } from '../middleware/authorize';
import { modelCardService } from '../services/modelCard.service';
import { sendFile } from '../utils/sendFile';
import type { ListModelCardsQuery } from '../validators/modelCard.validators';

export const modelCardController = {
  list: async (req: Request, res: Response) => res.json(await modelCardService.list(authContext(req), req.query as unknown as ListModelCardsQuery)),
  prefill: async (req: Request, res: Response) => res.json(await modelCardService.prefill(String(req.query.modelId), req.query.versionId as string | undefined)),
  get: async (req: Request, res: Response) => res.json(await modelCardService.get(authContext(req), req.params.id)),
  create: async (req: Request, res: Response) => res.status(201).json(await modelCardService.create(authContext(req), req.body)),
  update: async (req: Request, res: Response) => res.json(await modelCardService.update(authContext(req), req.params.id, req.body)),
  submit: async (req: Request, res: Response) => res.json(await modelCardService.submit(authContext(req), req.params.id)),
  withdraw: async (req: Request, res: Response) => res.json(await modelCardService.withdraw(authContext(req), req.params.id)),
  review: async (req: Request, res: Response) => res.json(await modelCardService.review(authContext(req), req.params.id, req.body)),
  newVersion: async (req: Request, res: Response) => res.status(201).json(await modelCardService.newVersion(authContext(req), req.params.id, req.body.version)),
  archive: async (req: Request, res: Response) => res.json(await modelCardService.archive(authContext(req), req.params.id, req.body.reason)),
  remove: async (req: Request, res: Response) => {
    await modelCardService.remove(authContext(req), req.params.id);
    res.status(204).end();
  },
  versions: async (req: Request, res: Response) => res.json(await modelCardService.versions(authContext(req), req.params.id)),
  history: async (req: Request, res: Response) => res.json(await modelCardService.history(authContext(req), req.params.id)),
  export: async (req: Request, res: Response) => {
    const { body, fileName, contentType } = await modelCardService.export(authContext(req), req.params.id, req.query.format as 'json' | 'md' | 'pdf');
    sendFile(res, body, fileName, contentType);
  },
};
