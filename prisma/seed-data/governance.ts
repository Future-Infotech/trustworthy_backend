import type { ModelLifecycleStage, ReviewStatus, AISystemStatus } from '@prisma/client';
import type { RiskAnswers } from '../../src/services/riskScoring.service';

export interface SeedAISystem {
  key: string;
  name: string;
  description: string;
  businessUnit: string;
  ownerEmail: string;
  status: AISystemStatus;
  isThirdParty?: boolean;
  vendorName?: string;
  dataCategories: string[];
  model: {
    name: string;
    description: string;
    purpose: string;
    framework: string;
    algorithm: string;
    lifecycleStage: ModelLifecycleStage;
    usesLoanDataset?: boolean;
    tags: string[];
  };
  risk: { title: string; status: ReviewStatus; answers: RiskAnswers };
}

export const AI_SYSTEMS: SeedAISystem[] = [
  {
    key: 'loan',
    name: 'Small Business Lending Platform',
    description: 'Credit decision support for small-business loan officers.',
    businessUnit: 'Commercial Banking',
    ownerEmail: 'developer@example.com',
    status: 'DEVELOPMENT',
    dataCategories: ['financial', 'personal'],
    model: {
      name: 'Trustworthy Loan Risk Evaluator',
      description: 'Estimates the probability of loan repayment to support (not replace) loan officers.',
      purpose: 'Small-business credit risk assessment',
      framework: 'LightGBM',
      algorithm: 'Gradient Boosted Decision Tree',
      lifecycleStage: 'REVIEW',
      usesLoanDataset: true,
      tags: ['credit', 'tabular', 'decision-support'],
    },
    risk: {
      title: 'Loan Risk Evaluator – pre-deployment risk assessment',
      status: 'SUBMITTED',
      answers: {
        purpose: 'Estimate repayment probability for small-business loan applications to support loan officers.',
        domain: 'CREDIT_FINANCE',
        users: ['INTERNAL_STAFF', 'DOMAIN_EXPERTS'],
        affectedPopulation: 'CUSTOMERS',
        affectedScale: 'UNDER_1M',
        dataSensitivity: 'PERSONAL',
        decisionImpact: 'SIGNIFICANT',
        automationLevel: 'HUMAN_IN_THE_LOOP',
        humanOversight: 'STRONG',
        fairnessRisk: 'HIGH',
        usesProtectedAttributes: false,
        privacyRisk: 'MEDIUM',
        securityExposure: 'INTERNAL_ONLY',
        adversarialThreat: 'MEDIUM',
        explainabilityRequirement: 'HIGH',
        modelTransparency: 'POST_HOC_EXPLAINABLE',
        regulatoryContext: ['FAIR_LENDING', 'GDPR', 'EU_AI_ACT'],
      },
    },
  },
  {
    key: 'hiring',
    name: 'Talent Acquisition Suite',
    description: 'Third-party CV screening and ranking integrated into the applicant tracking system.',
    businessUnit: 'Human Resources',
    ownerEmail: 'admin@example.com',
    status: 'ACTIVE',
    isThirdParty: true,
    vendorName: 'HireSense Ltd.',
    dataCategories: ['personal', 'employment'],
    model: {
      name: 'Resume Screening Assistant',
      description: 'Vendor model ranking applicants against job requirements.',
      purpose: 'Shortlisting candidates for recruiter review',
      framework: 'Proprietary (vendor)',
      algorithm: 'Transformer-based ranking',
      lifecycleStage: 'PRODUCTION',
      tags: ['hr', 'nlp', 'vendor'],
    },
    risk: {
      title: 'Resume Screening Assistant – annual risk review',
      status: 'APPROVED',
      answers: {
        purpose: 'Rank job applicants so recruiters can prioritise review of the most relevant CVs.',
        domain: 'EMPLOYMENT',
        users: ['INTERNAL_STAFF'],
        affectedPopulation: 'GENERAL_PUBLIC',
        affectedScale: 'UNDER_10K',
        dataSensitivity: 'PERSONAL',
        decisionImpact: 'SIGNIFICANT',
        automationLevel: 'HUMAN_ON_THE_LOOP',
        humanOversight: 'PARTIAL',
        fairnessRisk: 'HIGH',
        usesProtectedAttributes: false,
        privacyRisk: 'MEDIUM',
        securityExposure: 'AUTHENTICATED_EXTERNAL',
        adversarialThreat: 'MEDIUM',
        explainabilityRequirement: 'HIGH',
        modelTransparency: 'BLACK_BOX',
        regulatoryContext: ['EMPLOYMENT_LAW', 'GDPR', 'EU_AI_ACT'],
      },
    },
  },
  {
    key: 'churn',
    name: 'Customer Retention Analytics',
    description: 'Predicts churn risk to prioritise retention outreach.',
    businessUnit: 'Marketing',
    ownerEmail: 'productdev@example.com',
    status: 'ACTIVE',
    dataCategories: ['behavioural', 'personal'],
    model: {
      name: 'Customer Churn Predictor',
      description: 'Monthly churn propensity scores for retention campaigns.',
      purpose: 'Prioritise customers for retention offers',
      framework: 'scikit-learn',
      algorithm: 'Random Forest',
      lifecycleStage: 'PRODUCTION',
      tags: ['marketing', 'tabular'],
    },
    risk: {
      title: 'Churn Predictor – risk assessment',
      status: 'APPROVED',
      answers: {
        purpose: 'Score customers by churn likelihood to target retention offers.',
        domain: 'MARKETING',
        users: ['INTERNAL_STAFF'],
        affectedPopulation: 'CUSTOMERS',
        affectedScale: 'UNDER_1M',
        dataSensitivity: 'PERSONAL',
        decisionImpact: 'MINIMAL',
        automationLevel: 'HUMAN_ON_THE_LOOP',
        humanOversight: 'PARTIAL',
        fairnessRisk: 'LOW',
        usesProtectedAttributes: false,
        privacyRisk: 'MEDIUM',
        securityExposure: 'INTERNAL_ONLY',
        adversarialThreat: 'LOW',
        explainabilityRequirement: 'LOW',
        modelTransparency: 'POST_HOC_EXPLAINABLE',
        regulatoryContext: ['GDPR'],
      },
    },
  },
  {
    key: 'triage',
    name: 'Emergency Department Triage Support',
    description: 'Prioritises incoming patients for clinician assessment.',
    businessUnit: 'Healthcare Partnerships',
    ownerEmail: 'developer@example.com',
    status: 'DEVELOPMENT',
    dataCategories: ['health', 'personal'],
    model: {
      name: 'Clinical Triage Prioritizer',
      description: 'Suggests a triage priority from vital signs and intake notes.',
      purpose: 'Assist triage nurses in prioritising patients',
      framework: 'PyTorch',
      algorithm: 'Multilayer Perceptron',
      lifecycleStage: 'TESTING',
      tags: ['healthcare', 'safety-critical'],
    },
    risk: {
      title: 'Clinical Triage Prioritizer – risk assessment',
      status: 'UNDER_REVIEW',
      answers: {
        purpose: 'Suggest a triage priority level to support emergency department nurses.',
        domain: 'HEALTHCARE',
        users: ['DOMAIN_EXPERTS'],
        affectedPopulation: 'VULNERABLE_GROUPS',
        affectedScale: 'UNDER_1M',
        dataSensitivity: 'SPECIAL_CATEGORY',
        decisionImpact: 'LIFE_CHANGING',
        automationLevel: 'HUMAN_IN_THE_LOOP',
        humanOversight: 'STRONG',
        fairnessRisk: 'MEDIUM',
        usesProtectedAttributes: true,
        privacyRisk: 'HIGH',
        securityExposure: 'INTERNAL_ONLY',
        adversarialThreat: 'MEDIUM',
        explainabilityRequirement: 'HIGH',
        modelTransparency: 'BLACK_BOX',
        regulatoryContext: ['HIPAA', 'EU_AI_ACT', 'SECTOR_REGULATOR'],
      },
    },
  },
  {
    key: 'dropout',
    name: 'Student Success Platform',
    description: 'Early warning of students at risk of dropping out to offer support.',
    businessUnit: 'Academic Affairs',
    ownerEmail: 'faculty@example.com',
    status: 'PROPOSED',
    dataCategories: ['education', 'personal'],
    model: {
      name: 'Student Dropout Early Warning',
      description: 'Identifies students who may benefit from proactive academic support.',
      purpose: 'Trigger supportive outreach by academic advisors',
      framework: 'scikit-learn',
      algorithm: 'Logistic Regression',
      lifecycleStage: 'DEVELOPMENT',
      tags: ['education', 'tabular'],
    },
    risk: {
      title: 'Dropout Early Warning – draft risk assessment',
      status: 'DRAFT',
      answers: {
        purpose: 'Flag students who may benefit from proactive support from academic advisors.',
        domain: 'EDUCATION',
        users: ['DOMAIN_EXPERTS'],
        affectedPopulation: 'VULNERABLE_GROUPS',
        affectedScale: 'UNDER_10K',
        dataSensitivity: 'PERSONAL',
        decisionImpact: 'MODERATE',
        automationLevel: 'DECISION_SUPPORT',
        humanOversight: 'STRONG',
        fairnessRisk: 'MEDIUM',
        usesProtectedAttributes: false,
        privacyRisk: 'MEDIUM',
        securityExposure: 'INTERNAL_ONLY',
        adversarialThreat: 'LOW',
        explainabilityRequirement: 'MEDIUM',
        modelTransparency: 'INTERPRETABLE',
        regulatoryContext: ['GDPR'],
      },
    },
  },
];

