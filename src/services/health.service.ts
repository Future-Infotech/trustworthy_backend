import { env } from '../config/env';
import { prisma } from '../config/prisma';
import { getRedis } from '../config/redis';

type CheckStatus = 'up' | 'down' | 'disabled';
interface Check {
  status: CheckStatus;
  latencyMs?: number;
  error?: string;
}

async function timed(fn: () => Promise<unknown>): Promise<Check> {
  const start = Date.now();
  try {
    await fn();
    return { status: 'up', latencyMs: Date.now() - start };
  } catch (err) {
    return { status: 'down', latencyMs: Date.now() - start, error: err instanceof Error ? err.message : 'unknown error' };
  }
}

export const healthService = {
  liveness() {
    return { status: 'ok', service: 'trustai-api', uptimeSeconds: Math.round(process.uptime()) };
  },

  /** Database is required; Redis and the ML service degrade gracefully. */
  async readiness() {
    const redis = getRedis();
    const [database, cache, mlService] = await Promise.all([
      timed(() => prisma.$queryRaw`SELECT 1`),
      redis ? timed(() => redis.ping()) : Promise.resolve<Check>({ status: 'disabled' }),
      timed(async () => {
        const res = await fetch(`${env.ML_SERVICE_URL}/health`, { signal: AbortSignal.timeout(2000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      }),
    ]);
    const ready = database.status === 'up';
    const degraded = cache.status === 'down' || mlService.status === 'down';
    return {
      status: ready ? (degraded ? 'degraded' : 'ok') : 'unavailable',
      ready,
      checks: { database, redis: cache, mlService },
    };
  },
};
