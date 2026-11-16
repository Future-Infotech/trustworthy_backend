import type { RiskLevel } from '@prisma/client';
import { z } from 'zod';

/**
 * Rule-based AI system risk scoring.
 *
 * Every point awarded is traceable to an explicit rule below. The engine never
 * determines legal compliance; it only surfaces "potential compliance
 * considerations" that require human / legal review.
 */
export const RISK_SCORING_VERSION = '1.0.0';

export const riskAnswersSchema = z.object({
  purpose: z.string().trim().min(10).max(2000),
  domain: z.enum([
    'EDUCATION',
    'EMPLOYMENT',
    'CREDIT_FINANCE',
    'HEALTHCARE',
    'LAW_ENFORCEMENT',
    'CRITICAL_INFRASTRUCTURE',
    'PUBLIC_SERVICES',
    'MARKETING',
    'INTERNAL_OPERATIONS',
    'OTHER',
  ]),
  users: z.array(z.enum(['INTERNAL_STAFF', 'DOMAIN_EXPERTS', 'BUSINESS_CUSTOMERS', 'GENERAL_PUBLIC'])).min(1),
  affectedPopulation: z.enum(['NONE', 'INTERNAL', 'CUSTOMERS', 'GENERAL_PUBLIC', 'VULNERABLE_GROUPS']),
  affectedScale: z.enum(['UNDER_100', 'UNDER_10K', 'UNDER_1M', 'OVER_1M']),
  dataSensitivity: z.enum(['PUBLIC', 'INTERNAL', 'PERSONAL', 'SPECIAL_CATEGORY']),
  decisionImpact: z.enum(['MINIMAL', 'MODERATE', 'SIGNIFICANT', 'LIFE_CHANGING']),
  automationLevel: z.enum(['DECISION_SUPPORT', 'HUMAN_IN_THE_LOOP', 'HUMAN_ON_THE_LOOP', 'FULLY_AUTOMATED']),
  humanOversight: z.enum(['STRONG', 'PARTIAL', 'NONE']),
  fairnessRisk: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  usesProtectedAttributes: z.boolean(),
  privacyRisk: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  securityExposure: z.enum(['INTERNAL_ONLY', 'AUTHENTICATED_EXTERNAL', 'PUBLIC_API']),
  adversarialThreat: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  explainabilityRequirement: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  modelTransparency: z.enum(['INTERPRETABLE', 'POST_HOC_EXPLAINABLE', 'BLACK_BOX']),
  regulatoryContext: z.array(z.enum(['EU_AI_ACT', 'GDPR', 'FAIR_LENDING', 'HIPAA', 'EMPLOYMENT_LAW', 'SECTOR_REGULATOR', 'NONE'])).min(1),
});

export type RiskAnswers = z.infer<typeof riskAnswersSchema>;

export interface RiskFactor {
  key: string;
  label: string;
  points: number;
  maxPoints: number;
  rationale: string;
}

export interface RiskControl {
  id: string;
  title: string;
  description: string;
  pillar: 'TRANSPARENCY' | 'ROBUSTNESS' | 'FAIRNESS' | 'PRIVACY' | 'ACCOUNTABILITY';
  priority: 'REQUIRED' | 'RECOMMENDED';
}

export interface RiskResult {
  score: number;
  rawScore: number;
  maxRawScore: number;
  level: RiskLevel;
  escalations: string[];
  factors: RiskFactor[];
  recommendedControls: RiskControl[];
  requiredOversight: string;
  reviewRequirement: 'OWNER_REVIEW' | 'GOVERNANCE_REVIEW' | 'GOVERNANCE_AND_LEGAL_REVIEW';
  complianceConsiderations: { topic: string; consideration: string; requiresLegalReview: boolean }[];
  disclaimer: string;
  scoringVersion: string;
}

const HIGH_RISK_DOMAINS = new Set<RiskAnswers['domain']>([
  'EDUCATION',
  'EMPLOYMENT',
  'CREDIT_FINANCE',
  'HEALTHCARE',
  'LAW_ENFORCEMENT',
  'CRITICAL_INFRASTRUCTURE',
  'PUBLIC_SERVICES',
]);

