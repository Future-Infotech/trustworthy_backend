import type { Prisma } from '@prisma/client';

/**
 * MySQL/MariaDB has no scalar-list columns, so lists of strings (tags, role names, column names…)
 * are stored as JSON arrays. This reads such a column back as a clean `string[]`.
 */
export function stringList(value: Prisma.JsonValue | null | undefined): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}
