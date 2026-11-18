import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { prisma } from '../../src/config/prisma';
import { app, latestAudit, loginAs } from '../helpers';

afterAll(() => prisma.$disconnect());

const kc = {
  prompt: 'Which metric compares selection rates across groups?',
  options: [
    { id: 'a', text: 'Demographic parity difference' },
    { id: 'b', text: 'Clean accuracy' },
  ],
  correctOptionIds: ['a'],
  explanation: 'Demographic parity compares selection rates.',
};

async function buildCourse(auth: Record<string, string>, lessons = 2) {
  const slug = `course-${randomUUID().slice(0, 8)}`;
  const course = await request(app)
    .post('/api/courses')
    .set(auth)
    .send({ title: 'Fairness 101', slug, summary: 'Intro to fairness', description: 'A short course.' })
    .expect(201);
  const mod = await request(app)
    .post(`/api/courses/${course.body.id}/modules`)
    .set(auth)
    .send({ title: 'Module one', summary: 'Basics', objectives: ['Understand parity'] })
    .expect(201);
  const lessonIds: string[] = [];
  for (let i = 0; i < lessons; i++) {
    const l = await request(app)
      .post(`/api/modules/${mod.body.id}/lessons`)
      .set(auth)
      .send({ title: `Lesson ${i + 1}`, content: '# Hello', knowledgeCheck: i === 0 ? [kc] : undefined })
      .expect(201);
    lessonIds.push(l.body.id);
  }
  return { courseId: course.body.id as string, moduleId: mod.body.id as string, lessonIds };
}

