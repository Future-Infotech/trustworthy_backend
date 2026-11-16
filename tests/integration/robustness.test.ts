import request from 'supertest';
import { prisma } from '../../src/config/prisma';
import { app, latestAudit, loginAs } from '../helpers';
import { drainQueue, mockMl, registeredVersion, run } from '../ml-fixtures';

afterEach(async () => {
  await drainQueue();
  vi.restoreAllMocks();
});
afterAll(() => prisma.$disconnect());

const attackResult = (status: 'PASSED' | 'WARNING' | 'FAILED', attacked = 0.55) => ({
  kind: 'tabular',
  curve: [
    { epsilon: 0, accuracy: 0.8, randomNoiseAccuracy: 0.8 },
    { epsilon: 0.25, accuracy: attacked, randomNoiseAccuracy: 0.79 },
  ],
  assessment: { status, reasons: ['Accuracy falls'], referenceEpsilon: 0.25, accuracyDrop: 0.8 - attacked },
  examples: [],
  notes: [],
  warnings: [],
});

describe('adversarial attacks on registered models', () => {
  it('runs PGD with sensitive columns immutable by default and records the security status', async () => {
    const { owner, version } = await registeredVersion();
    const ml = mockMl({ 'robustness.tabular': () => attackResult('FAILED') });
    const created = await run(owner.auth, 'PGD', { modelVersionId: version.id }).expect(202);
    await drainQueue();

    const [job, params] = ml.mock.calls[0];
    expect(job).toBe('robustness.tabular');
    expect(params).toMatchObject({ attack: 'PGD', steps: 10, epsilons: [0.1, 0.25, 0.5, 1], referenceEpsilon: 0.25, immutableFeatures: ['gender'], maskColumns: [] });
    expect(params).not.toHaveProperty('modelVersionId');

    const detail = await request(app).get(`/api/experiments/${created.body.id}`).set(owner.auth).expect(200);
    expect(detail.body.status).toBe('COMPLETED');
    expect(detail.body.logs[0].message).toMatch(/robustness\.tabular/);
    expect(detail.body.results[0]).toMatchObject({ kind: 'robustness_tabular', metrics: { status: 'FAILED', cleanAccuracy: 0.8, attackedAccuracy: 0.55, referenceEpsilon: 0.25 } });
    expect((await prisma.aIModel.findUniqueOrThrow({ where: { id: version.modelId } })).securityStatus).toBe('FAILED');
    expect(await latestAudit({ action: 'model.evaluation_recorded', resourceId: version.modelId })).toMatchObject({ after: { securityStatus: 'FAILED' } });
  });

  it('FGSM takes no step count and validates budgets and columns', async () => {
    const { owner, version } = await registeredVersion();
    const ml = mockMl({ 'robustness.tabular': () => attackResult('PASSED', 0.79) });
    await run(owner.auth, 'FGSM', { modelVersionId: version.id, epsilons: [0.5], referenceEpsilon: 0.5, immutableFeatures: [] }).expect(202);
    await drainQueue();
    const params = ml.mock.calls[0][1] as Record<string, unknown>;
    expect(params).toMatchObject({ attack: 'FGSM', epsilons: [0.5], immutableFeatures: [] });
    expect(params).not.toHaveProperty('steps');

    let res = await run(owner.auth, 'PGD', { modelVersionId: version.id, epsilons: [5] }).expect(400);
    expect(res.body.error.details[0].path).toBe('params.epsilons.0');
    res = await run(owner.auth, 'PGD', { modelVersionId: version.id, immutableFeatures: ['height'] }).expect(400);
    expect(res.body.error.details[0]).toMatchObject({ path: 'params.immutableFeatures', message: expect.stringMatching(/does not exist/) });
    res = await run(owner.auth, 'PGD', {}).expect(400);
    expect(res.body.error.details.length).toBeGreaterThan(0);
  });

  it('requires the robustness permission', async () => {
    const { version } = await registeredVersion();
    const exec = await loginAs('EXECUTIVE');
    await run(exec.auth, 'PGD', { modelVersionId: version.id }).expect(403);
    await run(exec.auth, 'ADVERSARIAL_TRAINING', {}).expect(403);
  });
});

describe('image attacks and adversarial training', () => {
  it('attacks the built-in digits CNN without a model source or status change', async () => {
    const dev = await loginAs('DEVELOPER');
    const ml = mockMl({ 'robustness.image': () => ({ ...attackResult('FAILED', 0.4), kind: 'image', curve: [{ epsilon: 0, accuracy: 0.96 }, { epsilon: 0.1, accuracy: 0.4 }], assessment: { status: 'FAILED', referenceEpsilon: 0.1, accuracyDrop: 0.56, reasons: [] } }) });
    const created = await run(dev.auth, 'PGD', { target: 'DIGITS_CNN', epsilons: [0.1], steps: 5 }).expect(202);
    expect(created.body).toMatchObject({ algorithm: 'CNN', randomSeed: 42 });
    await drainQueue();
    expect(ml.mock.calls[0]).toEqual(['robustness.image', { attack: 'PGD', epsilons: [0.1], referenceEpsilon: 0.1, steps: 5, epochs: 12, seed: 42, count: 6 }, expect.anything()]);
    const detail = await request(app).get(`/api/experiments/${created.body.id}`).set(dev.auth).expect(200);
    expect(detail.body.results[0]).toMatchObject({ kind: 'robustness_image', metrics: { cleanAccuracy: 0.96, attackedAccuracy: 0.4 } });

    const bad = await run(dev.auth, 'FGSM', { target: 'DIGITS_CNN', epsilons: [0.9] }).expect(400);
    expect(bad.body.error.details[0].path).toBe('params.epsilons.0');
  });

  it('compares standard and adversarially trained models', async () => {
    const dev = await loginAs('DEVELOPER');
    const curves = (clean: number, robust: number) => ({ FGSM: [], PGD: [{ epsilon: 0, accuracy: clean }, { epsilon: 0.1, accuracy: robust }] });
    const ml = mockMl({
      'robustness.adversarial_training': () => ({
        trainEpsilon: 0.1,
        standard: { model: { testAccuracy: 0.95 }, curves: curves(0.95, 0.57) },
        adversarial: { model: { testAccuracy: 0.94 }, curves: curves(0.94, 0.7) },
        summary: [],
        notes: [],
        warnings: [],
      }),
    });
    const created = await run(dev.auth, 'ADVERSARIAL_TRAINING', { epochs: 4 }).expect(202);
    await drainQueue();
    expect(ml.mock.calls[0][1]).toMatchObject({ trainAttack: 'PGD', trainEpsilon: 0.1, trainSteps: 5, epochs: 4 });
    const detail = await request(app).get(`/api/experiments/${created.body.id}`).set(dev.auth).expect(200);
    expect(detail.body.results[0]).toMatchObject({
      kind: 'adversarial_training',
      metrics: { standardCleanAccuracy: 0.95, adversarialCleanAccuracy: 0.94, standardRobustAccuracy: 0.57, adversarialRobustAccuracy: 0.7 },
    });
    await run(dev.auth, 'ADVERSARIAL_TRAINING', { trainEpsilon: 0.6 }).expect(400);
  });
});
