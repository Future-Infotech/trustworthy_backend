import type { NotificationType, Prisma } from '@prisma/client';
import { prisma, type DbClient } from '../config/prisma';

export const notificationRepository = {
  async listForUser(userId: string, unreadOnly: boolean, skip: number, take: number) {
    const where: Prisma.NotificationWhereInput = { userId, ...(unreadOnly ? { readAt: null } : {}) };
    const [items, total, unread] = await prisma.$transaction([
      prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return { items, total, unread };
  },

  countUnread(userId: string) {
    return prisma.notification.count({ where: { userId, readAt: null } });
  },

  async existsForUser(userId: string, id: string) {
    return (await prisma.notification.count({ where: { id, userId } })) > 0;
  },

  markRead(userId: string, id: string) {
    return prisma.notification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: new Date() } });
  },

  markAllRead(userId: string) {
    return prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
  },

  create(
    data: { userId: string; type: NotificationType; title: string; message: string; link?: string; metadata?: Prisma.InputJsonValue },
    db: DbClient = prisma,
  ) {
    return db.notification.create({ data });
  },
};
