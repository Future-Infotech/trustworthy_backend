import type { Prisma } from '@prisma/client';
import { prisma, type DbClient } from '../config/prisma';

export const settingRepository = {
  findAll() {
    return prisma.systemSetting.findMany();
  },

  findByKey(key: string, db: DbClient = prisma) {
    return db.systemSetting.findUnique({ where: { key } });
  },

  upsert(key: string, value: Prisma.InputJsonValue, description: string, updatedById: string | null, db: DbClient = prisma) {
    return db.systemSetting.upsert({
      where: { key },
      create: { key, value, description, updatedById },
      update: { value, updatedById },
    });
  },
};
