/* eslint-disable no-console */
import { PrismaClient, type Prisma, type ReviewStatus, type RoleName, type User } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { scoreRiskAssessment, RISK_SCORING_VERSION } from '../src/services/riskScoring.service';
import { passwordPolicy } from '../src/services/password.service';
import { getStorage } from '../src/services/storage';
import { analyzeCsv } from '../src/utils/csv';
import { COURSE, MODULES } from './seed-data/course';
import {
  auditHistoricalOutcomes,
  generateLoanDataset,
  LOAN_DATASET_SEED,
  LOAN_SENSITIVE_COLUMNS,
  LOAN_TARGET,
  sha256,
  toCsv,
} from './seed-data/dataset';
import { AI_SYSTEMS, COMPLIANCE_REQUIREMENTS, IMPACT_ASSESSMENTS, POLICIES, SHADOW_AI } from './seed-data/governance';
import { ASSIGNMENTS, FINAL_EXAM, LABS, PILLARS_QUIZ, type SeedQuestion } from './seed-data/learning';
import { seedRbac } from './seed-data/rbac';

const prisma = new PrismaClient();
const DAY = 24 * 60 * 60 * 1000;
const daysFromNow = (d: number) => new Date(Date.now() + d * DAY);

const DEMO_USERS: { email: string; firstName: string; lastName: string; role: RoleName; jobTitle: string }[] = [
  { email: 'superadmin@example.com', firstName: 'Sam', lastName: 'Rivera', role: 'SUPER_ADMIN', jobTitle: 'Platform Owner' },
  { email: 'admin@example.com', firstName: 'Alex', lastName: 'Morgan', role: 'ADMIN', jobTitle: 'AI Governance Lead' },
  { email: 'faculty@example.com', firstName: 'Priya', lastName: 'Nair', role: 'FACULTY', jobTitle: 'Professor of Responsible AI' },
  { email: 'student@example.com', firstName: 'Jordan', lastName: 'Lee', role: 'STUDENT', jobTitle: 'MSc Data Science Student' },
  { email: 'developer@example.com', firstName: 'Maya', lastName: 'Chen', role: 'DEVELOPER', jobTitle: 'Senior ML Engineer' },
  { email: 'productdev@example.com', firstName: 'Daniel', lastName: 'Okafor', role: 'PRODUCT_DEVELOPER', jobTitle: 'AI Product Manager' },
  { email: 'executive@example.com', firstName: 'Elena', lastName: 'García', role: 'EXECUTIVE', jobTitle: 'Chief Digital Officer' },
  { email: 'learner1@example.com', firstName: 'Amara', lastName: 'Diallo', role: 'STUDENT', jobTitle: 'Student' },
  { email: 'learner2@example.com', firstName: 'Lucas', lastName: 'Silva', role: 'STUDENT', jobTitle: 'Student' },
  { email: 'learner3@example.com', firstName: 'Hana', lastName: 'Sato', role: 'STUDENT', jobTitle: 'Student' },
  { email: 'learner4@example.com', firstName: 'Omar', lastName: 'Haddad', role: 'STUDENT', jobTitle: 'Student' },
];

async function seedUsers(roleIds: Record<RoleName, string>) {
  const password = process.env.SEED_DEFAULT_PASSWORD ?? DEFAULT_SEED_PASSWORD;
  const passwordHash = await bcrypt.hash(password, 12);
  const users: Record<string, User> = {};
  for (const u of DEMO_USERS) {
    users[u.email] = await prisma.user.upsert({
      where: { email: u.email },
      create: {
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        jobTitle: u.jobTitle,
        organization: 'Demo University & Enterprise',
        roleId: roleIds[u.role],
        passwordHash,
        passwordChangedAt: new Date(Date.now() - 60_000),
        consents: {
          create: ['terms_of_service', 'privacy_notice'].map((consentType) => ({ consentType, granted: true, policyVersion: '2026-01' })),
        },
      },
      update: {},
    });
  }
  return users;
}

function questionData(q: SeedQuestion, order: number, extra: Partial<Prisma.QuestionUncheckedCreateInput>) {
  return {
    type: q.type,
    prompt: q.prompt,
    scenario: q.scenario,
    options: q.options.map((text, i) => ({ id: String.fromCharCode(97 + i), text })),
    correctOptionIds: q.correct.map((i) => String.fromCharCode(97 + i)),
    explanation: q.explanation,
    difficulty: q.difficulty ?? 'MEDIUM',
    tags: q.tags,
    order,
    ...extra,
  };
}

