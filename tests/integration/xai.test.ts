import request from 'supertest';
import { prisma } from '../../src/config/prisma';
import { settingsService } from '../../src/services/settings.service';
import { app, latestAudit, loginAs } from '../helpers';
import { drainQueue, makeCsv, mockMl, profileResult, registeredVersion, run, trainingResult, trainParams, uploadDataset } from '../ml-fixtures';

afterEach(async () => {
  await drainQueue();
  vi.restoreAllMocks();
  settingsService.clearCache();
});
afterAll(() => prisma.$disconnect());

const shapResult = (status: 'PASSED' | 'WARNING' = 'PASSED') => ({
  algorithm: 'RANDOM_FOREST',
  method: 'TreeExplainer (path-dependent)',
  outputSpace: 'probability',
  explainedClass: '1',
  baseValue: 0.6,
  additivityError: status === 'PASSED' ? 1e-12 : 0.2,
  globalImportance: [{ feature: 'income', meanAbsShap: 0.2, meanShap: 0.01 }],
  beeswarm: [],
  local: [{ index: 0, values: { gender: '•••', income: 41000 }, baseValue: 0.6, output: 0.8, contributions: [{ feature: 'income', value: 41000, contribution: 0.2 }] }],
  assessment: { status, reasons: status === 'PASSED' ? [] : ['Additivity check failed'] },
  candidates: [],
  warnings: [],
});


