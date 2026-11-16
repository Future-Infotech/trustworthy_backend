import request from 'supertest';
import { prisma } from '../../src/config/prisma';
import { settingsService } from '../../src/services/settings.service';
import { app, createUser, latestAudit, loginAs, PASSWORD, uniqueEmail } from '../helpers';

afterAll(() => prisma.$disconnect());

describe('audit logs', () => {
  it('lists and filters audit events', async () => {
    const { auth } = await loginAs('ADMIN');
    const student = await loginAs('STUDENT');
    await request(app).get('/api/users').set(student.auth).expect(403);

    const res = await request(app).get('/api/audit-logs').query({ result: 'DENIED', userId: student.user.id }).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.every((e: { result: string }) => e.result === 'DENIED')).toBe(true);
    expect(res.body.meta).toMatchObject({ page: 1, pageSize: 20 });

    const byAction = await request(app).get('/api/audit-logs').query({ action: 'auth.' }).set(auth);
    expect(byAction.body.data.every((e: { action: string }) => e.action.startsWith('auth.'))).toBe(true);
  });

  it('rejects an inverted date range', async () => {
    const { auth } = await loginAs('ADMIN');
    await request(app).get('/api/audit-logs').query({ from: '2026-02-01', to: '2026-01-01' }).set(auth).expect(400);
  });

  it('exposes no endpoints to modify or delete entries', async () => {
    const { auth } = await loginAs('SUPER_ADMIN');
    const entry = await prisma.auditLog.findFirstOrThrow();
    await request(app).patch(`/api/audit-logs/${entry.id}`).set(auth).send({ action: 'x' }).expect(404);
    await request(app).delete(`/api/audit-logs/${entry.id}`).set(auth).expect(404);
    await request(app).post('/api/audit-logs').set(auth).send({ action: 'x' }).expect(404);
  });

  it('is append-only at the database level', async () => {
    const entry = await prisma.auditLog.findFirstOrThrow();
    await expect(prisma.auditLog.update({ where: { id: entry.id }, data: { action: 'tampered' } })).rejects.toThrow(/append-only/);
    await expect(prisma.auditLog.delete({ where: { id: entry.id } })).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe('TRUNCATE "audit_logs"')).rejects.toThrow(/append-only/);
    expect((await prisma.auditLog.findUniqueOrThrow({ where: { id: entry.id } })).action).toBe(entry.action);
  });

  it('exports CSV and audits the export', async () => {
    const { user, auth } = await loginAs('ADMIN');
    const res = await request(app).get('/api/audit-logs/export').query({ format: 'csv', action: 'auth.' }).set(auth);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text.split('\n')[0]).toBe('id,createdAt,userEmail,role,action,resource,resourceId,result,severity,reason,ipAddress,requestId');
    expect(await latestAudit({ action: 'audit_logs.export', userId: user.id })).not.toBeNull();
  });

  it('never stores secrets in audit snapshots', async () => {
    const rows = await prisma.auditLog.findMany({ take: 500, orderBy: { createdAt: 'desc' } });
    const serialised = JSON.stringify(rows);
    expect(serialised).not.toContain(PASSWORD);
    expect(serialised).not.toMatch(/\$2[aby]\$/);
  });
});

describe('system settings', () => {
  afterEach(() => settingsService.clearCache());

  it('lists settings with defaults', async () => {
    const { auth } = await loginAs('ADMIN');
    const res = await request(app).get('/api/settings').set(auth);
    expect(res.status).toBe(200);
    const s = res.body.find((x: { key: string }) => x.key === 'security.maxFailedLogins');
    expect(s).toMatchObject({ category: 'Security', defaultValue: 5 });
  });

  it('validates values per key and audits changes', async () => {
    const { user, auth } = await loginAs('ADMIN');
    await request(app).patch('/api/settings/uploads.maxDatasetSizeMb').set(auth).send({ value: 5000 }).expect(400);
    await request(app).patch('/api/settings/uploads.maxDatasetSizeMb').set(auth).send({ value: 'big' }).expect(400);
    await request(app).patch('/api/settings/unknown.key').set(auth).send({ value: 1 }).expect(404);

    const res = await request(app).patch('/api/settings/uploads.maxDatasetSizeMb').set(auth).send({ value: 50 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ value: 50, isDefault: false });
    const audit = await latestAudit({ action: 'settings.update', userId: user.id });
    expect(audit).toMatchObject({ resourceId: 'uploads.maxDatasetSizeMb', after: { value: 50 } });
  });

  it('cannot whitelist privileged roles for self-registration', async () => {
    const { auth } = await loginAs('ADMIN');
    await request(app).patch('/api/settings/registration.allowedRoles').set(auth).send({ value: ['STUDENT', 'ADMIN'] }).expect(400);
  });

  it('honours registration settings', async () => {
    const { auth } = await loginAs('ADMIN');
    const body = { email: uniqueEmail('dev'), password: PASSWORD, firstName: 'D', lastName: 'V', acceptTerms: true, role: 'DEVELOPER' };

    await request(app).patch('/api/settings/registration.allowedRoles').set(auth).send({ value: ['STUDENT', 'DEVELOPER'] }).expect(200);
    await request(app).post('/api/auth/register').send(body).expect(201);

    await request(app).patch('/api/settings/registration.enabled').set(auth).send({ value: false }).expect(200);
    await request(app).post('/api/auth/register').send({ ...body, email: uniqueEmail('x'), role: undefined }).expect(403);

    await request(app).patch('/api/settings/registration.enabled').set(auth).send({ value: true }).expect(200);
    await request(app).patch('/api/settings/registration.allowedRoles').set(auth).send({ value: ['STUDENT'] }).expect(200);
  });
});

