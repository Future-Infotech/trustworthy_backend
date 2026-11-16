import type { Request, Response } from 'express';
import { authContext } from '../middleware/authorize';
import { impactAssessmentService as aia } from '../services/impactAssessment.service';
import { riskAssessmentService as risk } from '../services/riskAssessment.service';
import { sendFile } from '../utils/sendFile';
import type { ListAssessmentsQuery, ListRiskAssessmentsQuery } from '../validators/assessment.validators';

type Format = 'json' | 'md' | 'pdf';

export const riskAssessmentController = {
  score: async (req: Request, res: Response) => res.json(risk.score(req.body.answers)),
  list: async (req: Request, res: Response) => res.json(await risk.list(authContext(req), req.query as unknown as ListRiskAssessmentsQuery)),
  get: async (req: Request, res: Response) => res.json(await risk.get(authContext(req), req.params.id)),
  create: async (req: Request, res: Response) => res.status(201).json(await risk.create(authContext(req), req.body)),
  update: async (req: Request, res: Response) => res.json(await risk.update(authContext(req), req.params.id, req.body)),
  submit: async (req: Request, res: Response) => res.json(await risk.submit(authContext(req), req.params.id)),
  withdraw: async (req: Request, res: Response) => res.json(await risk.withdraw(authContext(req), req.params.id)),
  startReview: async (req: Request, res: Response) => res.json(await risk.startReview(authContext(req), req.params.id)),
  review: async (req: Request, res: Response) => res.json(await risk.review(authContext(req), req.params.id, req.body)),
  retire: async (req: Request, res: Response) => res.json(await risk.retire(authContext(req), req.params.id, req.body.reason)),
  remove: async (req: Request, res: Response) => {
    await risk.remove(authContext(req), req.params.id);
    res.status(204).end();
  },
  history: async (req: Request, res: Response) => res.json(await risk.history(req.params.id)),
  export: async (req: Request, res: Response) => {
    const file = await risk.export(authContext(req), req.params.id, req.query.format as Format);
    sendFile(res, file.body, file.fileName, file.contentType);
  },
};

export const impactAssessmentController = {
  list: async (req: Request, res: Response) => res.json(await aia.list(authContext(req), req.query as unknown as ListAssessmentsQuery)),
  get: async (req: Request, res: Response) => res.json(await aia.get(authContext(req), req.params.id)),
  create: async (req: Request, res: Response) => res.status(201).json(await aia.create(authContext(req), req.body)),
  update: async (req: Request, res: Response) => res.json(await aia.update(authContext(req), req.params.id, req.body)),
  submit: async (req: Request, res: Response) => res.json(await aia.submit(authContext(req), req.params.id)),
  withdraw: async (req: Request, res: Response) => res.json(await aia.withdraw(authContext(req), req.params.id)),
  startReview: async (req: Request, res: Response) => res.json(await aia.startReview(authContext(req), req.params.id)),
  review: async (req: Request, res: Response) => res.json(await aia.review(authContext(req), req.params.id, req.body)),
  retire: async (req: Request, res: Response) => res.json(await aia.retire(authContext(req), req.params.id, req.body.reason)),
  remove: async (req: Request, res: Response) => {
    await aia.remove(authContext(req), req.params.id);
    res.status(204).end();
  },
  history: async (req: Request, res: Response) => res.json(await aia.history(req.params.id)),
  export: async (req: Request, res: Response) => {
    const file = await aia.export(authContext(req), req.params.id, req.query.format as Format);
    sendFile(res, file.body, file.fileName, file.contentType);
  },
};
