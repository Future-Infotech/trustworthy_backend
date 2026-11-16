import request from 'supertest';
import { prisma } from '../../src/config/prisma';
import { nextVersion } from '../../src/services/modelCard.service';
import { app, latestAudit, loginAs } from '../helpers';
import { drainQueue, mockMl, registeredVersion, run } from '../ml-fixtures';

afterEach(async () => {
  await drainQueue();
  vi.restoreAllMocks();
});
afterAll(() => prisma.$disconnect());

const COMPLETION = {
  outOfScopeUse: 'Automated rejection without human review.',
  humanOversight: 'Loan officers review every recommendation.',
  knownLimitations: 'Trained on synthetic data; gender disparity found in the audit.',
  ethicalConsiderations: 'Risk of perpetuating historical lending bias.',
};

async function withAudit() {
  const ctx = await registeredVersion();
  mockMl({
    'fairness.audit': () => ({
      attributes: [{ attribute: 'gender', includedInStatus: true, disparities: { demographicParityDifference: 0.31, equalizedOddsDifference: 0.2, demographicParityRatio: 0.6 } }],
      status: 'FAILED',
      assessment: { status: 'FAILED', reasons: ['gender: selection rates differ by 0.31'] },
      warnings: [],
    }),
  });
  await run(ctx.owner.auth, 'FAIRNESS_AUDIT', { modelVersionId: ctx.version.id }).expect(202);
  await drainQueue();
  vi.restoreAllMocks();
  const prefill = await request(app).get(`/api/model-cards/prefill?modelId=${ctx.version.modelId}`).set(ctx.owner.auth).expect(200);
  return { ...ctx, prefill: prefill.body };
}

const create = (auth: Record<string, string>, modelId: string, content: unknown) => request(app).post('/api/model-cards').set(auth).send({ modelId, content });

describe('model card prefill and evidence integrity', () => {
  it('fills metrics and fairness evidence from real runs and flags what is missing', async () => {
    const { version, prefill } = await withAudit();
    const { content, warnings } = prefill;
    expect(content).toMatchObject({ modelName: 'Loan RF', version: version.version, basedOnVersion: { id: version.id }, evaluatedSubgroups: ['gender'] });
    expect(content.performanceMetrics).toContainEqual(expect.objectContaining({ key: 'accuracy', value: 0.8, source: 'VERSION' }));
    expect(content.fairnessMetrics).toContainEqual(expect.objectContaining({ attribute: 'gender', key: 'demographicParityDifference', value: 0.31, source: 'EXPERIMENT' }));
    expect(content.evaluations.fairness).toMatchObject({ status: 'FAILED' });
    expect(warnings.join(' ')).toMatch(/No completed SHAP or LIME/);
    expect(warnings.join(' ')).toMatch(/robustness/);
  });

  it('rejects evidence-backed values that differ from the recorded results', async () => {
    const { owner, version, prefill } = await withAudit();
    const tampered = structuredClone(prefill.content);
    tampered.performanceMetrics[0].value = 0.99;
    tampered.evaluations.fairness.status = 'PASSED';
    const res = await create(owner.auth, version.modelId, tampered).expect(400);
    const paths = res.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['content.performanceMetrics.0.value', 'content.evaluations.fairness.status']));

    const manual = structuredClone(prefill.content);
    manual.performanceMetrics[0] = { ...manual.performanceMetrics[0], value: 0.99, source: 'MANUAL' };
    const ok = await create(owner.auth, version.modelId, manual).expect(201);
    expect(ok.body.readiness.concerns.join(' ')).toMatch(/entered manually/);
  });
});

