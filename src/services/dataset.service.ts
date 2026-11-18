import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import type { AuthContext } from '../middleware/authorize';
import { analyzeCsv, CsvValidationError, decodeCsv, type CsvAnalysis } from '../utils/csv';
import { sha256 } from '../utils/crypto';
import { AppError, Errors } from '../utils/errors';
import { stringList } from '../utils/jsonList';
import { paginate, toSkipTake } from '../utils/pagination';
import type { ListDatasetsQuery, UpdateDatasetInput, UploadDatasetInput } from '../validators/asset.validators';
import { auditService } from './audit.service';
import { experimentService } from './experiments/experiment.service';
import { canManageDatasets, canViewDataset, datasetVisibilityWhere } from './experiments/sources';
import { settingsService } from './settings.service';
import { getStorage } from './storage';

const MASK = '•••';
const ALLOWED_MIME = new Set(['text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel', 'text/x-csv', 'application/octet-stream']);

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const summarySelect = {
  id: true,
  name: true,
  description: true,
  fileName: true,
  sizeBytes: true,
  rowCount: true,
  columnCount: true,
  status: true,
  targetColumn: true,
  sensitiveColumns: true,
  isShared: true,
  isSynthetic: true,
  containsPersonalData: true,
  createdAt: true,
  updatedAt: true,
  owner: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.DatasetSelect;

const ownerName = (o: { firstName: string; lastName: string }) => `${o.firstName} ${o.lastName}`.trim();

function assertColumns(columns: string[], names: (string | null | undefined)[]) {
  const unknown = names.filter((n): n is string => !!n && !columns.includes(n));
  if (unknown.length) throw Errors.validation(unknown.map((n) => ({ path: 'columns', message: `Column "${n}" does not exist in the dataset` })));
}

function canEdit(dataset: { ownerId: string }, auth: AuthContext) {
  return dataset.ownerId === auth.actor.id || canManageDatasets(auth);
}

async function findVisible(id: string, auth: AuthContext) {
  const dataset = await prisma.dataset.findUnique({ where: { id } });
  if (!dataset || !canViewDataset(dataset, auth)) throw Errors.notFound('Dataset');
  return dataset;
}

export const datasetService = {
  async list(auth: AuthContext, query: ListDatasetsQuery) {
    const where: Prisma.DatasetWhereInput = {
      AND: [
        datasetVisibilityWhere(auth),
        query.mine ? { ownerId: auth.actor.id } : {},
        query.status ? { status: query.status } : {},
        query.search ? { OR: [{ name: { contains: query.search } }, { description: { contains: query.search } }] } : {},
      ],
    };
    const [items, total] = await prisma.$transaction([
      prisma.dataset.findMany({ where, select: summarySelect, orderBy: { createdAt: 'desc' }, ...toSkipTake(query) }),
      prisma.dataset.count({ where }),
    ]);
    return paginate(
      items.map(({ owner, ...d }) => ({ ...d, owner: { id: owner.id, name: ownerName(owner) }, canEdit: owner.id === auth.actor.id || canManageDatasets(auth) })),
      total,
      query,
    );
  },

  async get(auth: AuthContext, id: string) {
    await findVisible(id, auth);
    const dataset = await prisma.dataset.findUniqueOrThrow({
      where: { id },
      select: {
        ...summarySelect,
        checksumSha256: true,
        duplicateRowCount: true,
        missingCellCount: true,
        validationErrors: true,
        profile: true,
        retentionUntil: true,
        columns: { orderBy: { position: 'asc' }, select: { name: true, position: true, dataType: true, isSensitive: true, isTarget: true, missingCount: true, uniqueCount: true, stats: true } },
        models: { select: { id: true, name: true, lifecycleStage: true } },
        _count: { select: { experiments: true } },
      },
    });
    const analysis = await prisma.experiment.findFirst({
      where: { datasetId: id, type: 'DATASET_ANALYSIS' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, error: true, createdAt: true, completedAt: true },
    });
    const { owner, _count, ...rest } = dataset;
    return {
      ...rest,
      owner: { id: owner.id, name: ownerName(owner) },
      experimentCount: _count.experiments,
      analysis,
      canEdit: owner.id === auth.actor.id || canManageDatasets(auth),
    };
  },

  async upload(auth: AuthContext, file: UploadedFile | undefined, input: UploadDatasetInput) {
    if (!file) throw Errors.validation([{ path: 'file', message: 'Choose a CSV file to upload' }]);
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.csv' || !ALLOWED_MIME.has(file.mimetype)) {
      throw Errors.validation([{ path: 'file', message: 'Only .csv files are accepted' }]);
    }
    const maxMb = await settingsService.get('uploads.maxDatasetSizeMb');
    if (file.size > maxMb * 1024 * 1024) throw new AppError(413, 'PAYLOAD_TOO_LARGE', `The file exceeds the ${maxMb} MB upload limit`);

    let analysis: CsvAnalysis;
    let text: string;
    try {
      text = decodeCsv(file.buffer);
      analysis = analyzeCsv(text);
    } catch (err) {
      if (err instanceof CsvValidationError) {
        await auditService.record({
          action: 'dataset.upload_rejected',
          resource: 'dataset',
          actor: auth.actor,
          context: auth.ctx,
          result: 'FAILURE',
          metadata: { fileName: file.originalname, sizeBytes: file.size, issues: err.issues.slice(0, 10) },
        });
        throw new AppError(422, 'INVALID_DATASET', err.message, err.issues.slice(0, 50));
      }
      throw err;
    }
    assertColumns(analysis.headers, [input.targetColumn, ...input.sensitiveColumns]);

    const checksum = sha256(text);
    const id = randomUUID();
    const storageKey = `datasets/${auth.actor.id}/${id}.csv`;
    await getStorage().put(storageKey, Buffer.from(text, 'utf8'), 'text/csv');
    const retentionDays = await settingsService.get('privacy.datasetRetentionDays');
    const sensitive = new Set(input.sensitiveColumns);

    const dataset = await prisma.$transaction(async (tx) => {
      const created = await tx.dataset.create({
        data: {
          id,
          name: input.name,
          description: input.description,
          ownerId: auth.actor.id,
          fileName: path.basename(file.originalname).slice(0, 255),
          storageKey,
          sizeBytes: Buffer.byteLength(text),
          checksumSha256: checksum,
          rowCount: analysis.rowCount,
          columnCount: analysis.columnCount,
          duplicateRowCount: analysis.duplicateRowCount,
          missingCellCount: analysis.missingCellCount,
          status: 'READY',
          validationErrors: analysis.warnings.length ? ({ warnings: analysis.warnings } as Prisma.InputJsonValue) : undefined,
          targetColumn: input.targetColumn,
          sensitiveColumns: [...sensitive],
          isShared: input.isShared ?? false,
          isSynthetic: input.isSynthetic ?? false,
          containsPersonalData: input.containsPersonalData ?? false,
          retentionUntil: new Date(Date.now() + retentionDays * 86_400_000),
          createdById: auth.actor.id,
          columns: {
            create: analysis.columns.map((c) => ({
              name: c.name,
              position: c.position,
              dataType: c.dataType,
              isSensitive: sensitive.has(c.name),
              isTarget: c.name === input.targetColumn,
              missingCount: c.missingCount,
              uniqueCount: c.uniqueCount,
              stats: c.stats as Prisma.InputJsonValue,
            })),
          },
        },
      });
      await auditService.record(
        {
          action: 'dataset.uploaded',
          resource: 'dataset',
          resourceId: created.id,
          actor: auth.actor,
          context: auth.ctx,
          after: { name: created.name, rows: analysis.rowCount, columns: analysis.columnCount, sha256: checksum, isShared: created.isShared },
        },
        tx,
      );
      return created;
    });

    await experimentService.createSystem('DATASET_ANALYSIS', { datasetId: dataset.id }, auth.actor.id, `Profile: ${dataset.name}`);
    return { ...(await this.get(auth, dataset.id)), warnings: analysis.warnings };
  },

  async update(auth: AuthContext, id: string, input: UpdateDatasetInput) {
    const before = await findVisible(id, auth);
    if (!canEdit(before, auth)) throw Errors.forbidden('Only the owner or a data manager can edit this dataset');
    const columns = (await prisma.datasetColumn.findMany({ where: { datasetId: id }, select: { name: true } })).map((c) => c.name);
    assertColumns(columns, [input.targetColumn, ...(input.sensitiveColumns ?? [])]);
    const target = input.targetColumn !== undefined ? input.targetColumn : before.targetColumn;
    const sensitive = input.sensitiveColumns ?? stringList(before.sensitiveColumns);
    if (target && sensitive.includes(target)) {
      throw Errors.validation([{ path: 'targetColumn', message: 'The target cannot also be a sensitive column' }]);
    }

    const after = await prisma.$transaction(async (tx) => {
      const updated = await tx.dataset.update({ where: { id }, data: { ...input, updatedById: auth.actor.id } });
      if (input.targetColumn !== undefined) {
        await tx.datasetColumn.updateMany({ where: { datasetId: id }, data: { isTarget: false } });
        if (input.targetColumn) await tx.datasetColumn.updateMany({ where: { datasetId: id, name: input.targetColumn }, data: { isTarget: true } });
      }
      if (input.sensitiveColumns) {
        await tx.datasetColumn.updateMany({ where: { datasetId: id }, data: { isSensitive: false } });
        await tx.datasetColumn.updateMany({ where: { datasetId: id, name: { in: input.sensitiveColumns } }, data: { isSensitive: true } });
      }
      const fields = Object.keys(input) as (keyof UpdateDatasetInput)[];
      await auditService.record(
        {
          action: 'dataset.updated',
          resource: 'dataset',
          resourceId: id,
          actor: auth.actor,
          context: auth.ctx,
          before: Object.fromEntries(fields.map((f) => [f, before[f]])),
          after: Object.fromEntries(fields.map((f) => [f, updated[f]])),
          severity: input.sensitiveColumns || input.isShared !== undefined ? 'LOW' : 'INFO',
        },
        tx,
      );
      return updated;
    });
    return this.get(auth, after.id);
  },

  /** Row preview. Sensitive columns are masked for anyone but the owner and data managers when masking is enabled. */
  async preview(auth: AuthContext, id: string, query: { limit: number; offset: number }) {
    const dataset = await findVisible(id, auth);
    const text = (await getStorage().get(dataset.storageKey)).toString('utf8');
    const { headers, rows } = analyzeCsv(text);
    const maskEnabled = await settingsService.get('privacy.maskSensitiveFields');
    const masked = maskEnabled && !canEdit(dataset, auth) ? stringList(dataset.sensitiveColumns).filter((c) => headers.includes(c)) : [];
    const maskIdx = new Set(masked.map((c) => headers.indexOf(c)));
    const page = rows.slice(query.offset, query.offset + query.limit).map((r) => r.map((v, i) => (maskIdx.has(i) && v !== '' ? MASK : v)));
    return { headers, rows: page, total: rows.length, offset: query.offset, maskedColumns: masked };
  },

  async download(auth: AuthContext, id: string) {
    const dataset = await findVisible(id, auth);
    if (!canEdit(dataset, auth)) throw Errors.forbidden('Only the owner or a data manager can download the raw file');
    const body = await getStorage().get(dataset.storageKey);
    await auditService.record({
      action: 'dataset.downloaded',
      resource: 'dataset',
      resourceId: id,
      actor: auth.actor,
      context: auth.ctx,
      severity: dataset.containsPersonalData ? 'MEDIUM' : 'INFO',
    });
    return { body, fileName: dataset.fileName };
  },

  /** Soft-deletes the record (kept for lineage/audit) and removes the stored file (data minimisation). */
  async remove(auth: AuthContext, id: string, reason: string) {
    const dataset = await findVisible(id, auth);
    if (!canEdit(dataset, auth)) throw Errors.forbidden('Only the owner or a data manager can delete this dataset');
    const active = await prisma.experiment.count({ where: { datasetId: id, status: { in: ['QUEUED', 'RUNNING'] } } });
    if (active) throw Errors.conflict('Wait for running experiments on this dataset to finish before deleting it');
    await prisma.$transaction(async (tx) => {
      await tx.dataset.update({ where: { id }, data: { status: 'DELETED', deletedAt: new Date(), isShared: false, updatedById: auth.actor.id } });
      await auditService.record(
        { action: 'dataset.deleted', resource: 'dataset', resourceId: id, actor: auth.actor, context: auth.ctx, reason, severity: 'MEDIUM', before: { name: dataset.name, sha256: dataset.checksumSha256 } },
        tx,
      );
    });
    await getStorage().delete(dataset.storageKey);
  },

  async analyze(auth: AuthContext, id: string) {
    const dataset = await findVisible(id, auth);
    if (dataset.status !== 'READY') throw Errors.conflict('Only ready datasets can be analysed');
    return experimentService.create(auth, { type: 'DATASET_ANALYSIS', name: `Profile: ${dataset.name}`, params: { datasetId: id } });
  },
};