describe('notifications', () => {
  it('lists, marks read and isolates notifications per user', async () => {
    const owner = await loginAs('STUDENT');
    const other = await loginAs('STUDENT');
    const n = await prisma.notification.create({
      data: { userId: owner.user.id, type: 'ASSIGNMENT_ASSIGNED', title: 'New assignment', message: 'Analyze a dataset' },
    });

    const list = await request(app).get('/api/notifications').set(owner.auth);
    expect(list.status).toBe(200);
    expect(list.body.unread).toBe(1);

    await request(app).patch(`/api/notifications/${n.id}/read`).set(other.auth).expect(404);
    await request(app).patch(`/api/notifications/${n.id}/read`).set(owner.auth).expect(204);
    const count = await request(app).get('/api/notifications/unread-count').set(owner.auth);
    expect(count.body.unread).toBe(0);
  });
});

describe('analytics', () => {
  it('returns the admin dashboard', async () => {
    const { auth } = await loginAs('ADMIN');
    const res = await request(app).get('/api/analytics/admin-dashboard').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.users.total).toBeGreaterThan(0);
    expect(res.body.users.byRole).toHaveLength(7);
    expect(res.body.audit.eventsByDay).toHaveLength(14);
    expect(res.body).toHaveProperty('compliance.byStatus');
    expect(res.body).toHaveProperty('fairness.violations');
  });

  it('returns the executive dashboard with a null risk index when nothing is assessed', async () => {
    const { auth } = await loginAs('EXECUTIVE');
    const res = await request(app).get('/api/analytics/executive-dashboard').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.overallRisk).toHaveProperty('score');
    expect(res.body.riskDistribution).toHaveLength(4);
  });

  it('returns a personal dashboard for any authenticated user', async () => {
    const { auth } = await loginAs('STUDENT');
    const res = await request(app).get('/api/analytics/me').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.learning).toMatchObject({ lessonsCompleted: 0 });
  });
});

describe('health', () => {
  it('reports liveness', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('reports readiness with database up and degraded optional dependencies', async () => {
    const res = await request(app).get('/api/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.checks.database.status).toBe('up');
    expect(res.body.checks.redis.status).toBe('disabled');
    expect(res.body.checks.mlService.status).toBe('down');
    expect(res.body.status).toBe('degraded');
  });

  it('sets security headers and a request id', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-request-id']).toEqual(expect.any(String));
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('returns a JSON 404 for unknown routes', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('database constraints', () => {
  it('enforces unique emails', async () => {
    const user = await createUser('STUDENT');
    await expect(createUser('STUDENT', { email: user.email })).rejects.toThrow();
  });

  it('prevents hard deletion of users referenced by audit logs', async () => {
    const { user } = await loginAs('STUDENT');
    await expect(prisma.user.delete({ where: { id: user.id } })).rejects.toThrow();
  });

  it('cascades refresh tokens and notifications with their user', async () => {
    const user = await createUser('STUDENT');
    await prisma.notification.create({ data: { userId: user.id, type: 'SYSTEM', title: 't', message: 'm' } });
    await prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: `h-${user.id}`, familyId: user.id, expiresAt: new Date(Date.now() + 1000) },
    });
    await prisma.user.delete({ where: { id: user.id } });
    expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(0);
  });
});