const POINTS = {
  domain: { max: 15, value: (a: RiskAnswers) => (HIGH_RISK_DOMAINS.has(a.domain) ? 15 : a.domain === 'INTERNAL_OPERATIONS' ? 2 : 5) },
  affectedPopulation: { max: 10, table: { NONE: 0, INTERNAL: 3, CUSTOMERS: 6, GENERAL_PUBLIC: 8, VULNERABLE_GROUPS: 10 } },
  affectedScale: { max: 7, table: { UNDER_100: 1, UNDER_10K: 3, UNDER_1M: 5, OVER_1M: 7 } },
  dataSensitivity: { max: 12, table: { PUBLIC: 0, INTERNAL: 2, PERSONAL: 7, SPECIAL_CATEGORY: 12 } },
  decisionImpact: { max: 15, table: { MINIMAL: 0, MODERATE: 5, SIGNIFICANT: 10, LIFE_CHANGING: 15 } },
  automationLevel: { max: 10, table: { DECISION_SUPPORT: 0, HUMAN_IN_THE_LOOP: 3, HUMAN_ON_THE_LOOP: 6, FULLY_AUTOMATED: 10 } },
  humanOversight: { max: 8, table: { STRONG: 0, PARTIAL: 4, NONE: 8 } },
  fairness: { max: 8 },
  privacyRisk: { max: 5, table: { LOW: 0, MEDIUM: 2, HIGH: 5 } },
  security: { max: 7 },
  explainabilityGap: { max: 5 },
} as const;

const MAX_RAW = Object.values(POINTS).reduce((n, p) => n + p.max, 0);
const LEVEL_ORDER: RiskLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export function levelForScore(score: number): RiskLevel {
  if (score >= 75) return 'CRITICAL';
  if (score >= 50) return 'HIGH';
  if (score >= 25) return 'MEDIUM';
  return 'LOW';
}

const atLeast = (current: RiskLevel, floor: RiskLevel): RiskLevel =>
  LEVEL_ORDER.indexOf(floor) > LEVEL_ORDER.indexOf(current) ? floor : current;

function scoreFactors(a: RiskAnswers): RiskFactor[] {
  const humanise = (v: string) => v.toLowerCase().replace(/_/g, ' ');
  const fairnessPoints = { LOW: 0, MEDIUM: 3, HIGH: 6 }[a.fairnessRisk] + (a.usesProtectedAttributes ? 2 : 0);
  const securityPoints =
    { INTERNAL_ONLY: 0, AUTHENTICATED_EXTERNAL: 2, PUBLIC_API: 4 }[a.securityExposure] + { LOW: 0, MEDIUM: 1, HIGH: 3 }[a.adversarialThreat];
  const gap =
    a.explainabilityRequirement === 'HIGH'
      ? { INTERPRETABLE: 0, POST_HOC_EXPLAINABLE: 2, BLACK_BOX: 5 }[a.modelTransparency]
      : a.explainabilityRequirement === 'MEDIUM' && a.modelTransparency === 'BLACK_BOX'
        ? 3
        : 0;

  return [
    {
      key: 'domain',
      label: 'Application domain',
      points: POINTS.domain.value(a),
      maxPoints: POINTS.domain.max,
      rationale: HIGH_RISK_DOMAINS.has(a.domain)
        ? `${humanise(a.domain)} is a domain where AI decisions commonly affect access to opportunities or essential services.`
        : `${humanise(a.domain)} is a lower-impact domain.`,
    },
    {
      key: 'affectedPopulation',
      label: 'Affected people',
      points: POINTS.affectedPopulation.table[a.affectedPopulation],
      maxPoints: POINTS.affectedPopulation.max,
      rationale: `Decisions affect ${humanise(a.affectedPopulation)}.`,
    },
    {
      key: 'affectedScale',
      label: 'Scale of impact',
      points: POINTS.affectedScale.table[a.affectedScale],
      maxPoints: POINTS.affectedScale.max,
      rationale: `Approximately ${humanise(a.affectedScale)} people affected.`,
    },
    {
      key: 'dataSensitivity',
      label: 'Data sensitivity',
      points: POINTS.dataSensitivity.table[a.dataSensitivity],
      maxPoints: POINTS.dataSensitivity.max,
      rationale: `Processes ${humanise(a.dataSensitivity)} data.`,
    },
    {
      key: 'decisionImpact',
      label: 'Decision impact',
      points: POINTS.decisionImpact.table[a.decisionImpact],
      maxPoints: POINTS.decisionImpact.max,
      rationale: `Outcomes have ${humanise(a.decisionImpact)} impact on individuals.`,
    },
    {
      key: 'automationLevel',
      label: 'Automation level',
      points: POINTS.automationLevel.table[a.automationLevel],
      maxPoints: POINTS.automationLevel.max,
      rationale: `Operating mode: ${humanise(a.automationLevel)}.`,
    },
    {
      key: 'humanOversight',
      label: 'Human oversight',
      points: POINTS.humanOversight.table[a.humanOversight],
      maxPoints: POINTS.humanOversight.max,
      rationale: `Ability for humans to review and override is ${humanise(a.humanOversight)}.`,
    },
    {
      key: 'fairness',
      label: 'Fairness risk',
      points: fairnessPoints,
      maxPoints: POINTS.fairness.max,
      rationale: `Self-assessed fairness risk is ${humanise(a.fairnessRisk)}${a.usesProtectedAttributes ? '; protected attributes (or close proxies) are used' : ''}.`,
    },
    {
      key: 'privacyRisk',
      label: 'Privacy risk',
      points: POINTS.privacyRisk.table[a.privacyRisk],
      maxPoints: POINTS.privacyRisk.max,
      rationale: `Self-assessed privacy risk is ${humanise(a.privacyRisk)}.`,
    },
    {
      key: 'security',
      label: 'Security exposure',
      points: securityPoints,
      maxPoints: POINTS.security.max,
      rationale: `Exposure: ${humanise(a.securityExposure)}; adversarial threat: ${humanise(a.adversarialThreat)}.`,
    },
    {
      key: 'explainabilityGap',
      label: 'Explainability gap',
      points: gap,
      maxPoints: POINTS.explainabilityGap.max,
      rationale: `Explainability requirement is ${humanise(a.explainabilityRequirement)} and the model is ${humanise(a.modelTransparency)}.`,
    },
  ];
}