async function seedCourse(users: Record<string, User>) {
  const existing = await prisma.course.findUnique({ where: { slug: COURSE.slug } });
  if (existing) {
    console.log('  course already present – skipping');
    return existing;
  }
  const faculty = users['faculty@example.com'];
  const course = await prisma.course.create({
    data: { ...COURSE, status: 'PUBLISHED', publishedAt: new Date(), instructorId: faculty.id, createdById: faculty.id, updatedById: faculty.id },
  });

  const moduleIds: Record<number, string> = {};
  for (const [i, m] of MODULES.entries()) {
    const created = await prisma.module.create({
      data: {
        courseId: course.id,
        title: m.title,
        summary: m.summary,
        objectives: m.objectives,
        estimatedMinutes: m.estimatedMinutes,
        order: i + 1,
        createdById: faculty.id,
        lessons: {
          create: m.lessons.map((l, j) => ({
            title: l.title,
            type: l.type,
            content: l.content,
            codeSnippet: l.codeSnippet,
            codeLanguage: l.codeLanguage,
            knowledgeCheck: l.knowledgeCheck as unknown as Prisma.InputJsonValue,
            estimatedMinutes: l.estimatedMinutes,
            order: j + 1,
            createdById: faculty.id,
          })),
        },
      },
    });
    moduleIds[i + 1] = created.id;
  }

  await prisma.quiz.create({
    data: {
      courseId: course.id,
      moduleId: moduleIds[PILLARS_QUIZ.moduleOrder],
      title: PILLARS_QUIZ.title,
      description: PILLARS_QUIZ.description,
      passingScore: PILLARS_QUIZ.passingScore,
      timeLimitSeconds: PILLARS_QUIZ.timeLimitSeconds,
      attemptLimit: PILLARS_QUIZ.attemptLimit,
      isPublished: true,
      createdById: faculty.id,
      questions: { create: PILLARS_QUIZ.questions.map((q, i) => questionData(q, i + 1, { createdById: faculty.id })) },
    },
  });
  await prisma.quiz.create({
    data: {
      courseId: course.id,
      moduleId: moduleIds[12],
      title: FINAL_EXAM.title,
      description: FINAL_EXAM.description,
      passingScore: FINAL_EXAM.passingScore,
      timeLimitSeconds: FINAL_EXAM.timeLimitSeconds,
      attemptLimit: FINAL_EXAM.attemptLimit,
      questionsPerAttempt: FINAL_EXAM.questionsPerAttempt,
      randomizeQuestions: true,
      isFinal: true,
      isPublished: true,
      createdById: faculty.id,
      questions: {
        create: FINAL_EXAM.questions.map((q, i) => questionData(q, i + 1, { bankCategory: 'certification-exam', createdById: faculty.id })),
      },
    },
  });

  for (const lab of LABS) {
    await prisma.lab.create({
      data: { ...lab, courseId: course.id, moduleId: moduleIds[10], isRequired: true, createdById: faculty.id },
    });
  }
  for (const a of ASSIGNMENTS) {
    await prisma.assignment.create({
      data: {
        courseId: course.id,
        moduleId: moduleIds[a.moduleOrder],
        title: a.title,
        description: a.description,
        instructions: a.instructions,
        targetRoles: a.targetRoles,
        dueDate: daysFromNow(a.dueInDays),
        rubric: a.rubric as Prisma.InputJsonValue,
        isPublished: true,
        createdById: faculty.id,
      },
    });
  }

  // Enrolments and lesson progress (learner activity, not AI results).
  const lessons = await prisma.lesson.findMany({
    where: { module: { courseId: course.id } },
    orderBy: [{ module: { order: 'asc' } }, { order: 'asc' }],
    select: { id: true, moduleId: true },
  });
  const learners: [string, number][] = [
    ['student@example.com', 4],
    ['developer@example.com', 9],
    ['productdev@example.com', 2],
    ['executive@example.com', 1],
    ['learner1@example.com', 14],
    ['learner2@example.com', 6],
    ['learner3@example.com', 21],
    ['learner4@example.com', 0],
  ];
  for (const [email, completedCount] of learners) {
    const user = users[email];
    const done = lessons.slice(0, completedCount);
    await prisma.enrollment.create({
      data: {
        userId: user.id,
        courseId: course.id,
        enrolledAt: daysFromNow(-30 + completedCount),
        progressPercent: Math.round((done.length / lessons.length) * 1000) / 10,
      },
    });
    if (done.length) {
      await prisma.progress.createMany({
        data: done.map((l, i) => ({
          userId: user.id,
          lessonId: l.id,
          moduleId: l.moduleId,
          status: 'COMPLETED' as const,
          completedAt: daysFromNow(-28 + i),
          timeSpentSeconds: 600 + ((i * 137) % 900),
        })),
      });
    }
    const next = lessons[completedCount];
    if (next) {
      await prisma.progress.create({
        data: { userId: user.id, lessonId: next.id, moduleId: next.moduleId, status: 'IN_PROGRESS', timeSpentSeconds: 240 },
      });
    }
  }
  console.log(`  course with ${MODULES.length} modules, ${lessons.length} lessons, 2 quizzes, ${LABS.length} labs, ${ASSIGNMENTS.length} assignments`);
  return course;
}