describe('explainability experiments', () => {
  it('runs SHAP on a registered version, stores the result and records the explainability status', async () => {
    const { owner, ds, version } = await registeredVersion();
    const ml = mockMl({ 'xai.shap': () => shapResult('WARNING') });

    const created = await run(owner.auth, 'SHAP', { modelVersionId: version.id, instances: [0, 3] }).expect(202);
    expect(created.body).toMatchObject({ type: 'SHAP', modelVersion: { id: version.id }, dataset: { id: ds.id }, randomSeed: 7, algorithm: 'RANDOM_FOREST' });
    await drainQueue();

    const [job, params] = ml.mock.calls[0];
    expect(job).toBe('xai.shap');
    expect(params).toMatchObject({
      dataset: { csv: makeCsv(), sha256: ds.checksumSha256 },
      model: { target: 'approved', algorithm: 'RANDOM_FOREST', seed: 7 },
      expectedFingerprint: 'f'.repeat(64),
      instances: [0, 3],
      backgroundSize: 100,
      sampleSize: 300,
      maskColumns: [],
    });
    expect(params).not.toHaveProperty('modelVersionId');

    const detail = await request(app).get(`/api/experiments/${created.body.id}`).set(owner.auth).expect(200);
    expect(detail.body.status).toBe('COMPLETED');
    expect(detail.body.results[0]).toMatchObject({ kind: 'shap', metrics: { status: 'WARNING' }, data: { outputSpace: 'probability' } });

    const model = await prisma.aIModel.findUniqueOrThrow({ where: { id: version.modelId } });
    expect(model.explainabilityStatus).toBe('WARNING');
    expect(await latestAudit({ action: 'model.evaluation_recorded', resourceId: version.modelId })).toMatchObject({
      before: { explainabilityStatus: 'NOT_ASSESSED' },
      after: { explainabilityStatus: 'WARNING' },
      metadata: { experimentId: created.body.id, versionId: version.id },
    });
  });

  it('masks sensitive values for users who are not the dataset owner, unless masking is disabled', async () => {
    const { version } = await registeredVersion();
    const ml = mockMl({ 'xai.lime': () => ({ ...shapResult(), meanFidelity: 0.7, meanStability: 0.9 }) });
    const other = await loginAs('DEVELOPER');
    await run(other.auth, 'LIME', { modelVersionId: version.id }).expect(202);
    await drainQueue();
    expect(ml.mock.calls[0][1]).toMatchObject({ maskColumns: ['gender'], numFeatures: 8, numSamples: 1000 });

    const admin = await loginAs('ADMIN');
    await request(app).patch('/api/settings/privacy.maskSensitiveFields').set(admin.auth).send({ value: false }).expect(200);
    try {
      await run(other.auth, 'LIME', { modelVersionId: version.id }).expect(202);
      await drainQueue();
      expect(ml.mock.calls[1][1]).toMatchObject({ maskColumns: [] });
    } finally {
      await request(app).patch('/api/settings/privacy.maskSensitiveFields').set(admin.auth).send({ value: true }).expect(200);
    }
  });

  it('keeps sensitive attributes immutable in counterfactual search by default and validates columns', async () => {
    const { owner, version } = await registeredVersion();
    const ml = mockMl({ 'xai.counterfactual': () => ({ counterfactuals: [{ changes: [], probability: 0.6, distance: 1 }], warnings: [] }) });
    const created = await run(owner.auth, 'COUNTERFACTUAL', { modelVersionId: version.id, instance: 4 }).expect(202);
    await drainQueue();
    expect(ml.mock.calls[0][1]).toMatchObject({ instance: 4, immutableFeatures: ['gender'], maxChanges: 2, count: 3 });
    const detail = await request(app).get(`/api/experiments/${created.body.id}`).set(owner.auth).expect(200);
    expect(detail.body.results[0]).toMatchObject({ kind: 'counterfactual', metrics: { found: 1 } });
    expect((await prisma.aIModel.findUniqueOrThrow({ where: { id: version.modelId } })).explainabilityStatus).toBe('NOT_ASSESSED');

    await run(owner.auth, 'COUNTERFACTUAL', { modelVersionId: version.id, immutableFeatures: [] }).expect(202);
    await drainQueue();
    expect(ml.mock.calls[1][1]).toMatchObject({ immutableFeatures: [] });

    const res = await run(owner.auth, 'COUNTERFACTUAL', { modelVersionId: version.id, immutableFeatures: ['height'] }).expect(400);
    expect(res.body.error.details[0]).toMatchObject({ path: 'params.immutableFeatures', message: expect.stringMatching(/does not exist/) });
  });

  it('explains a completed training run of the caller without touching any registry status', async () => {
    mockMl({ 'dataset.profile': () => profileResult(), 'model.train': () => trainingResult() });
    const faculty = await loginAs('FACULTY');
    const ds = (await uploadDataset(faculty.auth, { shared: true }).expect(201)).body;
    await drainQueue();
    const student = await loginAs('STUDENT');
    const training = (await request(app).post('/api/experiments').set(student.auth).send(trainParams(ds.id)).expect(202)).body;
    await drainQueue();
    vi.restoreAllMocks();

    const ml = mockMl({ 'xai.shap': () => shapResult() });
    const created = await run(student.auth, 'SHAP', { trainingExperimentId: training.id }).expect(202);
    expect(created.body).toMatchObject({ modelVersion: null, dataset: { id: ds.id } });
    await drainQueue();
    expect(ml.mock.calls[0][1]).toMatchObject({ expectedFingerprint: 'f'.repeat(64), maskColumns: ['gender'] });
    expect((await prisma.experiment.findUniqueOrThrow({ where: { id: created.body.id } })).status).toBe('COMPLETED');

    const other = await loginAs('STUDENT');
    await run(other.auth, 'SHAP', { trainingExperimentId: training.id }).expect(404);
  });

  it('validates the model source and parameter bounds before queueing', async () => {
    const { owner, version, trainingId } = await registeredVersion();
    await run(owner.auth, 'SHAP', {}).expect(400);
    await run(owner.auth, 'SHAP', { modelVersionId: version.id, trainingExperimentId: trainingId }).expect(400);
    await run(owner.auth, 'SHAP', { modelVersionId: version.id, instances: Array.from({ length: 11 }, (_, i) => i) }).expect(400);
    await run(owner.auth, 'LIME', { modelVersionId: version.id, numSamples: 100_000 }).expect(400);
    await run(owner.auth, 'COUNTERFACTUAL', { modelVersionId: version.id, maxChanges: 5 }).expect(400);
    await run(owner.auth, 'SHAP', { modelVersionId: '00000000-0000-4000-8000-000000000000' }).expect(404);
  });

  it('surfaces ML input errors as failed runs', async () => {
    const { owner, version } = await registeredVersion();
    const { MlServiceError } = await import('../../src/services/ml/mlClient');
    mockMl({
      'xai.counterfactual': () => {
        throw new MlServiceError('JOB_INVALID_INPUT', 'Instance index 999 is out of range; the test split has 10 rows (0-9)');
      },
    });
    const created = await run(owner.auth, 'COUNTERFACTUAL', { modelVersionId: version.id, instance: 999 }).expect(202);
    await drainQueue();
    const detail = await request(app).get(`/api/experiments/${created.body.id}`).set(owner.auth).expect(200);
    expect(detail.body).toMatchObject({ status: 'FAILED', error: expect.stringMatching(/out of range/) });
  });
});

