import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { vi } from 'vitest';
import { prisma } from '../src/config/prisma';
import { mlClient, MlServiceError } from '../src/services/ml/mlClient';
import { experimentQueue } from '../src/services/experiments/experiment.service';
import { app, loginAs } from './helpers';

/** Small deterministic loan-style CSV. */
export function makeCsv(rows = 40): string {
  const lines = ['applicant_id,gender,age,income,region,approved'];
  for (let i = 0; i < rows; i++) {
    lines.push([`A${String(i).padStart(4, '0')}`, i % 2 ? 'female' : 'male', 20 + (i % 40), 30000 + i * 750, ['north', 'south', 'east'][i % 3], i % 3 === 0 ? 0 : 1].join(','));
  }
  return lines.join('\n') + '\n';
}

export function uploadDataset(
  auth: Record<string, string>,
  opts: { name?: string; csv?: string; fileName?: string; shared?: boolean; sensitive?: string[]; target?: string } = {},
) {
  const req = request(app)
    .post('/api/datasets')
    .set(auth)
    .field('name', opts.name ?? `Dataset ${randomUUID().slice(0, 6)}`)
    .field('isShared', String(opts.shared ?? false))
    .field('sensitiveColumns', JSON.stringify(opts.sensitive ?? ['gender']))
    .attach('file', Buffer.from(opts.csv ?? makeCsv()), { filename: opts.fileName ?? 'loans.csv', contentType: 'text/csv' });
  if (opts.target !== undefined) req.field('targetColumn', opts.target);
  else req.field('targetColumn', 'approved');
  return req;
}

export function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type JobHandler = (params: any) => unknown | Promise<unknown>;

/** Replaces the ML service with per-job fakes; unmocked jobs fail like an unavailable service. */
export function mockMl(handlers: Record<string, JobHandler>) {
  return vi.spyOn(mlClient, 'runJob').mockImplementation(async (name: string, params: unknown) => {
    const handler = handlers[name];
    if (!handler) throw new MlServiceError('ML_UNAVAILABLE', 'The ML service is unavailable. Please retry later.');
    return { job: name, durationMs: 12, result: (await handler(params)) as never };
  });
}

export const drainQueue = () => experimentQueue.drain();

export const ARTIFACT_BYTES = Buffer.from('skops-archive-bytes-for-tests');

export function trainingResult(overrides: Record<string, unknown> = {}) {
  return {
    algorithm: 'RANDOM_FOREST',
    hyperparameters: { nEstimators: 50, maxDepth: null, minSamplesLeaf: 1, maxFeatures: 'sqrt', classWeight: null },
    target: 'approved',
    classes: ['0', '1'],
    positiveLabel: '1',
    features: { numeric: ['age', 'income'], categorical: ['gender', 'region'], dropped: [{ column: 'applicant_id', reason: 'identifier column is not used as a model feature' }] },
    split: { train: 30, test: 10, testSize: 0.25, seed: 7, stratified: true },
    reproducibility: { datasetSha256: 'x'.repeat(64), seed: 7, fingerprint: 'f'.repeat(64) },
    metrics: { accuracy: 0.8, balancedAccuracy: 0.78, precision: 0.82, recall: 0.9, f1: 0.86, rocAuc: 0.88, averaging: 'binary (positive class)' },
    trainMetrics: { accuracy: 0.97, f1: 0.97, rocAuc: 0.99 },
    confusionMatrix: { labels: ['0', '1'], matrix: [[2, 1], [1, 6]] },
    perClass: [],
    rocCurve: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    prCurve: [],
    featureImportance: { method: 'permutation', values: [{ feature: 'income', importance: 0.12, std: 0.01 }] },
    modelImportance: null,
    trainingSeconds: 0.4,
    artifact: { format: 'skops', sha256: createHash('sha256').update(ARTIFACT_BYTES).digest('hex'), sizeBytes: ARTIFACT_BYTES.length, base64: ARTIFACT_BYTES.toString('base64') },
    warnings: ['Possible overfitting: training accuracy exceeds test accuracy by 17.0%'],
    ...overrides,
  };
}

export const profileResult = (rows = 40) => ({
  sha256: 'x'.repeat(64),
  rows,
  columns: 6,
  duplicateRows: 0,
  missingCells: 0,
  missingPercent: 0,
  memoryBytes: 1000,
  columnProfiles: [],
  correlation: null,
  target: null,
  proxies: [{ sensitive: 'gender', column: 'region', strength: 0.31, method: "Cramér's V" }],
  proxyNote: 'Associations are statistical.',
  warnings: [],
});

export const trainParams = (datasetId: string, extra: Record<string, unknown> = {}) => ({
  type: 'TRAINING',
  name: 'RF baseline',
  params: { datasetId, model: { target: 'approved', algorithm: 'RANDOM_FOREST', hyperparameters: { nEstimators: 50 }, seed: 7 }, ...extra },
});

/** A shared dataset (owned by a developer) with a registered model version trained on it. */
export async function registeredVersion() {
  mockMl({ 'dataset.profile': () => profileResult(), 'model.train': () => trainingResult() });
  const owner = await loginAs('DEVELOPER');
  const ds = (await uploadDataset(owner.auth, { shared: true }).expect(201)).body;
  const register = { newModel: { name: 'Loan RF', purpose: 'Rank loan applications for manual review' } };
  const exp = (await request(app).post('/api/experiments').set(owner.auth).send(trainParams(ds.id, { register })).expect(202)).body;
  await drainQueue();
  vi.restoreAllMocks();
  const version = await prisma.modelVersion.findFirstOrThrow({ where: { trainingExperimentId: exp.id }, include: { model: true } });
  return { owner, ds, version, trainingId: exp.id as string };
}

export const run = (auth: Record<string, string>, type: string, params: Record<string, unknown>) => request(app).post('/api/experiments').set(auth).send({ type, params });
