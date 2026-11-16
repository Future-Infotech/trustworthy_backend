import type { EvaluationStatus, RiskLevel } from '@prisma/client';
import { prisma } from '../config/prisma';

const DAY_MS = 24 * 60 * 60 * 1000;
const RISK_LEVELS: RiskLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const EVALUATION_STATUSES: EvaluationStatus[] = ['PASSED', 'WARNING', 'FAILED', 'NOT_ASSESSED'];
const PENDING_REVIEW = ['SUBMITTED', 'UNDER_REVIEW'] as const;
const INACTIVE_STAGES = ['RETIRED', 'SUSPENDED'] as const;

/**
 * Organisational AI risk index (0-100): mean of fixed weights over models that
 * have an assessed risk level. Weights are the mid-points of the risk-score
 * bands produced by the risk assessment engine.
 */
export const RISK_WEIGHTS: Record<RiskLevel, number> = { LOW: 12, MEDIUM: 37, HIGH: 62, CRITICAL: 87 };

export function riskIndex(counts: Partial<Record<RiskLevel, number>>) {
  const assessed = RISK_LEVELS.reduce((n, l) => n + (counts[l] ?? 0), 0);
  if (assessed === 0) return { score: null, level: null, assessed };
  const score = Math.round(RISK_LEVELS.reduce((s, l) => s + (counts[l] ?? 0) * RISK_WEIGHTS[l], 0) / assessed);
  const level: RiskLevel = score >= 75 ? 'CRITICAL' : score >= 50 ? 'HIGH' : score >= 25 ? 'MEDIUM' : 'LOW';
  return { score, level, assessed };
}

const sumWhere = <R extends { _count: { _all: number } }>(rows: R[], predicate: (row: R) => boolean) =>
  rows.filter(predicate).reduce((n, r) => n + r._count._all, 0);

function fill<K extends string>(keys: readonly K[], rows: { key: K | null; count: number }[]) {
  return keys.map((key) => ({ key, count: rows.find((r) => r.key === key)?.count ?? 0 }));
}

async function evaluationBreakdown(field: 'fairnessStatus' | 'securityStatus' | 'explainabilityStatus') {
  const rows = await prisma.aIModel.groupBy({
    by: [field],
    where: { lifecycleStage: { notIn: [...INACTIVE_STAGES] } },
    _count: { _all: true },
  });
  const counts = Object.fromEntries(EVALUATION_STATUSES.map((s) => [s, 0])) as Record<EvaluationStatus, number>;
  for (const r of rows) counts[r[field] as EvaluationStatus] = r._count._all;
  return counts;
}

async function auditEventsByDay(days: number) {
  const since = new Date(Date.now() - (days - 1) * DAY_MS);
  since.setUTCHours(0, 0, 0, 0);
  const rows = await prisma.$queryRaw<{ day: Date; result: string; count: bigint }[]>`
    SELECT date_trunc('day', "createdAt") AS day, "result"::text AS result, COUNT(*)::bigint AS count
    FROM "audit_logs"
    WHERE "createdAt" >= ${since}
    GROUP BY 1, 2
    ORDER BY 1`;
  const series: { date: string; success: number; failure: number; denied: number }[] = [];
  for (let i = 0; i < days; i++) {
    const date = new Date(since.getTime() + i * DAY_MS).toISOString().slice(0, 10);
    series.push({ date, success: 0, failure: 0, denied: 0 });
  }
  for (const r of rows) {
    const point = series.find((p) => p.date === new Date(r.day).toISOString().slice(0, 10));
    if (!point) continue;
    const key = r.result.toLowerCase() as 'success' | 'failure' | 'denied';
    point[key] += Number(r.count);
  }
  return series;
}

async function modelRiskCounts() {
  const rows = await prisma.aIModel.groupBy({
    by: ['riskLevel'],
    where: { lifecycleStage: { notIn: [...INACTIVE_STAGES] } },
    _count: { _all: true },
  });
  const counts: Partial<Record<RiskLevel, number>> = {};
  let unassessed = 0;
  for (const r of rows) {
    if (r.riskLevel) counts[r.riskLevel] = r._count._all;
    else unassessed = r._count._all;
  }
  return { counts, unassessed };
}

