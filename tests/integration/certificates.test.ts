import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { prisma } from '../../src/config/prisma';
import { app, latestAudit, loginAs } from '../helpers';

afterAll(() => prisma.$disconnect());

/** A small course with every kind of certification requirement. */
async function buildCourse() {
  const course = await prisma.course.create({
    data: {
      title: `Trustworthy AI ${randomUUID().slice(0, 4)}`,
      slug: `tai-${randomUUID().slice(0, 8)}`,
      summary: 's',
      description: 'd',
      status: 'PUBLISHED',
      modules: { create: { title: 'M1', summary: 's', order: 1, lessons: { create: [{ title: 'L1', content: 'x', order: 1 }, { title: 'L2', content: 'y', order: 2 }] } } },
    },
    include: { modules: { include: { lessons: true } } },
  });
  const lab = await prisma.lab.create({ data: { courseId: course.id, slug: `lab-${randomUUID().slice(0, 8)}`, title: 'Fairness lab', type: 'FAIRNESS', description: 'd', instructions: 'i', isRequired: true } });
  const quiz = await prisma.quiz.create({ data: { courseId: course.id, title: 'Pillars quiz', isPublished: true } });
  const exam = await prisma.quiz.create({ data: { courseId: course.id, title: 'Final exam', isPublished: true, isFinal: true } });
  const assignment = await prisma.assignment.create({
    data: { courseId: course.id, title: 'Fairness project', description: 'd', instructions: 'i', targetRoles: ['STUDENT'], isPublished: true, rubric: [{ criterion: 'All', weight: 100 }] },
  });
  return { course, lessons: course.modules[0].lessons, lab, quiz, exam, assignment };
}

type Course = Awaited<ReturnType<typeof buildCourse>>;

async function completeEverything(userId: string, c: Course, grade = 80) {
  await prisma.enrollment.upsert({ where: { userId_courseId: { userId, courseId: c.course.id } }, create: { userId, courseId: c.course.id }, update: {} });
  await prisma.progress.createMany({ data: c.lessons.map((l) => ({ userId, lessonId: l.id, moduleId: l.moduleId, status: 'COMPLETED' as const, completedAt: new Date() })) });
  await prisma.labAttempt.create({ data: { labId: c.lab.id, userId, status: 'COMPLETED', completedAt: new Date() } });
  for (const q of [c.quiz, c.exam]) {
    await prisma.quizAttempt.create({ data: { quizId: q.id, userId, attemptNumber: 1, questionIds: [], percentage: 85, passed: true, submittedAt: new Date() } });
  }
  await prisma.submission.create({ data: { assignmentId: c.assignment.id, userId, content: 'x', status: 'GRADED', score: grade } });
}

