import type { ExperimentType, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { prisma } from '../../src/config/prisma';
import { app, latestAudit, loginAs } from '../helpers';

afterAll(() => prisma.$disconnect());

const group = (name: string, selectionRate: number) => ({ group: name, count: 120, positives: 60, selectionRate, baseRate: 0.5, accuracy: 0.8, tpr: 0.7, fpr: 0.2, fnr: 0.3, precision: 0.75, reliable: true });

const FAIRNESS_AUDIT = {
  algorithm: 'logistic_regression',
  positiveLabel: 'approved',
  testRows: 240,
  overall: { accuracy: 0.81, balancedAccuracy: 0.79, f1: 0.77, selectionRate: 0.44 },
  status: 'FAILED',
  assessment: { status: 'FAILED', reasons: ['Demographic parity difference for gender is 0.31 (threshold 0.10).'] },
  attributes: [
    {
      attribute: 'gender',
      usedAsFeature: false,
      groups: [group('female', 0.29), group('male', 0.6)],
      disparities: { demographicParityDifference: 0.31, demographicParityRatio: 0.48, equalOpportunityDifference: 0.22, falsePositiveRateDifference: 0.1, equalizedOddsDifference: 0.22, accuracyDifference: 0.03 },
      dpInterval: [0.22, 0.4],
      fourFifthsPassed: false,
      status: 'FAILED',
      includedInStatus: true,
      findings: ['Women are selected at less than half the rate of men.'],
    },
  ],
  notes: ['Group metrics computed on the held-out test split.'],
  warnings: [],
};

const SHAP = {
  method: 'TreeExplainer',
  outputSpace: 'probability',
  explainedClass: 'approved',
  baseValue: 0.44,
  backgroundSize: 100,
  sampleSize: 200,
  additivityError: 0.000001,
  globalImportance: [
    { feature: 'income', meanAbsShap: 0.12, meanShap: 0.03 },
    { feature: 'debt_ratio', meanAbsShap: 0.08, meanShap: -0.02 },
  ],
  beeswarm: [],
  local: [{ index: 0, datasetRow: 17, values: {}, actual: 'denied', predicted: 'denied', probability: 0.71, positiveProbability: 0.29, correct: true, baseValue: 0.44, output: 0.29, contributions: [{ feature: 'debt_ratio', value: 0.61, contribution: -0.14 }] }],
  assessment: { status: 'PASSED', reasons: ['Additivity holds.'] },
  warnings: [],
};

async function experiment(userId: string, type: ExperimentType, kind: string, data: object, status: 'COMPLETED' | 'RUNNING' = 'COMPLETED') {
  return prisma.experiment.create({
    data: {
      userId,
      type,
      status,
      name: `${type} run`,
      parameters: {},
      randomSeed: 7,
      configHash: randomUUID(),
      completedAt: status === 'COMPLETED' ? new Date() : null,
      results: status === 'COMPLETED' ? { create: { kind, data: data as Prisma.InputJsonValue } } : undefined,
    },
  });
}

const binary = (req: request.Test) =>
  req.buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on('data', (d: Buffer) => chunks.push(d));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });

describe('reports', () => {
  it('builds fairness reports from stored results without hiding unfavourable findings', async () => {
    const dev = await loginAs('DEVELOPER');
    const e = await experiment(dev.user.id, 'FAIRNESS_AUDIT', 'fairness_audit', FAIRNESS_AUDIT);

    const sources = await request(app).get('/api/reports/sources').set(dev.auth).expect(200);
    expect(sources.body.fairness.map((s: { id: string }) => s.id)).toContain(e.id);
    expect(sources.body.risk_assessment).toEqual([]);

    const md = await binary(request(app).get(`/api/reports/experiment/${e.id}?format=md`).set(dev.auth)).expect(200);
    const text = (md.body as Buffer).toString();
    expect(md.headers['content-type']).toContain('text/markdown');
    expect(text).toContain('# Fairness Report: FAIRNESS_AUDIT run');
    expect(text).toContain('EDUCATIONAL SIMULATION');
    expect(text).toContain('## Unfavourable findings');
    expect(text).toContain('Women are selected at less than half the rate of men.');
    expect(text).toContain('| female | 120 | 29% |');
    expect(text).toContain('## Trade-offs and limitations');
    expect(text).not.toMatch(/\bcompliant\b/i);

    const pdf = await binary(request(app).get(`/api/reports/experiment/${e.id}?format=pdf`).set(dev.auth)).expect(200);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');

    const json = await request(app).get(`/api/reports/experiment/${e.id}?format=json`).set(dev.auth).expect(200);
    const parsed = JSON.parse(Buffer.isBuffer(json.body) ? json.body.toString() : json.text);
    expect(parsed.results[0].data.attributes[0].disparities.demographicParityDifference).toBe(0.31);
    expect(await latestAudit({ action: 'report.generated', resourceId: e.id })).not.toBeNull();
  });

  it('renders SHAP explainability reports', async () => {
    const dev = await loginAs('DEVELOPER');
    const e = await experiment(dev.user.id, 'SHAP', 'shap', SHAP);
    const md = await binary(request(app).get(`/api/reports/experiment/${e.id}?format=md`).set(dev.auth)).expect(200);
    const text = (md.body as Buffer).toString();
    expect(text).toContain('# Explainability Report');
    expect(text).toContain('| income | 0.12 | 0.03 |');
    expect(text).toContain('## Local explanation: dataset row 17');
  });

  it('enforces visibility, permissions and completion', async () => {
    const dev = await loginAs('DEVELOPER');
    const otherDev = await loginAs('DEVELOPER');
    const student = await loginAs('STUDENT');
    const faculty = await loginAs('FACULTY');
    const e = await experiment(dev.user.id, 'FAIRNESS_AUDIT', 'fairness_audit', FAIRNESS_AUDIT);
    const running = await experiment(dev.user.id, 'PGD', 'robustness_tabular', {}, 'RUNNING');
    const training = await experiment(dev.user.id, 'TRAINING', 'training', {});

    await request(app).get(`/api/reports/experiment/${e.id}`).set(otherDev.auth).expect(404);
    await request(app).get(`/api/reports/experiment/${e.id}?format=md`).set(faculty.auth).expect(200);
    await request(app).get('/api/reports/sources').set(student.auth).expect(403);
    await request(app).get(`/api/reports/experiment/${running.id}`).set(dev.auth).expect(409);
    await request(app).get(`/api/reports/experiment/${training.id}`).set(dev.auth).expect(400);
    await request(app).get(`/api/reports/risk_assessment/${randomUUID()}`).set(dev.auth).expect(403);
    await request(app).get(`/api/reports/unknown/${e.id}`).set(dev.auth).expect(400);
    await request(app).get(`/api/reports/experiment/${e.id}?format=docx`).set(dev.auth).expect(400);
  });
});
