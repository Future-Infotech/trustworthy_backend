import request from 'supertest';
import { prisma } from '../../src/config/prisma';
import { recoverExperiments } from '../../src/services/experiments/experiment.service';
import { MlServiceError } from '../../src/services/ml/mlClient';
import { settingsService } from '../../src/services/settings.service';
import { getStorage } from '../../src/services/storage';
import { sha256 } from '../../src/utils/crypto';
import { app, latestAudit, loginAs } from '../helpers';
import { ARTIFACT_BYTES, deferred, drainQueue, makeCsv, mockMl, profileResult, trainingResult, trainParams, uploadDataset } from '../ml-fixtures';

afterEach(async () => {
  await drainQueue();
  vi.restoreAllMocks();
  settingsService.clearCache();
});
afterAll(() => prisma.$disconnect());

describe('dataset upload validation', () => {
  it('requires the upload permission', async () => {
    const { auth } = await loginAs('STUDENT');
    await uploadDataset(auth).expect(403);
  });

  it.each([
    ['non-CSV extension', { fileName: 'data.xlsx' }, 400, /Only \.csv/],
    ['binary content', { csv: 'a,b\n\u0000\u0001,2\n' }, 422, /binary/],
    ['inconsistent columns', { csv: 'a,b\n1,2\n3\n' + '4,5\n'.repeat(12) }, 422, /columns/i],
    ['duplicate headers', { csv: 'a,a\n' + '1,2\n'.repeat(12) }, 422, /Duplicate column/],
    ['too few rows', { csv: 'a,b\n1,2\n' }, 422, /At least 10 data rows/],
    ['unknown target', { target: 'missing' }, 400, /does not exist/],
  ])('rejects %s', async (_label, opts, status, message) => {
    mockMl({});
    const { auth } = await loginAs('DEVELOPER');
    const res = await uploadDataset(auth, opts).expect(status);
    expect(JSON.stringify(res.body.error)).toMatch(message);
  });

  it('records rejected uploads in the audit log', async () => {
    const { auth, user } = await loginAs('DEVELOPER');
    await uploadDataset(auth, { csv: 'x\n1\n' }).expect(422);
    expect(await latestAudit({ action: 'dataset.upload_rejected', userId: user.id })).toMatchObject({ result: 'FAILURE' });
  });

  it('enforces the configured size limit', async () => {
    const admin = await loginAs('ADMIN');
    await request(app).patch('/api/settings/uploads.maxDatasetSizeMb').set(admin.auth).send({ value: 1 }).expect(200);
    try {
      const { auth } = await loginAs('DEVELOPER');
      const big = 'a,b\n' + `${'9'.repeat(500)},1\n`.repeat(2200);
      const res = await uploadDataset(auth, { csv: big, sensitive: [], target: '' }).expect(413);
      expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    } finally {
      await request(app).patch('/api/settings/uploads.maxDatasetSizeMb').set(admin.auth).send({ value: 25 }).expect(200);
    }
  });
});

