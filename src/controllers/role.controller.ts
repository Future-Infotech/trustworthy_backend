import type { Request, Response } from 'express';
import { roleRepository } from '../repositories/role.repository';

export const roleController = {
  async list(_req: Request, res: Response) {
    const roles = await roleRepository.listWithPermissions();
    res.json(
      roles.map((r) => ({
        id: r.id,
        name: r.name,
        displayName: r.displayName,
        description: r.description,
        userCount: r._count.users,
        permissions: r.permissions.map((p) => p.permission.key).sort(),
      })),
    );
  },
};