function recommendControls(a: RiskAnswers, level: RiskLevel): RiskControl[] {
  const controls: RiskControl[] = [];
  const add = (c: RiskControl) => controls.push(c);
  const elevated = level === 'HIGH' || level === 'CRITICAL';

  add({
    id: 'model-card',
    title: 'Publish a model card',
    description: 'Document intended use, out-of-scope use, evaluation data, subgroup performance and known limitations.',
    pillar: 'TRANSPARENCY',
    priority: 'REQUIRED',
  });
  if (a.fairnessRisk !== 'LOW' || a.usesProtectedAttributes) {
    add({
      id: 'fairness-audit',
      title: 'Run a fairness audit before deployment and on a recurring schedule',
      description: 'Measure demographic parity difference, equalized odds and per-group error rates; document trade-offs of any mitigation.',
      pillar: 'FAIRNESS',
      priority: elevated || a.fairnessRisk === 'HIGH' ? 'REQUIRED' : 'RECOMMENDED',
    });
  }
  if (a.explainabilityRequirement !== 'LOW' || a.modelTransparency === 'BLACK_BOX') {
    add({
      id: 'explanations',
      title: 'Provide global and local explanations',
      description: 'Use SHAP / LIME to explain predictions to reviewers and affected people; consider an inherently interpretable model.',
      pillar: 'TRANSPARENCY',
      priority: a.explainabilityRequirement === 'HIGH' ? 'REQUIRED' : 'RECOMMENDED',
    });
  }
  if (a.securityExposure !== 'INTERNAL_ONLY' || a.adversarialThreat !== 'LOW') {
    add({
      id: 'robustness-testing',
      title: 'Adversarial robustness testing',
      description: 'Evaluate degradation under FGSM / PGD perturbations and consider adversarial training, input validation and rate limiting.',
      pillar: 'ROBUSTNESS',
      priority: a.adversarialThreat === 'HIGH' || a.securityExposure === 'PUBLIC_API' ? 'REQUIRED' : 'RECOMMENDED',
    });
  }
  if (a.dataSensitivity === 'PERSONAL' || a.dataSensitivity === 'SPECIAL_CATEGORY' || a.privacyRisk !== 'LOW') {
    add({
      id: 'privacy-review',
      title: 'Privacy impact review and data minimisation',
      description: 'Limit features to what is necessary, define retention, apply access controls and consider privacy-enhancing techniques.',
      pillar: 'PRIVACY',
      priority: a.dataSensitivity === 'SPECIAL_CATEGORY' || a.privacyRisk === 'HIGH' ? 'REQUIRED' : 'RECOMMENDED',
    });
  }
  if (a.automationLevel === 'FULLY_AUTOMATED' && a.decisionImpact !== 'MINIMAL') {
    add({
      id: 'human-review-adverse',
      title: 'Human review of adverse decisions',
      description: 'Route adverse or contested outcomes to a trained human reviewer with authority to override.',
      pillar: 'ACCOUNTABILITY',
      priority: 'REQUIRED',
    });
  }
  if (elevated) {
    add({
      id: 'aia',
      title: 'Complete an Algorithmic Impact Assessment',
      description: 'Assess potential harms to affected groups and obtain governance approval before deployment.',
      pillar: 'ACCOUNTABILITY',
      priority: 'REQUIRED',
    });
    add({
      id: 'monitoring',
      title: 'Continuous monitoring and incident response',
      description: 'Monitor drift, subgroup performance and complaints; define an incident response runbook and owners.',
      pillar: 'ROBUSTNESS',
      priority: 'REQUIRED',
    });
  }
  return controls;
}

const OVERSIGHT: Record<RiskLevel, string> = {
  LOW: 'Periodic sampling review by the system owner.',
  MEDIUM: 'Human-on-the-loop monitoring with a documented escalation path.',
  HIGH: 'Human-in-the-loop review of adverse or high-impact decisions before they take effect.',
  CRITICAL:
    'Mandatory human approval before any decision takes effect, and governance board sign-off before deployment.',
};

