import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { prisma } from '../../src/config/prisma';
import { app, latestAudit, loginAs } from '../helpers';

afterAll(() => prisma.$disconnect());

const RUBRIC = [
  { criterion: 'Correct metric computation', weight: 40 },
  { criterion: 'Mitigation and trade-off analysis', weight: 40 },
  { criterion: 'Clarity of reporting', weight: 20 },
];
const ESSAY = 'I measured selection rates by gender and age, applied exponentiated gradient and compared before/after metrics.';

async function course() {
  return prisma.course.create({
    data: { title: 'Fairness', slug: `fair-${randomUUID().slice(0, 8)}`, summary: 's', description: 'd', status: 'PUBLISHED', modules: { create: { title: 'M1', summary: 's', order: 1 } } },
    include: { modules: true },
  });
}

async function completedExperiment(userId: string) {
  return prisma.experiment.create({
    data: { userId, type: 'FAIRNESS_AUDIT', status: 'COMPLETED', name: 'Loan audit', parameters: {}, randomSeed: 42, configHash: randomUUID(), completedAt: new Date() },
  });
}

async function createAssignment(auth: Record<string, string>, courseId: string, extra: Record<string, unknown> = {}) {
  const res = await request(app)
    .post('/api/assignments')
    .set(auth)
    .send({
      courseId,
      title: 'Analyze a dataset for fairness',
      description: 'Identify and mitigate bias in the loan dataset.',
      instructions: 'Measure selection and error rates by group, mitigate, and report the trade-off.',
      targetRoles: ['STUDENT'],
      rubric: RUBRIC,
      isPublished: true,
      ...extra,
    })
    .expect(201);
  return res.body as { id: string; rubric: { criterion: string; maxPoints: number }[] };
}