export const SHADOW_AI = [
  {
    name: 'Public generative AI chatbot for customer emails',
    description: 'Customer service staff paste customer messages into a public chatbot to draft replies.',
    businessUnit: 'Customer Service',
    discoveredVia: 'Staff survey (Q3)',
    dataCategories: ['personal', 'customer communications'],
  },
  {
    name: 'Contract summarisation browser extension',
    description: 'A browser extension that uploads contract text to a third-party AI service for summarisation.',
    businessUnit: 'Legal',
    discoveredVia: 'Network egress monitoring',
    dataCategories: ['confidential', 'commercial'],
  },
];

export const POLICIES = [
  {
    slug: 'responsible-ai-policy',
    title: 'Responsible AI Policy',
    category: 'Principles',
    status: 'ACTIVE' as const,
    version: '2.0',
    summary: 'Organisation-wide principles and obligations for designing, procuring and operating AI systems.',
    content: `# Responsible AI Policy

## 1. Purpose
Establish principles and minimum requirements so that AI systems used by the organisation are transparent, robust, fair, privacy-preserving and accountable.

## 2. Scope
All AI systems developed, procured or used by employees and contractors, including generative AI tools.

## 3. Requirements
1. Every AI system must be registered in the AI inventory with a named owner.
2. A risk assessment is required before development proceeds beyond proof of concept.
3. Systems rated HIGH or CRITICAL require an Algorithmic Impact Assessment and governance board approval.
4. Models must have a model card before deployment.
5. Fairness, explainability and robustness evaluations must be documented, including unfavourable results.
6. Adverse decisions with significant effects on individuals require meaningful human review.
7. Incidents must be reported within 24 hours of discovery.

## 4. Compliance
Platform outputs support but do not replace legal review. Legal counsel determines regulatory obligations.`,
  },
  {
    slug: 'shadow-ai-acceptable-use',
    title: 'Shadow AI & Generative AI Acceptable Use Policy',
    category: 'Acceptable Use',
    status: 'ACTIVE' as const,
    version: '1.1',
    summary: 'Rules for using AI tools, including discovery and registration of unsanctioned AI usage.',
    content: `# Shadow AI & Generative AI Acceptable Use Policy

## Principles
- Use sanctioned AI tools listed in the AI inventory.
- Never enter personal, confidential or regulated data into unsanctioned AI services.
- Register any AI tool you rely on for work through the Shadow AI register.

## Discovery
Shadow AI is identified through surveys, procurement reviews and network monitoring, and is registered without blame so that risk can be assessed.

## Exceptions
Exceptions require a risk assessment and approval from the AI governance board.`,
  },
  {
    slug: 'model-risk-management-standard',
    title: 'Model Risk Management Standard',
    category: 'Standards',
    status: 'UNDER_REVIEW' as const,
    version: '0.9',
    summary: 'Validation, documentation, monitoring and review requirements proportional to model risk.',
    content: `# Model Risk Management Standard

| Risk level | Independent validation | Review frequency |
|---|---|---|
| LOW | Not required | Annual |
| MEDIUM | Peer review | Semi-annual |
| HIGH | Independent validation | Quarterly |
| CRITICAL | Independent validation + board approval | Quarterly and on every change |`,
  },
  {
    slug: 'ai-incident-response',
    title: 'AI Incident Response Procedure',
    category: 'Operations',
    status: 'DRAFT' as const,
    version: '0.3',
    summary: 'How AI incidents are reported, triaged, investigated and closed.',
    content: `# AI Incident Response Procedure (draft)

1. **Report** via the governance incident register.
2. **Triage** severity (LOW–CRITICAL) within 4 business hours.
3. **Contain** – suspend the model or enforce human review if needed.
4. **Investigate** root cause; document affected people and harms.
5. **Remediate**, notify stakeholders as required and record lessons learned.`,
  },
];

