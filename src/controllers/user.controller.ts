import type { Request, Response } from 'express';
import { actorFrom } from '../middleware/authorize';
import { userService } from '../services/user.service';
import { getRequestContext } from '../utils/requestContext';
import type { ListUsersQuery } from '../validators/user.validators';

export const userController = {
  async list(req: Request, res: Response) {
    res.json(await userService.list(req.query as unknown as ListUsersQuery));
  },

  async get(req: Request, res: Response) {
    res.json(await userService.get(req.params.id));
  },

  async create(req: Request, res: Response) {
    res.status(201).json(await userService.create(actorFrom(req), req.body, getRequestContext(req)));
  },

  async update(req: Request, res: Response) {
    res.json(await userService.update(actorFrom(req), req.params.id, req.body, getRequestContext(req)));
  },

  async remove(req: Request, res: Response) {
    await userService.remove(actorFrom(req), req.params.id, req.body?.reason, getRequestContext(req));
    res.status(204).end();
  },
};
