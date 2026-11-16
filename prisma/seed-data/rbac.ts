import type { PrismaClient, RoleName } from '@prisma/client';
import {
  ALL_PERMISSIONS,
  describePermission,
  ROLE_METADATA,
  ROLE_PERMISSIONS,
} from '../../src/rbac/permissions';

/**
 * Synchronises the code-defined permission catalogue and role matrix into the
 * database. Idempotent: safe to run on every deploy.
 */
export async function seedRbac(prisma: PrismaClient): Promise<Record<RoleName, string>> {
  for (const key of ALL_PERMISSIONS) {
    const { resource, action } = describePermission(key);
    await prisma.permission.upsert({
      where: { key },
      create: { key, resource, action },
      update: { resource, action },
    });
  }
  await prisma.permission.deleteMany({ where: { key: { notIn: ALL_PERMISSIONS } } });

  const permissions = await prisma.permission.findMany({ select: { id: true, key: true } });
  const permissionId = new Map(permissions.map((p) => [p.key, p.id]));
  const roleIds = {} as Record<RoleName, string>;

  for (const [name, meta] of Object.entries(ROLE_METADATA) as [RoleName, (typeof ROLE_METADATA)[RoleName]][]) {
    const role = await prisma.role.upsert({
      where: { name },
      create: { name, displayName: meta.displayName, description: meta.description },
      update: { displayName: meta.displayName, description: meta.description },
    });
    roleIds[name] = role.id;
    const wanted = ROLE_PERMISSIONS[name].map((k) => permissionId.get(k)!);
    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId: role.id, permissionId: { notIn: wanted } } }),
      prisma.rolePermission.createMany({
        data: wanted.map((permissionId) => ({ roleId: role.id, permissionId })),
        skipDuplicates: true,
      }),
    ]);
  }
  return roleIds;
}
