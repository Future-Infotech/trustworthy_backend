import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../../config/prisma';
import { PERMISSIONS } from '../../../rbac/permissions';
import { getUsableDataset, loadDatasetCsv } from '../sources';
import type { ExperimentHandler } from '../types';

const input = z.object({ datasetId: z.string().uuid() });

interface ProfileResult {
  rows: number;
  columns: number;
  duplicateRows: number;
  missingPercent: number;
  proxies: unknown[];
  warnings: unknown[];
}

export const datasetAnalysisHandler: ExperimentHandler<z.infer<typeof input>> = {
  type: 'DATASET_ANALYSIS',
  job: 'dataset.profile',
  permission: PERMISSIONS.EXPERIMENTS_RUN,
  input,
  notifyOnSuccess: false,

  async prepare({ datasetId }, auth) {
    const dataset = auth ? await getUsableDataset(datasetId, auth) : await prisma.dataset.findUniqueOrThrow({ where: { id: datasetId } });
    return { datasetId, randomSeed: 0, hashInputs: { sha256: dataset.checksumSha256, target: dataset.targetColumn, sensitive: dataset.sensitiveColumns } };
  },

  async jobParams({ datasetId }) {
    const [{ csv, sha256 }, dataset] = await Promise.all([loadDatasetCsv(datasetId), prisma.dataset.findUniqueOrThrow({ where: { id: datasetId } })]);
    return { dataset: { csv, sha256 }, targetColumn: dataset.targetColumn, sensitiveColumns: dataset.sensitiveColumns };
  },

  async complete(result: ProfileResult, { datasetId }, { tx }) {
    await tx.dataset.update({ where: { id: datasetId }, data: { profile: result as unknown as Prisma.InputJsonValue } });
    return [
      {
        kind: 'dataset_profile',
        metrics: { rows: result.rows, columns: result.columns, duplicateRows: result.duplicateRows, missingPercent: result.missingPercent, possibleProxies: result.proxies.length },
        data: result as unknown as Prisma.InputJsonValue,
      },
    ];
  },
};