describe('courses', () => {
  it('lets faculty author, reorder and publish a course and hides drafts from learners', async () => {
    const faculty = await loginAs('FACULTY');
    const student = await loginAs('STUDENT');
    const { courseId, moduleId, lessonIds } = await buildCourse(faculty.auth, 3);

    await request(app).get(`/api/courses/${courseId}`).set(student.auth).expect(404);
    const drafts = await request(app).get('/api/courses').set(student.auth).expect(200);
    expect(drafts.body.data.some((c: { id: string }) => c.id === courseId)).toBe(false);

    await request(app).put(`/api/modules/${moduleId}/lessons/order`).set(faculty.auth).send({ ids: [lessonIds[2], lessonIds[0], lessonIds[1]] }).expect(204);
    await request(app).put(`/api/modules/${moduleId}/lessons/order`).set(faculty.auth).send({ ids: [lessonIds[0]] }).expect(400);
    const ordered = await prisma.lesson.findMany({ where: { moduleId }, orderBy: { order: 'asc' } });
    expect(ordered.map((l) => l.id)).toEqual([lessonIds[2], lessonIds[0], lessonIds[1]]);

    await request(app).patch(`/api/courses/${courseId}`).set(faculty.auth).send({ status: 'PUBLISHED' }).expect(200);
    expect(await latestAudit({ action: 'course.published', resourceId: courseId })).not.toBeNull();
    const detail = await request(app).get(`/api/courses/${courseId}`).set(student.auth).expect(200);
    expect(detail.body.modules[0].lessons).toHaveLength(3);
    expect(detail.body.enrollment).toBeNull();
  });

  it('refuses to publish an empty course', async () => {
    const faculty = await loginAs('FACULTY');
    const res = await request(app)
      .post('/api/courses')
      .set(faculty.auth)
      .send({ title: 'Empty', slug: `empty-${randomUUID().slice(0, 8)}`, summary: 's', description: 'd' })
      .expect(201);
    await request(app).patch(`/api/courses/${res.body.id}`).set(faculty.auth).send({ status: 'PUBLISHED' }).expect(400);
  });

  it('forbids learners from authoring and validates input', async () => {
    const student = await loginAs('STUDENT');
    const faculty = await loginAs('FACULTY');
    await request(app).post('/api/courses').set(student.auth).send({ title: 'x', slug: 'xxx', summary: 's', description: 'd' }).expect(403);
    await request(app).post('/api/courses').set(faculty.auth).send({ title: 'x', slug: 'Bad Slug', summary: 's', description: 'd' }).expect(400);
    const { moduleId } = await buildCourse(faculty.auth, 1);
    await request(app)
      .post(`/api/modules/${moduleId}/lessons`)
      .set(faculty.auth)
      .send({ title: 'Video', videoUrl: 'http://insecure.example.com/v.mp4' })
      .expect(400);
  });

  it('tracks enrolment, lesson progress and course completion', async () => {
    const faculty = await loginAs('FACULTY');
    const student = await loginAs('STUDENT');
    const { courseId, lessonIds } = await buildCourse(faculty.auth, 2);
    await request(app).patch(`/api/courses/${courseId}`).set(faculty.auth).send({ status: 'PUBLISHED' }).expect(200);

    await request(app).get(`/api/lessons/${lessonIds[0]}`).set(student.auth).expect(403);
    await request(app).post(`/api/courses/${courseId}/enroll`).set(student.auth).expect(201);

    const lesson = await request(app).get(`/api/lessons/${lessonIds[0]}`).set(student.auth).expect(200);
    expect(lesson.body.knowledgeCheck[0]).not.toHaveProperty('correctOptionIds');
    expect(lesson.body.knowledgeCheck[0]).not.toHaveProperty('explanation');
    expect(lesson.body.navigation).toMatchObject({ position: 1, total: 2, previous: null });

    const p1 = await request(app).post(`/api/lessons/${lessonIds[0]}/progress`).set(student.auth).send({ timeSpentSeconds: 120, completed: true });
    expect(p1.status).toBe(200);
    expect(p1.body.enrollment.progressPercent).toBe(50);

    await request(app).post(`/api/lessons/${lessonIds[1]}/progress`).set(student.auth).send({ timeSpentSeconds: 99999 }).expect(400);
    const p2 = await request(app).post(`/api/lessons/${lessonIds[1]}/progress`).set(student.auth).send({ timeSpentSeconds: 60, completed: true });
    expect(p2.body.enrollment).toMatchObject({ status: 'COMPLETED', progressPercent: 100 });
    const notification = await prisma.notification.findFirst({ where: { userId: student.user.id, type: 'COURSE_COMPLETED' } });
    expect(notification).not.toBeNull();

    // Completing again is idempotent and time accumulates.
    const again = await request(app).post(`/api/lessons/${lessonIds[0]}/progress`).set(student.auth).send({ timeSpentSeconds: 30, completed: true });
    expect(again.body.progress.timeSpentSeconds).toBe(150);

    const analytics = await request(app).get(`/api/courses/${courseId}/analytics`).set(faculty.auth).expect(200);
    expect(analytics.body).toMatchObject({ enrolled: 1, completed: 1 });
    expect(analytics.body.learners[0]).toMatchObject({ userId: student.user.id, progressPercent: 100 });
    await request(app).get(`/api/courses/${courseId}/analytics`).set(student.auth).expect(403);
  });

  it('grades knowledge checks on the server', async () => {
    const faculty = await loginAs('FACULTY');
    const student = await loginAs('STUDENT');
    const { courseId, lessonIds } = await buildCourse(faculty.auth, 1);
    await request(app).patch(`/api/courses/${courseId}`).set(faculty.auth).send({ status: 'PUBLISHED' }).expect(200);
    await request(app).post(`/api/lessons/${lessonIds[0]}/knowledge-check`).set(student.auth).send({ index: 0, answers: ['a'] }).expect(403);
    await request(app).post(`/api/courses/${courseId}/enroll`).set(student.auth).expect(201);

    const wrong = await request(app).post(`/api/lessons/${lessonIds[0]}/knowledge-check`).set(student.auth).send({ index: 0, answers: ['b'] });
    expect(wrong.body).toMatchObject({ correct: false, correctOptionIds: ['a'] });
    const right = await request(app).post(`/api/lessons/${lessonIds[0]}/knowledge-check`).set(student.auth).send({ index: 0, answers: ['a'] });
    expect(right.body.correct).toBe(true);
    await request(app).post(`/api/lessons/${lessonIds[0]}/knowledge-check`).set(student.auth).send({ index: 5, answers: ['a'] }).expect(404);
  });

  it('protects content with learner progress from deletion', async () => {
    const faculty = await loginAs('FACULTY');
    const student = await loginAs('STUDENT');
    const { courseId, moduleId, lessonIds } = await buildCourse(faculty.auth, 2);
    await request(app).patch(`/api/courses/${courseId}`).set(faculty.auth).send({ status: 'PUBLISHED' }).expect(200);
    await request(app).post(`/api/courses/${courseId}/enroll`).set(student.auth).expect(201);
    await request(app).get(`/api/lessons/${lessonIds[0]}`).set(student.auth).expect(200);

    await request(app).delete(`/api/lessons/${lessonIds[0]}`).set(faculty.auth).expect(409);
    await request(app).delete(`/api/modules/${moduleId}`).set(faculty.auth).expect(409);
    await request(app).delete(`/api/lessons/${lessonIds[1]}`).set(faculty.auth).expect(204);
    const remaining = await prisma.lesson.findMany({ where: { moduleId } });
    expect(remaining.map((l) => l.order)).toEqual([1]);
  });
});