describe('model card workflow', () => {
  it('drafts, submits, publishes with segregation of duties and archives the previous version', async () => {
    const { owner, version, prefill } = await withAudit();
    const admin = await loginAs('ADMIN');
    const student = await loginAs('STUDENT');

    const card = (await create(owner.auth, version.modelId, prefill.content).expect(201)).body;
    expect(card).toMatchObject({ status: 'DRAFT', permissions: { edit: true, submit: true } });
    let res = await request(app).post(`/api/model-cards/${card.id}/submit`).set(owner.auth).expect(422);
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain('content.humanOversight');

    await request(app).get(`/api/model-cards/${card.id}`).set(student.auth).expect(404);
    await request(app)
      .patch(`/api/model-cards/${card.id}`)
      .set(owner.auth)
      .send({ content: { ...prefill.content, ...COMPLETION } })
      .expect(200);
    res = await request(app).post(`/api/model-cards/${card.id}/submit`).set(owner.auth).expect(200);
    expect(res.body.status).toBe('IN_REVIEW');
    expect(await prisma.notification.count({ where: { userId: admin.user.id, type: 'GOVERNANCE_REVIEW_REQUIRED', link: `/model-cards/${card.id}` } })).toBe(1);
    await request(app).patch(`/api/model-cards/${card.id}`).set(owner.auth).send({ content: prefill.content }).expect(409);
    await request(app).post(`/api/model-cards/${card.id}/review`).set(owner.auth).send({ decision: 'PUBLISH' }).expect(403);
    await request(app).post(`/api/model-cards/${card.id}/review`).set(admin.auth).send({ decision: 'REQUEST_CHANGES', comment: '' }).expect(400);

    res = await request(app).post(`/api/model-cards/${card.id}/review`).set(admin.auth).send({ decision: 'PUBLISH', comment: 'Evidence reviewed' }).expect(200);
    expect(res.body).toMatchObject({ status: 'PUBLISHED', publishedById: admin.user.id });
    expect(await latestAudit({ action: 'model_card.published', resourceId: card.id })).toMatchObject({ userId: admin.user.id, reason: 'Evidence reviewed' });
    await request(app).get(`/api/model-cards/${card.id}`).set(student.auth).expect(200);

    const v2 = (await request(app).post(`/api/model-cards/${card.id}/versions`).set(owner.auth).send({}).expect(201)).body;
    expect(v2).toMatchObject({ status: 'DRAFT', parentCardId: card.id, version: nextVersion(card.version) });
    await request(app).post(`/api/model-cards/${card.id}/versions`).set(owner.auth).send({}).expect(409);
    await request(app).post(`/api/model-cards/${v2.id}/submit`).set(owner.auth).expect(200);
    await request(app).post(`/api/model-cards/${v2.id}/review`).set(admin.auth).send({ decision: 'PUBLISH' }).expect(200);
    expect((await prisma.modelCard.findUniqueOrThrow({ where: { id: card.id } })).status).toBe('ARCHIVED');
    const versions = await request(app).get(`/api/model-cards/${v2.id}/versions`).set(student.auth).expect(200);
    expect(versions.body.versions.map((v: { status: string }) => v.status)).toEqual(['ARCHIVED', 'PUBLISHED']);
    const history = await request(app).get(`/api/model-cards/${card.id}/history`).set(owner.auth).expect(200);
    expect(history.body.events.map((e: { action: string }) => e.action)).toEqual(expect.arrayContaining(['model_card.created', 'model_card.submitted', 'model_card.published']));
  });

  it('blocks a reviewer from publishing their own card', async () => {
    const sa = await loginAs('SUPER_ADMIN');
    const content = { modelName: 'Self Review', version: '1.0', developer: 'x', architecture: 'x', intendedUse: 'x', trainingData: 'x', evaluationData: 'x', ...COMPLETION, performanceMetrics: [{ name: 'Accuracy', value: 0.7 }] };
    const card = (await create(sa.auth, null as unknown as string, content).expect(201)).body;
    await request(app).post(`/api/model-cards/${card.id}/submit`).set(sa.auth).expect(200);
    const res = await request(app).post(`/api/model-cards/${card.id}/review`).set(sa.auth).send({ decision: 'PUBLISH' }).expect(403);
    expect(res.body.error.message).toMatch(/Segregation of duties/);
    expect(await latestAudit({ action: 'model_card.review_blocked', resourceId: card.id })).toMatchObject({ result: 'DENIED' });
  });

  it('exports JSON, Markdown and PDF and marks drafts as unpublished', async () => {
    const { owner, version, prefill } = await withAudit();
    const card = (await create(owner.auth, version.modelId, prefill.content).expect(201)).body;
    const md = await request(app).get(`/api/model-cards/${card.id}/export?format=md`).set(owner.auth).expect(200);
    expect(md.headers['content-type']).toMatch(/text\/markdown/);
    expect(md.text).toMatch(/^# Model Card: Loan RF/);
    expect(md.text).toMatch(/DRAFT: not a published model card/);
    expect(md.text).toMatch(/\| gender \| Demographic parity difference \| 0.31 \| 0.1 \| Platform experiment \|/);
    expect(md.text).toMatch(/not proof of regulatory compliance/);
    const pdf = await request(app).get(`/api/model-cards/${card.id}/export?format=pdf`).set(owner.auth).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(pdf.status).toBe(200);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    const json = await request(app).get(`/api/model-cards/${card.id}/export?format=json`).set(owner.auth).expect(200);
    expect(JSON.parse(json.text ?? JSON.stringify(json.body))).toMatchObject({ id: card.id, status: 'DRAFT', content: { modelName: 'Loan RF' } });
    await request(app).get(`/api/model-cards/${card.id}/export?format=docx`).set(owner.auth).expect(400);
  });

  it('enforces permissions and only deletes never-published drafts', async () => {
    const { owner, version, prefill } = await withAudit();
    const student = await loginAs('STUDENT');
    await create(student.auth, version.modelId, prefill.content).expect(403);
    const exec = await loginAs('EXECUTIVE');
    await request(app).get('/api/model-cards').set(exec.auth).expect(200);
    const card = (await create(owner.auth, version.modelId, prefill.content).expect(201)).body;
    const other = await loginAs('DEVELOPER');
    await request(app).delete(`/api/model-cards/${card.id}`).set(other.auth).expect(404);
    await request(app).delete(`/api/model-cards/${card.id}`).set(owner.auth).expect(204);
    expect(await latestAudit({ action: 'model_card.deleted', resourceId: card.id })).toBeTruthy();
  });

  it('computes the next version label', () => {
    expect(nextVersion('1.0')).toBe('1.1');
    expect(nextVersion('2.9')).toBe('2.10');
    expect(nextVersion('beta')).toBe('beta.1');
  });
});
