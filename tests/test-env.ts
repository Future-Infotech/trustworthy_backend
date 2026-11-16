/** Environment shared by the global setup and every test worker. */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://trustai:trustai_dev_password@localhost:5433/trustai_test?schema=public';

export function applyTestEnv(): void {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.REDIS_URL = '';
  process.env.JWT_ACCESS_SECRET = 'test-secret-that-is-long-enough-for-hs256-signing-0123456789';
  process.env.ML_SERVICE_TOKEN = 'test-internal-service-token-0123456789abcdef';
  process.env.ML_SERVICE_URL = 'http://127.0.0.1:59999';
  process.env.CORS_ORIGINS = 'http://localhost:5173';
  process.env.BCRYPT_ROUNDS = '4';
  process.env.COOKIE_SECURE = 'false';
  process.env.STORAGE_LOCAL_PATH = '../.local/test-storage';
}
