import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { seedRbac } from '../prisma/seed-data/rbac';
import { applyTestEnv, TEST_DATABASE_URL } from './test-env';

/**
 * Recreates the test database schema from migrations and synchronises RBAC.
 * Set SKIP_DB_SETUP=1 to run pure unit tests without a database.
 */
export default async function setup() {
  if (process.env.SKIP_DB_SETUP === '1') return;
  applyTestEnv();
  execSync('npx prisma migrate reset --force --skip-seed --skip-generate', {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'pipe',
  });
  const prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
  try {
    await seedRbac(prisma);
  } finally {
    await prisma.$disconnect();
  }
}