async function seedDataset(users: Record<string, User>) {
  const name = 'Loan Applications (synthetic)';
  const existing = await prisma.dataset.findFirst({ where: { name } });
  if (existing) {
    if (!existing.isShared) await prisma.dataset.update({ where: { id: existing.id }, data: { isShared: true } });
    console.log('  dataset already present – skipping');
    return existing;
  }
  const faculty = users['faculty@example.com'];
  const rows = generateLoanDataset();
  const csv = toCsv(rows);
  const checksum = sha256(csv);
  const storageKey = `datasets/seed/loan_applications_${checksum.slice(0, 12)}.csv`;
  await getStorage().put(storageKey, Buffer.from(csv), 'text/csv');

  const profile = analyzeCsv(csv);
  const dataset = await prisma.dataset.create({
    data: {
      name,
      description:
        'Synthetic small-business loan applications with a historical approval label. Generated deterministically; historical bias by gender and age group is deliberately encoded for teaching fairness auditing.',
      ownerId: faculty.id,
      fileName: 'loan_applications.csv',
      storageKey,
      sizeBytes: Buffer.byteLength(csv),
      checksumSha256: checksum,
      rowCount: profile.rowCount,
      columnCount: profile.columnCount,
      duplicateRowCount: profile.duplicateRowCount,
      missingCellCount: profile.missingCellCount,
      status: 'READY',
      targetColumn: LOAN_TARGET,
      sensitiveColumns: LOAN_SENSITIVE_COLUMNS,
      profile: { generator: { seed: LOAN_DATASET_SEED, rows: rows.length } } as Prisma.InputJsonValue,
      isSynthetic: true,
      isShared: true,
      containsPersonalData: false,
      retentionUntil: daysFromNow(3650),
      createdById: faculty.id,
      columns: {
        create: profile.columns.map((c) => ({
          name: c.name,
          position: c.position,
          dataType: c.dataType,
          isSensitive: LOAN_SENSITIVE_COLUMNS.includes(c.name),
          isTarget: c.name === LOAN_TARGET,
          missingCount: c.missingCount,
          uniqueCount: c.uniqueCount,
          stats: c.stats as Prisma.InputJsonValue,
        })),
      },
    },
  });

  const protectedAttributes = ['gender', 'age_group', 'region'];
  const parameters = { target: LOAN_TARGET, protectedAttributes, scope: 'historical_labels' };
  const started = Date.now();
  const audit = auditHistoricalOutcomes(rows, LOAN_TARGET, protectedAttributes);
  await prisma.experiment.create({
    data: {
      name: 'Historical approval fairness audit – loan dataset',
      type: 'FAIRNESS_AUDIT',
      status: 'COMPLETED',
      userId: faculty.id,
      datasetId: dataset.id,
      algorithm: 'historical-outcome-audit',
      parameters,
      randomSeed: LOAN_DATASET_SEED,
      configHash: sha256(JSON.stringify({ parameters, dataset: checksum })),
      progress: 100,
      startedAt: new Date(started),
      completedAt: new Date(),
      durationMs: Date.now() - started,
      logs: [{ at: new Date().toISOString(), level: 'info', message: `Audited ${rows.length} historical decisions across ${protectedAttributes.length} attributes` }],
      results: {
        create: {
          kind: 'fairness_historical_labels',
          metrics: Object.fromEntries(audit.map((a) => [a.attribute, { dpd: a.demographicParityDifference, disparityRatio: a.disparityRatio }])),
          data: audit as unknown as Prisma.InputJsonValue,
        },
      },
    },
  });
  console.log(`  dataset (${rows.length} rows) + historical fairness audit`);
  return { dataset, audit };
}