function complianceConsiderations(a: RiskAnswers, level: RiskLevel) {
  const items: RiskResult['complianceConsiderations'] = [];
  const regs = new Set(a.regulatoryContext);
  if (regs.has('EU_AI_ACT')) {
    items.push({
      topic: 'EU AI Act',
      consideration: HIGH_RISK_DOMAINS.has(a.domain)
        ? 'The application domain may correspond to high-risk use cases; obligations such as risk management, data governance, logging, transparency and human oversight may apply.'
        : 'Determine whether the system falls into any regulated category or carries transparency obligations.',
      requiresLegalReview: true,
    });
  }
  if (regs.has('GDPR') || a.dataSensitivity === 'PERSONAL' || a.dataSensitivity === 'SPECIAL_CATEGORY') {
    items.push({
      topic: 'Data protection',
      consideration:
        a.automationLevel === 'FULLY_AUTOMATED' && a.decisionImpact !== 'MINIMAL'
          ? 'Solely automated decisions with significant effects may trigger rights to human intervention and explanation; a data protection impact assessment may be needed.'
          : 'Confirm lawful basis, purpose limitation, retention and data subject rights handling.',
      requiresLegalReview: true,
    });
  }
  if (regs.has('FAIR_LENDING') || a.domain === 'CREDIT_FINANCE') {
    items.push({
      topic: 'Fair lending',
      consideration: 'Adverse action notices and anti-discrimination requirements may apply to credit decisions.',
      requiresLegalReview: true,
    });
  }
  if (regs.has('EMPLOYMENT_LAW') || a.domain === 'EMPLOYMENT') {
    items.push({
      topic: 'Employment',
      consideration: 'Automated hiring or evaluation tools may be subject to bias audit and notice requirements in some jurisdictions.',
      requiresLegalReview: true,
    });
  }
  if (regs.has('HIPAA') || a.domain === 'HEALTHCARE') {
    items.push({
      topic: 'Health data',
      consideration: 'Health information handling and clinical safety requirements may apply.',
      requiresLegalReview: true,
    });
  }
  if (regs.has('SECTOR_REGULATOR')) {
    items.push({
      topic: 'Sector regulation',
      consideration: 'Review model risk management expectations issued by the relevant sector regulator.',
      requiresLegalReview: true,
    });
  }
  if (items.length === 0 && (level === 'HIGH' || level === 'CRITICAL')) {
    items.push({
      topic: 'Regulatory scoping',
      consideration: 'No regulatory context was selected, but the risk level warrants a legal scoping review.',
      requiresLegalReview: true,
    });
  }
  return items;
}

export function scoreRiskAssessment(answers: RiskAnswers): RiskResult {
  const factors = scoreFactors(answers);
  const rawScore = factors.reduce((n, f) => n + f.points, 0);
  const score = Math.round((rawScore / MAX_RAW) * 100);

  let level = levelForScore(score);
  const escalations: string[] = [];
  if (answers.decisionImpact === 'LIFE_CHANGING' && answers.automationLevel === 'FULLY_AUTOMATED') {
    level = atLeast(level, 'CRITICAL');
    escalations.push('Life-changing decisions are fully automated: minimum level CRITICAL.');
  }
  if (HIGH_RISK_DOMAINS.has(answers.domain) && (answers.decisionImpact === 'SIGNIFICANT' || answers.decisionImpact === 'LIFE_CHANGING')) {
    level = atLeast(level, 'HIGH');
    escalations.push('Significant decisions in a high-impact domain: minimum level HIGH.');
  }
  if (answers.dataSensitivity === 'SPECIAL_CATEGORY' && answers.humanOversight === 'NONE') {
    level = atLeast(level, 'HIGH');
    escalations.push('Special-category data processed without human oversight: minimum level HIGH.');
  }

  const considerations = complianceConsiderations(answers, level);
  const reviewRequirement =
    level === 'HIGH' || level === 'CRITICAL' || considerations.some((c) => c.requiresLegalReview)
      ? 'GOVERNANCE_AND_LEGAL_REVIEW'
      : level === 'MEDIUM'
        ? 'GOVERNANCE_REVIEW'
        : 'OWNER_REVIEW';

  return {
    score,
    rawScore,
    maxRawScore: MAX_RAW,
    level,
    escalations,
    factors: factors.filter((f) => f.points > 0).sort((x, y) => y.points - x.points),
    recommendedControls: recommendControls(answers, level),
    requiredOversight: OVERSIGHT[level],
    reviewRequirement,
    complianceConsiderations: considerations,
    disclaimer:
      'This score is produced by documented, rule-based criteria to support governance decisions. It is not a legal determination and does not establish that any regulatory requirement is satisfied.',
    scoringVersion: RISK_SCORING_VERSION,
  };
}
