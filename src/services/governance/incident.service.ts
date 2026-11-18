import type { AIIncident, AuditSeverity, IncidentSeverity, IncidentStatus, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import type { AuthContext } from '../../middleware/authorize';
import { PERMISSIONS } from '../../rbac/permissions';
import { Errors } from '../../utils/errors';
import { paginate, toSkipTake } from '../../utils/pagination';
import type { ListIncidentsQuery, ReportIncidentInput, UpdateIncidentInput } from '../../validators/governance.validators';
import { auditService } from '../audit.service';
import { notificationService } from '../notification.service';
import { assertRefs, changes, person, userSelect } from './shared';

const RESOURCE = 'incident';
const ORDER: IncidentStatus[] = ['OPEN', 'INVESTIGATING', 'MITIGATED', 'RESOLVED', 'CLOSED'];
const ACTIVE: IncidentStatus[] = ['OPEN', 'INVESTIGATING', 'MITIGATED'];
const AUDIT_SEVERITY: Record<IncidentSeverity, AuditSeverity> = { LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH', CRITICAL: 'CRITICAL' };

const include = {
  reportedBy: { select: userSelect },
  assignedTo: { select: userSelect },
  aiSystem: { select: { id: true, name: true } },
  model: { select: { id: true, name: true } },
} satisfies Prisma.AIIncidentInclude;
type Row = Prisma.AIIncidentGetPayload<{ include: typeof include }>;

const seesAll = (auth: AuthContext) => auth.can(PERMISSIONS.GOVERNANCE_READ) || auth.can(PERMISSIONS.INCIDENTS_MANAGE);

function present(row: Row, auth: AuthContext) {
  const { reportedBy, assignedTo, ...rest } = row;
  return { ...rest, reportedBy: person(reportedBy), assignedTo: person(assignedTo), permissions: { manage: auth.can(PERMISSIONS.INCIDENTS_MANAGE) } };
}

async function find(id: string, auth: AuthContext) {
  const row = await prisma.aIIncident.findUnique({ where: { id }, include });
  if (!row || (!seesAll(auth) && row.reportedById !== auth.actor.id)) throw Errors.notFound('Incident');
  return row;
}

/**
 * Incidents move forward through the lifecycle; the only backward move is reopening a resolved or
 * closed incident for further investigation. Resolution requires a recorded root cause and corrective actions.
 */
export function checkTransition(row: Pick<AIIncident, 'status' | 'rootCause' | 'correctiveActions'>, input: UpdateIncidentInput) {
  const to = input.status;
  if (!to || to === row.status) return;
  const reopen = to === 'INVESTIGATING' && (row.status === 'RESOLVED' || row.status === 'CLOSED');
  if (ORDER.indexOf(to) < ORDER.indexOf(row.status) && !reopen) throw Errors.conflict(`An incident cannot move from ${row.status.toLowerCase()} back to ${to.toLowerCase()}`);
  if (reopen && !input.note) throw Errors.validation([{ path: 'note', message: 'Explain why the incident is being reopened' }]);
  if (to === 'CLOSED' && row.status !== 'RESOLVED') throw Errors.conflict('Resolve the incident before closing it');
  if (to === 'RESOLVED' || to === 'CLOSED') {
    const issues = [];
    if (!(input.rootCause ?? row.rootCause)) issues.push({ path: 'rootCause', message: 'Record the root cause before resolving' });
    if (!(input.correctiveActions ?? row.correctiveActions)) issues.push({ path: 'correctiveActions', message: 'Record the corrective actions before resolving' });
    if (issues.length) throw Errors.validation(issues);
  }
}

export const incidentService = {
  async list(auth: AuthContext, q: ListIncidentsQuery) {
    const where: Prisma.AIIncidentWhereInput = {
      status: q.status,
      severity: q.severity,
      aiSystemId: q.aiSystemId,
      reportedById: q.mine || !seesAll(auth) ? auth.actor.id : undefined,
      title: q.search ? { contains: q.search } : undefined,
    };
    const [rows, total] = await Promise.all([
      prisma.aIIncident.findMany({ where, include, orderBy: [{ detectedAt: 'desc' }], ...toSkipTake(q) }),
      prisma.aIIncident.count({ where }),
    ]);
    return paginate(
      rows.map((r) => present(r, auth)),
      total,
      q,
    );
  },

  async get(auth: AuthContext, id: string) {
    return present(await find(id, auth), auth);
  },

  async report(auth: AuthContext, input: ReportIncidentInput) {
    await assertRefs({ aiSystemId: input.aiSystemId, modelId: input.modelId });
    if (input.occurredAt && input.occurredAt > new Date()) throw Errors.validation([{ path: 'occurredAt', message: 'The occurrence date cannot be in the future' }]);
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.aIIncident.create({ data: { ...input, reportedById: auth.actor.id, createdById: auth.actor.id } });
      await auditService.record(
        { action: `${RESOURCE}.reported`, resource: RESOURCE, resourceId: row.id, actor: auth.actor, context: auth.ctx, severity: AUDIT_SEVERITY[row.severity], after: { title: row.title, severity: row.severity } },
        tx,
      );
      if (row.severity === 'HIGH' || row.severity === 'CRITICAL') {
        await notificationService.notifyPermissionHolders(
          PERMISSIONS.INCIDENTS_MANAGE,
          { type: 'GOVERNANCE_REVIEW_REQUIRED', title: `${row.severity} AI incident reported`, message: row.title, link: `/governance/incidents?id=${row.id}` },
          tx,
          { exclude: [auth.actor.id] },
        );
      }
      return row;
    });
    return this.get(auth, created.id);
  },

  async update(auth: AuthContext, id: string, input: UpdateIncidentInput) {
    const row = await find(id, auth);
    checkTransition(row, input);
    await assertRefs({ userId: [['assignedToId', input.assignedToId]] });
    const { note, ...fields } = input;
    const diff = changes(row as AIIncident, fields as Partial<AIIncident>);
    if (!diff.keys.length && !note) return this.get(auth, id);
    const resolving = fields.status && (fields.status === 'RESOLVED' || fields.status === 'CLOSED');
    const reopening = fields.status && ACTIVE.includes(fields.status);
    await prisma.$transaction(async (tx) => {
      await tx.aIIncident.update({
        where: { id },
        data: { ...fields, resolvedAt: resolving ? (row.resolvedAt ?? new Date()) : reopening ? null : undefined, updatedById: auth.actor.id },
      });
      await auditService.record(
        {
          action: diff.keys.includes('status') ? `${RESOURCE}.status_changed` : `${RESOURCE}.updated`,
          resource: RESOURCE,
          resourceId: id,
          actor: auth.actor,
          context: auth.ctx,
          before: diff.before,
          after: diff.after,
          reason: note || undefined,
          severity: AUDIT_SEVERITY[fields.severity ?? row.severity],
        },
        tx,
      );
      if (fields.assignedToId && fields.assignedToId !== row.assignedToId && fields.assignedToId !== auth.actor.id) {
        await notificationService.notify(fields.assignedToId, { type: 'SYSTEM', title: 'AI incident assigned to you', message: row.title, link: `/governance/incidents?id=${id}` }, tx);
      }
    });
    return this.get(auth, id);
  },

  async history(auth: AuthContext, id: string) {
    await find(id, auth);
    return auditService.history(RESOURCE, id);
  },
};