async function buildQuiz(auth: Record<string, string>, opts: Record<string, unknown> = {}) {
  const quiz = await request(app)
    .post('/api/quizzes')
    .set(auth)
    .send({ title: 'Quick check', passingScore: 50, randomizeQuestions: false, ...opts })
    .expect(201);
  const questions = [
    { type: 'MULTIPLE_CHOICE', prompt: 'Q1', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], correctOptionIds: ['a'], explanation: 'A is right' },
    {
      type: 'MULTIPLE_ANSWER',
      prompt: 'Q2',
      options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }, { id: 'c', text: 'C' }],
      correctOptionIds: ['a', 'c'],
      explanation: 'A and C',
      points: 2,
    },
  ];
  const ids: string[] = [];
  for (const q of questions) ids.push((await request(app).post(`/api/quizzes/${quiz.body.id}/questions`).set(auth).send(q).expect(201)).body.id);
  await request(app).patch(`/api/quizzes/${quiz.body.id}`).set(auth).send({ isPublished: true }).expect(200);
  return { quizId: quiz.body.id as string, questionIds: ids };
}

describe('video and slide lessons', () => {
  // Minimal valid file signatures; the content after them is irrelevant to the checks.
  const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(40, 1)]);
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 2)]);
  const PDF = Buffer.from('%PDF-1.4\n%fake\n');

  it('stores slide decks and video, and remembers each learner\'s resume position', async () => {
    const faculty = await loginAs('FACULTY');
    const student = await loginAs('STUDENT');
    const { courseId, moduleId } = await buildCourse(faculty.auth, 1);
    const deck = await request(app)
      .post(`/api/modules/${moduleId}/lessons`)
      .set(faculty.auth)
      .send({
        title: 'Slides',
        type: 'SLIDES',
        slides: [{ url: '/samples/slides/slide-1.png', title: 'One', notes: 'Say hello' }, { url: 'https://cdn.example.com/two.png' }],
        slidesUrl: '/api/course-media/00000000-0000-0000-0000-000000000000.pdf',
      })
      .expect(201);
    const video = await request(app)
      .post(`/api/modules/${moduleId}/lessons`)
      .set(faculty.auth)
      .send({ title: 'Video', type: 'VIDEO', videoUrl: 'https://www.youtube.com/watch?v=abc123' })
      .expect(201);
    await request(app).patch(`/api/courses/${courseId}`).set(faculty.auth).send({ status: 'PUBLISHED' }).expect(200);
    await request(app).post(`/api/courses/${courseId}/enroll`).set(student.auth).expect(201);

    const first = await request(app).get(`/api/lessons/${deck.body.id}`).set(student.auth).expect(200);
    expect(first.body).toMatchObject({ type: 'SLIDES', slidesUrl: expect.stringContaining('/api/course-media/') });
    expect(first.body.slides).toHaveLength(2);
    expect(first.body.progress.lastPosition).toBe(0);

    await request(app).post(`/api/lessons/${deck.body.id}/progress`).set(student.auth).send({ timeSpentSeconds: 20, position: 1 }).expect(200);
    const resumed = await request(app).get(`/api/lessons/${deck.body.id}`).set(student.auth).expect(200);
    expect(resumed.body.progress).toMatchObject({ lastPosition: 1, status: 'IN_PROGRESS' });

    // A progress ping without a position must not reset the resume point.
    await request(app).post(`/api/lessons/${deck.body.id}/progress`).set(student.auth).send({ timeSpentSeconds: 5 }).expect(200);
    const kept = await request(app).get(`/api/lessons/${deck.body.id}`).set(student.auth).expect(200);
    expect(kept.body.progress.lastPosition).toBe(1);

    await request(app).post(`/api/lessons/${video.body.id}/progress`).set(student.auth).send({ timeSpentSeconds: 30, position: 95 }).expect(200);
    const other = await request(app).get(`/api/lessons/${video.body.id}`).set(student.auth).expect(200);
    expect(other.body.progress.lastPosition).toBe(95);
  });

  it('rejects unsafe media URLs and unknown lesson shapes', async () => {
    const faculty = await loginAs('FACULTY');
    const { moduleId } = await buildCourse(faculty.auth, 1);
    const post = (body: object) => request(app).post(`/api/modules/${moduleId}/lessons`).set(faculty.auth).send({ title: 'x', ...body });
    await post({ type: 'VIDEO', videoUrl: 'http://insecure.example.com/v.mp4' }).expect(400);
    await post({ type: 'VIDEO', videoUrl: 'javascript:alert(1)' }).expect(400);
    await post({ type: 'SLIDES', slides: [{ url: '//evil.example.com/a.png' }] }).expect(400);
    await post({ type: 'SLIDES', slidesUrl: '/api/course-media/../../etc/passwd' }).expect(400);
    await post({ type: 'SLIDES', slides: [{ url: '/samples/../secret.png' }] }).expect(400);
    await post({ type: 'SLIDES', slides: [] }).expect(201);
  });

  it('accepts only inert media types, checks file signatures and serves byte ranges', async () => {
    const faculty = await loginAs('FACULTY');
    const student = await loginAs('STUDENT');

    await request(app).post('/api/courses/media').set(student.auth).attach('file', MP4, 'a.mp4').expect(403);
    await request(app).post('/api/courses/media').set(faculty.auth).expect(400);
    // A script renamed to .png is rejected by its signature, as is SVG.
    await request(app).post('/api/courses/media').set(faculty.auth).attach('file', Buffer.from('<script>alert(1)</script>'), 'x.png').expect(400);
    await request(app).post('/api/courses/media').set(faculty.auth).attach('file', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'x.svg').expect(400);

    const video = await request(app).post('/api/courses/media').set(faculty.auth).attach('file', MP4, 'intro.mp4').expect(201);
    expect(video.body).toMatchObject({ kind: 'video', contentType: 'video/mp4', sizeBytes: MP4.length });
    expect(video.body.url).toMatch(/^\/api\/course-media\/[0-9a-f-]{36}\.mp4$/);
    expect(await latestAudit({ action: 'course.media.upload', resourceId: video.body.url.split('/').pop() })).not.toBeNull();

    // Players cannot send bearer tokens, so the unguessable URL is fetchable without one.
    const full = await request(app).get(video.body.url).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(full.status).toBe(200);
    expect(full.headers['content-type']).toBe('video/mp4');
    expect(full.headers['accept-ranges']).toBe('bytes');
    expect(full.headers['x-content-type-options']).toBe('nosniff');
    expect(full.body.equals(MP4)).toBe(true);

    const partial = await request(app).get(video.body.url).set('Range', 'bytes=0-9').buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(partial.status).toBe(206);
    expect(partial.headers['content-range']).toBe(`bytes 0-9/${MP4.length}`);
    expect(partial.body.equals(MP4.subarray(0, 10))).toBe(true);
    await request(app).get(video.body.url).set('Range', `bytes=${MP4.length + 5}-`).expect(416);

    const png = await request(app).post('/api/courses/media').set(faculty.auth).attach('file', PNG, 's.png').expect(201);
    expect(png.body.kind).toBe('image');
    const pdf = await request(app).post('/api/courses/media').set(faculty.auth).attach('file', PDF, 'deck.pdf').expect(201);
    expect(pdf.body.kind).toBe('document');
    const pdfRes = await request(app).get(pdf.body.url).expect(200);
    expect(pdfRes.headers['content-security-policy']).toContain("frame-ancestors 'self'");

    await request(app).get('/api/course-media/not-a-real-file.mp4').expect(404);
    await request(app).get('/api/course-media/00000000-0000-0000-0000-000000000000.mp4').expect(404);
  });
});

