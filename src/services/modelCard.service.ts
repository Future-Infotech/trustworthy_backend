import type { ModelCard, ModelCardStatus, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import type { AuthContext } from '../middleware/authorize';
import { PERMISSIONS } from '../rbac/permissions';
import { AppError, Errors } from '../utils/errors';
import { paginate, toSkipTake } from '../utils/pagination';
import {
  modelCardContentSchema,
  type CreateModelCardInput,
  type ListModelCardsQuery,
  type ModelCardContent,
  type UpdateModelCardInput,
} from '../validators/modelCard.validators';
import { auditService } from './audit.service';
import { prefill, readiness, toDocument, verifyEvidence } from './modelCards/content';
import { notificationService } from './notification.service';
import { toMarkdown, toPdf } from './reports/document';

const OPEN: ModelCardStatus[] = ['DRAFT', 'IN_REVIEW'];

const include = {
  owner: { select: { id: true, firstName: true, lastName: true } },
  model: { select: { id: true, name: true, lifecycleStage: true } },
} satisfies Prisma.ModelCardInclude;

type CardRow = Prisma.ModelCardGetPayload<{ include: typeof include }>;

const fullName = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`.trim();
const isReviewer = (auth: AuthContext) => auth.can(PERMISSIONS.MODEL_CARDS_PUBLISH);

/** Unpublished cards are visible to their owner and to reviewers; published and archived cards to every reader. */
function canView(card: Pick<ModelCard, 'status' | 'ownerId'>, auth: AuthContext) {
  return !OPEN.includes(card.status) || card.ownerId === auth.actor.id || isReviewer(auth);
}

export function visibilityFilter(auth: AuthContext): Prisma.ModelCardWhereInput {
  return isReviewer(auth) ? {} : { OR: [{ status: { notIn: OPEN } }, { ownerId: auth.actor.id }] };
}

function parseContent(card: Pick<ModelCard, 'content'>): ModelCardContent {
  return modelCardContentSchema.parse(card.content ?? {});
}

function present(card: CardRow, auth: AuthContext) {
  const content = parseContent(card);
  const { owner, model, ...rest } = card;
  const own = card.ownerId === auth.actor.id;
  return {
    ...rest,
    content,
    owner: { id: owner.id, name: fullName(owner) },
    model,
    readiness: readiness(content),
    permissions: {
      edit: own && card.status === 'DRAFT',
      submit: own && card.status === 'DRAFT',
      withdraw: own && card.status === 'IN_REVIEW',
      review: isReviewer(auth) && !own && card.status === 'IN_REVIEW',
      newVersion: own && auth.can(PERMISSIONS.MODEL_CARDS_MANAGE) && !OPEN.includes(card.status),
      archive: (own || isReviewer(auth)) && card.status === 'PUBLISHED',
      delete: own && card.status === 'DRAFT' && !card.publishedAt,
    },
  };
}

async function findCard(id: string, auth: AuthContext) {
  const card = await prisma.modelCard.findUnique({ where: { id }, include });
  if (!card || !canView(card, auth)) throw Errors.notFound('Model card');
  return card;
}

function requireOwner(card: ModelCard, auth: AuthContext, action: string) {
  if (card.ownerId !== auth.actor.id) throw Errors.forbidden(`Only the card owner can ${action}`);
}

function requireStatus(card: ModelCard, allowed: ModelCardStatus[], action: string) {
  if (!allowed.includes(card.status)) throw Errors.conflict(`A ${card.status.toLowerCase().replace('_', ' ')} card cannot be ${action}`);
}

/** All cards in the same version lineage (root and descendants). */
async function lineage(card: Pick<ModelCard, 'id' | 'parentCardId'>) {
  let root = card;
  const seen = new Set<string>([card.id]);
  while (root.parentCardId && !seen.has(root.parentCardId)) {
    const parent = await prisma.modelCard.findUnique({ where: { id: root.parentCardId }, select: { id: true, parentCardId: true } });
    if (!parent) break;
    seen.add(parent.id);
    root = parent;
  }
  const ids = [root.id];
  for (let frontier = [root.id]; frontier.length; ) {
    const children = await prisma.modelCard.findMany({ where: { parentCardId: { in: frontier } }, select: { id: true } });
    frontier = children.map((c) => c.id).filter((id) => !ids.includes(id));
    ids.push(...frontier);
  }
  return ids;
}

export function nextVersion(current: string) {
  const parts = current.split('.');
  const last = Number(parts.at(-1));
  return Number.isInteger(last) ? [...parts.slice(0, -1), String(last + 1)].join('.') : `${current}.1`;
}

async function assertModel(modelId: string | null | undefined) {
  if (modelId && !(await prisma.aIModel.findUnique({ where: { id: modelId }, select: { id: true } }))) {
    throw Errors.validation([{ path: 'modelId', message: 'Model not found' }]);
  }
}

export const modelCardService = {
  async list(auth: AuthContext, query: ListModelCardsQuery) {
    const where: Prisma.ModelCardWhereInput = {
      AND: [
        visibilityFilter(auth),
        query.status ? { status: query.status } : {},
        query.modelId ? { modelId: query.modelId } : {},
        query.mine ? { ownerId: auth.actor.id } : {},
        query.search ? { name: { contains: query.search } } : {},
      ],
    };
    const [rows, total] = await Promise.all([
      prisma.modelCard.findMany({ where, include, orderBy: { updatedAt: 'desc' }, ...toSkipTake(query) }),
      prisma.modelCard.count({ where }),
    ]);
    const data = rows.map(({ content: _c, owner, ...r }) => ({ ...r, owner: { id: owner.id, name: fullName(owner) } }));
    return paginate(data, total, query);
  },

  async get(auth: AuthContext, id: string) {
    return present(await findCard(id, auth), auth);
  },

  prefill(modelId: string, versionId?: string) {
    return prefill(modelId, versionId);
  },

  async create(auth: AuthContext, { modelId, content }: CreateModelCardInput) {
    await assertModel(modelId);
    await verifyEvidence(content, modelId);
    const card = await prisma.$transaction(async (tx) => {
      const created = await tx.modelCard.create({
        data: { modelId: modelId ?? null, name: content.modelName, version: content.version, content: content as Prisma.InputJsonValue, ownerId: auth.actor.id, createdById: auth.actor.id },
      });
      await auditService.record({ action: 'model_card.created', resource: 'model_card', resourceId: created.id, actor: auth.actor, context: auth.ctx, after: { name: created.name, version: created.version, modelId } }, tx);
      return created;
    });
    return this.get(auth, card.id);
  },

  async update(auth: AuthContext, id: string, { content }: UpdateModelCardInput) {
    const card = await findCard(id, auth);
    requireOwner(card, auth, 'edit it');
    requireStatus(card, ['DRAFT'], 'edited; withdraw it from review or create a new version');
    await verifyEvidence(content, card.modelId);
    const before = parseContent(card);
    const changed = (Object.keys(content) as (keyof ModelCardContent)[]).filter((k) => JSON.stringify(content[k]) !== JSON.stringify(before[k]));
    await prisma.$transaction(async (tx) => {
      await tx.modelCard.update({ where: { id }, data: { content: content as Prisma.InputJsonValue, name: content.modelName, version: content.version, updatedById: auth.actor.id } });
      await auditService.record({ action: 'model_card.updated', resource: 'model_card', resourceId: id, actor: auth.actor, context: auth.ctx, metadata: { changedFields: changed } }, tx);
    });
    return this.get(auth, id);
  },

  async submit(auth: AuthContext, id: string) {
    const card = await findCard(id, auth);
    requireOwner(card, auth, 'submit it');
    requireStatus(card, ['DRAFT'], 'submitted');
    const content = parseContent(card);
    const check = readiness(content);
    if (!check.ready) throw new AppError(422, 'CARD_INCOMPLETE', 'Complete the required fields before submitting for review', check.missing);
    await verifyEvidence(content, card.modelId);
    await prisma.$transaction(async (tx) => {
      await tx.modelCard.update({ where: { id }, data: { status: 'IN_REVIEW', updatedById: auth.actor.id } });
      await auditService.record(
        { action: 'model_card.submitted', resource: 'model_card', resourceId: id, actor: auth.actor, context: auth.ctx, before: { status: 'DRAFT' }, after: { status: 'IN_REVIEW' }, metadata: { concerns: check.concerns } },
        tx,
      );
      await notificationService.notifyPermissionHolders(
        PERMISSIONS.MODEL_CARDS_PUBLISH,
        { type: 'GOVERNANCE_REVIEW_REQUIRED', title: 'Model card awaiting review', message: `${card.name} v${card.version} was submitted for publication.`, link: `/model-cards/${id}` },
        tx,
        { exclude: [card.ownerId] },
      );
    });
    return this.get(auth, id);
  },

  async withdraw(auth: AuthContext, id: string) {
    const card = await findCard(id, auth);
    requireOwner(card, auth, 'withdraw it');
    requireStatus(card, ['IN_REVIEW'], 'withdrawn');
    await prisma.$transaction(async (tx) => {
      await tx.modelCard.update({ where: { id }, data: { status: 'DRAFT', updatedById: auth.actor.id } });
      await auditService.record({ action: 'model_card.withdrawn', resource: 'model_card', resourceId: id, actor: auth.actor, context: auth.ctx, before: { status: 'IN_REVIEW' }, after: { status: 'DRAFT' } }, tx);
    });
    return this.get(auth, id);
  },

  /** Reviewer decision. The owner can never publish their own card (segregation of duties). */
  async review(auth: AuthContext, id: string, { decision, comment }: { decision: 'PUBLISH' | 'REQUEST_CHANGES'; comment: string }) {
    const card = await findCard(id, auth);
    requireStatus(card, ['IN_REVIEW'], 'reviewed');
    if (card.ownerId === auth.actor.id) {
      await auditService.record({ action: 'model_card.review_blocked', resource: 'model_card', resourceId: id, actor: auth.actor, context: auth.ctx, result: 'DENIED', severity: 'MEDIUM', reason: 'Segregation of duties' });
      throw Errors.forbidden('Segregation of duties: you cannot review your own model card');
    }
    const publish = decision === 'PUBLISH';
    if (publish) await verifyEvidence(parseContent(card), card.modelId);
    const ids = publish ? await lineage(card) : [];
    await prisma.$transaction(async (tx) => {
      if (publish) {
        const superseded = await tx.modelCard.updateMany({ where: { id: { in: ids.filter((x) => x !== id) }, status: 'PUBLISHED' }, data: { status: 'ARCHIVED', updatedById: auth.actor.id } });
        await tx.modelCard.update({ where: { id }, data: { status: 'PUBLISHED', publishedAt: new Date(), publishedById: auth.actor.id, updatedById: auth.actor.id } });
        await auditService.record(
          { action: 'model_card.published', resource: 'model_card', resourceId: id, actor: auth.actor, context: auth.ctx, before: { status: 'IN_REVIEW' }, after: { status: 'PUBLISHED' }, reason: comment || undefined, severity: 'LOW', metadata: { supersededCards: superseded.count } },
          tx,
        );
      } else {
        await tx.modelCard.update({ where: { id }, data: { status: 'DRAFT', updatedById: auth.actor.id } });
        await auditService.record({ action: 'model_card.changes_requested', resource: 'model_card', resourceId: id, actor: auth.actor, context: auth.ctx, before: { status: 'IN_REVIEW' }, after: { status: 'DRAFT' }, reason: comment }, tx);
      }
      await notificationService.notify(
        card.ownerId,
        {
          type: 'SYSTEM',
          title: publish ? 'Model card published' : 'Changes requested on model card',
          message: publish ? `${card.name} v${card.version} is now published.` : `${card.name} v${card.version}: ${comment}`,
          link: `/model-cards/${id}`,
        },
        tx,
      );
    });
    return this.get(auth, id);
  },

  async newVersion(auth: AuthContext, id: string, requested?: string) {
    const card = await findCard(id, auth);
    requireOwner(card, auth, 'version it');
    requireStatus(card, ['PUBLISHED', 'ARCHIVED'], 'versioned; edit the open draft instead');
    const ids = await lineage(card);
    const family = await prisma.modelCard.findMany({ where: { id: { in: ids } }, select: { id: true, version: true, status: true } });
    const open = family.find((c) => OPEN.includes(c.status));
    if (open) throw Errors.conflict(`Version ${open.version} is already open (${open.status.toLowerCase().replace('_', ' ')}); finish it first`);
    const version = requested ?? nextVersion(family.map((c) => c.version).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1) ?? card.version);
    if (family.some((c) => c.version === version)) throw Errors.conflict(`Version ${version} already exists for this card`);
    const content = { ...parseContent(card), version };
    const created = await prisma.$transaction(async (tx) => {
      const draft = await tx.modelCard.create({
        data: { modelId: card.modelId, name: card.name, version, content: content as Prisma.InputJsonValue, parentCardId: card.id, ownerId: auth.actor.id, createdById: auth.actor.id },
      });
      await auditService.record({ action: 'model_card.version_created', resource: 'model_card', resourceId: draft.id, actor: auth.actor, context: auth.ctx, metadata: { fromCardId: id, fromVersion: card.version, version } }, tx);
      return draft;
    });
    return this.get(auth, created.id);
  },

  async archive(auth: AuthContext, id: string, reason: string) {
    const card = await findCard(id, auth);
    if (card.ownerId !== auth.actor.id && !isReviewer(auth)) throw Errors.forbidden('Only the owner or a reviewer can archive this card');
    requireStatus(card, ['PUBLISHED'], 'archived');
    await prisma.$transaction(async (tx) => {
      await tx.modelCard.update({ where: { id }, data: { status: 'ARCHIVED', updatedById: auth.actor.id } });
      await auditService.record({ action: 'model_card.archived', resource: 'model_card', resourceId: id, actor: auth.actor, context: auth.ctx, before: { status: 'PUBLISHED' }, after: { status: 'ARCHIVED' }, reason }, tx);
    });
    return this.get(auth, id);
  },

  async remove(auth: AuthContext, id: string) {
    const card = await findCard(id, auth);
    requireOwner(card, auth, 'delete it');
    if (card.status !== 'DRAFT' || card.publishedAt) throw Errors.conflict('Only never-published drafts can be deleted; archive published cards instead');
    await prisma.$transaction(async (tx) => {
      await tx.modelCard.delete({ where: { id } });
      await auditService.record({ action: 'model_card.deleted', resource: 'model_card', resourceId: id, actor: auth.actor, context: auth.ctx, before: { name: card.name, version: card.version } }, tx);
    });
  },

  async versions(auth: AuthContext, id: string) {
    const card = await findCard(id, auth);
    const rows = await prisma.modelCard.findMany({
      where: { AND: [{ id: { in: await lineage(card) } }, visibilityFilter(auth)] },
      select: { id: true, version: true, status: true, publishedAt: true, updatedAt: true, parentCardId: true },
      orderBy: { createdAt: 'asc' },
    });
    return { versions: rows };
  },

  async history(auth: AuthContext, id: string) {
    await findCard(id, auth);
    return auditService.history('model_card', id);
  },

  async export(auth: AuthContext, id: string, format: 'json' | 'md' | 'pdf') {
    const card = await findCard(id, auth);
    const content = parseContent(card);
    const base = `model-card-${card.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-v${card.version}`;
    await auditService.record({ action: 'model_card.exported', resource: 'model_card', resourceId: id, actor: auth.actor, context: auth.ctx, metadata: { format } });
    if (format === 'json') {
      const body = { id: card.id, status: card.status, version: card.version, publishedAt: card.publishedAt, modelId: card.modelId, content, readiness: readiness(content), exportedAt: new Date().toISOString() };
      return { body: Buffer.from(JSON.stringify(body, null, 2)), fileName: `${base}.json`, contentType: 'application/json' };
    }
    const doc = toDocument(card, content, fullName(card.owner));
    if (format === 'md') return { body: Buffer.from(toMarkdown(doc)), fileName: `${base}.md`, contentType: 'text/markdown; charset=utf-8' };
    return { body: await toPdf(doc), fileName: `${base}.pdf`, contentType: 'application/pdf' };
  },
};
