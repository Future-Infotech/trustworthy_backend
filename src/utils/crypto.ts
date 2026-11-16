import { createHash, randomBytes } from 'node:crypto';

export const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');

/** JSON with object keys sorted recursively, so equal configurations always hash identically. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export const randomToken = (bytes = 48): string => randomBytes(bytes).toString('base64url');
