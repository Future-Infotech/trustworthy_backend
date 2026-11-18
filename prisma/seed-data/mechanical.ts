import type { Prisma, PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getStorage } from '../../src/services/storage';
import { analyzeCsv } from '../../src/utils/csv';
import { sha256 } from './dataset';

const DAY = 24 * 60 * 60 * 1000;
const DATA_DIR = path.join(__dirname, 'mechanical');

export interface MechanicalDatasetDef {
  name: string;
  /** File inside `prisma/seed-data/mechanical/`. */
  file: string;
  targetColumn: string;
  description: string;
  sourceUrl: string;
}

/**
 * Real mechanical-engineering datasets from the UCI Machine Learning Repository, converted to
 * binary-classification tables that the ML service can train (it supports classifiers only).
 * Column names are normalised to snake_case. Columns that would reveal the label are removed.
 */
export const MECHANICAL_DATASETS: MechanicalDatasetDef[] = [
  {
    name: 'Mechanical - Machine Failure (AI4I 2020)',
    file: 'ai4i2020_predictive_maintenance.csv',
    targetColumn: 'machine_failure',
    description:
      'Predictive maintenance for a milling machine: 10,000 operating records with air and process temperature, rotational speed, torque, tool wear and product type. Target machine_failure (1 = failure, about 3.4% positive, so accuracy alone is misleading). The dataset is synthetic but modelled on real industrial machine behaviour. Product ID, UDI and the failure-mode flags (TWF, HDF, PWF, OSF, RNF) are removed because they are only set when a failure occurs and would leak the label.',
    sourceUrl: 'https://archive.ics.uci.edu/dataset/601/ai4i+2020+predictive+maintenance+dataset',
  },
  {
    name: 'Mechanical - Engine Efficiency (Auto MPG)',
    file: 'auto_mpg_high_efficiency.csv',
    targetColumn: 'high_mpg',
    description:
      'Engine and vehicle specifications for 398 cars (1970-1982): cylinders, displacement, horsepower, weight, acceleration, model year and origin. Derived target high_mpg = 1 when fuel economy is at or above the dataset median of 23.0 mpg. The mpg value and car name are removed because mpg defines the label. Six horsepower values are missing.',
    sourceUrl: 'https://archive.ics.uci.edu/dataset/9/auto+mpg',
  },
  {
    name: 'Mechanical - Concrete Strength',
    file: 'concrete_high_strength.csv',
    targetColumn: 'high_strength',
    description:
      'Concrete mixture recipes (kg per cubic metre of cement, slag, fly ash, water, superplasticizer, aggregates) and curing age in days. Derived target high_strength = 1 when compressive strength is at or above the median of 34.4 MPa. The measured strength is removed because it defines the label.',
    sourceUrl: 'https://archive.ics.uci.edu/dataset/165/concrete+compressive+strength',
  },
];

/**
 * Loads the mechanical datasets as shared, real (non-synthetic) datasets, owned by `ownerId`.
 * Idempotent: a dataset that already exists by name is left unchanged.
 */
export async function loadMechanicalDatasets(prisma: PrismaClient, ownerId: string, log: (msg: string) => void = console.log) {
  const loaded: string[] = [];
  for (const def of MECHANICAL_DATASETS) {
    const existing = await prisma.dataset.findFirst({ where: { name: def.name } });
    if (existing) {
      log(`  ${def.name}: already present, skipping`);
      continue;
    }
    const csv = readFileSync(path.join(DATA_DIR, def.file), 'utf8');
    const profile = analyzeCsv(csv);
    if (!profile.headers.includes(def.targetColumn)) {
      throw new Error(`${def.file} has no target column ${def.targetColumn}`);
    }
    const checksum = sha256(csv);
    const storageKey = `datasets/seed/${def.file.replace(/\.csv$/, '')}_${checksum.slice(0, 12)}.csv`;
    await getStorage().put(storageKey, Buffer.from(csv), 'text/csv');

    const dataset = await prisma.dataset.create({
      data: {
        name: def.name,
        description: def.description,
        ownerId,
        fileName: def.file,
        storageKey,
        sizeBytes: Buffer.byteLength(csv),
        checksumSha256: checksum,
        rowCount: profile.rowCount,
        columnCount: profile.columnCount,
        duplicateRowCount: profile.duplicateRowCount,
        missingCellCount: profile.missingCellCount,
        status: 'READY',
        targetColumn: def.targetColumn,
        sensitiveColumns: [],
        profile: { source: { url: def.sourceUrl, repository: 'UCI Machine Learning Repository' } } as Prisma.InputJsonValue,
        isSynthetic: false,
        isShared: true,
        containsPersonalData: false,
        retentionUntil: new Date(Date.now() + 3650 * DAY),
        createdById: ownerId,
        columns: {
          create: profile.columns.map((c) => ({
            name: c.name,
            position: c.position,
            dataType: c.dataType,
            isSensitive: false,
            isTarget: c.name === def.targetColumn,
            missingCount: c.missingCount,
            uniqueCount: c.uniqueCount,
            stats: c.stats as Prisma.InputJsonValue,
          })),
        },
      },
    });
    loaded.push(dataset.name);
    log(`  ${def.name}: ${profile.rowCount} rows, ${profile.columnCount} columns`);
  }
  return loaded;
}