describe('datasets', () => {
  it('stores a validated upload, types its columns and profiles it in the sandbox', async () => {
    const ml = mockMl({ 'dataset.profile': () => profileResult() });
    const { auth, user } = await loginAs('DEVELOPER');
    const csv = makeCsv();
    const res = await uploadDataset(auth, { csv }).expect(201);

    expect(res.body).toMatchObject({ status: 'READY', rowCount: 40, columnCount: 6, targetColumn: 'approved', sensitiveColumns: ['gender'], checksumSha256: sha256(csv) });
    const types = Object.fromEntries(res.body.columns.map((c: { name: string; dataType: string }) => [c.name, c.dataType]));
    expect(types).toEqual({ applicant_id: 'CATEGORICAL', gender: 'CATEGORICAL', age: 'NUMERIC', income: 'NUMERIC', region: 'CATEGORICAL', approved: 'BOOLEAN' });
    expect(res.body.columns.find((c: { name: string }) => c.name === 'gender').isSensitive).toBe(true);

    await drainQueue();
    expect(ml).toHaveBeenCalledWith('dataset.profile', expect.objectContaining({ dataset: { csv, sha256: sha256(csv) }, targetColumn: 'approved', sensitiveColumns: ['gender'] }), expect.anything());
    const detail = await request(app).get(`/api/datasets/${res.body.id}`).set(auth).expect(200);
    expect(detail.body.analysis.status).toBe('COMPLETED');
    expect(detail.body.profile.proxies[0].column).toBe('region');

    const stored = await prisma.dataset.findUniqueOrThrow({ where: { id: res.body.id } });
    expect((await getStorage().get(stored.storageKey)).toString()).toBe(csv);
    expect(await latestAudit({ action: 'dataset.uploaded', userId: user.id })).toMatchObject({ resourceId: res.body.id });
  });

  it('keeps private datasets private and shares shared ones', async () => {
    mockMl({ 'dataset.profile': () => profileResult() });
    const owner = await loginAs('DEVELOPER');
    const other = await loginAs('DEVELOPER');
    const manager = await loginAs('FACULTY');
    const priv = (await uploadDataset(owner.auth, { name: 'private-ds' }).expect(201)).body;
    const shared = (await uploadDataset(owner.auth, { name: 'shared-ds', shared: true }).expect(201)).body;

    await request(app).get(`/api/datasets/${priv.id}`).set(other.auth).expect(404);
    await request(app).get(`/api/datasets/${shared.id}`).set(other.auth).expect(200);
    await request(app).get(`/api/datasets/${priv.id}`).set(manager.auth).expect(200);
    const list = await request(app).get('/api/datasets?pageSize=100').set(other.auth).expect(200);
    const ids = list.body.data.map((d: { id: string }) => d.id);
    expect(ids).toContain(shared.id);
    expect(ids).not.toContain(priv.id);
  });

  it('masks sensitive columns in previews for non-owners and restricts raw downloads', async () => {
    mockMl({ 'dataset.profile': () => profileResult() });
    const owner = await loginAs('DEVELOPER');
    const student = await loginAs('STUDENT');
    const ds = (await uploadDataset(owner.auth, { shared: true, sensitive: ['gender', 'applicant_id'] }).expect(201)).body;

    const masked = await request(app).get(`/api/datasets/${ds.id}/preview?limit=5`).set(student.auth).expect(200);
    expect(masked.body.maskedColumns).toEqual(['gender', 'applicant_id']);
    expect(masked.body.rows[0][masked.body.headers.indexOf('gender')]).toBe('•••');
    expect(masked.body.rows).toHaveLength(5);

    const raw = await request(app).get(`/api/datasets/${ds.id}/preview?limit=5`).set(owner.auth).expect(200);
    expect(raw.body.maskedColumns).toEqual([]);
    expect(raw.body.rows[0][raw.body.headers.indexOf('gender')]).toBe('male');

    await request(app).get(`/api/datasets/${ds.id}/download`).set(student.auth).expect(403);
    const file = await request(app).get(`/api/datasets/${ds.id}/download`).set(owner.auth).expect(200);
    expect(file.headers['content-disposition']).toContain('loans.csv');
    expect(file.text).toBe(makeCsv());
    expect(await latestAudit({ action: 'dataset.downloaded', userId: owner.user.id })).toBeTruthy();
  });

  it('updates column roles and validates them', async () => {
    mockMl({ 'dataset.profile': () => profileResult() });
    const { auth } = await loginAs('DEVELOPER');
    const ds = (await uploadDataset(auth).expect(201)).body;
    await request(app).patch(`/api/datasets/${ds.id}`).set(auth).send({ sensitiveColumns: ['nope'] }).expect(400);
    await request(app).patch(`/api/datasets/${ds.id}`).set(auth).send({ sensitiveColumns: ['approved'] }).expect(400);
    const res = await request(app).patch(`/api/datasets/${ds.id}`).set(auth).send({ sensitiveColumns: ['age', 'gender'], isShared: true }).expect(200);
    expect(res.body.columns.filter((c: { isSensitive: boolean }) => c.isSensitive).map((c: { name: string }) => c.name)).toEqual(['gender', 'age']);
    const other = await loginAs('DEVELOPER');
    await request(app).patch(`/api/datasets/${ds.id}`).set(other.auth).send({ name: 'hijack' }).expect(403);
  });

  it('soft-deletes with a reason, removes the stored file and blocks further use', async () => {
    mockMl({ 'dataset.profile': () => profileResult() });
    const { auth, user } = await loginAs('DEVELOPER');
    const ds = (await uploadDataset(auth).expect(201)).body;
    await drainQueue();
    await request(app).delete(`/api/datasets/${ds.id}`).set(auth).send({}).expect(400);
    await request(app).delete(`/api/datasets/${ds.id}`).set(auth).send({ reason: 'No longer needed' }).expect(204);
    const row = await prisma.dataset.findUniqueOrThrow({ where: { id: ds.id } });
    expect(row.status).toBe('DELETED');
    expect(await getStorage().exists(row.storageKey)).toBe(false);
    await request(app).get(`/api/datasets/${ds.id}`).set(auth).expect(404);
    await request(app).post('/api/experiments').set(auth).send(trainParams(ds.id)).expect(404);
    expect(await latestAudit({ action: 'dataset.deleted', userId: user.id })).toMatchObject({ reason: 'No longer needed' });
  });
});

