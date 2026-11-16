import type { AuditResult, AuditSeverity, Prisma, RoleName } from '@prisma/client';
import { prisma, type DbClient } from '../config/prisma';

export interface AuditLogFilter {
  from?: Date;
  to?: Date;
  userId?: string;
  role?: RoleName;
  action?: string;
  resource?: string;
  resourceId?: string;
  severity?: AuditSeverity;
  result?: AuditResult;
  search?: string;
}

export function buildAuditWhere(filter: AuditLogFilter): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};
  if (filter.from || filter.to) where.createdAt = { gte: filter.from, lte: filter.to };
  if (filter.userId) where.userId = filter.userId;
  if (filter.role) where.role = filter.role;
  if (filter.action) where.action = { startsWith: filter.action };
  if (filter.resource) where.resource = filter.resource;
  if (filter.resourceId) where.resourceId = filter.resourceId;
  if (filter.severity) where.severity = filter.severity;
  if (filter.result) where.result = filter.result;
  if (filter.search) {
    where.OR = [
      { userEmail: { contains: filter.search, mode: 'insensitive' } },
      { action: { contains: filter.search, mode: 'insensitive' } },
      { reason: { contains: filter.search, mode: 'insensitive' } },
      { resourceId: { contains: filter.search } },
    ];
  }
  return where;
}

export const auditLogRepository = {
  create(data: Prisma.AuditLogUncheckedCreateInput, db: DbClient = prisma) {
    return db.auditLog.create({ data });
  },

  async list(filter: AuditLogFilter, skip: number, take: number) {
    const where = buildAuditWhere(filter);
    const [items, total] = await prisma.$transaction([
      prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      prisma.auditLog.count({ where }),
    ]);
    return { items, total };
  },

  findMany(filter: AuditLogFilter, take: number) {
    return prisma.auditLog.findMany({ where: buildAuditWhere(filter), orderBy: { createdAt: 'desc' }, take });
  },

  findById(id: string) {
    return prisma.auditLog.findUnique({ where: { id } });
  },

  async distinctValues() {
    const [actions, resources] = await prisma.$transaction([
      prisma.auditLog.findMany({ distinct: ['action'], select: { action: true }, orderBy: { action: 'asc' } }),
      prisma.auditLog.findMany({ distinct: ['resource'], select: { resource: true }, orderBy: { resource: 'asc' } }),
    ]);
    return { actions: actions.map((a) => a.action), resources: resources.map((r) => r.resource) };
  },
};