export const COMPLIANCE_REQUIREMENTS = [
  { code: 'NIST-GOVERN', framework: 'NIST AI RMF', category: 'Governance', title: 'GOVERN – policies, roles and accountability for AI risk', status: 'EVIDENCE_PROVIDED' as const, description: 'Policies, processes and accountability structures for mapping, measuring and managing AI risk are in place.' },
  { code: 'NIST-MAP', framework: 'NIST AI RMF', category: 'Context', title: 'MAP – context, purpose and impacts documented per AI system', status: 'IN_PROGRESS' as const, description: 'Intended purpose, context of use, stakeholders and potential impacts are documented.' },
  { code: 'NIST-MEASURE-FAIRNESS', framework: 'NIST AI RMF', category: 'Measurement', title: 'MEASURE – fairness and bias evaluated and documented', status: 'IN_PROGRESS' as const, description: 'Fairness and bias are evaluated with appropriate metrics and results documented.' },
  { code: 'NIST-MANAGE-INCIDENTS', framework: 'NIST AI RMF', category: 'Operations', title: 'MANAGE – incident response and recovery for AI systems', status: 'NOT_STARTED' as const, description: 'Processes for responding to and recovering from AI incidents are defined and exercised.' },
  { code: 'ISO42001-POLICY', framework: 'ISO/IEC 42001', category: 'Governance', title: 'AI policy established and communicated', status: 'REVIEWED' as const, description: 'An AI policy appropriate to the organisation is documented, approved and communicated.' },
  { code: 'ISO42001-AIIA', framework: 'ISO/IEC 42001', category: 'Assessment', title: 'AI system impact assessment process', status: 'IN_PROGRESS' as const, description: 'A process to assess impacts of AI systems on individuals, groups and society is defined.' },
  { code: 'EUAIA-ART9', framework: 'EU AI Act', category: 'Risk management', title: 'Risk management system for potentially high-risk systems (Art. 9)', status: 'NEEDS_LEGAL_REVIEW' as const, description: 'Determine applicability and, where applicable, maintain a lifecycle risk management system.' },
  { code: 'EUAIA-ART13', framework: 'EU AI Act', category: 'Transparency', title: 'Transparency and provision of information to deployers (Art. 13)', status: 'NEEDS_LEGAL_REVIEW' as const, description: 'Determine applicability and the information that must accompany the system.' },
  { code: 'EUAIA-ART14', framework: 'EU AI Act', category: 'Human oversight', title: 'Human oversight measures (Art. 14)', status: 'IN_PROGRESS' as const, description: 'Design measures enabling effective oversight by natural persons where applicable.' },
];

