import { AuditResult, AuditSeverity, RoleName } from '@prisma/client';
import { z } from 'zod';
import { paginationSchema } from '../utils/pagination';

export const auditLogFilterSchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    userId: z.string().uuid().optional(),
    role: z.nativeEnum(RoleName).optional(),
    action: z.string().trim().max(100).optional(),
    resource: z.string().trim().max(100).optional(),
    resourceId: z.string().trim().max(100).optional(),
    severity: z.nativeEnum(AuditSeverity).optional(),
    result: z.nativeEnum(AuditResult).optional(),
    search: z.string().trim().max(100).optional(),
  })
  .refine((d) => !d.from || !d.to || d.from <= d.to, { message: '`from` must be before `to`', path: ['from'] });

export const listAuditLogsQuery = paginationSchema.and(auditLogFilterSchema);

export const exportAuditLogsQuery = z
  .object({ format: z.enum(['csv', 'json']).default('csv') })
  .and(auditLogFilterSchema);

export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuery>;
export type ExportAuditLogsQuery = z.infer<typeof exportAuditLogsQuery>;
