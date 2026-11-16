import type { RoleName } from '@prisma/client';
import { roleRepository } from '../repositories/role.repository';

const CACHE_TTL_MS = 60_000;
const cache = new Map<RoleName, { permissions: ReadonlySet<string>; loadedAt: number }>();

/** Resolves a role's permissions from the database with a short in-process cache. */
export const permissionService = {
  async forRole(role: RoleName): Promise<ReadonlySet<string>> {
    const hit = cache.get(role);
    if (hit && Date.now() - hit.loadedAt < CACHE_TTL_MS) return hit.permissions;
    const permissions = new Set(await roleRepository.permissionKeysForRole(role));
    cache.set(role, { permissions, loadedAt: Date.now() });
    return permissions;
  },

  invalidate(): void {
    cache.clear();
  },
};