describe('certificates', () => {
  it('blocks requests until every requirement is met, then runs approval, PDF, verification and revocation', async () => {
    const c = await buildCourse();
    const student = await loginAs('STUDENT');
    const faculty = await loginAs('FACULTY');
    await prisma.enrollment.create({ data: { userId: student.user.id, courseId: c.course.id } });

    const before = await request(app).get(`/api/certificates/eligibility?courseId=${c.course.id}`).set(student.auth).expect(200);
    expect(before.body[0]).toMatchObject({ enrolled: true, eligible: false, certificate: null });
    expect(before.body[0].requirements.map((r: { key: string; met: boolean }) => [r.key, r.met])).toEqual([
      ['lessons', false],
      ['labs', false],
      ['quizzes', false],
      ['final_exam', false],
      ['assignments', false],
      ['approval', false],
    ]);
    const blocked = await request(app).post('/api/certificates/request').set(student.auth).send({ courseId: c.course.id }).expect(422);
    expect(blocked.body.error.code).toBe('CERTIFICATE_NOT_ELIGIBLE');
    expect(blocked.body.error.details).toHaveLength(5);

    await completeEverything(student.user.id, c, 65);
    const lowGrade = await request(app).get(`/api/certificates/eligibility?courseId=${c.course.id}`).set(student.auth).expect(200);
    expect(lowGrade.body[0].requirements.find((r: { key: string }) => r.key === 'assignments')).toMatchObject({ met: false, items: [{ detail: 'Graded 65%' }] });
    await prisma.submission.updateMany({ where: { userId: student.user.id }, data: { score: 80 } });

    const requested = await request(app).post('/api/certificates/request').set(student.auth).send({ courseId: c.course.id }).expect(201);
    expect(requested.body).toMatchObject({ status: 'PENDING_APPROVAL', verificationUrl: null, permissions: { canApprove: false, canDownload: false } });
    expect(requested.body.certificateNumber).toMatch(/^TAI-\d{4}-\d{6}$/);
    expect(await prisma.notification.count({ where: { userId: faculty.user.id, title: 'Certificate awaiting approval' } })).toBe(1);
    await request(app).post('/api/certificates/request').set(student.auth).send({ courseId: c.course.id }).expect(409);

    const { verificationCode } = await prisma.certificate.findUniqueOrThrow({ where: { id: requested.body.id } });
    await request(app).get(`/api/verify/${verificationCode}`).expect(404);
    await request(app).get(`/api/certificates/${requested.body.id}/pdf`).set(student.auth).expect(409);
    await request(app).post(`/api/certificates/${requested.body.id}/approve`).set(student.auth).send({}).expect(403);

    const review = await request(app).get(`/api/certificates/${requested.body.id}`).set(faculty.auth).expect(200);
    expect(review.body.liveRequirements.every((r: { met: boolean }) => r.met)).toBe(true);
    expect(review.body.holder.email).toBe(student.user.email);

    const issued = await request(app).post(`/api/certificates/${requested.body.id}/approve`).set(faculty.auth).send({ comment: 'Excellent work' }).expect(200);
    expect(issued.body).toMatchObject({ status: 'ISSUED', approvedBy: { id: faculty.user.id }, approvalComment: 'Excellent work', permissions: { canRevoke: true } });
    expect(issued.body.verificationUrl).toContain(`/verify/${verificationCode}`);
    expect(await latestAudit({ action: 'certificate.issued', resourceId: requested.body.id })).not.toBeNull();
    expect(await prisma.notification.count({ where: { userId: student.user.id, type: 'CERTIFICATE_ISSUED' } })).toBe(1);

    const pdf = await request(app).get(`/api/certificates/${requested.body.id}/pdf`).set(student.auth).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (d: Buffer) => chunks.push(d));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');

    const other = await loginAs('STUDENT');
    await request(app).get(`/api/certificates/${requested.body.id}`).set(other.auth).expect(404);

    const verified = await request(app).get(`/api/verify/${verificationCode}`).expect(200);
    expect(verified.body).toMatchObject({ valid: true, status: 'ISSUED', certificateNumber: requested.body.certificateNumber, holderName: 'Test STUDENT', courseTitle: c.course.title });
    expect(JSON.stringify(verified.body)).not.toContain(student.user.email);
    await request(app).get('/api/verify/not-a-real-code-at-all').expect(404);
    await request(app).get('/api/verify/bad!').expect(400);

    await request(app).post(`/api/certificates/${requested.body.id}/revoke`).set(faculty.auth).send({ reason: 'x' }).expect(400);
    const revoked = await request(app).post(`/api/certificates/${requested.body.id}/revoke`).set(faculty.auth).send({ reason: 'Academic integrity finding' }).expect(200);
    expect(revoked.body.status).toBe('REVOKED');
    const revokedCheck = await request(app).get(`/api/verify/${verificationCode}`).expect(200);
    expect(revokedCheck.body).toMatchObject({ valid: false, status: 'REVOKED' });
    expect(revokedCheck.body.revokedReason).toBeUndefined();
    await request(app).get(`/api/certificates/${requested.body.id}/pdf`).set(student.auth).expect(409);
    expect((await latestAudit({ action: 'certificate.revoked', resourceId: requested.body.id }))?.severity).toBe('MEDIUM');
  });

  it('declines requests and re-checks requirements at approval time', async () => {
    const c = await buildCourse();
    const faculty = await loginAs('FACULTY');
    const a = await loginAs('STUDENT');
    const b = await loginAs('STUDENT');
    await completeEverything(a.user.id, c);
    await completeEverything(b.user.id, c);

    const reqA = await request(app).post('/api/certificates/request').set(a.auth).send({ courseId: c.course.id }).expect(201);
    await request(app).post(`/api/certificates/${reqA.body.id}/decline`).set(faculty.auth).send({ reason: 'Please resubmit after the final review' }).expect(204);
    expect(await prisma.certificate.findUnique({ where: { id: reqA.body.id } })).toBeNull();
    expect(await latestAudit({ action: 'certificate.declined', resourceId: reqA.body.id })).not.toBeNull();
    await request(app).post('/api/certificates/request').set(a.auth).send({ courseId: c.course.id }).expect(201);

    const reqB = await request(app).post('/api/certificates/request').set(b.auth).send({ courseId: c.course.id }).expect(201);
    await prisma.quizAttempt.deleteMany({ where: { userId: b.user.id, quizId: c.exam.id } });
    const stale = await request(app).post(`/api/certificates/${reqB.body.id}/approve`).set(faculty.auth).send({}).expect(422);
    expect(stale.body.error.details[0].path).toBe('final_exam');

    const list = await request(app).get('/api/certificates?status=PENDING_APPROVAL').set(faculty.auth).expect(200);
    expect(list.body.pendingApprovals).toBeGreaterThanOrEqual(2);
    const own = await request(app).get('/api/certificates').set(b.auth).expect(200);
    expect(own.body.data.map((x: { id: string }) => x.id)).toEqual([reqB.body.id]);
  });

  it('requires enrolment and prevents faculty from approving their own certificate', async () => {
    const c = await buildCourse();
    const faculty = await loginAs('FACULTY');
    const student = await loginAs('STUDENT');
    await request(app).post('/api/certificates/request').set(student.auth).send({ courseId: c.course.id }).expect(409);
    const notEnrolled = await request(app).get(`/api/certificates/eligibility?courseId=${c.course.id}`).set(student.auth).expect(200);
    expect(notEnrolled.body[0]).toMatchObject({ enrolled: false, eligible: false });

    await prisma.assignment.update({ where: { id: c.assignment.id }, data: { targetRoles: [] } });
    await completeEverything(faculty.user.id, c, 90);
    const mine = await request(app).post('/api/certificates/request').set(faculty.auth).send({ courseId: c.course.id }).expect(201);
    expect(mine.body.permissions.canApprove).toBe(false);
    await request(app).post(`/api/certificates/${mine.body.id}/approve`).set(faculty.auth).send({}).expect(403);
  });
});