describe('analysable model sources', () => {
  it('lists registered versions to registry readers and only the caller’s own training runs', async () => {
    const { owner, version, trainingId } = await registeredVersion();
    const mine = await request(app).get('/api/experiments/sources').set(owner.auth).expect(200);
    expect(mine.body.versions.find((v: { id: string }) => v.id === version.id)).toMatchObject({
      label: 'Loan RF v1',
      algorithm: 'RANDOM_FOREST',
      target: 'approved',
      accuracy: 0.8,
      dataset: { sensitiveColumns: ['gender'], columns: ['applicant_id', 'gender', 'age', 'income', 'region', 'approved'] },
    });
    expect(mine.body.trainingRuns.map((r: { id: string }) => r.id)).toContain(trainingId);
    expect(mine.body.trainingRuns.find((r: { id: string }) => r.id === trainingId)).toMatchObject({ algorithm: 'RANDOM_FOREST', accuracy: 0.8 });

    const student = await loginAs('STUDENT');
    const theirs = await request(app).get('/api/experiments/sources').set(student.auth).expect(200);
    expect(theirs.body.trainingRuns.map((r: { id: string }) => r.id)).not.toContain(trainingId);
  });

  it('filters experiment lists by several types', async () => {
    const { owner, version } = await registeredVersion();
    mockMl({ 'xai.shap': () => shapResult() });
    await run(owner.auth, 'SHAP', { modelVersionId: version.id }).expect(202);
    await drainQueue();
    const labs = await request(app).get('/api/experiments?types=SHAP,LIME,GRAD_CAM').set(owner.auth).expect(200);
    expect(labs.body.data.map((e: { type: string }) => e.type)).toEqual(['SHAP']);
    await request(app).get('/api/experiments?types=SHAP,NOPE').set(owner.auth).expect(400);
  });
});

describe('Grad-CAM', () => {
  it('trains the digits CNN with deterministic defaults and stores the heatmaps', async () => {
    const ml = mockMl({ 'xai.gradcam': () => ({ model: { testAccuracy: 0.95 }, instances: [], warnings: [] }) });
    const { auth } = await loginAs('STUDENT');
    const created = await run(auth, 'GRAD_CAM', { epochs: 5 }).expect(202);
    expect(created.body).toMatchObject({ algorithm: 'CNN', randomSeed: 42, dataset: null });
    await drainQueue();
    expect(ml.mock.calls[0]).toEqual(['xai.gradcam', { epochs: 5, seed: 42, count: 6 }, expect.anything()]);
    const detail = await request(app).get(`/api/experiments/${created.body.id}`).set(auth).expect(200);
    expect(detail.body.results[0]).toMatchObject({ kind: 'gradcam', metrics: { testAccuracy: 0.95 } });
  });

  it('requires the XAI permission and enforces bounds', async () => {
    const exec = await loginAs('EXECUTIVE');
    await run(exec.auth, 'GRAD_CAM', {}).expect(403);
    const { auth } = await loginAs('STUDENT');
    await run(auth, 'GRAD_CAM', { epochs: 500 }).expect(400);
  });
});
