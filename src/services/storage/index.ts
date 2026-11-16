import path from 'node:path';
import { env } from '../../config/env';
import { LocalStorageProvider } from './local.storage';
import { S3StorageProvider } from './s3.storage';
import type { StorageProvider } from './storage.types';

let provider: StorageProvider | undefined;

export function getStorage(): StorageProvider {
  if (provider) return provider;
  provider =
    env.STORAGE_DRIVER === 's3'
      ? new S3StorageProvider(env.S3_BUCKET, {
          region: env.S3_REGION,
          endpoint: env.S3_ENDPOINT,
          forcePathStyle: env.S3_FORCE_PATH_STYLE,
          credentials:
            env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
              ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }
              : undefined,
        })
      : new LocalStorageProvider(path.resolve(process.cwd(), env.STORAGE_LOCAL_PATH));
  return provider;
}

export type { StorageProvider } from './storage.types';