async function seedGovernance(users: Record<string, User>, datasetId: string | null, genderAudit?: { demographicParityDifference: number; disparityRatio: number }) {
  if ((await prisma.aISystem.count()) > 0) {
    console.log('  governance data already present – skipping');
    return;
  }
  const admin = users['admin@example.com'];

  for (const s of AI_SYSTEMS) {
    const owner = users[s.ownerEmail];
    const result = scoreRiskAssessment(s.risk.answers);
    const assessed = s.risk.status !== 'DRAFT';
    const reviewed = s.risk.status === 'APPROVED';

    const system = await prisma.aISystem.create({
      data: {
        name: s.name,
        description: s.description,
        businessUnit: s.businessUnit,
        ownerId: owner.id,
        status: s.status,
        isThirdParty: s.isThirdParty ?? false,
        vendorName: s.vendorName,
        dataCategories: s.dataCategories,
        riskLevel: assessed ? result.level : null,
        lastReviewedAt: reviewed ? daysFromNow(-40) : null,
        nextReviewAt: assessed ? daysFromNow(result.level === 'LOW' ? 365 : result.level === 'MEDIUM' ? 180 : 90) : null,
        createdById: owner.id,
      },
    });
    const { usesLoanDataset, ...modelFields } = s.model;
    const model = await prisma.aIModel.create({
      data: {
        ...modelFields,
        ownerId: owner.id,
        aiSystemId: system.id,
        trainingDatasetId: usesLoanDataset ? datasetId : null,
        riskLevel: assessed ? result.level : null,
        nextReviewAt: system.nextReviewAt,
        createdById: owner.id,
        versions: { create: { version: '1.0.0', description: 'Initial registered version. Metrics are populated from evaluation experiments.', createdById: owner.id } },
      },
    });
    await prisma.riskAssessment.create({
      data: {
        title: s.risk.title,
        aiSystemId: system.id,
        modelId: model.id,
        assessorId: users[s.key === 'dropout' ? 'faculty@example.com' : 'productdev@example.com'].id,
        answers: s.risk.answers,
        score: result.score,
        riskLevel: result.level,
        riskFactors: result.factors as unknown as Prisma.InputJsonValue,
        recommendedControls: result.recommendedControls as unknown as Prisma.InputJsonValue,
        requiredOversight: result.requiredOversight,
        complianceConsiderations: result.complianceConsiderations as unknown as Prisma.InputJsonValue,
        scoringVersion: RISK_SCORING_VERSION,
        status: s.risk.status,
        submittedAt: assessed ? daysFromNow(-10) : null,
        reviewerId: reviewed ? admin.id : null,
        reviewedAt: reviewed ? daysFromNow(-5) : null,
        reviewComment: reviewed ? 'Approved with the recommended controls. Re-assess at next scheduled review.' : null,
      },
    });
    if (assessed && (result.level === 'HIGH' || result.level === 'CRITICAL')) {
      await prisma.reviewSchedule.create({
        data: { resourceType: 'AIModel', resourceId: model.id, title: `Quarterly review – ${model.name}`, frequencyDays: 90, nextReviewAt: daysFromNow(90), assigneeId: admin.id },
      });
    }

    if (s.key === 'loan') {
      await prisma.modelCard.create({
        data: {
          modelId: model.id,
          name: 'Trustworthy Loan Risk Evaluator',
          version: '1.0',
          status: 'DRAFT',
          ownerId: owner.id,
          createdById: owner.id,
          content: {
            modelName: 'Trustworthy Loan Risk Evaluator',
            developer: 'Commercial Banking ML Team',
            version: '1.0',
            architecture: 'Gradient Boosted Decision Tree / LightGBM',
            license: 'Internal use only',
            intendedUse: 'Small-business credit risk assessment supporting loan officers.',
            outOfScopeUse: 'Automated rejection without human review; consumer lending; employment decisions.',
            trainingData: 'Loan Applications (synthetic) dataset – 1,000 records with historical approval labels.',
            evaluationData: 'Stratified 25% hold-out split (seed 42).',
            performanceMetrics: [],
            evaluatedSubgroups: ['gender', 'age_group', 'region'],
            fairnessMetrics: [],
            fairnessThreshold: 'Demographic parity difference ≤ 0.10 and equalized odds difference ≤ 0.10 across evaluated subgroups.',
            mitigationTechnique: 'To be determined from the fairness audit (candidate: ExponentiatedGradient with DemographicParity).',
            privacyMechanisms: 'Data minimisation; protected attributes used only for auditing; access-controlled storage; encryption at rest.',
            securityMechanisms: 'Internal-only deployment; input validation; adversarial robustness evaluation planned.',
            humanOversight: 'Human-in-the-loop: loan officers review every recommendation and all adverse decisions.',
            knownLimitations:
              'Historical labels are known to encode bias by gender and age group. Performance and fairness metrics are pending evaluation and must be completed before publication.',
            ethicalConsiderations: 'Risk of perpetuating historical lending discrimination; requires subgroup monitoring and an appeal route for applicants.',
            deploymentRequirements: 'Governance approval of the risk assessment and AIA; completed fairness and robustness evaluations; quarterly review.',
          },
        },
      });
      if (genderAudit) {
        await prisma.riskRegisterEntry.create({
          data: {
            title: 'Historical lending data encodes gender disparity',
            description: `Historical approvals in the training data show a demographic parity difference of ${genderAudit.demographicParityDifference.toFixed(3)} and a disparity ratio of ${genderAudit.disparityRatio.toFixed(3)} by gender (computed from the dataset). A model trained on these labels may reproduce the disparity.`,
            category: 'Fairness',
            aiSystemId: system.id,
            likelihood: 4,
            impact: 4,
            inherentScore: 16,
            mitigation: 'Model-level fairness audit with mitigation; human review of adverse decisions; subgroup monitoring.',
            status: 'MITIGATING',
            ownerId: owner.id,
            reviewDate: daysFromNow(30),
            createdById: admin.id,
          },
        });
      }
    }
    if (s.key === 'hiring') {
      await prisma.aIIncident.create({
        data: {
          title: 'Recruiters report lower shortlisting rates for career-break applicants',
          description:
            'Recruiters observed that applicants with employment gaps are rarely shortlisted. Employment gaps may act as a proxy for gender and caregiving status.',
          severity: 'HIGH',
          status: 'INVESTIGATING',
          aiSystemId: system.id,
          modelId: model.id,
          reportedById: admin.id,
          assignedToId: users['productdev@example.com'].id,
          occurredAt: daysFromNow(-12),
          detectedAt: daysFromNow(-9),
          impact: 'Potential indirect discrimination in candidate shortlisting.',
          createdById: admin.id,
        },
      });
      await prisma.vendorAssessment.create({
        data: {
          aiSystemId: system.id,
          vendorName: 'HireSense Ltd.',
          productName: 'Resume Screening Assistant',
          riskLevel: result.level,
          status: 'UNDER_REVIEW',
          assessorId: admin.id,
          findings: {
            documentation: 'Vendor model card provided; subgroup metrics not disclosed.',
            auditRights: 'Contract allows annual third-party bias audit.',
            dataUse: 'Vendor states candidate data is not used for training other customers\u2019 models.',
            openQuestions: ['Request subgroup selection rates', 'Confirm incident notification SLA'],
          },
        },
      });
      await prisma.riskRegisterEntry.create({
        data: {
          title: 'Employment gaps used as a proxy in vendor ranking',
          description: 'The vendor model may penalise employment gaps, which correlate with gender and caregiving.',
          category: 'Fairness',
          aiSystemId: system.id,
          likelihood: 3,
          impact: 5,
          inherentScore: 15,
          mitigation: 'Request vendor bias audit; require recruiter review of all rejections.',
          status: 'OPEN',
          ownerId: admin.id,
          reviewDate: daysFromNow(14),
          createdById: admin.id,
        },
      });
    }
  }

  for (const s of SHADOW_AI) {
    await prisma.aISystem.create({
      data: { ...s, ownerId: admin.id, status: 'ACTIVE', isShadowAI: true, isThirdParty: true, createdById: admin.id },
    });
  }
  await prisma.riskRegisterEntry.create({
    data: {
      title: 'Customer personal data entered into public generative AI',
      description: 'Shadow AI usage in customer service may disclose personal data to an unsanctioned processor.',
      category: 'Privacy',
      likelihood: 4,
      impact: 3,
      inherentScore: 12,
      mitigation: 'Publish acceptable-use policy; provide sanctioned enterprise assistant; staff training.',
      status: 'MITIGATING',
      ownerId: admin.id,
      reviewDate: daysFromNow(21),
      createdById: admin.id,
    },
  });

  for (const p of POLICIES) {
    await prisma.governancePolicy.upsert({
      where: { slug: p.slug },
      create: {
        ...p,
        ownerId: admin.id,
        effectiveDate: p.status === 'ACTIVE' ? daysFromNow(-120) : null,
        reviewDate: p.status === 'ACTIVE' ? daysFromNow(p.slug === 'shadow-ai-acceptable-use' ? 20 : 245) : null,
        approvedById: p.status === 'ACTIVE' ? users['superadmin@example.com'].id : null,
        approvedAt: p.status === 'ACTIVE' ? daysFromNow(-125) : null,
        createdById: admin.id,
      },
      update: {},
    });
  }
  for (const c of COMPLIANCE_REQUIREMENTS) {
    await prisma.complianceRequirement.upsert({
      where: { code: c.code },
      create: { ...c, ownerId: admin.id, requiresLegalReview: true, nextReviewAt: daysFromNow(90), createdById: admin.id },
      update: {},
    });
  }
  console.log(`  ${AI_SYSTEMS.length} AI systems/models with scored risk assessments, ${SHADOW_AI.length} Shadow AI entries, ${POLICIES.length} policies, ${COMPLIANCE_REQUIREMENTS.length} compliance requirements`);
}

