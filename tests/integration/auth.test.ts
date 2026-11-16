import request from 'supertest';
import { prisma } from '../../src/config/prisma';
import { sha256 } from '../../src/utils/crypto';
import { app, createUser, latestAudit, login, ORIGIN, PASSWORD, refreshCookieFrom, uniqueEmail } from '../helpers';

const registration = (overrides: Record<string, unknown> = {}) => ({
  email: uniqueEmail('reg'),
  password: PASSWORD,
  firstName: 'Ada',
  lastName: 'Lovelace',
  acceptTerms: true,
  ...overrides,
});

const refresh = (cookie: string) =>
  request(app).post('/api/auth/refresh').set('Cookie', cookie).set('X-CSRF-Protection', '1').set('Origin', ORIGIN);

afterAll(() => prisma.$disconnect());

describe('POST /api/auth/register', () => {
  it('creates a student account, sets a hardened refresh cookie and records consent + audit', async () => {
    const body = registration();
    const res = await request(app).post('/api/auth/register').send(body);
    expect(res.status).toBe(201);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ email: body.email, role: 'STUDENT' });
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.body.permissions).toContain('courses:read');

    const cookie = ([] as string[]).concat(res.headers['set-cookie']).find((c) => c.startsWith('tai_rt='))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/auth/i);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: body.email }, include: { consents: true } });
    expect(user.consents.map((c) => c.consentType).sort()).toEqual(['privacy_notice', 'terms_of_service']);
    expect(await latestAudit({ action: 'auth.register', userId: user.id })).not.toBeNull();
  });

  it('rejects weak passwords', async () => {
    const res = await request(app).post('/api/auth/register').send(registration({ password: 'password' }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('requires acceptance of terms', async () => {
    const res = await request(app).post('/api/auth/register').send(registration({ acceptTerms: false }));
    expect(res.status).toBe(400);
  });

  it.each(['ADMIN', 'SUPER_ADMIN', 'FACULTY', 'DEVELOPER'])('blocks self-registration as %s (role escalation)', async (role) => {
    const body = registration({ role });
    const res = await request(app).post('/api/auth/register').send(body);
    expect(res.status).toBe(403);
    expect(await prisma.user.findUnique({ where: { email: body.email } })).toBeNull();
    const audit = await prisma.auditLog.findFirst({ where: { action: 'auth.register', userEmail: body.email } });
    expect(audit).toMatchObject({ result: 'DENIED', severity: 'HIGH' });
  });

  it('rejects duplicate emails', async () => {
    const body = registration();
    await request(app).post('/api/auth/register').send(body).expect(201);
    const res = await request(app).post('/api/auth/register').send({ ...body, email: body.email.toUpperCase() });
    expect(res.status).toBe(409);
  });

  it('rejects malformed JSON', async () => {
    const res = await request(app).post('/api/auth/register').set('Content-Type', 'application/json').send('{"email":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('rejects oversized request bodies', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send(registration({ firstName: 'x'.repeat(1_100_000) }));
    expect(res.status).toBe(413);
  });
});

describe('POST /api/auth/login', () => {
  it('signs in with valid credentials', async () => {
    const user = await createUser('DEVELOPER');
    const res = await request(app).post('/api/auth/login').send({ email: user.email, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('DEVELOPER');
    expect(await latestAudit({ action: 'auth.login', userId: user.id })).toMatchObject({ result: 'SUCCESS' });
  });

  it('returns the same generic error for wrong passwords and unknown accounts', async () => {
    const user = await createUser('STUDENT');
    const wrong = await request(app).post('/api/auth/login').send({ email: user.email, password: 'Wr0ng!Password' });
    const unknown = await request(app).post('/api/auth/login').send({ email: uniqueEmail('ghost'), password: 'Wr0ng!Password' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it('locks the account after repeated failures, even for the correct password', async () => {
    const user = await createUser('STUDENT');
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/auth/login').send({ email: user.email, password: 'Wr0ng!Password' }).expect(401);
    }
    const res = await request(app).post('/api/auth/login').send({ email: user.email, password: PASSWORD });
    expect(res.status).toBe(423);
    expect(await latestAudit({ action: 'auth.account_locked', userId: user.id })).toMatchObject({ severity: 'HIGH' });
  });

  it('refuses suspended accounts', async () => {
    const user = await createUser('STUDENT', { status: 'SUSPENDED' });
    const res = await request(app).post('/api/auth/login').send({ email: user.email, password: PASSWORD });
    expect(res.status).toBe(403);
  });
});

describe('authenticated access', () => {
  it('rejects missing, malformed and forged tokens', async () => {
    await request(app).get('/api/auth/me').expect(401);
    await request(app).get('/api/auth/me').set('Authorization', 'Bearer not-a-jwt').expect(401);
    await request(app).get('/api/auth/me').set('Authorization', 'Basic abc').expect(401);
  });

  it('returns the current user and permissions', async () => {
    const user = await createUser('EXECUTIVE');
    const { accessToken } = await login(user.email);
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(user.email);
    expect(res.body.permissions).toContain('analytics:executive');
    expect(res.body.permissions).not.toContain('users:manage');
  });
});

describe('refresh token rotation', () => {
  it('requires the CSRF header and an allowed origin', async () => {
    const user = await createUser('STUDENT');
    const { cookie } = await login(user.email);
    await request(app).post('/api/auth/refresh').set('Cookie', cookie).expect(403);
    await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookie)
      .set('X-CSRF-Protection', '1')
      .set('Origin', 'https://evil.example')
      .expect(403);
  });

  it('rotates the token and issues a new access token', async () => {
    const user = await createUser('STUDENT');
    const { cookie } = await login(user.email);
    const res = await refresh(cookie);
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(refreshCookieFrom(res)).not.toBe(cookie);
  });

  it('detects reuse of a rotated token and revokes the whole family', async () => {
    const user = await createUser('STUDENT');
    const { cookie: original } = await login(user.email);
    const rotated = refreshCookieFrom(await refresh(original).expect(200));

    // Move the rotation outside the concurrency grace window.
    await prisma.refreshToken.update({
      where: { tokenHash: sha256(original.split('=')[1]) },
      data: { revokedAt: new Date(Date.now() - 60_000) },
    });

    await refresh(original).expect(401);
    await refresh(rotated).expect(401);
    expect(await latestAudit({ action: 'auth.refresh_token_reuse', userId: user.id })).toMatchObject({ result: 'DENIED', severity: 'HIGH' });
  });

  it('tolerates concurrent refreshes within the grace window', async () => {
    const user = await createUser('STUDENT');
    const { cookie } = await login(user.email);
    await refresh(cookie).expect(200);
    await refresh(cookie).expect(200);
  });

  it('invalidates the session on logout', async () => {
    const user = await createUser('STUDENT');
    const { cookie } = await login(user.email);
    await request(app).post('/api/auth/logout').set('Cookie', cookie).set('X-CSRF-Protection', '1').expect(204);
    await refresh(cookie).expect(401);
  });
});

describe('POST /api/auth/change-password', () => {
  it('changes the password and revokes other sessions', async () => {
    const user = await createUser('STUDENT');
    const other = await login(user.email);
    const current = await login(user.email);
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${current.accessToken}`)
      .send({ currentPassword: PASSWORD, newPassword: 'N3w!SecurePassword' });
    expect(res.status).toBe(200);
    await refresh(other.cookie).expect(401);
    await request(app).post('/api/auth/login').send({ email: user.email, password: 'N3w!SecurePassword' }).expect(200);
  });

  it('rejects an incorrect current password', async () => {
    const user = await createUser('STUDENT');
    const { accessToken } = await login(user.email);
    await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: 'Wr0ng!Password', newPassword: 'N3w!SecurePassword' })
      .expect(400);
  });
});
