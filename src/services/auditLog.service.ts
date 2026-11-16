import type { AuditLog } from '@prisma/client';
import { auditLogRepository, type AuditLogFilter } from '../repositories/auditLog.repository';
import { csvCell } from '../utils/csv';
import { Errors } from '../utils/errors';
import { paginate, toSkipTake } from '../utils/pagination';
import type { RequestContext } from '../utils/requestContext';
import type { ExportAuditLogsQuery, ListAuditLogsQuery } from '../validators/auditLog.validators';
import { auditService, type AuditActor } from './audit.service';

const EXPORT_LIMIT = 10_000;
const CSV_COLUMNS: (keyof AuditLog)[] = [
  'id',
  'createdAt',
  'userEmail',
  'role',
  'action',
  'resource',
  'resourceId',
  'result',
  'severity',
  'reason',
  'ipAddress',
  'requestId',
];

export function toCsv(rows: AuditLog[]): string {
  const header = CSV_COLUMNS.join(',');
  const lines = rows.map((r) => CSV_COLUMNS.map((c) => csvCell(r[c])).join(','));
  return [header, ...lines].join('\n');
}

function filterOf(query: AuditLogFilter): AuditLogFilter {
  const { from, to, userId, role, action, resource, resourceId, severity, result, search } = query;
  return { from, to, userId, role, action, resource, resourceId, severity, result, search };
}

export const auditLogService = {
  async list(query: ListAuditLogsQuery) {
    const { skip, take } = toSkipTake(query);
    const { items, total } = await auditLogRepository.list(filterOf(query), skip, take);
    return paginate(items, total, query);
  },

  async get(id: string) {
    const log = await auditLogRepository.findById(id);
    if (!log) throw Errors.notFound('Audit log entry');
    return log;
  },

  facets() {
    return auditLogRepository.distinctValues();
  },

  async export(query: ExportAuditLogsQuery, actor: AuditActor, ctx: RequestContext) {
    const filter = filterOf(query);
    const rows = await auditLogRepository.findMany(filter, EXPORT_LIMIT);
    await auditService.record({
      action: 'audit_logs.export',
      resource: 'audit_log',
      actor,
      context: ctx,
      severity: 'MEDIUM',
      metadata: { format: query.format, rowCount: rows.length, filter },
    });
    return query.format === 'json'
      ? { contentType: 'application/json', body: JSON.stringify(rows, null, 2), extension: 'json' }
      : { contentType: 'text/csv', body: toCsv(rows), extension: 'csv' };
  },
};