/** Separate from seedGovernance so existing databases pick up the demo impact assessments on re-seed. */
async function seedImpactAssessments(users: Record<string, User>) {
  if ((await prisma.algorithmicImpactAssessment.count()) > 0) return;
  const owner = users['productdev@example.com'];
  const reviewer = users['admin@example.com'];
  for (const a of IMPACT_ASSESSMENTS) {
    const system = await prisma.aISystem.findFirst({ where: { name: a.systemName } });
    if (!system) continue;
    const approved = a.status === 'APPROVED';
    const sections = a.sections as Prisma.InputJsonValue;
    const transitions: { from: ReviewStatus | null; to: ReviewStatus; actorId: string; comment?: string; at: Date }[] = [
      { from: null, to: 'DRAFT', actorId: owner.id, at: daysFromNow(-30) },
      { from: 'DRAFT', to: 'SUBMITTED', actorId: owner.id, at: daysFromNow(-20) },
      ...(approved
        ? [
            { from: 'SUBMITTED' as const, to: 'UNDER_REVIEW' as const, actorId: reviewer.id, at: daysFromNow(-18) },
            { from: 'UNDER_REVIEW' as const, to: 'APPROVED' as const, actorId: reviewer.id, comment: 'Approved on condition that the vendor bias audit is completed within 90 days.', at: daysFromNow(-15) },
          ]
        : []),
    ];
    await prisma.algorithmicImpactAssessment.create({
      data: {
        title: a.title,
        aiSystemId: system.id,
        ownerId: owner.id,
        status: a.status,
        sections,
        submittedAt: daysFromNow(-20),
        approvedAt: approved ? daysFromNow(-15) : null,
        approvedById: approved ? reviewer.id : null,
        createdById: owner.id,
        history: { create: transitions.map((t) => ({ fromStatus: t.from, toStatus: t.to, actorId: t.actorId, comment: t.comment ?? null, snapshot: sections, createdAt: t.at })) },
      },
    });
  }
  console.log(`  ${IMPACT_ASSESSMENTS.length} algorithmic impact assessments`);
}

