import type { NotificationType, Prisma } from '@prisma/client';
import { logger } from '../config/logger';
import type { DbClient } from '../config/prisma';
import { notificationRepository } from '../repositories/notification.repository';
import { Errors } from '../utils/errors';
import { paginate, toSkipTake, type PaginationInput } from '../utils/pagination';

export interface NotificationInput {
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  metadata?: Prisma.InputJsonValue;
}

export const notificationService = {
  async list(userId: string, query: PaginationInput & { unreadOnly: boolean }) {
    const { skip, take } = toSkipTake(query);
    const { items, total, unread } = await notificationRepository.listForUser(userId, query.unreadOnly, skip, take);
    return { ...paginate(items, total, query), unread };
  },

  unreadCount(userId: string) {
    return notificationRepository.countUnread(userId);
  },

  async markRead(userId: string, id: string) {
    const { count } = await notificationRepository.markRead(userId, id);
    if (count === 0 && !(await notificationRepository.existsForUser(userId, id))) {
      throw Errors.notFound('Notification');
    }
  },

  async markAllRead(userId: string) {
    const { count } = await notificationRepository.markAllRead(userId);
    return count;
  },

  /** Creates an in-app notification. Delivery failures never break the triggering action. */
  async notify(userId: string, input: NotificationInput, db?: DbClient) {
    try {
      await notificationRepository.create({ userId, ...input }, db);
    } catch (err) {
      if (db) throw err;
      logger.error({ err, userId, type: input.type }, 'failed to create notification');
    }
  },

  /** Notifies every active user whose role grants `permission` (e.g. the reviewers of a workflow). */
  async notifyPermissionHolders(permission: string, input: NotificationInput, db: DbClient, options: { exclude?: string[] } = {}) {
    const users = await db.user.findMany({
      where: { status: 'ACTIVE', id: { notIn: options.exclude ?? [] }, role: { permissions: { some: { permission: { key: permission } } } } },
      select: { id: true },
    });
    for (const u of users) await this.notify(u.id, input, db);
    return users.length;
  },
};
