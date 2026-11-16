import request from 'supertest';
import { prisma } from '../../src/config/prisma';
import { PERMISSIONS } from '../../src/rbac/permissions';
import { incidentService } from '../../src/services/governance/incident.service';
import { app, latestAudit, loginAs } from '../helpers';

afterAll(() => prisma.$disconnect());

const ANSWERS = {
  purpose: 'Rank job applicants for recruiter shortlisting.',
  domain: 'EMPLOYMENT',
  users: ['INTERNAL_STAFF'],
  affectedPopulation: 'GENERAL_PUBLIC',
  affectedScale: 'UNDER_10K',
  dataSensitivity: 'PERSONAL',
  decisionImpact: 'SIGNIFICANT',
  automationLevel: 'HUMAN_IN_THE_LOOP',
  humanOversight: 'STRONG',
  fairnessRisk: 'HIGH',
  usesProtectedAttributes: false,
  privacyRisk: 'MEDIUM',
  securityExposure: 'INTERNAL_ONLY',
  adversarialThreat: 'LOW',
  explainabilityRequirement: 'MEDIUM',
  modelTransparency: 'POST_HOC_EXPLAINABLE',
  regulatoryContext: ['EMPLOYMENT_LAW'],
};

describe('AI system inventory and Shadow AI register', () => {
  it('gates activation on an approved risk assessment and, for high risk, an approved AIA', async () => {
    const admin = await loginAs('ADMIN');
    const pd = await loginAs('PRODUCT_DEVELOPER');
    const created = await request(app)
      .post('/api/governance/ai-systems')
      .set(admin.auth)
      .send({ name: 'Hiring ranker', description: 'Ranks applicants for recruiters', status: 'DEVELOPMENT', isThirdParty: true, vendorName: 'HireCo', dataCategories: ['CV data'] })
      .expect(201);
    const id = created.body.id;
    expect(created.body.activationBlockers.join(' ')).toMatch(/approved risk assessment/);

    const blocked = await request(app).patch(`/api/governance/ai-systems/${id}`).set(admin.auth).send({ status: 'ACTIVE' }).expect(409);
    expect(blocked.body.error.code).toBe('GOVERNANCE_GATE');

    const ra = await request(app).post('/api/risk-assessments').set(pd.auth).send({ title: 'Hiring risk', aiSystemId: id, answers: ANSWERS }).expect(201);
    await request(app).post(`/api/risk-assessments/${ra.body.id}/submit`).set(pd.auth).expect(200);
    await request(app).post(`/api/risk-assessments/${ra.body.id}/start-review`).set(admin.auth).expect(200);
    await request(app).post(`/api/risk-assessments/${ra.body.id}/review`).set(admin.auth).send({ decision: 'APPROVE' }).expect(200);

    const stillBlocked = await request(app).patch(`/api/governance/ai-systems/${id}`).set(admin.auth).send({ status: 'ACTIVE' }).expect(409);
    expect(stillBlocked.body.error.details[0].message).toMatch(/HIGH risk systems need an approved algorithmic impact assessment/);

    await prisma.algorithmicImpactAssessment.create({ data: { title: 'Hiring AIA', aiSystemId: id, ownerId: pd.user.id, status: 'APPROVED', sections: {} } });
    const active = await request(app).patch(`/api/governance/ai-systems/${id}`).set(admin.auth).send({ status: 'ACTIVE' }).expect(200);
    expect(active.body).toMatchObject({ status: 'ACTIVE', riskLevel: 'HIGH' });
    expect((await latestAudit({ action: 'ai_system.status_changed', resourceId: id }))?.after).toMatchObject({ status: 'ACTIVE' });
  });

  it('requires a vendor for third-party systems and keeps risk level read-only', async () => {
    const admin = await loginAs('ADMIN');
    const res = await request(app).post('/api/governance/ai-systems').set(admin.auth).send({ name: 'Vendor tool', description: 'Third-party scoring tool', isThirdParty: true }).expect(400);
    expect(res.body.error.details[0].path).toBe('vendorName');
    const sys = await request(app).post('/api/governance/ai-systems').set(admin.auth).send({ name: 'Internal tool', description: 'Internal forecasting model' }).expect(201);
    await request(app).patch(`/api/governance/ai-systems/${sys.body.id}`).set(admin.auth).send({ riskLevel: 'LOW' }).expect(400);
  });

  it('sanctions or prohibits Shadow AI with a recorded reason', async () => {
    const admin = await loginAs('ADMIN');
    const dev = await loginAs('DEVELOPER');
    const shadow = await request(app)
      .post('/api/governance/ai-systems')
      .set(admin.auth)
      .send({ name: 'Public chatbot used by support', description: 'Staff paste tickets into a public chatbot', isShadowAI: true, status: 'ACTIVE', isThirdParty: true, vendorName: 'Public LLM', discoveredVia: 'Network logs' })
      .expect(201);
    const list = await request(app).get('/api/governance/ai-systems?shadow=true').set(dev.auth).expect(200);
    expect(list.body.data.some((s: { id: string }) => s.id === shadow.body.id)).toBe(true);
    await request(app).post(`/api/governance/ai-systems/${shadow.body.id}/resolve-shadow`).set(dev.auth).send({ decision: 'PROHIBIT', reason: 'Personal data exposure' }).expect(403);
    await request(app).post(`/api/governance/ai-systems/${shadow.body.id}/resolve-shadow`).set(admin.auth).send({ decision: 'PROHIBIT' }).expect(400);
    const prohibited = await request(app).post(`/api/governance/ai-systems/${shadow.body.id}/resolve-shadow`).set(admin.auth).send({ decision: 'PROHIBIT', reason: 'Personal data exposure' }).expect(200);
    expect(prohibited.body).toMatchObject({ status: 'RETIRED', isShadowAI: true });
    expect((await latestAudit({ action: 'ai_system.shadow_prohibited', resourceId: shadow.body.id }))?.reason).toBe('Personal data exposure');

    const other = await request(app).post('/api/governance/ai-systems').set(admin.auth).send({ name: 'Spreadsheet ML add-in', description: 'Forecasting add-in found on laptops', isShadowAI: true, status: 'ACTIVE' }).expect(201);
    const sanctioned = await request(app).post(`/api/governance/ai-systems/${other.body.id}/resolve-shadow`).set(admin.auth).send({ decision: 'SANCTION', reason: 'Low-risk forecasting use' }).expect(200);
    expect(sanctioned.body).toMatchObject({ isShadowAI: false, status: 'PROPOSED' });
    expect(sanctioned.body.nextReviewAt).toBeTruthy();
  });
});

