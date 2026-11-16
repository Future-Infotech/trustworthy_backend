const SENSITIVE_KEYS = new Set([
  'password',
  'passwordhash',
  'currentpassword',
  'newpassword',
  'token',
  'tokenhash',
  'refreshtoken',
  'accesstoken',
  'secret',
  'apikey',
]);

/**
 * Deep-copies a value replacing secrets with "[REDACTED]".
 * Used before persisting before/after snapshots into the audit log.
 */
export function redactSecrets<T>(value: T, depth = 0): T {
  if (depth > 8 || value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString() as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v, depth + 1)) as unknown as T;
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? '[REDACTED]' : redactSecrets(v, depth + 1);
    }
    return out as T;
  }
  return value;
}

/** Masks an email for display to users without permission to see PII: j***@example.com */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  return `${local.charAt(0)}***@${domain}`;
}
