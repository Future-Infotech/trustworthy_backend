import type { AuditResult, AuditSeverity, Prisma, RoleName } from '@prisma/client';
import { logger } from '../config/logger';
import { prisma, type DbClient } from '../config/prisma';
import { auditLogRepository } from '../repositories/auditLog.repository';
import { redactSecrets } from '../utils/sanitize';
import type { RequestContext } from '../utils/requestContext';

export interface AuditActor {
  id: string;
  email: string;
  role: RoleName;
}

export interface AuditEntry {
  action: string;
  resource: string;
  resourceId?: string | null;
  actor?: AuditActor | null;
  /** Used when there is no authenticated actor (e.g. failed login). */
  actorEmail?: string | null;
  context?: RequestContext;
  before?: unknown;
  after?: unknown;
  result?: AuditResult;
  reason?: string;
  severity?: AuditSeverity;
  metadata?: Record<string, unknown>;
}

const toJson = (value: unknown): Prisma.InputJsonValue | undefined =>
  value === undefined || value === null ? undefined : (redactSecrets(value) as Prisma.InputJsonValue);

function toRecord(entry: AuditEntry): Prisma.AuditLogUncheckedCreateInput {
  return {
    action: entry.action,
    resource: entry.resource,
    resourceId: entry.resourceId ?? null,
    userId: entry.actor?.id ?? null,
    userEmail: entry.actor?.email ?? entry.actorEmail?.toLowerCase() ?? null,
    role: entry.actor?.role ?? null,
    ipAddress: entry.context?.ip ?? null,
    userAgent: entry.context?.userAgent ?? null,
    requestId: entry.context?.requestId ?? null,
    before: toJson(entry.before),
    after: toJson(entry.after),
    result: entry.result ?? 'SUCCESS',
    reason: entry.reason ?? null,
    severity: entry.severity ?? 'INFO',
    metadata: toJson(entry.metadata),
  };
}

export const auditService = {
  /**
   * Records an audit event.
   * When `db` is a transaction client the write is atomic with the business
   * change and failures propagate. Stand-alone writes never break the request;
   * failures are logged at error level for alerting.
   */
  async record(entry: AuditEntry, db?: DbClient): Promise<void> {
    if (db) {
      await auditLogRepository.create(toRecord(entry), db);
      return;
    }
    try {
      await auditLogRepository.create(toRecord(entry));
    } catch (err) {
      logger.error({ err, action: entry.action, resource: entry.resource }, 'failed to write audit log');
    }
  },

  /** Most recent audit events for one resource, newest first. */
  /** Events for one record, optionally merged with events on related child records. */
  async history(resource: string, resourceId: string, { take = 100, related = [] }: { take?: number; related?: { resource: string; ids: string[] }[] } = {}) {
    const children = related.filter((r) => r.ids.length).map((r) => ({ resource: r.resource, resourceId: { in: r.ids } }));
    const events = await prisma.auditLog.findMany({
      where: { OR: [{ resource, resourceId }, ...children] },
      orderBy: { createdAt: 'desc' },
      take,
      select: { id: true, action: true, userEmail: true, role: true, reason: true, result: true, createdAt: true, metadata: true },
    });
    return { events };
  },
};
