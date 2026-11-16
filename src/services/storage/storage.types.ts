export interface StoredObject {
  key: string;
  sizeBytes: number;
}

/** Abstraction over local disk (development) and S3-compatible object storage (production). */
export interface StorageProvider {
  readonly driver: 'local' | 's3';
  put(key: string, body: Buffer, contentType: string): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

const SAFE_KEY = /^[a-zA-Z0-9][a-zA-Z0-9/_.-]{0,511}$/;

/** Rejects keys that could escape the storage root or address unexpected objects. */
export function assertSafeKey(key: string): void {
  if (!SAFE_KEY.test(key) || key.includes('..') || key.includes('//')) {
    throw new Error(`Unsafe storage key: ${key}`);
  }
}