describe('policies', () => {
  it('moves through review and approval with segregation of duties', async () => {
    const admin = await loginAs('ADMIN');
    const other = await loginAs('ADMIN');
    const created = await request(app)
      .post('/api/governance/policies')
      .set(admin.auth)
      .send({ title: 'Generative AI acceptable use', category: 'Acceptable use', summary: 'Rules for using generative AI tools at work.', content: 'Do not enter personal or confidential data into unsanctioned AI tools.' })
      .expect(201);
    const id = created.body.id;
    expect(created.body.slug).toMatch(/^generative-ai-acceptable-use/);
    await request(app).post(`/api/governance/policies/${id}/submit`).set(admin.auth).expect(200);
    await request(app).patch(`/api/governance/policies/${id}`).set(admin.auth).send({ summary: 'Changed while in review' }).expect(409);
    await request(app).post(`/api/governance/policies/${id}/approve`).set(admin.auth).send({}).expect(403);
    const approved = await request(app).post(`/api/governance/policies/${id}/approve`).set(other.auth).send({}).expect(200);
    expect(approved.body).toMatchObject({ status: 'ACTIVE', approvedBy: { id: other.user.id } });
    expect(new Date(approved.body.reviewDate).getTime()).toBeGreaterThan(Date.now() + 360 * 86_400_000);

    const revised = await request(app).post(`/api/governance/policies/${id}/revise`).set(admin.auth).send({ reason: 'Add guidance on code assistants' }).expect(200);
    expect(revised.body).toMatchObject({ status: 'DRAFT', version: '1.1', approvedBy: null });
    const history = await request(app).get(`/api/governance/policies/${id}/history`).set(admin.auth).expect(200);
    expect(history.body.events.map((e: { action: string }) => e.action)).toEqual(expect.arrayContaining(['policy.created', 'policy.submitted', 'policy.approval_blocked', 'policy.approved', 'policy.revised']));
  });
});