describe('assignments', () => {
  it('validates the rubric, targets roles and notifies enrolled learners on publish', async () => {
    const faculty = await loginAs('FACULTY');
    const student = await loginAs('STUDENT');
    const developer = await loginAs('DEVELOPER');
    const c = await course();
    await prisma.enrollment.createMany({ data: [student.user.id, developer.user.id].map((userId) => ({ userId, courseId: c.id })) });

    await request(app)
      .post('/api/assignments')
      .set(faculty.auth)
      .send({ courseId: c.id, title: 'Bad rubric', description: 'Weights do not add up.', instructions: 'Weights do not add up to 100.', rubric: [{ criterion: 'Only', weight: 90 }] })
      .expect(400);
    await request(app).post('/api/assignments').set(student.auth).send({}).expect(403);

    const a = await createAssignment(faculty.auth, c.id);
    expect(a.rubric.map((r) => r.maxPoints)).toEqual([40, 40, 20]);
    expect(await prisma.notification.count({ where: { userId: student.user.id, type: 'ASSIGNMENT_ASSIGNED' } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: developer.user.id, type: 'ASSIGNMENT_ASSIGNED' } })).toBe(0);

    const mine = await request(app).get('/api/assignments').set(student.auth).expect(200);
    expect(mine.body.data.map((x: { id: string }) => x.id)).toContain(a.id);
    const theirs = await request(app).get('/api/assignments').set(developer.auth).expect(200);
    expect(theirs.body.data.map((x: { id: string }) => x.id)).not.toContain(a.id);
    await request(app).get(`/api/assignments/${a.id}`).set(developer.auth).expect(404);

    const detail = await request(app).get(`/api/assignments/${a.id}`).set(student.auth).expect(200);
    expect(detail.body).toMatchObject({ canSubmit: true, stats: null, mySubmissions: [] });
  });

  it('runs the submit, grade, return and resubmit workflow with a server-computed score', async () => {
    const faculty = await loginAs('FACULTY');
    const student = await loginAs('STUDENT');
    const other = await loginAs('STUDENT');
    const c = await course();
    const a = await createAssignment(faculty.auth, c.id);
    const exp = await completedExperiment(student.user.id);
    const foreign = await completedExperiment(other.user.id);

    await request(app).post(`/api/assignments/${a.id}/submissions`).set(student.auth).send({ content: 'too short' }).expect(400);
    const bad = await request(app)
      .post(`/api/assignments/${a.id}/submissions`)
      .set(student.auth)
      .send({ content: ESSAY, evidence: [{ type: 'experiment', id: foreign.id }] })
      .expect(400);
    expect(bad.body.error.details[0].path).toBe('evidence.0');

    const sub = await request(app)
      .post(`/api/assignments/${a.id}/submissions`)
      .set(student.auth)
      .send({ content: ESSAY, evidence: [{ type: 'experiment', id: exp.id }] })
      .expect(201);
    expect(sub.body).toMatchObject({ status: 'SUBMITTED', attemptNumber: 1, late: false, evidence: [{ type: 'experiment', id: exp.id, label: 'Loan audit' }] });
    await request(app).post(`/api/assignments/${a.id}/submissions`).set(student.auth).send({ content: ESSAY }).expect(409);
    await request(app).get(`/api/submissions/${sub.body.id}`).set(other.auth).expect(404);
    await request(app).get(`/api/assignments/${a.id}/submissions`).set(student.auth).expect(403);

    const queue = await request(app).get(`/api/assignments/${a.id}/submissions?status=SUBMITTED`).set(faculty.auth).expect(200);
    expect(queue.body.data.map((s: { id: string }) => s.id)).toEqual([sub.body.id]);

    // Return for revision first.
    await request(app).post(`/api/submissions/${sub.body.id}/grade`).set(faculty.auth).send({ decision: 'RETURN', feedback: 'Please add the accuracy trade-off.' }).expect(200);
    const returned = await request(app).get(`/api/assignments/${a.id}`).set(student.auth).expect(200);
    expect(returned.body).toMatchObject({ canSubmit: true, mySubmissions: [{ status: 'RETURNED', score: null }] });

    const second = await request(app).post(`/api/assignments/${a.id}/submissions`).set(student.auth).send({ content: `${ESSAY} Accuracy fell by 2 points.` }).expect(201);
    expect(second.body.attemptNumber).toBe(2);

    const grade = (rubricScores: unknown) => request(app).post(`/api/submissions/${second.body.id}/grade`).set(faculty.auth).send({ decision: 'GRADE', feedback: 'Good analysis overall.', rubricScores });
    await grade([{ criterion: RUBRIC[0].criterion, points: 41 }, { criterion: RUBRIC[1].criterion, points: 30 }, { criterion: RUBRIC[2].criterion, points: 10 }]).expect(400);
    await grade([{ criterion: RUBRIC[0].criterion, points: 30 }]).expect(400);
    await grade([{ criterion: 'Invented', points: 5 }, { criterion: RUBRIC[0].criterion, points: 30 }, { criterion: RUBRIC[1].criterion, points: 30 }, { criterion: RUBRIC[2].criterion, points: 10 }]).expect(400);

    const graded = await grade([
      { criterion: RUBRIC[0].criterion, points: 36 },
      { criterion: RUBRIC[1].criterion, points: 30.5, comment: 'Explain the constraint choice.' },
      { criterion: RUBRIC[2].criterion, points: 18 },
    ]).expect(200);
    expect(graded.body).toMatchObject({ status: 'GRADED', score: 84.5, percentage: 84.5, gradedBy: { id: faculty.user.id } });
    expect(graded.body.rubricScores[1]).toMatchObject({ maxPoints: 40, points: 30.5, comment: 'Explain the constraint choice.' });
    await grade([{ criterion: RUBRIC[0].criterion, points: 40 }]).expect(409);

    const audit = await latestAudit({ action: 'submission.graded', resourceId: second.body.id });
    expect(audit?.after).toMatchObject({ status: 'GRADED', score: 84.5 });
    expect(await prisma.notification.count({ where: { userId: student.user.id, type: 'ASSIGNMENT_GRADED' } })).toBe(2);
    const history = await request(app).get(`/api/assignments/${a.id}/history`).set(faculty.auth).expect(200);
    const actions = history.body.events.map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['assignment.created', 'submission.created', 'submission.returned', 'submission.graded']));

    const after = await request(app).get(`/api/assignments/${a.id}`).set(student.auth).expect(200);
    expect(after.body).toMatchObject({ canSubmit: false, reason: 'Your submission has been graded' });

    await request(app)
      .patch(`/api/assignments/${a.id}`)
      .set(faculty.auth)
      .send({ rubric: [{ criterion: 'All', weight: 100 }] })
      .expect(409);
    await request(app).patch(`/api/assignments/${a.id}`).set(faculty.auth).send({ title: 'Analyze a dataset for fairness (2026)' }).expect(200);
  });

  it('flags late submissions and blocks graders from grading their own work', async () => {
    const faculty = await loginAs('FACULTY');
    const colleague = await loginAs('FACULTY');
    const c = await course();
    const a = await createAssignment(faculty.auth, c.id, { targetRoles: [], dueDate: new Date(Date.now() - 86_400_000).toISOString() });

    const sub = await request(app).post(`/api/assignments/${a.id}/submissions`).set(faculty.auth).send({ content: ESSAY }).expect(201);
    expect(sub.body.late).toBe(true);
    expect(sub.body.permissions.canGrade).toBe(false);
    await request(app)
      .post(`/api/submissions/${sub.body.id}/grade`)
      .set(faculty.auth)
      .send({ decision: 'GRADE', feedback: 'Grading my own work.', rubricScores: RUBRIC.map((r) => ({ criterion: r.criterion, points: r.weight })) })
      .expect(403);
    const ok = await request(app)
      .post(`/api/submissions/${sub.body.id}/grade`)
      .set(colleague.auth)
      .send({ decision: 'GRADE', feedback: 'Independent grading.', rubricScores: RUBRIC.map((r) => ({ criterion: r.criterion, points: r.weight })) })
      .expect(200);
    expect(ok.body.score).toBe(100);
  });

  it('hides unpublished assignments from learners', async () => {
    const faculty = await loginAs('FACULTY');
    const student = await loginAs('STUDENT');
    const c = await course();
    const a = await createAssignment(faculty.auth, c.id, { isPublished: false });
    await request(app).get(`/api/assignments/${a.id}`).set(student.auth).expect(404);
    await request(app).post(`/api/assignments/${a.id}/submissions`).set(student.auth).send({ content: ESSAY }).expect(404);
    await request(app).patch(`/api/assignments/${a.id}`).set(faculty.auth).send({ isPublished: true }).expect(200);
    await request(app).get(`/api/assignments/${a.id}`).set(student.auth).expect(200);
  });
});
