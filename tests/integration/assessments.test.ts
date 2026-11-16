import request from 'supertest';
import { prisma } from '../../src/config/prisma';
import { app, latestAudit, loginAs } from '../helpers';

afterAll(() => prisma.$disconnect());

const ANSWERS = {
  purpose: 'Recommend approval or rejection of small-business loan applications.',
  domain: 'CREDIT_FINANCE',
  users: ['DOMAIN_EXPERTS'],
  affectedPopulation: 'CUSTOMERS',
  affectedScale: 'UNDER_10K',
  dataSensitivity: 'PERSONAL',
  decisionImpact: 'SIGNIFICANT',
  automationLevel: 'HUMAN_IN_THE_LOOP',
  humanOversight: 'STRONG',
  fairnessRisk: 'HIGH',
  usesProtectedAttributes: true,
  privacyRisk: 'MEDIUM',
  securityExposure: 'INTERNAL_ONLY',
  adversarialThreat: 'LOW',
  explainabilityRequirement: 'HIGH',
  modelTransparency: 'BLACK_BOX',
  regulatoryContext: ['FAIR_LENDING', 'GDPR'],
} as const;

const fullSections = () => ({
  systemInformation: 'Loan risk evaluator v1, deployed in commercial banking.',
  purpose: 'Support loan officers when assessing small-business credit risk.',
  stakeholders: 'Applicants, loan officers, credit risk committee, regulators.',
  affectedGroups: 'Small-business applicants, including women-owned businesses.',
  dataSources: 'Historical loan applications 2019-2024 with outcomes.',
  modelDescription: 'Gradient boosted trees over 14 financial features.',
  potentialHarms: 'Unequal approval rates; opaque rejections.',
  fairnessAnalysis: 'Audit shows a 0.18 parity gap by gender before mitigation.',
  privacyAnalysis: 'Personal financial data; minimised and access controlled.',
  securityAnalysis: 'Internal only; PGD robustness evaluated.',
  humanOversight: 'Loan officers review every recommendation.',
  explainability: 'SHAP explanations shown to officers and in adverse action notices.',
  monitoring: 'Quarterly fairness re-audit and drift monitoring.',
  incidentResponse: 'Incidents routed to the model risk team within 24 hours.',
  governanceApproval: 'Credit risk committee and AI governance board sign-off.',
  harms: [{ description: 'Lower approval rates for women-owned businesses', affectedGroup: 'Women-owned businesses', likelihood: 'MEDIUM', severity: 'HIGH', mitigation: 'Threshold review and quarterly audit' }],
});

async function system(ownerId: string) {
  return prisma.aISystem.create({ data: { name: `Loan system ${Date.now()}`, description: 'Small-business lending decision support', ownerId } });
}