async function seedNotifications(users: Record<string, User>) {
  if ((await prisma.notification.count()) > 0) return;
  const data: Prisma.NotificationCreateManyInput[] = Object.values(users).map((u) => ({
    userId: u.id,
    type: 'SYSTEM',
    title: 'Welcome to the Trustworthy AI Platform',
    message: 'Explore the course "Trustworthy AI-Driven Digital Transformation" and your role-specific dashboard.',
    link: '/dashboard',
  }));
  data.push(
    {
      userId: users['admin@example.com'].id,
      type: 'GOVERNANCE_REVIEW_REQUIRED',
      title: 'Risk assessment awaiting review',
      message: 'The pre-deployment risk assessment for the Trustworthy Loan Risk Evaluator was submitted for governance review.',
      link: '/risk-assessments',
    },
    {
      userId: users['executive@example.com'].id,
      type: 'HIGH_RISK_MODEL_DETECTED',
      title: 'High-risk AI systems in inventory',
      message: 'Several AI systems are rated HIGH or CRITICAL. Review the executive governance dashboard.',
      link: '/dashboard',
    },
    {
      userId: users['student@example.com'].id,
      type: 'ASSIGNMENT_ASSIGNED',
      title: 'New assignment: Analyze a dataset for fairness',
      message: 'Due in 14 days. Use the demo loan dataset and the Fairness Audit Lab.',
      link: '/assignments',
    },
    {
      userId: users['developer@example.com'].id,
      type: 'MODEL_REVIEW_DUE',
      title: 'Model card incomplete',
      message: 'The Trustworthy Loan Risk Evaluator model card is a draft with pending performance and fairness metrics.',
      link: '/model-cards',
    },
  );
  await prisma.notification.createMany({ data });
}