describe('experiment engine', () => {
  async function sharedDataset() {
    mockMl({ 'dataset.profile': () => profileResult() });
    const owner = await loginAs('FACULTY');
    const ds = (await uploadDataset(owner.auth, { shared: true }).expect(201)).body;
    await drainQueue();
    vi.restoreAllMocks();
    return ds as { id: string; checksumSha256: string };
  }

  it('trains through the ML service, stores real results and reproduces the configuration', async () => {
    const ds = await sharedDataset();
    const ml = mockMl({ 'model.train': () => trainingResult() });
    const { auth, user } = await loginAs('STUDENT');

    const created = await request(app).post('/api/experiments').set(auth).send(trainParams(ds.id)).expect(202);
    expect(created.body).toMatchObject({ status: 'QUEUED', type: 'TRAINING', randomSeed: 7, isEducational: true });
    await drainQueue();

    const call = ml.mock.calls[0];
    expect(call[0]).toBe('model.train');
    expect(call[1]).toMatchObject({ dataset: { csv: makeCsv(), sha256: ds.checksumSha256 }, includeArtifact: false, model: { target: 'approved', seed: 7, testSize: 0.25 } });

    const detail = await request(app).get(`/api/experiments/${created.body.id}`).set(auth).expect(200);
    expect(detail.body).toMatchObject({ status: 'COMPLETED', progress: 100, canCancel: false });
    expect(detail.body.disclaimer).toMatch(/not proof of regulatory compliance/);
    expect(detail.body.results).toHaveLength(1);
    expect(detail.body.results[0]).toMatchObject({ kind: 'training', metrics: { accuracy: 0.8 } });
    expect(detail.body.results[0].data.artifact).toBeUndefined();
    expect(detail.body.logs.some((l: { level: string; message: string }) => l.level === 'warn' && l.message.includes('overfitting'))).toBe(true);
    expect(await prisma.notification.findFirst({ where: { userId: user.id, title: 'Experiment completed' } })).toBeTruthy();
    expect(await latestAudit({ action: 'experiment.created', userId: user.id })).toMatchObject({ resourceId: created.body.id });

    const rerun = await request(app).post(`/api/experiments/${created.body.id}/rerun`).set(auth).expect(202);
    expect(rerun.body.configHash).toBe(created.body.configHash);
    expect(rerun.body.randomSeed).toBe(7);
  });

  it('validates parameters and dataset columns before queueing', async () => {
    const ds = await sharedDataset();
    const { auth } = await loginAs('STUDENT');
    const bad = (model: Record<string, unknown>) => ({ ...trainParams(ds.id), params: { datasetId: ds.id, model: { target: 'approved', algorithm: 'RANDOM_FOREST', ...model } } });
    let res = await request(app).post('/api/experiments').set(auth).send(bad({ target: 'missing' })).expect(400);
    expect(res.body.error.details[0]).toMatchObject({ path: 'params.model.target' });
    res = await request(app).post('/api/experiments').set(auth).send(bad({ algorithm: 'SVM' })).expect(400);
    expect(res.body.error.details[0].path).toBe('params.model.algorithm');
    res = await request(app).post('/api/experiments').set(auth).send(bad({ features: ['approved'] })).expect(400);
    await request(app).post('/api/experiments').set(auth).send(bad({ testSize: 0.9 })).expect(400);
    await request(app).post('/api/experiments').set(auth).send({ type: 'TRAINING', params: {} }).expect(400);
  });

  it('checks hyperparameters against the ML catalogue when it is reachable', async () => {
    const ds = await sharedDataset();
    const { mlClient } = await import('../../src/services/ml/mlClient');
    vi.spyOn(mlClient, 'algorithms').mockResolvedValue([
      { key: 'RANDOM_FOREST', label: 'Random Forest', description: '', interpretability: 'medium', params: [{ name: 'nEstimators', kind: 'int', default: 200, description: '', minimum: 10, maximum: 500, choices: [], nullable: false }] },
    ]);
    const { auth } = await loginAs('STUDENT');
    const res = await request(app)
      .post('/api/experiments')
      .set(auth)
      .send({ type: 'TRAINING', params: { datasetId: ds.id, model: { target: 'approved', algorithm: 'RANDOM_FOREST', hyperparameters: { nEstimators: 9000, nJobs: -1 } } } })
      .expect(400);
    expect(res.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual(['params.model.hyperparameters.nEstimators', 'params.model.hyperparameters.nJobs']);
  });

  it('surfaces ML input errors and outages as failed experiments with user-facing messages', async () => {
    const ds = await sharedDataset();
    const { auth, user } = await loginAs('STUDENT');
    mockMl({
      'model.train': () => {
        throw new MlServiceError('JOB_INVALID_INPUT', "Target column 'approved' has a single value");
      },
    });
    const failed = await request(app).post('/api/experiments').set(auth).send(trainParams(ds.id)).expect(202);
    await drainQueue();
    let detail = await request(app).get(`/api/experiments/${failed.body.id}`).set(auth).expect(200);
    expect(detail.body).toMatchObject({ status: 'FAILED', error: "Target column 'approved' has a single value" });
    expect(await prisma.notification.findFirst({ where: { userId: user.id, title: 'Experiment failed' } })).toBeTruthy();

    vi.restoreAllMocks();
    const outage = await request(app).post('/api/experiments').set(auth).send(trainParams(ds.id)).expect(202);
    await drainQueue();
    detail = await request(app).get(`/api/experiments/${outage.body.id}`).set(auth).expect(200);
    expect(detail.body.status).toBe('FAILED');
    expect(detail.body.error).toMatch(/ML service is unavailable/);
  });

  it('limits concurrent experiments per user and supports cancellation', async () => {
    const ds = await sharedDataset();
    const gate = deferred<unknown>();
    mockMl({ 'model.train': () => gate.promise });
    const { auth } = await loginAs('STUDENT');
    const first = await request(app).post('/api/experiments').set(auth).send(trainParams(ds.id)).expect(202);
    const second = await request(app).post('/api/experiments').set(auth).send(trainParams(ds.id)).expect(202);
    const third = await request(app).post('/api/experiments').set(auth).send(trainParams(ds.id)).expect(429);
    expect(third.body.error.message).toMatch(/at most 2/);

    await vi.waitFor(async () => expect((await prisma.experiment.findUniqueOrThrow({ where: { id: first.body.id } })).status).toBe('RUNNING'));
    await request(app).post(`/api/experiments/${first.body.id}/cancel`).set(auth).expect(204);
    const other = await loginAs('STUDENT');
    await request(app).post(`/api/experiments/${second.body.id}/cancel`).set(other.auth).expect(404);

    gate.resolve(trainingResult());
    await drainQueue();
    const cancelled = await prisma.experiment.findUniqueOrThrow({ where: { id: first.body.id }, include: { results: true } });
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.results).toHaveLength(0);
    expect((await prisma.experiment.findUniqueOrThrow({ where: { id: second.body.id } })).status).toBe('COMPLETED');
    await request(app).post(`/api/experiments/${first.body.id}/cancel`).set(auth).expect(409);
  });

  it('scopes experiment visibility', async () => {
    const ds = await sharedDataset();
    mockMl({ 'model.train': () => trainingResult() });
    const student = await loginAs('STUDENT');
    const exp = (await request(app).post('/api/experiments').set(student.auth).send(trainParams(ds.id)).expect(202)).body;
    await drainQueue();
    const other = await loginAs('DEVELOPER');
    await request(app).get(`/api/experiments/${exp.id}`).set(other.auth).expect(404);
    const otherList = await request(app).get('/api/experiments?scope=all').set(other.auth).expect(200);
    expect(otherList.body.data.map((e: { id: string }) => e.id)).not.toContain(exp.id);
    const faculty = await loginAs('FACULTY');
    await request(app).get(`/api/experiments/${exp.id}`).set(faculty.auth).expect(200);
    const all = await request(app).get('/api/experiments?scope=all&pageSize=100').set(faculty.auth).expect(200);
    expect(all.body.data.map((e: { id: string }) => e.id)).toContain(exp.id);
  });

  it('fails interrupted runs and resumes queued ones after a restart', async () => {
    const ds = await sharedDataset();
    const { user } = await loginAs('STUDENT');
    const base = { type: 'TRAINING' as const, userId: user.id, datasetId: ds.id, randomSeed: 7, configHash: 'h', parameters: trainParams(ds.id).params };
    const running = await prisma.experiment.create({ data: { ...base, status: 'RUNNING' } });
    const queued = await prisma.experiment.create({ data: { ...base, status: 'QUEUED' } });
    mockMl({ 'model.train': () => trainingResult() });
    await recoverExperiments();
    await drainQueue();
    expect((await prisma.experiment.findUniqueOrThrow({ where: { id: running.id } })).error).toMatch(/Interrupted/);
    expect((await prisma.experiment.findUniqueOrThrow({ where: { id: queued.id } })).status).toBe('COMPLETED');
  });
});

