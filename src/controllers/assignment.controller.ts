import type { Request, Response } from 'express';
import { authContext } from '../middleware/authorize';
import { assignmentService as svc } from '../services/assignment.service';
import type { ListAssignmentsQuery, ListSubmissionsQuery } from '../validators/assignment.validators';

export const assignmentController = {
  list: async (req: Request, res: Response) => res.json(await svc.list(authContext(req), req.query as unknown as ListAssignmentsQuery)),
  get: async (req: Request, res: Response) => res.json(await svc.get(authContext(req), req.params.id)),
  create: async (req: Request, res: Response) => res.status(201).json(await svc.create(authContext(req), req.body)),
  update: async (req: Request, res: Response) => res.json(await svc.update(authContext(req), req.params.id, req.body)),
  history: async (req: Request, res: Response) => res.json(await svc.history(authContext(req), req.params.id)),
  submit: async (req: Request, res: Response) => res.status(201).json(await svc.submit(authContext(req), req.params.id, req.body)),
  listSubmissions: async (req: Request, res: Response) =>
    res.json(await svc.listSubmissions(authContext(req), req.params.id, req.query as unknown as ListSubmissionsQuery)),
};

export const submissionController = {
  get: async (req: Request, res: Response) => res.json(await svc.getSubmission(authContext(req), req.params.id)),
  grade: async (req: Request, res: Response) => res.json(await svc.grade(authContext(req), req.params.id, req.body)),
};
