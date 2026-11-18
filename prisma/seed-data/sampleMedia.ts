import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * Sample video and slide lessons for the seeded course. The files live in frontend/public/samples/ and are
 * produced by scripts/generate-sample-lesson-media.py; replace them from Admin > Courses > Edit lesson.
 */
const DECK = [
  ['Trustworthy AI-Driven Digital Transformation', 'Welcome. This deck is the 10-minute orientation to the course: what trustworthy AI means and how the modules fit together.'],
  ['Why trust decides success', 'AI adoption stalls when people cannot trust the system. Regulation (EU AI Act, NIST AI RMF, OECD) is formalising what that means.'],
  ['Five pillars of Trustworthy AI', 'Transparency, robustness, fairness, privacy and accountability. Module 2 covers the metrics and standards for each.'],
  ['Explain the decision', 'SHAP and LIME explain individual predictions; Grad-CAM does it for images; counterfactuals show what would change the outcome.'],
  ['Measure and mitigate bias', 'Demographic parity and equalized odds are the two group-fairness metrics you will compute in the fairness lab.'],
  ['Withstand attack, protect data', 'FGSM and PGD are the standard adversarial attacks; adversarial training is the standard defence.'],
  ['Keep humans accountable', 'Human oversight, model cards, risk registers and audit trails keep a named person responsible for every consequential decision.'],
  ['Your next steps', 'Work through the modules in order, run the labs, pass the quizzes and request your certificate.'],
].map(([title, notes], i) => ({ url: `/samples/slides/slide-${i + 1}.png`, title, notes }));

export const SAMPLE_MEDIA_LESSONS = [
  {
    title: 'Video: Trustworthy AI in 40 seconds',
    type: 'VIDEO' as const,
    estimatedMinutes: 2,
    videoUrl: '/samples/video/trustworthy-ai-overview.mp4',
    content: `A quick animated overview of the course. Watch it to the end and the lesson completes automatically; your place is saved if you leave part-way.

**What you will cover**

- Why trust decides whether AI succeeds
- The five pillars of Trustworthy AI
- Explainability, fairness, robustness and accountability in practice`,
  },
  {
    title: 'Slides: Course orientation',
    type: 'SLIDES' as const,
    estimatedMinutes: 8,
    slides: DECK,
    content: `Use the arrow keys, the on-screen buttons or the thumbnails to move through the deck. Press **F** for full screen and open **Notes** for the speaker notes. The lesson completes when you reach the last slide.`,
  },
];

/**
 * Adds the sample video and slide lessons to the start of the course's first module if they are missing.
 * Idempotent, and safe for databases that were seeded before these lessons existed.
 */
export async function ensureSampleMediaLessons(prisma: PrismaClient, courseId: string, authorId: string): Promise<number> {
  const first = await prisma.module.findFirst({ where: { courseId }, orderBy: { order: 'asc' }, include: { lessons: { select: { id: true, title: true, order: true } } } });
  if (!first) return 0;
  const have = new Set(first.lessons.map((l) => l.title));
  const missing = SAMPLE_MEDIA_LESSONS.filter((l) => !have.has(l.title));
  if (missing.length === 0) return 0;

  await prisma.$transaction(async (tx) => {
    // Shift highest first so the (moduleId, order) unique key is never violated mid-way.
    for (const l of [...first.lessons].sort((a, b) => b.order - a.order)) {
      await tx.lesson.update({ where: { id: l.id }, data: { order: l.order + missing.length } });
    }
    for (const [i, l] of missing.entries()) {
      await tx.lesson.create({
        data: {
          moduleId: first.id,
          title: l.title,
          type: l.type,
          content: l.content,
          videoUrl: 'videoUrl' in l ? l.videoUrl : null,
          slides: 'slides' in l ? (l.slides as unknown as Prisma.InputJsonValue) : undefined,
          estimatedMinutes: l.estimatedMinutes,
          order: i + 1,
          createdById: authorId,
        },
      });
    }
  });

  // Learners' completion percentages are relative to the lesson count, which just grew.
  const total = await prisma.lesson.count({ where: { module: { courseId } } });
  for (const e of await prisma.enrollment.findMany({ where: { courseId } })) {
    const completed = await prisma.progress.count({ where: { userId: e.userId, status: 'COMPLETED', lesson: { module: { courseId } } } });
    const percent = Math.round((completed / total) * 1000) / 10;
    await prisma.enrollment.update({
      where: { id: e.id },
      data: e.status === 'COMPLETED' && percent < 100 ? { progressPercent: percent, status: 'ACTIVE', completedAt: null } : { progressPercent: percent },
    });
  }
  return missing.length;
}
