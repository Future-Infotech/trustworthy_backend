import { PrismaClient, type Prisma } from '@prisma/client';
import { isProduction } from './env';
import { logger } from './logger';

function createClient() {
  const client = new PrismaClient({
    log: [
      { level: 'warn', emit: 'event' },
      { level: 'error', emit: 'event' },
    ],
  });
  client.$on('warn', (e) => logger.warn({ prisma: e }, 'prisma warning'));
  client.$on('error', (e) => logger.error({ prisma: e }, 'prisma error'));
  return client;
}

const globalForPrisma = globalThis as unknown as { prisma?: ReturnType<typeof createClient> };

export const prisma = globalForPrisma.prisma ?? createClient();

if (!isProduction) globalForPrisma.prisma = prisma;

export type DbClient = typeof prisma | Prisma.TransactionClient;
