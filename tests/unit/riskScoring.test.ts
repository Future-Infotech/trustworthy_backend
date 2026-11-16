import { levelForScore, riskAnswersSchema, scoreRiskAssessment, type RiskAnswers } from '../../src/services/riskScoring.service';

const LOW_RISK: RiskAnswers = {
  purpose: 'Forecast stationery demand for internal procurement.',
  domain: 'INTERNAL_OPERATIONS',
  users: ['INTERNAL_STAFF'],
  affectedPopulation: 'NONE',
  affectedScale: 'UNDER_100',
  dataSensitivity: 'PUBLIC',
  decisionImpact: 'MINIMAL',
  automationLevel: 'DECISION_SUPPORT',
  humanOversight: 'STRONG',
  fairnessRisk: 'LOW',
  usesProtectedAttributes: false,
  privacyRisk: 'LOW',
  securityExposure: 'INTERNAL_ONLY',
  adversarialThreat: 'LOW',
  explainabilityRequirement: 'LOW',
  modelTransparency: 'INTERPRETABLE',
  regulatoryContext: ['NONE'],
};

const MAX_RISK: RiskAnswers = {
  ...LOW_RISK,
  purpose: 'Decide eligibility for public benefits without human involvement.',
  domain: 'PUBLIC_SERVICES',
  users: ['GENERAL_PUBLIC'],
  affectedPopulation: 'VULNERABLE_GROUPS',
  affectedScale: 'OVER_1M',
  dataSensitivity: 'SPECIAL_CATEGORY',
  decisionImpact: 'LIFE_CHANGING',
  automationLevel: 'FULLY_AUTOMATED',
  humanOversight: 'NONE',
  fairnessRisk: 'HIGH',
  usesProtectedAttributes: true,
  privacyRisk: 'HIGH',
  securityExposure: 'PUBLIC_API',
  adversarialThreat: 'HIGH',
  explainabilityRequirement: 'HIGH',
  modelTransparency: 'BLACK_BOX',
  regulatoryContext: ['EU_AI_ACT', 'GDPR'],
};

describe('risk scoring engine', () => {
  it('maps score bands to levels', () => {
    expect(levelForScore(0)).toBe('LOW');
    expect(levelForScore(24)).toBe('LOW');
    expect(levelForScore(25)).toBe('MEDIUM');
    expect(levelForScore(50)).toBe('HIGH');
    expect(levelForScore(75)).toBe('CRITICAL');
  });

  it('rates a benign internal system LOW with owner review', () => {
    const r = scoreRiskAssessment(LOW_RISK);
    expect(r.level).toBe('LOW');
    expect(r.score).toBeLessThan(25);
    expect(r.reviewRequirement).toBe('OWNER_REVIEW');
  });

  it('rates the worst case 100 / CRITICAL', () => {
    const r = scoreRiskAssessment(MAX_RISK);
    expect(r.score).toBe(100);
    expect(r.level).toBe('CRITICAL');
    expect(r.reviewRequirement).toBe('GOVERNANCE_AND_LEGAL_REVIEW');
  });

  it('is deterministic and traceable: factor points sum to the raw score', () => {
    const a = scoreRiskAssessment(MAX_RISK);
    const b = scoreRiskAssessment(MAX_RISK);
    expect(a).toEqual(b);
    expect(a.factors.reduce((n, f) => n + f.points, 0)).toBe(a.rawScore);
    for (const f of a.factors) expect(f.points).toBeLessThanOrEqual(f.maxPoints);
  });

  it('escalates fully automated life-changing decisions to CRITICAL regardless of score', () => {
    const r = scoreRiskAssessment({ ...LOW_RISK, decisionImpact: 'LIFE_CHANGING', automationLevel: 'FULLY_AUTOMATED' });
    expect(r.level).toBe('CRITICAL');
    expect(r.escalations.length).toBeGreaterThan(0);
  });

  it('escalates significant decisions in high-impact domains to at least HIGH', () => {
    const r = scoreRiskAssessment({ ...LOW_RISK, domain: 'EMPLOYMENT', decisionImpact: 'SIGNIFICANT' });
    expect(['HIGH', 'CRITICAL']).toContain(r.level);
  });

  it('requires human review of adverse decisions for automated impactful systems', () => {
    const r = scoreRiskAssessment({ ...LOW_RISK, automationLevel: 'FULLY_AUTOMATED', decisionImpact: 'MODERATE' });
    expect(r.recommendedControls.map((c) => c.id)).toContain('human-review-adverse');
  });

  it('never claims compliance: considerations always require legal review', () => {
    const r = scoreRiskAssessment(MAX_RISK);
    expect(r.complianceConsiderations.length).toBeGreaterThan(0);
    expect(r.complianceConsiderations.every((c) => c.requiresLegalReview)).toBe(true);
    expect(r.disclaimer).toMatch(/not a legal determination/i);
    expect(JSON.stringify(r)).not.toMatch(/\bis compliant\b|\bcompliance (is )?satisfied\b/i);
  });

  it('validates wizard answers', () => {
    expect(riskAnswersSchema.safeParse(LOW_RISK).success).toBe(true);
    expect(riskAnswersSchema.safeParse({ ...LOW_RISK, domain: 'SPACE_TRAVEL' }).success).toBe(false);
    expect(riskAnswersSchema.safeParse({ ...LOW_RISK, users: [] }).success).toBe(false);
  });
});
