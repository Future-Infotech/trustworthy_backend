/** Environment shared by the global setup and every test worker. */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'mysql://trustai:trustai_dev_password@127.0.0.1:3307/trustai_test';

/**
 * The test suite resets the whole database schema, so it must never run against a real database.
 * Only a local server and a database whose name contains "test" are accepted.
 */
export function assertSafeTestDatabase(url: string = TEST_DATABASE_URL): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('TEST_DATABASE_URL is not a valid URL');
  }
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!local || !/test/i.test(database)) {
    throw new Error(`Refusing to run tests against "${parsed.hostname}/${database}": tests wipe the database, so only a local database with "test" in its name is allowed.`);
  }
}

export function applyTestEnv(): void {
  assertSafeTestDatabase();
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
