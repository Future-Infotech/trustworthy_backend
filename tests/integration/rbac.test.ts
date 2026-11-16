import type { RoleName } from '@prisma/client';
import request from 'supertest';
import { prisma } from '../../src/config/prisma';
import { PERMISSIONS, ROLE_PERMISSIONS } from '../../src/rbac/permissions';
import { app, createUser, latestAudit, loginAs, PASSWORD, uniqueEmail } from '../helpers';

afterAll(() => prisma.$disconnect());

const ROLES: RoleName[] = ['SUPER_ADMIN', 'ADMIN', 'FACULTY', 'STUDENT', 'DEVELOPER', 'PRODUCT_DEVELOPER', 'EXECUTIVE'];

describe('endpoint authorisation matrix', () => {
  const endpoints: { path: string; permission: string }[] = [
    { path: '/api/users', permission: PERMISSIONS.USERS_READ },
    { path: '/api/roles', permission: PERMISSIONS.ROLES_READ },
    { path: '/api/audit-logs', permission: PERMISSIONS.AUDIT_LOGS_READ },
    { path: '/api/settings', permission: PERMISSIONS.SETTINGS_READ },
    { path: '/api/analytics/admin-dashboard', permission: PERMISSIONS.ANALYTICS_ADMIN },
    { path: '/api/analytics/executive-dashboard', permission: PERMISSIONS.ANALYTICS_EXECUTIVE },
  ];

  it.each(ROLES)('%s receives exactly the access its permissions allow', async (role) => {
    const { auth } = await loginAs(role);
    for (const e of endpoints) {
      const res = await request(app).get(e.path).set(auth);
      const allowed = (ROLE_PERMISSIONS[role] as string[]).includes(e.permission);
      expect({ path: e.path, status: res.status }).toEqual({ path: e.path, status: allowed ? 200 : 403 });
    }
  });

  it('returns 401 for anonymous requests to protected endpoints', async () => {
    for (const e of endpoints) await request(app).get(e.path).expect(401);
  });

  it('records denied access attempts in the audit log', async () => {
    const { user, auth } = await loginAs('STUDENT');
    await request(app).get('/api/users').set(auth).expect(403);
    expect(await latestAudit({ action: 'access.denied', userId: user.id })).toMatchObject({ result: 'DENIED' });
  });

  it('/auth/me reflects the role permission matrix', async () => {
    for (const role of ROLES) {
      const { auth } = await loginAs(role);
      const res = await request(app).get('/api/auth/me').set(auth);
      expect(new Set(res.body.permissions)).toEqual(new Set(ROLE_PERMISSIONS[role]));
    }
  });
});

