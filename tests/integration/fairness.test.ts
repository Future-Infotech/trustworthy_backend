import request from 'supertest';
import { prisma } from '../../src/config/prisma';
import { app, latestAudit, loginAs } from '../helpers';
import { drainQueue, makeCsv, mockMl, profileResult, registeredVersion, run, uploadDataset } from '../ml-fixtures';

afterEach(async () => {
  await drainQueue();
  vi.restoreAllMocks();
});
afterAll(() => prisma.$disconnect());

const auditResult = (status: 'PASSED' | 'WARNING' | 'FAILED') => ({
  positiveLabel: '1',
  testRows: 10,
  overall: { accuracy: 0.8 },
  attributes: [{ attribute: 'gender', groups: [], disparities: { demographicParityDifference: status === 'PASSED' ? 0.05 : 0.31 }, status, includedInStatus: true, findings: [] }],
  status,
  assessment: { status, reasons: ['gender: the model selects 30% of female versus 61% of male'] },
  notes: [],
  warnings: [],
});

describe('fairness audit', () => {
  it('defaults to the dataset’s sensitive columns, stores the report and records the fairness status', async () => {
    const { owner, ds, version } = await registeredVersion();
    const ml = mockMl({ 'fairness.audit': () => auditResult('FAILED') });
    const created = await run(owner.auth, 'FAIRNESS_AUDIT', { modelVersionId: version.id }).expect(202);
    await drainQueue();

    const [job, params] = ml.mock.calls[0];
    expect(job).toBe('fairness.audit');
    expect(params).toMatchObject({ dataset: { csv: makeCsv(), sha256: ds.checksumSha256 }, sensitiveFeatures: ['gender'], intersectional: true, expectedFingerprint: 'f'.repeat(64) });
    expect(params).not.toHaveProperty('maskColumns');

    const detail = await request(app).get(`/api/experiments/${created.body.id}`).set(owner.auth).expect(200);
    expect(detail.body.results[0]).toMatchObject({ kind: 'fairness_audit', metrics: { status: 'FAILED', maxDemographicParityDifference: 0.31 } });
    expect((await prisma.aIModel.findUniqueOrThrow({ where: { id: version.modelId } })).fairnessStatus).toBe('FAILED');
    expect(await latestAudit({ action: 'model.evaluation_recorded', resourceId: version.modelId })).toMatchObject({ after: { fairnessStatus: 'FAILED' } });
  });

  it('validates attribute names and requires attributes when the dataset has no sensitive columns', async () => {
    const { owner, version } = await registeredVersion();
    let res = await run(owner.auth, 'FAIRNESS_AUDIT', { modelVersionId: version.id, sensitiveFeatures: ['religion'] }).expect(400);
    expect(res.body.error.details[0]).toMatchObject({ path: 'params.sensitiveFeatures', message: expect.stringMatching(/does not exist/) });
    await run(owner.auth, 'FAIRNESS_AUDIT', { modelVersionId: version.id, sensitiveFeatures: ['a', 'b', 'c', 'd'] }).expect(400);

    mockMl({ 'dataset.profile': () => profileResult(), 'model.train': () => ({}) });
    const plain = (await uploadDataset(owner.auth, { sensitive: [] }).expect(201)).body;
    await drainQueue();
    vi.restoreAllMocks();
    const training = await prisma.experiment.create({
      data: { type: 'TRAINING', userId: owner.user.id, datasetId: plain.id, status: 'COMPLETED', randomSeed: 1, configHash: 'x', parameters: { datasetId: plain.id, model: { target: 'approved', algorithm: 'RANDOM_FOREST', seed: 1 } } },
    });
    res = await run(owner.auth, 'FAIRNESS_AUDIT', { trainingExperimentId: training.id }).expect(400);
    expect(res.body.error.details[0].message).toMatch(/no sensitive columns/);
    await run(owner.auth, 'FAIRNESS_AUDIT', { trainingExperimentId: training.id, sensitiveFeatures: ['region'] }).expect(202);
  });

  it('requires the fairness permission', async () => {
    const { version } = await registeredVersion();
    const exec = await loginAs('EXECUTIVE');
    await run(exec.auth, 'FAIRNESS_AUDIT', { modelVersionId: version.id }).expect(403);
  });
});

describe('fairness mitigation', () => {
  it('compares default mitigations without changing the registry status', async () => {
    const { owner, version } = await registeredVersion();
    const ml = mockMl({
      'fairness.mitigate': () => ({
        attribute: 'gender',
        baseline: {},
        mitigations: [
          { label: 'EG', tradeoff: { disparityChange: -0.12, accuracyChange: -0.02 } },
          { label: 'TO', tradeoff: { disparityChange: 0.01, accuracyChange: -0.01 } },
        ],
        notes: [],
        warnings: [],
      }),
    });
    const created = await run(owner.auth, 'FAIRNESS_MITIGATION', { modelVersionId: version.id }).expect(202);
    await drainQueue();
    expect(ml.mock.calls[0][1]).toMatchObject({
      sensitiveFeature: 'gender',
      mitigations: [
        { technique: 'EXPONENTIATED_GRADIENT', constraint: 'DEMOGRAPHIC_PARITY' },
        { technique: 'THRESHOLD_OPTIMIZER', constraint: 'EQUALIZED_ODDS' },
      ],
    });
    const detail = await request(app).get(`/api/experiments/${created.body.id}`).set(owner.auth).expect(200);
    expect(detail.body.results[0]).toMatchObject({ kind: 'fairness_mitigation', metrics: { mitigations: 2, improved: 1 } });
    expect((await prisma.aIModel.findUniqueOrThrow({ where: { id: version.modelId } })).fairnessStatus).toBe('NOT_ASSESSED');
  });

  it('rejects duplicate or unknown mitigations', async () => {
    const { owner, version } = await registeredVersion();
    const eg = { technique: 'EXPONENTIATED_GRADIENT', constraint: 'DEMOGRAPHIC_PARITY' };
    await run(owner.auth, 'FAIRNESS_MITIGATION', { modelVersionId: version.id, mitigations: [eg, eg] }).expect(400);
    await run(owner.auth, 'FAIRNESS_MITIGATION', { modelVersionId: version.id, mitigations: [{ technique: 'REWEIGHING', constraint: 'DEMOGRAPHIC_PARITY' }] }).expect(400);
    await run(owner.auth, 'FAIRNESS_MITIGATION', { modelVersionId: version.id, sensitiveFeature: 'height' }).expect(400);
  });
});
