import jwt from 'jsonwebtoken';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { env } from '../../src/config/env';
import { riskIndex } from '../../src/services/analytics.service';
import { toCsv } from '../../src/services/auditLog.service';
import { passwordPolicy } from '../../src/services/password.service';
import { LocalStorageProvider } from '../../src/services/storage/local.storage';
import { tokenService } from '../../src/services/token.service';
import { maskEmail, redactSecrets } from '../../src/utils/sanitize';

describe('password policy', () => {
  it('accepts a strong password', () => {
    expect(passwordPolicy.safeParse('Str0ng!Passw0rd').success).toBe(true);
  });
  it.each(['short1!A', 'alllowercase1!x', 'ALLUPPERCASE1!X', 'NoDigitsHere!!', 'NoSymbols12345'])('rejects %s', (pw) => {
    expect(passwordPolicy.safeParse(pw).success).toBe(false);
  });
});

describe('access tokens', () => {
  it('round-trips subject and role', () => {
    const token = tokenService.signAccessToken('3f1c2a7e-0000-4000-8000-000000000001', 'ADMIN');
    const claims = tokenService.verifyAccessToken(token);
    expect(claims.sub).toBe('3f1c2a7e-0000-4000-8000-000000000001');
    expect(claims.role).toBe('ADMIN');
  });

  it('rejects tokens signed with another secret', () => {
    const forged = jwt.sign({ role: 'SUPER_ADMIN', type: 'access' }, 'another-secret-another-secret-another-secret', {
      subject: 'x',
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    });
    expect(() => tokenService.verifyAccessToken(forged)).toThrow(/Invalid access token/);
  });

  it('rejects the "none" algorithm', () => {
    const unsigned = jwt.sign({ role: 'SUPER_ADMIN', type: 'access', sub: 'x' }, '', { algorithm: 'none' });
    expect(() => tokenService.verifyAccessToken(unsigned)).toThrow();
  });

  it('rejects expired tokens', () => {
    const expired = jwt.sign({ role: 'STUDENT', type: 'access' }, env.JWT_ACCESS_SECRET, {
      subject: 'x',
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      expiresIn: -10,
    });
    expect(() => tokenService.verifyAccessToken(expired)).toThrow(/expired/);
  });

  it('rejects tokens that are not access tokens', () => {
    const other = jwt.sign({ role: 'STUDENT', type: 'refresh' }, env.JWT_ACCESS_SECRET, {
      subject: 'x',
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    });
    expect(() => tokenService.verifyAccessToken(other)).toThrow();
  });
});

describe('redaction and masking', () => {
  it('redacts secrets at any depth', () => {
    const out = redactSecrets({ email: 'a@b.c', passwordHash: 'x', nested: { token: 't', ok: 1 }, list: [{ refreshToken: 'r' }] });
    expect(out).toEqual({ email: 'a@b.c', passwordHash: '[REDACTED]', nested: { token: '[REDACTED]', ok: 1 }, list: [{ refreshToken: '[REDACTED]' }] });
  });
  it('masks emails', () => {
    expect(maskEmail('jordan@example.com')).toBe('j***@example.com');
  });
});

describe('audit CSV export', () => {
  it('escapes quotes and neutralises spreadsheet formulas', () => {
    const csv = toCsv([
      {
        id: '1',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        userEmail: '=HYPERLINK("http://evil")',
        role: 'ADMIN',
        action: 'user.update',
        resource: 'user',
        resourceId: null,
        result: 'SUCCESS',
        severity: 'INFO',
        reason: 'said "hello", then left',
        ipAddress: null,
        requestId: null,
      } as never,
    ]);
    const [, row] = csv.split('\n');
    expect(row).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(row).toContain('"said ""hello"", then left"');
  });
});

describe('organisational risk index', () => {
  it('returns null when nothing is assessed', () => {
    expect(riskIndex({}).score).toBeNull();
  });
  it('averages fixed level weights', () => {
    expect(riskIndex({ LOW: 1, CRITICAL: 1 })).toMatchObject({ score: 50, level: 'HIGH', assessed: 2 });
    expect(riskIndex({ LOW: 4 })).toMatchObject({ score: 12, level: 'LOW' });
  });
});

describe('local storage provider', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'tai-storage-'));
  const storage = new LocalStorageProvider(root);

  it('round-trips objects', async () => {
    await storage.put('datasets/a/file.csv', Buffer.from('x,y\n1,2\n'), 'text/csv');
    expect((await storage.get('datasets/a/file.csv')).toString()).toBe('x,y\n1,2\n');
    expect(await storage.exists('datasets/a/file.csv')).toBe(true);
    await storage.delete('datasets/a/file.csv');
    expect(await storage.exists('datasets/a/file.csv')).toBe(false);
  });

  it.each(['../etc/passwd', '/etc/passwd', 'a/../../b', 'a//b', ''])('rejects unsafe key %j', async (key) => {
    await expect(storage.put(key, Buffer.from('x'), 'text/plain')).rejects.toThrow(/Unsafe storage key/);
  });
});