const DEFAULT_SEED_PASSWORD = 'TrustAI!2026';

/** Creates the first SUPER_ADMIN from BOOTSTRAP_ADMIN_* when no super administrator exists yet. */
async function seedBootstrapAdmin(roleIds: Record<RoleName, string>) {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password) return;
  const existing = await prisma.user.count({ where: { role: { name: 'SUPER_ADMIN' }, status: { not: 'DELETED' } } });
  if (existing > 0) {
    console.log('  bootstrap admin skipped (a super administrator already exists)');
    return;
  }
  const policy = passwordPolicy.safeParse(password);
  if (!policy.success) throw new Error(`BOOTSTRAP_ADMIN_PASSWORD rejected: ${policy.error.issues.map((i) => i.message).join('; ')}`);
  await prisma.user.create({
    data: {
      email,
      firstName: 'Platform',
      lastName: 'Administrator',
      roleId: roleIds.SUPER_ADMIN,
      passwordHash: await bcrypt.hash(password, 12),
      passwordChangedAt: new Date(Date.now() - 60_000),
    },
  });
  console.log(`  bootstrap super administrator created: ${email}`);
}

function demoSeedingAllowed(): boolean {
  if (process.env.NODE_ENV !== 'production') return process.env.SEED_DEMO_DATA !== 'false';
  if (process.env.SEED_DEMO_DATA !== 'true') return false;
  const pw = process.env.SEED_DEFAULT_PASSWORD;
  if (!pw || pw === DEFAULT_SEED_PASSWORD) {
    throw new Error('Refusing to seed demo accounts in production with the default password. Set SEED_DEFAULT_PASSWORD.');
  }
  return true;
}

async function main() {
  console.log('Seeding Trustworthy AI Platform…');
  const roleIds = await seedRbac(prisma);
  console.log('  roles & permissions synchronised');
  await seedBootstrapAdmin(roleIds);
  if (!demoSeedingAllowed()) {
    console.log('  demo data skipped (set SEED_DEMO_DATA=true to include it)');
    return;
  }
  const users = await seedUsers(roleIds);
  console.log(`  ${Object.keys(users).length} demo users`);
  await seedCourse(users);
  const ds = await seedDataset(users);
  const datasetId = 'dataset' in ds ? ds.dataset.id : ds.id;
  const genderAudit = 'audit' in ds ? ds.audit.find((a) => a.attribute === 'gender') : undefined;
  await seedGovernance(users, datasetId, genderAudit);
  await seedImpactAssessments(users);
  await seedNotifications(users);

  await prisma.auditLog.create({
    data: {
      action: 'system.seed',
      resource: 'system',
      result: 'SUCCESS',
      severity: 'INFO',
      reason: 'Demo data seeded',
      requestId: randomBytes(8).toString('hex'),
      metadata: { users: Object.keys(users).length },
    },
  });
  console.log('Seed complete.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
