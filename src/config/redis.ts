import Redis from 'ioredis';
import { env } from './env';
import { logger } from './logger';

let client: Redis | null | undefined;

/** Returns a shared Redis client, or null when REDIS_URL is not configured. */
export function getRedis(): Redis | null {
  if (client !== undefined) return client;
  if (!env.REDIS_URL) {
    client = null;
    return client;
  }
  client = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2, enableOfflineQueue: false });
  client.on('error', (err) => logger.error({ err }, 'redis error'));
  return client;
}

export async function closeRedis(): Promise<void> {
  if (client) await client.quit();
  client = undefined;
}