describe('incidents', () => {
  it('lets reporters see only their own incidents and notifies managers of severe ones', async () => {
    const reporter = await loginAs('DEVELOPER');
    const admin = await loginAs('ADMIN');
    const pd = await loginAs('PRODUCT_DEVELOPER');
    const created = await request(app)
      .post('/api/governance/incidents')
      .set(reporter.auth)
      .send({ title: 'Model rejects all applicants from one region', description: 'Since Monday every applicant from region X is rejected.', severity: 'CRITICAL' })
      .expect(201);
    const notice = await prisma.notification.findFirst({ where: { userId: admin.user.id, title: 'CRITICAL AI incident reported' }, orderBy: { createdAt: 'desc' } });
    expect(notice).toBeTruthy();
    await request(app).patch(`/api/governance/incidents/${created.body.id}`).set(reporter.auth).send({ status: 'INVESTIGATING' }).expect(403);
    const reporterOnly = { actor: { id: pd.user.id, email: pd.user.email, role: pd.user.role.name }, ctx: {} as never, can: (p: string) => p === PERMISSIONS.INCIDENTS_REPORT };
    const own = await incidentService.list(reporterOnly, { page: 1, pageSize: 100 });
    expect(own.data.every((i) => i.reportedBy?.id === pd.user.id)).toBe(true);
    await expect(incidentService.get(reporterOnly, created.body.id)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('enforces the incident lifecycle and requires root cause before resolution', async () => {
    const admin = await loginAs('ADMIN');
    const assignee = await loginAs('PRODUCT_DEVELOPER');
    const { body: inc } = await request(app).post('/api/governance/incidents').set(admin.auth).send({ title: 'Drift in credit scores', description: 'Score distribution shifted after the data feed change.', severity: 'MEDIUM' }).expect(201);
    const url = `/api/governance/incidents/${inc.id}`;
    await request(app).patch(url).set(admin.auth).send({ status: 'INVESTIGATING', assignedToId: assignee.user.id }).expect(200);
    expect(await prisma.notification.count({ where: { userId: assignee.user.id, title: 'AI incident assigned to you' } })).toBe(1);
    await request(app).patch(url).set(admin.auth).send({ status: 'OPEN' }).expect(409);
    const missing = await request(app).patch(url).set(admin.auth).send({ status: 'RESOLVED' }).expect(400);
    expect(missing.body.error.details.map((d: { path: string }) => d.path)).toEqual(['rootCause', 'correctiveActions']);
    await request(app).patch(url).set(admin.auth).send({ status: 'CLOSED', rootCause: 'x', correctiveActions: 'y' }).expect(409);
    const resolved = await request(app).patch(url).set(admin.auth).send({ status: 'RESOLVED', rootCause: 'Upstream unit change', correctiveActions: 'Schema validation on the feed' }).expect(200);
    expect(resolved.body.resolvedAt).toBeTruthy();
    await request(app).patch(url).set(admin.auth).send({ status: 'INVESTIGATING' }).expect(400);
    const reopened = await request(app).patch(url).set(admin.auth).send({ status: 'INVESTIGATING', note: 'Drift recurred' }).expect(200);
    expect(reopened.body.resolvedAt).toBeNull();
  });
});

describe('registers', () => {
  it('derives inherent risk scores and requires a rationale to accept a risk', async () => {
    const admin = await loginAs('ADMIN');
    const { body: entry } = await request(app)
      .post('/api/governance/risks')
      .set(admin.auth)
      .send({ title: 'Proxy discrimination', description: 'Postcode acts as a proxy for ethnicity.', category: 'Fairness', likelihood: 4, impact: 5 })
      .expect(201);
    expect(entry.inherentScore).toBe(20);
    await request(app).patch(`/api/governance/risks/${entry.id}`).set(admin.auth).send({ residualScore: 21 }).expect(400);
    await request(app).patch(`/api/governance/risks/${entry.id}`).set(admin.auth).send({ status: 'ACCEPTED' }).expect(400);
    const accepted = await request(app).patch(`/api/governance/risks/${entry.id}`).set(admin.auth).send({ status: 'ACCEPTED', mitigation: 'Postcode removed; residual monitored', residualScore: 6, impact: 3 }).expect(200);
    expect(accepted.body).toMatchObject({ status: 'ACCEPTED', inherentScore: 12, residualScore: 6 });
  });

  it('never marks a requirement compliant and routes legal items through legal review', async () => {
    const admin = await loginAs('ADMIN');
    const req = await prisma.complianceRequirement.create({ data: { code: `T-${Date.now()}`, title: 'Human oversight measures', description: 'Document oversight', framework: 'Test framework', category: 'Oversight', requiresLegalReview: true } });
    const url = `/api/governance/compliance/${req.id}`;
    await request(app).patch(url).set(admin.auth).send({ status: 'COMPLIANT' }).expect(400);
    await request(app).patch(url).set(admin.auth).send({ status: 'EVIDENCE_PROVIDED' }).expect(400);
    await request(app).patch(url).set(admin.auth).send({ status: 'EVIDENCE_PROVIDED', evidence: 'Oversight runbook v2' }).expect(200);
    const skip = await request(app).patch(url).set(admin.auth).send({ status: 'REVIEWED', note: 'Looks fine' }).expect(400);
    expect(skip.body.error.details[0].message).toMatch(/legal review/);
    await request(app).patch(url).set(admin.auth).send({ status: 'NEEDS_LEGAL_REVIEW' }).expect(200);
    const reviewed = await request(app).patch(url).set(admin.auth).send({ status: 'REVIEWED', note: 'Reviewed by counsel J. Doe' }).expect(200);
    expect(reviewed.body.lastReviewedAt).toBeTruthy();
    const list = await request(app).get('/api/governance/compliance?framework=Test%20framework').set(admin.auth).expect(200);
    expect(list.body.disclaimer).toMatch(/never indicate that a legal requirement is satisfied/);
  });

  it('keeps vendor approval independent of the assessor', async () => {
    const admin = await loginAs('ADMIN');
    const other = await loginAs('ADMIN');
    const { body: v } = await request(app).post('/api/governance/vendors').set(admin.auth).send({ vendorName: 'ScoreCo', productName: 'Credit API', findings: { documentation: 'Model card provided', openQuestions: ['Subgroup metrics?'] } }).expect(201);
    await request(app).post(`/api/governance/vendors/${v.id}/decision`).set(admin.auth).send({ decision: 'START_REVIEW' }).expect(200);
    await request(app).post(`/api/governance/vendors/${v.id}/decision`).set(admin.auth).send({ decision: 'APPROVE' }).expect(403);
    await request(app).post(`/api/governance/vendors/${v.id}/decision`).set(other.auth).send({ decision: 'REJECT' }).expect(400);
    const approved = await request(app).post(`/api/governance/vendors/${v.id}/decision`).set(other.auth).send({ decision: 'APPROVE' }).expect(200);
    expect(approved.body.status).toBe('APPROVED');
  });

  it('records oversight decisions and completes scheduled reviews, updating the resource', async () => {
    const admin = await loginAs('ADMIN');
    const sys = await prisma.aISystem.create({ data: { name: 'Review target', description: 'System under review', ownerId: admin.user.id } });
    await request(app).post('/api/governance/oversight').set(admin.auth).send({ decisionReference: 'APP-1', decision: 'OVERRODE_RECOMMENDATION', rationale: 'Applicant provided updated income evidence.' }).expect(400);
    await request(app).post('/api/governance/oversight').set(admin.auth).send({ aiSystemId: sys.id, decisionReference: 'APP-1', decision: 'OVERRODE_RECOMMENDATION', rationale: 'Applicant provided updated income evidence.' }).expect(201);
    const { body: schedule } = await request(app)
      .post('/api/governance/reviews')
      .set(admin.auth)
      .send({ resourceType: 'AISystem', resourceId: sys.id, title: 'Quarterly review', frequencyDays: 90, nextReviewAt: new Date(Date.now() - 86_400_000).toISOString() })
      .expect(201);
    const due = await request(app).get('/api/governance/reviews?dueWithinDays=0').set(admin.auth).expect(200);
    expect(due.body.data.find((r: { id: string }) => r.id === schedule.id)).toMatchObject({ overdue: true, resourceName: 'Review target' });
    await request(app).post(`/api/governance/reviews/${schedule.id}/complete`).set(admin.auth).send({ notes: 'Metrics stable; no new incidents' }).expect(200);
    const after = await prisma.aISystem.findUniqueOrThrow({ where: { id: sys.id } });
    expect(after.lastReviewedAt).toBeTruthy();
    expect(after.nextReviewAt!.getTime()).toBeGreaterThan(Date.now() + 85 * 86_400_000);
  });
});

describe('overview and approvals', () => {
  it('summarises governance state and lists pending decisions the caller can act on', async () => {
    const admin = await loginAs('ADMIN');
    const pd = await loginAs('PRODUCT_DEVELOPER');
    const student = await loginAs('STUDENT');
    const ra = await request(app).post('/api/risk-assessments').set(pd.auth).send({ title: 'Pending review', answers: ANSWERS }).expect(201);
    await request(app).post(`/api/risk-assessments/${ra.body.id}/submit`).set(pd.auth).expect(200);

    const overview = await request(app).get('/api/governance/overview').set(admin.auth).expect(200);
    expect(overview.body).toHaveProperty('systems.shadowAI');
    expect(overview.body.disclaimer).toMatch(/not a compliance determination/);

    const adminQueue = await request(app).get('/api/governance/approvals').set(admin.auth).expect(200);
    expect(adminQueue.body.items.find((i: { id: string }) => i.id === ra.body.id)).toMatchObject({ type: 'RISK_ASSESSMENT', canAct: true });
    const ownQueue = await request(app).get('/api/governance/approvals').set(pd.auth).expect(200);
    expect(ownQueue.body.items.find((i: { id: string }) => i.id === ra.body.id)).toMatchObject({ canAct: false });
    await request(app).get('/api/governance/overview').set(student.auth).expect(403);
  });
});
