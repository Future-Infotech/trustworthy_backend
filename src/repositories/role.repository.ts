import type { RoleName } from '@prisma/client';
import { prisma } from '../config/prisma';

export const roleRepository = {
  listWithPermissions() {
    return prisma.role.findMany({
      orderBy: { name: 'asc' },
      include: {
        permissions: { include: { permission: true } },
        _count: { select: { users: true } },
      },
    });
  },

  findByName(name: RoleName) {
    return prisma.role.findUnique({ where: { name } });
  },

  async permissionKeysForRole(name: RoleName): Promise<string[]> {
    const rows = await prisma.rolePermission.findMany({
      where: { role: { name } },
      select: { permission: { select: { key: true } } },
    });
    return rows.map((r) => r.permission.key);
  },
};