describe('risk assessments', () => {
  it('previews the score without saving and rejects incomplete answers', async () => {
    const pd = await loginAs('PRODUCT_DEVELOPER');
    const res = await request(app).post('/api/risk-assessments/score').set(pd.auth).send({ answers: ANSWERS }).expect(200);
    expect(res.body.level).toBe('HIGH');
    expect(res.body.escalations.join(' ')).toMatch(/high-impact domain/);
    expect(res.body.complianceConsiderations.every((c: { requiresLegalReview: boolean }) => c.requiresLegalReview)).toBe(true);
    expect(res.body.disclaimer).toMatch(/not a legal determination/);

    const bad = await request(app).post('/api/risk-assessments/score').set(pd.auth).send({ answers: { ...ANSWERS, purpose: 'short', users: [] } }).expect(400);
    const paths = bad.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['answers.purpose', 'answers.users']));
  });

  it('runs the full review workflow, enforces segregation of duties and updates the AI system on approval', async () => {
    const pd = await loginAs('PRODUCT_DEVELOPER');
    const admin = await loginAs('ADMIN');
    const sys = await system(pd.user.id);

    const created = await request(app).post('/api/risk-assessments').set(pd.auth).send({ title: 'Loan pre-deployment', aiSystemId: sys.id, answers: ANSWERS }).expect(201);
    const id = created.body.id;
    expect(created.body).toMatchObject({ status: 'DRAFT', riskLevel: 'HIGH', permissions: { edit: true, submit: true, review: false } });
    expect(created.body.result.recommendedControls.map((c: { id: string }) => c.id)).toEqual(expect.arrayContaining(['fairness-audit', 'aia']));

    const edited = await request(app).patch(`/api/risk-assessments/${id}`).set(pd.auth).send({ answers: { ...ANSWERS, decisionImpact: 'LIFE_CHANGING', automationLevel: 'FULLY_AUTOMATED', humanOversight: 'NONE' } }).expect(200);
    expect(edited.body.riskLevel).toBe('CRITICAL');
    await request(app).patch(`/api/risk-assessments/${id}`).set(pd.auth).send({ answers: ANSWERS }).expect(200);

    await request(app).post(`/api/risk-assessments/${id}/start-review`).set(admin.auth).expect(409);
    await request(app).post(`/api/risk-assessments/${id}/submit`).set(pd.auth).expect(200);
    await request(app).patch(`/api/risk-assessments/${id}`).set(pd.auth).send({ title: 'Changed' }).expect(409);
    const notice = await prisma.notification.findFirst({ where: { userId: admin.user.id, type: 'RISK_ASSESSMENT_SUBMITTED' }, orderBy: { createdAt: 'desc' } });
    expect(notice?.link).toBe(`/risk-assessments/${id}`);

    await request(app).post(`/api/risk-assessments/${id}/review`).set(admin.auth).send({ decision: 'APPROVE' }).expect(409);
    await request(app).post(`/api/risk-assessments/${id}/start-review`).set(admin.auth).expect(200);
    await request(app).post(`/api/risk-assessments/${id}/review`).set(admin.auth).send({ decision: 'REQUEST_CHANGES' }).expect(400);
    const changes = await request(app).post(`/api/risk-assessments/${id}/review`).set(admin.auth).send({ decision: 'REQUEST_CHANGES', comment: 'Document the appeal route' }).expect(200);
    expect(changes.body).toMatchObject({ status: 'CHANGES_REQUESTED', reviewComment: 'Document the appeal route', permissions: { edit: false } });
    const ownerView = await request(app).get(`/api/risk-assessments/${id}`).set(pd.auth).expect(200);
    expect(ownerView.body.permissions).toMatchObject({ edit: true, submit: true });

    await request(app).post(`/api/risk-assessments/${id}/submit`).set(pd.auth).expect(200);
    await request(app).post(`/api/risk-assessments/${id}/start-review`).set(admin.auth).expect(200);
    const approved = await request(app).post(`/api/risk-assessments/${id}/review`).set(admin.auth).send({ decision: 'APPROVE', comment: 'Controls accepted' }).expect(200);
    expect(approved.body).toMatchObject({ status: 'APPROVED', reviewerId: admin.user.id });

    const updated = await prisma.aISystem.findUniqueOrThrow({ where: { id: sys.id } });
    expect(updated.riskLevel).toBe('HIGH');
    expect(updated.nextReviewAt!.getTime()).toBeGreaterThan(Date.now() + 80 * 86_400_000);

    const history = await request(app).get(`/api/risk-assessments/${id}/history`).set(pd.auth).expect(200);
    const actions = history.body.events.map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['risk_assessment.created', 'risk_assessment.submitted', 'risk_assessment.review_started', 'risk_assessment.changes_requested', 'risk_assessment.approved']));

    await request(app).delete(`/api/risk-assessments/${id}`).set(pd.auth).expect(409);
    await request(app).post(`/api/risk-assessments/${id}/retire`).set(admin.auth).send({ reason: 'Superseded by re-assessment' }).expect(200);
  });

  it('blocks a super admin from reviewing their own assessment and audits the attempt', async () => {
    const su = await loginAs('SUPER_ADMIN');
    const created = await request(app).post('/api/risk-assessments').set(su.auth).send({ title: 'Self review', answers: ANSWERS }).expect(201);
    await request(app).post(`/api/risk-assessments/${created.body.id}/submit`).set(su.auth).expect(200);
    await request(app).post(`/api/risk-assessments/${created.body.id}/start-review`).set(su.auth).expect(403);
    const audit = await latestAudit({ action: 'risk_assessment.review_blocked', userId: su.user.id });
    expect(audit?.result).toBe('DENIED');
  });

  it('exports with the methodology and compliance disclaimer, and enforces permissions', async () => {
    const pd = await loginAs('PRODUCT_DEVELOPER');
    const student = await loginAs('STUDENT');
    const exec = await loginAs('EXECUTIVE');
    const created = await request(app).post('/api/risk-assessments').set(pd.auth).send({ title: 'Export me', answers: ANSWERS }).expect(201);
    const md = await request(app).get(`/api/risk-assessments/${created.body.id}/export?format=md`).set(pd.auth).expect(200);
    expect(md.text).toMatch(/Potential compliance considerations/);
    expect(md.text).toMatch(/DRAFT: not an approved risk assessment/);
    expect(md.text).toMatch(/does not establish that any regulatory requirement is satisfied/);
    const pdf = await request(app).get(`/api/risk-assessments/${created.body.id}/export?format=pdf`).set(pd.auth).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    await request(app).get('/api/risk-assessments').set(student.auth).expect(403);
    const list = await request(app).get('/api/risk-assessments?mine=false').set(exec.auth).expect(200);
    expect(list.body.data.length).toBeGreaterThan(0);
    expect(list.body.data[0]).not.toHaveProperty('answers');
    await request(app).post(`/api/risk-assessments/${created.body.id}/start-review`).set(exec.auth).expect(403);
    await request(app).delete(`/api/risk-assessments/${created.body.id}`).set(pd.auth).expect(204);
  });
});