describe('model registry', () => {
  async function trainedVersion(register: Record<string, unknown>, role: 'DEVELOPER' | 'FACULTY' = 'DEVELOPER') {
    mockMl({ 'dataset.profile': () => profileResult(), 'model.train': () => trainingResult() });
    const session = await loginAs(role);
    const ds = (await uploadDataset(session.auth).expect(201)).body;
    const exp = (await request(app).post('/api/experiments').set(session.auth).send(trainParams(ds.id, { register })).expect(202)).body;
    await drainQueue();
    return { session, ds, exp };
  }

  it('registers a trained model as a version with full lineage and an export-only artifact', async () => {
    const { session, ds, exp } = await trainedVersion({ newModel: { name: 'Loan RF', purpose: 'Rank loan applications for manual review' } });
    const detail = await request(app).get(`/api/experiments/${exp.id}`).set(session.auth).expect(200);
    expect(detail.body.status).toBe('COMPLETED');
    const reg = detail.body.results.find((r: { kind: string }) => r.kind === 'model_registration').data;

    const model = await request(app).get(`/api/models/${reg.modelId}`).set(session.auth).expect(200);
    expect(model.body).toMatchObject({ name: 'Loan RF', framework: 'scikit-learn', algorithm: 'Random Forest', trainingDataset: { id: ds.id }, lifecycleStage: 'DEVELOPMENT' });
    const [version] = model.body.versions;
    expect(version).toMatchObject({ version: 'v1', targetColumn: 'approved', randomSeed: 7, fingerprint: 'f'.repeat(64), trainingExperimentId: exp.id, analysable: true, artifactFormat: 'skops' });
    expect(version.metrics.test.accuracy).toBe(0.8);
    expect(version.featureColumns).toEqual(['age', 'income', 'gender', 'region']);

    const artifact = await request(app).get(`/api/model-versions/${version.id}/artifact`).set(session.auth).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(Buffer.compare(artifact.body, ARTIFACT_BYTES)).toBe(0);
    expect(await latestAudit({ action: 'model.created', userId: session.user.id })).toMatchObject({ resourceId: reg.modelId });
  });

  it('does not let learners register models', async () => {
    mockMl({ 'dataset.profile': () => profileResult() });
    const faculty = await loginAs('FACULTY');
    const ds = (await uploadDataset(faculty.auth, { shared: true }).expect(201)).body;
    const { auth } = await loginAs('STUDENT');
    await request(app)
      .post('/api/experiments')
      .set(auth)
      .send(trainParams(ds.id, { register: { newModel: { name: 'Mine', purpose: 'A student model for testing' } } }))
      .expect(403);
    await request(app).post('/api/models').set(auth).send({ name: 'x', purpose: 'some purpose text', algorithm: 'RF' }).expect(403);
  });

  it('refuses executable model formats and stores accepted artifacts opaquely', async () => {
    const { auth, user } = await loginAs('DEVELOPER');
    const model = (await request(app).post('/api/models').set(auth).send({ name: 'External', purpose: 'Model trained outside the platform', algorithm: 'XGBoost' }).expect(201)).body;
    const pkl = await request(app).post(`/api/models/${model.id}/versions`).set(auth).field('version', '1.0').attach('file', Buffer.from('cos\nsystem\n'), 'model.pkl').expect(400);
    expect(pkl.body.error.details[0].message).toMatch(/can execute code/);
    expect(await latestAudit({ action: 'model.artifact_refused', userId: user.id })).toMatchObject({ result: 'DENIED' });

    const onnx = Buffer.from('onnx-bytes');
    const v = await request(app).post(`/api/models/${model.id}/versions`).set(auth).field('version', '1.0').attach('file', onnx, 'model.onnx').expect(201);
    expect(v.body).toMatchObject({ version: '1.0', artifactFormat: 'onnx', artifactChecksum: sha256(onnx), metrics: null, datasetId: null });
    await request(app).post(`/api/models/${model.id}/versions`).set(auth).field('version', '1.0').expect(409);
    const got = await request(app).get(`/api/model-versions/${v.body.id}`).set(auth).expect(200);
    expect(got.body).toMatchObject({ hasArtifact: true, analysable: false });
    expect(got.body.artifactKey).toBeUndefined();
  });

  it('enforces lifecycle rules, segregation of duties and production gates', async () => {
    const owner = await loginAs('DEVELOPER');
    const admin = await loginAs('ADMIN');
    const model = (await request(app).post('/api/models').set(owner.auth).send({ name: 'Gated', purpose: 'Lifecycle governance test model', algorithm: 'LR', riskLevel: 'HIGH' }).expect(201)).body;
    expect(await prisma.notification.findFirst({ where: { userId: admin.user.id, type: 'HIGH_RISK_MODEL_DETECTED' } })).toBeTruthy();

    const move = (auth: Record<string, string>, stage: string) => request(app).post(`/api/models/${model.id}/lifecycle`).set(auth).send({ stage, reason: `Move to ${stage}` });
    expect((await move(owner.auth, 'PRODUCTION').expect(409)).body.error.code).toBe('LIFECYCLE_BLOCKED');
    await move(owner.auth, 'TESTING').expect(200);
    expect((await move(owner.auth, 'REVIEW').expect(409)).body.error.message).toMatch(/at least one version/);
    await request(app).post(`/api/models/${model.id}/versions`).set(owner.auth).field('version', 'v1').expect(201);
    await move(owner.auth, 'REVIEW').expect(200);
    expect((await move(owner.auth, 'APPROVED').expect(409)).body.error.details.join(' ')).toMatch(/Segregation of duties/);
    const approved = await move(admin.auth, 'APPROVED').expect(200);
    expect(approved.body.lifecycleStage).toBe('APPROVED');
    expect(await prisma.notification.findFirst({ where: { userId: owner.user.id, title: 'Model lifecycle changed' } })).toBeTruthy();

    const blocked = await move(admin.auth, 'PRODUCTION').expect(409);
    expect(blocked.body.error.details.join(' ')).toMatch(/approved risk assessment/);
    expect(await latestAudit({ action: 'model.lifecycle_blocked', userId: admin.user.id })).toMatchObject({ result: 'DENIED' });

    const detail = await request(app).get(`/api/models/${model.id}`).set(admin.auth).expect(200);
    const production = detail.body.nextStages.find((s: { stage: string }) => s.stage === 'PRODUCTION');
    expect(production.blockers.length).toBeGreaterThan(0);
    expect(await latestAudit({ action: 'model.lifecycle_changed', userId: admin.user.id })).toMatchObject({ reason: 'Move to APPROVED' });
  });

  it('lets only owners and managers edit models', async () => {
    const owner = await loginAs('DEVELOPER');
    const model = (await request(app).post('/api/models').set(owner.auth).send({ name: 'Owned', purpose: 'Ownership test model here', algorithm: 'LR' }).expect(201)).body;
    const other = await loginAs('DEVELOPER');
    await request(app).patch(`/api/models/${model.id}`).set(other.auth).send({ name: 'Hijacked' }).expect(403);
    const exec = await loginAs('EXECUTIVE');
    await request(app).get(`/api/models/${model.id}`).set(exec.auth).expect(200);
    await request(app).patch(`/api/models/${model.id}`).set(exec.auth).send({ name: 'x' }).expect(403);
    const res = await request(app).patch(`/api/models/${model.id}`).set(owner.auth).send({ riskLevel: 'MEDIUM', tags: ['credit'] }).expect(200);
    expect(res.body).toMatchObject({ riskLevel: 'MEDIUM', tags: ['credit'] });
  });
});
