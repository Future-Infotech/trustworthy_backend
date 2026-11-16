import { prisma } from '../../config/prisma';
import { Errors } from '../../utils/errors';

export const userSelect = { id: true, firstName: true, lastName: true } as const;
export const fullName = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`.trim();
export const person = (u: { id: string; firstName: string; lastName: string } | null | undefined) => (u ? { id: u.id, name: fullName(u) } : null);

export const addDays = (from: Date, days: number) => new Date(from.getTime() + days * 86_400_000);

/** Resolves user ids that are stored without a relation (e.g. risk register owners) to display names. */
export async function peopleById(ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  const users = unique.length ? await prisma.user.findMany({ where: { id: { in: unique } }, select: userSelect }) : [];
  return new Map(users.map((u) => [u.id, person(u)!]));
}

/** Validates optional foreign keys and reports every problem against its field. */
export async function assertRefs(refs: { userId?: [string, string | null | undefined][]; aiSystemId?: string | null; modelId?: string | null }) {
  const issues: { path: string; message: string }[] = [];
  for (const [path, id] of refs.userId ?? []) {
    if (id && !(await prisma.user.findFirst({ where: { id, status: 'ACTIVE' }, select: { id: true } }))) issues.push({ path, message: 'User not found or inactive' });
  }
  if (refs.aiSystemId && !(await prisma.aISystem.findUnique({ where: { id: refs.aiSystemId }, select: { id: true } }))) issues.push({ path: 'aiSystemId', message: 'AI system not found' });
  if (refs.modelId && !(await prisma.aIModel.findUnique({ where: { id: refs.modelId }, select: { id: true } }))) issues.push({ path: 'modelId', message: 'Model not found' });
  if (issues.length) throw Errors.validation(issues);
}

/** Field-level before/after for the audit trail, limited to the fields that actually changed. */
export function changes<T extends object>(before: T, input: Partial<T>) {
  const keys = (Object.keys(input) as (keyof T)[]).filter((k) => input[k] !== undefined && JSON.stringify(input[k]) !== JSON.stringify(before[k]));
  return {
    keys,
    before: Object.fromEntries(keys.map((k) => [k, before[k]])),
    after: Object.fromEntries(keys.map((k) => [k, input[k]])),
  };
}

export const slugify = (v: string) =>
  v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'item';