describe('algorithmic impact assessments', () => {
  it('requires every section before submission and reports what is missing', async () => {
    const pd = await loginAs('PRODUCT_DEVELOPER');
    const created = await request(app)
      .post('/api/impact-assessments')
      .set(pd.auth)
      .send({ title: 'Partial AIA', sections: { purpose: 'Support loan officers', harms: [{ description: 'Opaque rejection', affectedGroup: 'Applicants', likelihood: 'HIGH', severity: 'CRITICAL' }] } })
      .expect(201);
    expect(created.body.readiness.ready).toBe(false);
    const res = await request(app).post(`/api/impact-assessments/${created.body.id}/submit`).set(pd.auth).expect(422);
    const paths = res.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['sections.systemInformation', 'sections.harms.0.mitigation']));
    expect(paths).not.toContain('sections.purpose');
  });

  it('records a complete status history with snapshots and versions resubmissions', async () => {
    const pd = await loginAs('PRODUCT_DEVELOPER');
    const admin = await loginAs('ADMIN');
    const sys = await system(pd.user.id);
    const created = await request(app).post('/api/impact-assessments').set(pd.auth).send({ title: 'Loan AIA', aiSystemId: sys.id, sections: fullSections() }).expect(201);
    const id = created.body.id;
    expect(created.body.readiness.ready).toBe(true);
    expect(created.body.readiness.concerns.join(' ')).toMatch(/no risk assessment/);

    await request(app).post(`/api/impact-assessments/${id}/submit`).set(pd.auth).expect(200);
    await request(app).post(`/api/impact-assessments/${id}/start-review`).set(admin.auth).expect(200);
    await request(app).post(`/api/impact-assessments/${id}/review`).set(admin.auth).send({ decision: 'REQUEST_CHANGES', comment: 'Quantify the parity gap after mitigation' }).expect(200);
    const sections = { ...fullSections(), fairnessAnalysis: 'Parity gap reduced from 0.18 to 0.06 with threshold optimisation.' };
    await request(app).patch(`/api/impact-assessments/${id}`).set(pd.auth).send({ sections }).expect(200);
    const resubmitted = await request(app).post(`/api/impact-assessments/${id}/submit`).set(pd.auth).expect(200);
    expect(resubmitted.body.version).toBe(2);
    await request(app).post(`/api/impact-assessments/${id}/start-review`).set(admin.auth).expect(200);
    const approved = await request(app).post(`/api/impact-assessments/${id}/review`).set(admin.auth).send({ decision: 'APPROVE' }).expect(200);
    expect(approved.body).toMatchObject({ status: 'APPROVED', approvedById: admin.user.id });
    await request(app).post(`/api/impact-assessments/${id}/retire`).set(admin.auth).send({ reason: 'System decommissioned' }).expect(200);

    const { body } = await request(app).get(`/api/impact-assessments/${id}/history`).set(pd.auth).expect(200);
    expect(body.history.map((h: { toStatus: string }) => h.toStatus)).toEqual(['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'RETIRED']);
    expect(body.history[3]).toMatchObject({ comment: 'Quantify the parity gap after mitigation', actor: { id: admin.user.id } });
    expect(body.history[1].snapshot.fairnessAnalysis).toMatch(/0.18 parity gap/);
    expect(body.history[4].snapshot.fairnessAnalysis).toMatch(/reduced from 0.18 to 0.06/);

    const md = await request(app).get(`/api/impact-assessments/${id}/export?format=md`).set(pd.auth).expect(200);
    expect(md.text).toMatch(/Status history/);
    expect(md.text).toMatch(/not a legal determination/);
  });

  it('only lets approvers review, never the owner', async () => {
    const su = await loginAs('SUPER_ADMIN');
    const pd = await loginAs('PRODUCT_DEVELOPER');
    const created = await request(app).post('/api/impact-assessments').set(su.auth).send({ title: 'Own AIA', sections: fullSections() }).expect(201);
    await request(app).post(`/api/impact-assessments/${created.body.id}/submit`).set(su.auth).expect(200);
    await request(app).post(`/api/impact-assessments/${created.body.id}/start-review`).set(pd.auth).expect(403);
    await request(app).post(`/api/impact-assessments/${created.body.id}/start-review`).set(su.auth).expect(403);
    await request(app).patch(`/api/impact-assessments/${created.body.id}`).set(pd.auth).send({ title: 'Hijack' }).expect(403);
  });
});