describe('quizzes', () => {
  it('validates question definitions', async () => {
    const faculty = await loginAs('FACULTY');
    const quiz = await request(app).post('/api/quizzes').set(faculty.auth).send({ title: 'V' }).expect(201);
    const base = { prompt: 'P', explanation: 'E', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }] };
    await request(app).post(`/api/quizzes/${quiz.body.id}/questions`).set(faculty.auth).send({ ...base, type: 'MULTIPLE_CHOICE', correctOptionIds: ['z'] }).expect(400);
    await request(app).post(`/api/quizzes/${quiz.body.id}/questions`).set(faculty.auth).send({ ...base, type: 'MULTIPLE_CHOICE', correctOptionIds: ['a', 'b'] }).expect(400);
    await request(app).patch(`/api/quizzes/${quiz.body.id}`).set(faculty.auth).send({ isPublished: true }).expect(400);
  });

  it('runs an attempt without leaking answers and grades it on the server', async () => {
    const faculty = await loginAs('FACULTY');
    const student = await loginAs('STUDENT');
    const { quizId, questionIds } = await buildQuiz(faculty.auth);

    const start = await request(app).post(`/api/quizzes/${quizId}/attempts`).set(student.auth).expect(201);
    expect(start.body.status).toBe('IN_PROGRESS');
    expect(JSON.stringify(start.body)).not.toContain('correctOptionIds');
    expect(JSON.stringify(start.body)).not.toContain('explanation');

    const resumed = await request(app).post(`/api/quizzes/${quizId}/attempts`).set(student.auth).expect(201);
    expect(resumed.body.id).toBe(start.body.id);

    const other = await loginAs('STUDENT');
    await request(app).get(`/api/quiz-attempts/${start.body.id}`).set(other.auth).expect(404);

    const submit = await request(app)
      .post(`/api/quiz-attempts/${start.body.id}/submit`)
      .set(student.auth)
      .send({ answers: { [questionIds[0]]: ['a'], [questionIds[1]]: ['a'] } })
      .expect(200);
    // Partial multiple-answer selections score zero: 1 of 3 points.
    expect(submit.body).toMatchObject({ status: 'SUBMITTED', score: 1, maxScore: 3, percentage: 33.3, passed: false });
    expect(submit.body.review[1]).toMatchObject({ correct: false, correctOptionIds: ['a', 'c'], explanation: 'A and C' });

    await request(app).post(`/api/quiz-attempts/${start.body.id}/submit`).set(student.auth).send({ answers: {} }).expect(409);
    expect(await latestAudit({ action: 'quiz.attempt_submit', userId: student.user.id })).not.toBeNull();
  });

  it('enforces attempt limits and discards answers submitted after expiry', async () => {
    const faculty = await loginAs('FACULTY');
    const student = await loginAs('STUDENT');
    const { quizId, questionIds } = await buildQuiz(faculty.auth, { attemptLimit: 1, timeLimitSeconds: 60 });

    const start = await request(app).post(`/api/quizzes/${quizId}/attempts`).set(student.auth).expect(201);
    await prisma.quizAttempt.update({ where: { id: start.body.id }, data: { expiresAt: new Date(Date.now() - 120_000) } });
    const late = await request(app)
      .post(`/api/quiz-attempts/${start.body.id}/submit`)
      .set(student.auth)
      .send({ answers: { [questionIds[0]]: ['a'], [questionIds[1]]: ['a', 'c'] } })
      .expect(200);
    expect(late.body).toMatchObject({ late: true, score: 0, passed: false });

    await request(app).post(`/api/quizzes/${quizId}/attempts`).set(student.auth).expect(409);
    const summary = await request(app).get(`/api/quizzes/${quizId}`).set(student.auth).expect(200);
    expect(summary.body).toMatchObject({ attemptsRemaining: 0, questions: null });
  });

  it('keeps deactivated questions out of new attempts', async () => {
    const faculty = await loginAs('FACULTY');
    const student = await loginAs('STUDENT');
    const { quizId, questionIds } = await buildQuiz(faculty.auth);
    await request(app).delete(`/api/questions/${questionIds[1]}`).set(faculty.auth).expect(200);
    const start = await request(app).post(`/api/quizzes/${quizId}/attempts`).set(student.auth).expect(201);
    expect(start.body.questions.map((q: { id: string }) => q.id)).toEqual([questionIds[0]]);
  });
});