export const analyticsService = {
  async adminDashboard() {
    const now = new Date();
    const [
      totalUsers,
      activeUsers,
      newUsers,
      usersByRoleRows,
      roles,
      totalModels,
      activeModels,
      lifecycleRows,
      riskCounts,
      fairness,
      security,
      openIncidents,
      incidentRows,
      pendingRisk,
      pendingAia,
      cardsInReview,
      complianceRows,
      audit24h,
      denied7d,
      eventsByDay,
      recentEvents,
      aiSystems,
      shadowAi,
    ] = await Promise.all([
      prisma.user.count({ where: { status: { not: 'DELETED' } } }),
      prisma.user.count({ where: { status: 'ACTIVE' } }),
      prisma.user.count({ where: { status: { not: 'DELETED' }, createdAt: { gte: new Date(now.getTime() - 30 * DAY_MS) } } }),
      prisma.user.groupBy({ by: ['roleId'], where: { status: { not: 'DELETED' } }, _count: { _all: true } }),
      prisma.role.findMany({ select: { id: true, name: true, displayName: true } }),
      prisma.aIModel.count(),
      prisma.aIModel.count({ where: { lifecycleStage: { notIn: [...INACTIVE_STAGES] } } }),
      prisma.aIModel.groupBy({ by: ['lifecycleStage'], _count: { _all: true } }),
      modelRiskCounts(),
      evaluationBreakdown('fairnessStatus'),
      evaluationBreakdown('securityStatus'),
      prisma.aIIncident.count({ where: { status: { in: ['OPEN', 'INVESTIGATING'] } } }),
      prisma.aIIncident.groupBy({
        by: ['severity'],
        where: { status: { in: ['OPEN', 'INVESTIGATING', 'MITIGATED'] } },
        _count: { _all: true },
      }),
      prisma.riskAssessment.count({ where: { status: { in: [...PENDING_REVIEW] } } }),
      prisma.algorithmicImpactAssessment.count({ where: { status: { in: [...PENDING_REVIEW] } } }),
      prisma.modelCard.count({ where: { status: 'IN_REVIEW' } }),
      prisma.complianceRequirement.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.auditLog.count({ where: { createdAt: { gte: new Date(now.getTime() - DAY_MS) } } }),
      prisma.auditLog.count({ where: { result: 'DENIED', createdAt: { gte: new Date(now.getTime() - 7 * DAY_MS) } } }),
      auditEventsByDay(14),
      prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: { id: true, action: true, resource: true, userEmail: true, role: true, result: true, severity: true, createdAt: true },
      }),
      prisma.aISystem.count({ where: { status: { not: 'RETIRED' } } }),
      prisma.aISystem.count({ where: { isShadowAI: true, status: { not: 'RETIRED' } } }),
    ]);

    const compliance = fill(
      ['NOT_STARTED', 'IN_PROGRESS', 'EVIDENCE_PROVIDED', 'NEEDS_LEGAL_REVIEW', 'REVIEWED'] as const,
      complianceRows.map((r) => ({ key: r.status, count: r._count._all })),
    );
    const complianceTotal = compliance.reduce((n, c) => n + c.count, 0);

    return {
      generatedAt: now.toISOString(),
      users: {
        total: totalUsers,
        active: activeUsers,
        newLast30Days: newUsers,
        byRole: roles
          .map((r) => ({
            role: r.name,
            label: r.displayName,
            count: usersByRoleRows.find((u) => u.roleId === r.id)?._count._all ?? 0,
          }))
          .sort((a, b) => b.count - a.count),
      },
      models: {
        total: totalModels,
        active: activeModels,
        highRisk: (riskCounts.counts.HIGH ?? 0) + (riskCounts.counts.CRITICAL ?? 0),
        unassessedRisk: riskCounts.unassessed,
        byRisk: RISK_LEVELS.map((level) => ({ level, count: riskCounts.counts[level] ?? 0 })),
        byLifecycle: lifecycleRows.map((r) => ({ stage: r.lifecycleStage, count: r._count._all })),
      },
      fairness: { violations: fairness.FAILED, warnings: fairness.WARNING, passed: fairness.PASSED, notAssessed: fairness.NOT_ASSESSED },
      security: {
        failedTests: security.FAILED,
        warnings: security.WARNING,
        passed: security.PASSED,
        notAssessed: security.NOT_ASSESSED,
        openIncidents,
        incidentsBySeverity: fill(
          ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const,
          incidentRows.map((r) => ({ key: r.severity, count: r._count._all })),
        ).map(({ key, count }) => ({ severity: key, count })),
      },
      reviews: {
        pendingRiskAssessments: pendingRisk,
        pendingImpactAssessments: pendingAia,
        modelCardsInReview: cardsInReview,
        total: pendingRisk + pendingAia + cardsInReview,
      },
      compliance: {
        total: complianceTotal,
        reviewed: compliance.find((c) => c.key === 'REVIEWED')?.count ?? 0,
        needsLegalReview: compliance.find((c) => c.key === 'NEEDS_LEGAL_REVIEW')?.count ?? 0,
        byStatus: compliance.map(({ key, count }) => ({ status: key, count })),
      },
      aiSystems: { total: aiSystems, shadowAI: shadowAi },
      audit: { last24Hours: audit24h, deniedLast7Days: denied7d, eventsByDay, recent: recentEvents },
    };
  },

  async executiveDashboard() {
    const now = new Date();
    const [
      riskCounts,
      fairness,
      security,
      explainability,
      systems,
      shadowAi,
      thirdParty,
      lifecycleRows,
      highRiskModels,
      openIncidents,
      activePolicies,
      policiesDue,
      pendingRisk,
      pendingAia,
      openRegister,
      complianceRows,
    ] = await Promise.all([
      modelRiskCounts(),
      evaluationBreakdown('fairnessStatus'),
      evaluationBreakdown('securityStatus'),
      evaluationBreakdown('explainabilityStatus'),
      prisma.aISystem.count({ where: { status: { not: 'RETIRED' } } }),
      prisma.aISystem.count({ where: { isShadowAI: true, status: { not: 'RETIRED' } } }),
      prisma.aISystem.count({ where: { isThirdParty: true, status: { not: 'RETIRED' } } }),
      prisma.aIModel.groupBy({ by: ['lifecycleStage'], _count: { _all: true } }),
      prisma.aIModel.findMany({
        where: { riskLevel: { in: ['HIGH', 'CRITICAL'] }, lifecycleStage: { notIn: [...INACTIVE_STAGES] } },
        orderBy: [{ riskLevel: 'desc' }, { updatedAt: 'desc' }],
        take: 6,
        select: {
          id: true,
          name: true,
          riskLevel: true,
          lifecycleStage: true,
          fairnessStatus: true,
          securityStatus: true,
          nextReviewAt: true,
          aiSystem: { select: { name: true } },
          owner: { select: { firstName: true, lastName: true } },
        },
      }),
      prisma.aIIncident.count({ where: { status: { in: ['OPEN', 'INVESTIGATING'] } } }),
      prisma.governancePolicy.count({ where: { status: 'ACTIVE' } }),
      prisma.governancePolicy.count({ where: { status: 'ACTIVE', reviewDate: { lte: new Date(now.getTime() + 30 * DAY_MS) } } }),
      prisma.riskAssessment.count({ where: { status: { in: [...PENDING_REVIEW] } } }),
      prisma.algorithmicImpactAssessment.count({ where: { status: { in: [...PENDING_REVIEW] } } }),
      prisma.riskRegisterEntry.count({ where: { status: { in: ['OPEN', 'MITIGATING'] } } }),
      prisma.complianceRequirement.groupBy({ by: ['framework', 'status'], _count: { _all: true } }),
    ]);

    const frameworks = new Map<string, { framework: string; total: number; reviewed: number; needsLegalReview: number }>();
    for (const r of complianceRows) {
      const f = frameworks.get(r.framework) ?? { framework: r.framework, total: 0, reviewed: 0, needsLegalReview: 0 };
      f.total += r._count._all;
      if (r.status === 'REVIEWED') f.reviewed += r._count._all;
      if (r.status === 'NEEDS_LEGAL_REVIEW') f.needsLegalReview += r._count._all;
      frameworks.set(r.framework, f);
    }
    const totalModels = lifecycleRows.reduce((n, r) => n + r._count._all, 0);

    return {
      generatedAt: now.toISOString(),
      overallRisk: { ...riskIndex(riskCounts.counts), unassessed: riskCounts.unassessed, weights: RISK_WEIGHTS },
      riskDistribution: RISK_LEVELS.map((level) => ({ level, count: riskCounts.counts[level] ?? 0 })),
      inventory: {
        aiSystems: systems,
        models: totalModels,
        inProduction: lifecycleRows.find((r) => r.lifecycleStage === 'PRODUCTION')?._count._all ?? 0,
        shadowAI: shadowAi,
        thirdParty,
        byLifecycle: lifecycleRows.map((r) => ({ stage: r.lifecycleStage, count: r._count._all })),
      },
      highRiskModels,
      fairness,
      security: { ...security, openIncidents },
      explainability,
      governance: { activePolicies, policiesDueForReview: policiesDue, pendingReviews: pendingRisk + pendingAia, openRisks: openRegister },
      compliance: { byFramework: [...frameworks.values()] },
    };
  },

  async personalDashboard(userId: string) {
    const [enrollments, progressRows, labAttempts, submissions, quizAttempts, certificates, experimentRows, recentExperiments, modelCards, ownedModels] =
      await Promise.all([
        prisma.enrollment.findMany({
          where: { userId },
          include: {
            course: {
              select: {
                id: true,
                title: true,
                modules: {
                  orderBy: { order: 'asc' },
                  select: { id: true, title: true, order: true, lessons: { orderBy: { order: 'asc' }, select: { id: true, title: true } } },
                },
              },
            },
          },
        }),
        prisma.progress.findMany({ where: { userId }, select: { lessonId: true, status: true } }),
        prisma.labAttempt.groupBy({ by: ['status'], where: { userId }, _count: { _all: true } }),
        prisma.submission.groupBy({ by: ['status'], where: { userId }, _count: { _all: true } }),
        prisma.quizAttempt.findMany({
          where: { userId, submittedAt: { not: null } },
          select: { percentage: true, passed: true, submittedAt: true, quiz: { select: { id: true, title: true } } },
          orderBy: { submittedAt: 'asc' },
        }),
        prisma.certificate.groupBy({ by: ['status'], where: { userId }, _count: { _all: true } }),
        prisma.experiment.groupBy({ by: ['type'], where: { userId }, _count: { _all: true } }),
        prisma.experiment.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { id: true, type: true, status: true, algorithm: true, createdAt: true },
        }),
        prisma.modelCard.count({ where: { ownerId: userId } }),
        prisma.aIModel.count({ where: { ownerId: userId } }),
      ]);

    const completedLessons = new Set(progressRows.filter((p) => p.status === 'COMPLETED').map((p) => p.lessonId));
    let totalLessons = 0;
    let totalModules = 0;
    let modulesCompleted = 0;
    let recommendedNext: { courseId: string; courseTitle: string; moduleId: string; moduleTitle: string; lessonId: string; lessonTitle: string } | null = null;

    const courses = enrollments.map((e) => {
      for (const m of e.course.modules) {
        totalModules += 1;
        totalLessons += m.lessons.length;
        if (m.lessons.length > 0 && m.lessons.every((l) => completedLessons.has(l.id))) modulesCompleted += 1;
        const next = m.lessons.find((l) => !completedLessons.has(l.id));
        if (!recommendedNext && next && e.status === 'ACTIVE') {
          recommendedNext = {
            courseId: e.course.id,
            courseTitle: e.course.title,
            moduleId: m.id,
            moduleTitle: m.title,
            lessonId: next.id,
            lessonTitle: next.title,
          };
        }
      }
      return { courseId: e.course.id, title: e.course.title, status: e.status, progressPercent: e.progressPercent };
    });

    const percentages = quizAttempts.map((a) => a.percentage ?? 0);

    return {
      learning: {
        courses,
        lessonsCompleted: completedLessons.size,
        totalLessons,
        modulesCompleted,
        totalModules,
      },
      labs: {
        completed: sumWhere(labAttempts, (r) => r.status === 'COMPLETED'),
        inProgress: sumWhere(labAttempts, (r) => r.status === 'IN_PROGRESS'),
      },
      assignments: {
        submitted: sumWhere(submissions, () => true),
        graded: sumWhere(submissions, (r) => r.status === 'GRADED'),
      },
      quizzes: {
        attempts: quizAttempts.length,
        passed: quizAttempts.filter((a) => a.passed).length,
        averageScore: percentages.length ? Math.round(percentages.reduce((a, b) => a + b, 0) / percentages.length) : null,
        history: quizAttempts.map((a) => ({ quiz: a.quiz.title, percentage: a.percentage, submittedAt: a.submittedAt })),
      },
      certificates: {
        issued: sumWhere(certificates, (r) => r.status === 'ISSUED'),
        pending: sumWhere(certificates, (r) => r.status === 'PENDING_APPROVAL'),
      },
      experiments: {
        total: sumWhere(experimentRows, () => true),
        byType: experimentRows.map((r) => ({ type: r.type, count: r._count._all })),
        recent: recentExperiments,
      },
      modelCards,
      ownedModels,
      recommendedNext,
    };
  },
};
