import type { ExperimentType, LabType, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import type { AuthContext } from '../middleware/authorize';
import { PERMISSIONS } from '../rbac/permissions';
import { Errors } from '../utils/errors';
import type { LabInput } from '../validators/learning.validators';
import { auditService } from './audit.service';
import { notificationService } from './notification.service';

/** Experiment types that count as evidence for completing a lab of the given type. */
export const LAB_EXPERIMENT_TYPES: Partial<Record<LabType, ExperimentType[]>> = {
  XAI: ['SHAP', 'LIME', 'COUNTERFACTUAL', 'GRAD_CAM'],
  FAIRNESS: ['FAIRNESS_AUDIT', 'FAIRNESS_MITIGATION'],
  ROBUSTNESS: ['FGSM', 'PGD', 'ADVERSARIAL_TRAINING'],
};

const MIN_REFLECTION_CHARS = 50;

function visibleLabs(auth: AuthContext): Prisma.LabWhereInput {
  if (auth.can(PERMISSIONS.LABS_MANAGE)) return {};
  return { OR: [{ courseId: null }, { course: { status: 'PUBLISHED' } }] };
}

export const labService = {
  async list(auth: AuthContext) {
    const labs = await prisma.lab.findMany({
      where: visibleLabs(auth),
      orderBy: [{ type: 'asc' }, { title: 'asc' }],
      include: {
        course: { select: { id: true, title: true } },
        module: { select: { id: true, title: true, order: true } },
        attempts: { where: { userId: auth.actor.id }, orderBy: { startedAt: 'desc' }, take: 1 },
      },
    });
    return labs.map(({ attempts, ...lab }) => ({
      ...lab,
      evidenceTypes: LAB_EXPERIMENT_TYPES[lab.type] ?? [],
      myLatestAttempt: attempts[0] ?? null,
    }));
  },

  async get(auth: AuthContext, idOrSlug: string) {
    const isUuid = /^[0-9a-f-]{36}$/i.test(idOrSlug);
    const lab = await prisma.lab.findFirst({
      where: { AND: [isUuid ? { id: idOrSlug } : { slug: idOrSlug }, visibleLabs(auth)] },
      include: {
        course: { select: { id: true, title: true } },
        module: { select: { id: true, title: true, order: true } },
        attempts: {
          where: { userId: auth.actor.id },
          orderBy: { startedAt: 'desc' },
          include: { experiment: { select: { id: true, type: true, status: true, name: true, createdAt: true } } },
        },
      },
    });
    if (!lab) throw Errors.notFound('Lab');
    return { ...lab, evidenceTypes: LAB_EXPERIMENT_TYPES[lab.type] ?? [] };
  },

  async startAttempt(auth: AuthContext, labId: string) {
    const lab = await this.get(auth, labId);
    const open = lab.attempts.find((a) => a.status === 'IN_PROGRESS');
    if (open) return open;
    const attempt = await prisma.labAttempt.create({ data: { labId: lab.id, userId: auth.actor.id } });
    await auditService.record({ action: 'lab.attempt_start', resource: 'lab', resourceId: lab.id, actor: auth.actor, context: auth.ctx, metadata: { attemptId: attempt.id } });
    return attempt;
  },

  async complete(auth: AuthContext, attemptId: string, input: { experimentId?: string; notes?: string }) {
    const attempt = await prisma.labAttempt.findUnique({ where: { id: attemptId }, include: { lab: true } });
    if (!attempt || attempt.userId !== auth.actor.id) throw Errors.notFound('Lab attempt');
    if (attempt.status === 'COMPLETED') throw Errors.conflict('This lab attempt is already completed');

    const evidenceTypes = LAB_EXPERIMENT_TYPES[attempt.lab.type];
    if (evidenceTypes) {
      if (!input.experimentId) throw Errors.badRequest('Link a completed experiment as evidence for this lab');
      const experiment = await prisma.experiment.findUnique({ where: { id: input.experimentId } });
      if (!experiment || experiment.userId !== auth.actor.id) throw Errors.badRequest('The experiment must be one of your own');
      if (experiment.status !== 'COMPLETED') throw Errors.badRequest('Only completed experiments can be used as evidence');
      if (!evidenceTypes.includes(experiment.type)) {
        throw Errors.badRequest(`This lab requires one of: ${evidenceTypes.join(', ')}`);
      }
    } else if ((input.notes ?? '').length < MIN_REFLECTION_CHARS) {
      throw Errors.badRequest(`Write a reflection of at least ${MIN_REFLECTION_CHARS} characters to complete this lab`);
    }

    const completed = await prisma.labAttempt.update({
      where: { id: attemptId },
      data: { status: 'COMPLETED', completedAt: new Date(), experimentId: input.experimentId ?? null, notes: input.notes ?? null },
    });
    await auditService.record({
      action: 'lab.attempt_complete',
      resource: 'lab',
      resourceId: attempt.labId,
      actor: auth.actor,
      context: auth.ctx,
      metadata: { attemptId, experimentId: input.experimentId ?? null },
    });
    await notificationService.notify(auth.actor.id, {
      type: 'LAB_COMPLETED',
      title: 'Lab completed',
      message: `You completed "${attempt.lab.title}".`,
      link: `/labs`,
    });
    return completed;
  },

  async create(auth: AuthContext, input: LabInput) {
    const lab = await prisma.lab.create({
      data: { ...input, config: (input.config ?? undefined) as Prisma.InputJsonValue | undefined, createdById: auth.actor.id, updatedById: auth.actor.id },
    });
    await auditService.record({ action: 'lab.create', resource: 'lab', resourceId: lab.id, actor: auth.actor, context: auth.ctx, after: lab });
    return lab;
  },

  async update(auth: AuthContext, id: string, input: Partial<LabInput>) {
    const before = await prisma.lab.findUnique({ where: { id } });
    if (!before) throw Errors.notFound('Lab');
    const lab = await prisma.lab.update({
      where: { id },
      data: {
        ...input,
        config: input.config === undefined ? undefined : ((input.config ?? {}) as Prisma.InputJsonValue),
        updatedById: auth.actor.id,
      },
    });
    await auditService.record({ action: 'lab.update', resource: 'lab', resourceId: id, actor: auth.actor, context: auth.ctx, before, after: lab });
    return lab;
  },
};