describe('labs', () => {
  it('requires a completed, owned experiment of a matching type as evidence', async () => {
    const student = await loginAs('STUDENT');
    const other = await loginAs('STUDENT');
    const lab = await prisma.lab.create({
      data: { slug: `fair-${randomUUID().slice(0, 8)}`, title: 'Fairness lab', type: 'FAIRNESS', description: 'd', instructions: 'i' },
    });
    const attempt = await request(app).post(`/api/labs/${lab.id}/attempts`).set(student.auth).expect(201);
    const again = await request(app).post(`/api/labs/${lab.id}/attempts`).set(student.auth).expect(201);
    expect(again.body.id).toBe(attempt.body.id);

    const mkExperiment = (userId: string, type: 'SHAP' | 'FAIRNESS_AUDIT', status: 'COMPLETED' | 'FAILED') =>
      prisma.experiment.create({ data: { type, status, userId, parameters: {}, randomSeed: 42, configHash: randomUUID() } });

    await request(app).post(`/api/lab-attempts/${attempt.body.id}/complete`).set(student.auth).send({}).expect(400);
    const wrongType = await mkExperiment(student.user.id, 'SHAP', 'COMPLETED');
    await request(app).post(`/api/lab-attempts/${attempt.body.id}/complete`).set(student.auth).send({ experimentId: wrongType.id }).expect(400);
    const failed = await mkExperiment(student.user.id, 'FAIRNESS_AUDIT', 'FAILED');
    await request(app).post(`/api/lab-attempts/${attempt.body.id}/complete`).set(student.auth).send({ experimentId: failed.id }).expect(400);
    const foreign = await mkExperiment(other.user.id, 'FAIRNESS_AUDIT', 'COMPLETED');
    await request(app).post(`/api/lab-attempts/${attempt.body.id}/complete`).set(student.auth).send({ experimentId: foreign.id }).expect(400);
    await request(app).post(`/api/lab-attempts/${attempt.body.id}/complete`).set(other.auth).send({ experimentId: foreign.id }).expect(404);

    const good = await mkExperiment(student.user.id, 'FAIRNESS_AUDIT', 'COMPLETED');
    const done = await request(app).post(`/api/lab-attempts/${attempt.body.id}/complete`).set(student.auth).send({ experimentId: good.id }).expect(200);
    expect(done.body).toMatchObject({ status: 'COMPLETED', experimentId: good.id });

    const list = await request(app).get('/api/labs').set(student.auth).expect(200);
    const entry = list.body.find((l: { id: string }) => l.id === lab.id);
    expect(entry.myLatestAttempt.status).toBe('COMPLETED');
    expect(entry.evidenceTypes).toEqual(['FAIRNESS_AUDIT', 'FAIRNESS_MITIGATION']);
  });

  it('requires a written reflection for non-experiment labs and restricts lab management', async () => {
    const student = await loginAs('STUDENT');
    const faculty = await loginAs('FACULTY');
    const created = await request(app)
      .post('/api/labs')
      .set(faculty.auth)
      .send({ slug: `gov-${randomUUID().slice(0, 8)}`, title: 'Governance lab', type: 'GOVERNANCE', description: 'd', instructions: 'i' })
      .expect(201);
    await request(app).post('/api/labs').set(student.auth).send({ slug: 'nope-lab', title: 't', type: 'XAI', description: 'd', instructions: 'i' }).expect(403);

    const bySlug = await request(app).get(`/api/labs/${created.body.slug}`).set(student.auth).expect(200);
    expect(bySlug.body.id).toBe(created.body.id);
    const attempt = await request(app).post(`/api/labs/${created.body.id}/attempts`).set(student.auth).expect(201);
    await request(app).post(`/api/lab-attempts/${attempt.body.id}/complete`).set(student.auth).send({ notes: 'too short' }).expect(400);
    await request(app)
      .post(`/api/lab-attempts/${attempt.body.id}/complete`)
      .set(student.auth)
      .send({ notes: 'I mapped every AI system in my department and found two unsanctioned generative AI tools in use.' })
      .expect(200);
  });
});
