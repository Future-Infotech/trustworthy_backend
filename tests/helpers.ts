import type { RoleName, UserStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/config/prisma';

export const app = createApp();
export const PASSWORD = 'Str0ng!Passw0rd';
export const ORIGIN = 'http://localhost:5173';
const passwordHash = bcrypt.hashSync(PASSWORD, 4);

export const uniqueEmail = (prefix = 'user') => `${prefix}.${randomUUID().slice(0, 8)}@test.example.com`;

export async function createUser(role: RoleName, opts: { status?: UserStatus; email?: string } = {}) {
  const roleRow = await prisma.role.findUniqueOrThrow({ where: { name: role } });
  return prisma.user.create({
    data: {
      email: opts.email ?? uniqueEmail(role.toLowerCase()),
      firstName: 'Test',
      lastName: role,
      passwordHash,
      roleId: roleRow.id,
      status: opts.status ?? 'ACTIVE',
      passwordChangedAt: new Date(Date.now() - 5_000),
    },
    include: { role: true },
  });
}

export function refreshCookieFrom(res: request.Response): string {
  const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const cookie = cookies.find((c) => c.startsWith('tai_rt='));
  if (!cookie) throw new Error('No refresh cookie set');
  return cookie.split(';')[0];
}

export async function login(email: string, password = PASSWORD) {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { accessToken: res.body.accessToken as string, cookie: refreshCookieFrom(res), body: res.body };
}

export async function loginAs(role: RoleName) {
  const user = await createUser(role);
  const session = await login(user.email);
  return { user, ...session, auth: { Authorization: `Bearer ${session.accessToken}` } };
}

export const latestAudit = (where: { action?: string; userId?: string; resourceId?: string }) =>
  prisma.auditLog.findFirst({ where, orderBy: { createdAt: 'desc' } });