type AiaSeedStatus = 'SUBMITTED' | 'APPROVED';

/** Impact assessments for the hiring (approved, required for its ACTIVE high-risk status) and loan (awaiting review) systems. */
export const IMPACT_ASSESSMENTS: { systemName: string; title: string; status: AiaSeedStatus; sections: Record<string, unknown> }[] = [
  {
    systemName: 'Talent Acquisition Suite',
    title: 'Talent Acquisition Suite – algorithmic impact assessment',
    status: 'APPROVED',
    sections: {
      systemInformation: 'Vendor-supplied resume screening assistant (HireSense Ltd.) integrated with the applicant tracking system. Owned by Talent Acquisition; operated by recruiters.',
      purpose: 'Rank incoming applications for recruiter review to reduce time-to-shortlist. The system recommends; recruiters decide.',
      stakeholders: 'Recruiters, hiring managers, applicants, HR leadership, the AI governance board, the works council.',
      affectedGroups: 'All job applicants, including people with career breaks, older applicants and applicants with non-traditional education.',
      dataSources: 'Applicant CVs and application forms. Protected attributes are not provided to the vendor model; voluntary diversity data is held separately for auditing.',
      modelDescription: 'Third-party ranking model producing a relevance score per application. Model internals are proprietary; the vendor supplies a model card.',
      potentialHarms: 'Indirect discrimination through proxies (employment gaps, graduation year); over-reliance on scores by recruiters; lack of transparency for applicants.',
      fairnessAnalysis: 'An incident reported lower shortlisting for career-break applicants. Subgroup selection rates have been requested from the vendor; an internal audit on historical outcomes is scheduled.',
      privacyAnalysis: 'Applicant data is processed under the recruitment privacy notice. The vendor contract prohibits training on our data; retention follows the recruitment schedule.',
      securityAnalysis: 'SaaS integration over authenticated API; vendor security attestation reviewed. Prompt or input manipulation through CV content is considered a residual risk.',
      humanOversight: 'Recruiters review every application in the shortlist window regardless of score; all rejections require a recruiter decision. Overrides are logged.',
      explainability: 'The vendor provides top contributing CV features per score. Applicants are told AI assists screening and can request human review.',
      monitoring: 'Monthly selection-rate monitoring by voluntary diversity data; quarterly governance review; incident reporting via the AI incident register.',
      incidentResponse: 'Incidents are logged in the AI incident register, triaged within 2 working days, and may trigger suspension of automated ranking.',
      governanceApproval: 'Approval by the AI governance board conditional on the vendor bias audit within 90 days.',
      harms: [
        { description: 'Career-break applicants ranked lower', affectedGroup: 'Applicants with employment gaps (disproportionately women and carers)', likelihood: 'HIGH', severity: 'HIGH', mitigation: 'Recruiter review of all rejections; vendor bias audit; monitoring of selection rates.' },
        { description: 'Automation bias in recruiter decisions', affectedGroup: 'All applicants', likelihood: 'MEDIUM', severity: 'MEDIUM', mitigation: 'Recruiter training; scores hidden until the recruiter records an initial view.' },
      ],
    },
  },
  {
    systemName: 'Small Business Lending Platform',
    title: 'Loan Risk Evaluator – algorithmic impact assessment',
    status: 'SUBMITTED',
    sections: {
      systemInformation: 'Internally developed credit risk model supporting small-business loan officers. Owned by Commercial Banking.',
      purpose: 'Provide a default-risk estimate to support, not replace, loan officer decisions.',
      stakeholders: 'Loan officers, credit risk committee, applicants, compliance, the AI governance board.',
      affectedGroups: 'Small-business loan applicants, including groups under-represented in historical approvals (by gender and age group).',
      dataSources: 'Synthetic loan applications dataset (1,000 records) with historical approval labels; protected attributes used only for fairness auditing.',
      modelDescription: 'Gradient boosted decision trees producing a default probability; explanations generated with SHAP for officer review.',
      potentialHarms: 'Reproduction of historical gender disparity in approvals; adverse decisions without meaningful explanation.',
      fairnessAnalysis: 'Dataset audit shows a demographic parity difference of about 0.19 by gender. A model-level audit with mitigation is required before deployment; trade-offs with accuracy will be documented.',
      privacyAnalysis: 'Minimised applicant features; access-controlled storage; no third-party processing.',
      securityAnalysis: 'Internal deployment only; adversarial robustness (FGSM/PGD) evaluation planned as an educational simulation on tabular features.',
      humanOversight: 'Loan officers review every recommendation; all adverse decisions require a second reviewer.',
      explainability: 'Per-decision SHAP explanations shown to officers; plain-language reasons provided to applicants on request.',
      monitoring: 'Quarterly review of subgroup approval rates and calibration; drift monitoring on key features.',
      incidentResponse: 'Incidents logged in the AI incident register; model can be withdrawn to manual underwriting within one day.',
      governanceApproval: 'Requires approval of the risk assessment and this AIA by the governance board before activation.',
      harms: [
        { description: 'Lower approval rates for women applicants', affectedGroup: 'Women business owners', likelihood: 'HIGH', severity: 'HIGH', mitigation: 'Fairness mitigation (ExponentiatedGradient) evaluated against accuracy; second-reviewer rule for adverse decisions.' },
        { description: 'Unexplained adverse decisions', affectedGroup: 'All applicants', likelihood: 'MEDIUM', severity: 'MEDIUM', mitigation: 'SHAP explanations and a documented appeal route.' },
      ],
    },
  },
];