describe('role escalation protection', () => {
  const newUser = (role: RoleName) => ({ email: uniqueEmail('new'), firstName: 'New', lastName: 'User', role, password: PASSWORD });

  it('ADMIN cannot create SUPER_ADMIN or ADMIN users', async () => {
    const { auth } = await loginAs('ADMIN');
    await request(app).post('/api/users').set(auth).send(newUser('SUPER_ADMIN')).expect(403);
    await request(app).post('/api/users').set(auth).send(newUser('ADMIN')).expect(403);
  });

  it('ADMIN can create lower-ranked users', async () => {
    const { auth } = await loginAs('ADMIN');
    const res = await request(app).post('/api/users').set(auth).send(newUser('FACULTY'));
    expect(res.status).toBe(201);
    expect(res.body.role).toBe('FACULTY');
  });

  it('SUPER_ADMIN can create ADMIN users', async () => {
    const { auth } = await loginAs('SUPER_ADMIN');
    await request(app).post('/api/users').set(auth).send(newUser('ADMIN')).expect(201);
  });

  it('ADMIN cannot change their own role or status', async () => {
    const { user, auth } = await loginAs('ADMIN');
    await request(app).patch(`/api/users/${user.id}`).set(auth).send({ role: 'SUPER_ADMIN' }).expect(403);
    await request(app).patch(`/api/users/${user.id}`).set(auth).send({ status: 'SUSPENDED' }).expect(403);
  });

  it('ADMIN cannot modify or delete a SUPER_ADMIN or another ADMIN', async () => {
    const { auth } = await loginAs('ADMIN');
    const superAdmin = await createUser('SUPER_ADMIN');
    const peer = await createUser('ADMIN');
    await request(app).patch(`/api/users/${superAdmin.id}`).set(auth).send({ status: 'SUSPENDED' }).expect(403);
    await request(app).patch(`/api/users/${peer.id}`).set(auth).send({ firstName: 'Hacked' }).expect(403);
    await request(app).delete(`/api/users/${peer.id}`).set(auth).send({}).expect(403);
  });

  it('ADMIN cannot promote a student to ADMIN', async () => {
    const { auth } = await loginAs('ADMIN');
    const student = await createUser('STUDENT');
    await request(app).patch(`/api/users/${student.id}`).set(auth).send({ role: 'ADMIN' }).expect(403);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: student.id }, include: { role: true } });
    expect(after.role.name).toBe('STUDENT');
  });

  it('students cannot call user management even with crafted bodies', async () => {
    const { user, auth } = await loginAs('STUDENT');
    await request(app).patch(`/api/users/${user.id}`).set(auth).send({ role: 'SUPER_ADMIN' }).expect(403);
    await request(app).post('/api/users').set(auth).send(newUser('SUPER_ADMIN')).expect(403);
  });
});

describe('user lifecycle effects', () => {
  it('suspension takes effect immediately for existing access tokens', async () => {
    const { auth: adminAuth } = await loginAs('ADMIN');
    const { user, auth } = await loginAs('STUDENT');
    await request(app).get('/api/auth/me').set(auth).expect(200);
    const res = await request(app).patch(`/api/users/${user.id}`).set(adminAuth).send({ status: 'SUSPENDED', reason: 'Policy violation' });
    expect(res.status).toBe(200);
    await request(app).get('/api/auth/me').set(auth).expect(401);
    expect(await latestAudit({ action: 'user.suspend', resourceId: user.id })).toMatchObject({ severity: 'HIGH', reason: 'Policy violation' });
  });

  it('role changes are audited with before/after values and revoke sessions', async () => {
    const { auth: adminAuth } = await loginAs('ADMIN');
    const student = await loginAs('STUDENT');
    await request(app).patch(`/api/users/${student.user.id}`).set(adminAuth).send({ role: 'DEVELOPER' }).expect(200);
    const audit = await latestAudit({ action: 'user.role_change', resourceId: student.user.id });
    expect(audit?.before).toMatchObject({ role: 'STUDENT' });
    expect(audit?.after).toMatchObject({ role: 'DEVELOPER' });
    const tokens = await prisma.refreshToken.findMany({ where: { userId: student.user.id } });
    expect(tokens.every((t) => t.revokedAt !== null)).toBe(true);
  });

  it('soft-deletes users and hides them from the default listing', async () => {
    const { auth } = await loginAs('ADMIN');
    const student = await createUser('STUDENT');
    await request(app).delete(`/api/users/${student.id}`).set(auth).send({ reason: 'Requested by user' }).expect(204);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: student.id } });
    expect(row.status).toBe('DELETED');
    const list = await request(app).get('/api/users').query({ search: student.email }).set(auth);
    expect(list.body.data).toHaveLength(0);
  });

  it('validates ids and query parameters', async () => {
    const { auth } = await loginAs('ADMIN');
    await request(app).get('/api/users/not-a-uuid').set(auth).expect(400);
    await request(app).get('/api/users').query({ pageSize: 1000 }).set(auth).expect(400);
    await request(app).get('/api/users').query({ role: 'GOD' }).set(auth).expect(400);
  });
});
