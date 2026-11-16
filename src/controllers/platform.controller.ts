import type { Request, Response } from 'express';
import { actorFrom } from '../middleware/authorize';
import { analyticsService } from '../services/analytics.service';
import { healthService } from '../services/health.service';
import { notificationService } from '../services/notification.service';
import { settingsService } from '../services/settings.service';
import { getRequestContext } from '../utils/requestContext';
import type { PaginationInput } from '../utils/pagination';

export const healthController = {
  liveness(_req: Request, res: Response) {
    res.json(healthService.liveness());
  },

  async readiness(_req: Request, res: Response) {
    const result = await healthService.readiness();
    res.status(result.ready ? 200 : 503).json(result);
  },
};

export const analyticsController = {
  async admin(_req: Request, res: Response) {
    res.json(await analyticsService.adminDashboard());
  },

  async executive(_req: Request, res: Response) {
    res.json(await analyticsService.executiveDashboard());
  },

  async me(req: Request, res: Response) {
    res.json(await analyticsService.personalDashboard(actorFrom(req).id));
  },
};

export const settingsController = {
  async list(_req: Request, res: Response) {
    res.json(await settingsService.list());
  },

  async update(req: Request, res: Response) {
    res.json(await settingsService.update(req.params.key, req.body.value, actorFrom(req), getRequestContext(req)));
  },
};

export const notificationController = {
  async list(req: Request, res: Response) {
    const query = req.query as unknown as PaginationInput & { unreadOnly: boolean };
    res.json(await notificationService.list(actorFrom(req).id, query));
  },

  async unreadCount(req: Request, res: Response) {
    res.json({ unread: await notificationService.unreadCount(actorFrom(req).id) });
  },

  async markRead(req: Request, res: Response) {
    await notificationService.markRead(actorFrom(req).id, req.params.id);
    res.status(204).end();
  },

  async markAllRead(req: Request, res: Response) {
    res.json({ updated: await notificationService.markAllRead(actorFrom(req).id) });
  },
};
