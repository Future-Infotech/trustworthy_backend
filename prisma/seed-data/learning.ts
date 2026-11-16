import type { LabType, QuestionType, RoleName } from '@prisma/client';

export interface SeedQuestion {
  type: QuestionType;
  prompt: string;
  scenario?: string;
  options: string[];
  correct: number[];
  explanation: string;
  difficulty?: 'EASY' | 'MEDIUM' | 'HARD';
  tags: string[];
}

const TF = ['True', 'False'];

export const PILLARS_QUIZ = {
  title: 'Core Pillars Knowledge Check',
  description: 'Check your understanding of the five pillars of Trustworthy AI.',
  moduleOrder: 2,
  passingScore: 70,
  timeLimitSeconds: 600,
  attemptLimit: 5,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      prompt: 'Which pillar is primarily concerned with whether error rates differ unjustifiably across demographic groups?',
      options: ['Transparency & Explainability', 'Fairness & Non-Discrimination', 'Privacy & Data Governance', 'Technical Robustness & Safety'],
      correct: [1],
      explanation: 'Comparing outcomes and error rates across groups is the core of group fairness.',
      tags: ['pillars', 'fairness'],
    },
    {
      type: 'MULTIPLE_ANSWER',
      prompt: 'Which of the following are typical robustness metrics? (Select all that apply)',
      options: ['Clean vs adversarial accuracy', 'Calibration error', 'Demographic parity difference', 'Drift alerts'],
      correct: [0, 1, 3],
      explanation: 'Demographic parity difference is a fairness metric.',
      tags: ['pillars', 'robustness'],
    },
    {
      type: 'TRUE_FALSE',
      prompt: 'A model can satisfy demographic parity and equalized odds simultaneously in every situation.',
      options: TF,
      correct: [1],
      explanation: 'When base rates differ between groups these criteria are generally incompatible except in degenerate cases.',
      tags: ['pillars', 'fairness'],
    },
    {
      type: 'MULTIPLE_CHOICE',
      prompt: 'Which framework organises AI risk management into Govern, Map, Measure and Manage functions?',
      options: ['ISO/IEC 27001', 'NIST AI Risk Management Framework', 'OWASP Top 10', 'COBIT'],
      correct: [1],
      explanation: 'The NIST AI RMF 1.0 is structured around these four functions.',
      tags: ['pillars', 'governance'],
    },
    {
      type: 'SCENARIO',
      scenario:
        'A bank wants to remove the gender column from its credit model to "guarantee fairness". The model still uses occupation and part-time status.',
      prompt: 'What is the main problem with this approach?',
      options: [
        'Removing columns always reduces accuracy too much',
        'Proxy variables may still encode gender, and fairness can no longer be measured without the attribute',
        'Gender is never a protected attribute',
        'There is no problem; fairness is guaranteed',
      ],
      correct: [1],
      explanation: '"Fairness through unawareness" fails when proxies exist, and it removes the ability to audit group outcomes.',
      difficulty: 'HARD',
      tags: ['pillars', 'fairness', 'privacy'],
    },
    {
      type: 'TRUE_FALSE',
      prompt: 'Detailed model explanations can sometimes make it easier for attackers to craft adversarial inputs.',
      options: TF,
      correct: [0],
      explanation: 'This is one of the trade-offs between transparency and robustness.',
      tags: ['pillars', 'tradeoffs'],
    },
  ] satisfies SeedQuestion[],
};

export const FINAL_EXAM = {
  title: 'Trustworthy AI Certification Exam',
  description: 'Final assessment covering all modules. Questions are drawn at random from the exam bank.',
  passingScore: 75,
  timeLimitSeconds: 1800,
  attemptLimit: 3,
  questionsPerAttempt: 10,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      prompt: 'For a single instance, SHAP values of all features sum to:',
      options: ['Zero', 'Model output minus the expected model output', 'The model accuracy', 'The number of features'],
      correct: [1],
      explanation: 'SHAP explanations are additive around the baseline expectation.',
      tags: ['xai', 'shap'],
    },
    {
      type: 'MULTIPLE_CHOICE',
      prompt: 'LIME explains a prediction by:',
      options: [
        'Computing exact Shapley values',
        'Fitting a locally weighted interpretable surrogate model on perturbed samples',
        'Inspecting gradients of the last convolutional layer',
        'Retraining the model without each feature',
      ],
      correct: [1],
      explanation: 'LIME fits a simple model that approximates the black box near the instance.',
      tags: ['xai', 'lime'],
    },
    {
      type: 'MULTIPLE_CHOICE',
      prompt: 'Grad-CAM is primarily used to explain:',
      options: ['Tabular gradient boosting models', 'Convolutional image classifiers', 'Clustering algorithms', 'SQL queries'],
      correct: [1],
      explanation: 'Grad-CAM produces class-discriminative heatmaps from CNN feature maps.',
      tags: ['xai', 'grad-cam'],
    },
    {
      type: 'MULTIPLE_CHOICE',
      prompt: 'Group A selection rate is 0.40 and group B is 0.64. What is the demographic parity difference?',
      options: ['0.24', '0.625', '1.6', '0.04'],
      correct: [0],
      explanation: '0.64 − 0.40 = 0.24.',
      tags: ['fairness', 'metrics'],
    },
    {
      type: 'MULTIPLE_ANSWER',
      prompt: 'Equalized odds compares which rates across groups? (Select all that apply)',
      options: ['True positive rate', 'False positive rate', 'Selection rate only', 'Training loss'],
      correct: [0, 1],
      explanation: 'Equalized odds requires similar TPR and FPR across groups.',
      tags: ['fairness', 'metrics'],
    },
    {
      type: 'SCENARIO',
      scenario:
        'After applying ExponentiatedGradient with a DemographicParity constraint, the demographic parity difference fell from 0.21 to 0.04 while accuracy fell from 0.86 to 0.82.',
      prompt: 'What should the team do next?',
      options: [
        'Report only the improved fairness metric',
        'Document both changes, explain the trade-off and obtain approval from accountable stakeholders',
        'Discard mitigation because accuracy decreased',
        'Claim the model is now legally compliant',
      ],
      correct: [1],
      explanation: 'Trade-offs must be reported transparently and approved; metrics never prove legal compliance.',
      difficulty: 'HARD',
      tags: ['fairness', 'mitigation', 'governance'],
    },
    {
      type: 'MULTIPLE_CHOICE',
      prompt: 'The FGSM adversarial example is computed as:',
      options: ['x − ε·∇L', 'x + ε·sign(∇ₓL)', 'x · ε', 'A random perturbation of size ε'],
      correct: [1],
      explanation: 'FGSM takes a single step of size ε in the sign of the input gradient of the loss.',
      tags: ['robustness', 'fgsm'],
    },
    {
      type: 'TRUE_FALSE',
      prompt: 'Adversarial training typically improves robustness but may slightly reduce clean accuracy.',
      options: TF,
      correct: [0],
      explanation: 'This robustness–accuracy trade-off is widely observed.',
      tags: ['robustness', 'adversarial-training'],
    },
    {
      type: 'MULTIPLE_CHOICE',
      prompt: 'Which statement about a model card is correct?',
      options: [
        'It should omit unfavourable subgroup results to avoid confusion',
        'It documents intended use, out-of-scope use, subgroup performance and limitations',
        'It is only needed for open-source models',
        'It replaces the need for human oversight',
      ],
      correct: [1],
      explanation: 'Model cards are honest, structured documentation for all stakeholders.',
      tags: ['model-cards'],
    },
    {
      type: 'SCENARIO',
      scenario: 'A fully automated system makes final decisions on social benefit eligibility for the general public.',
      prompt: 'Under the platform\'s risk escalation rules, what is the minimum risk level if impact is life-changing?',
      options: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
      correct: [3],
      explanation: 'Fully automated, life-changing decisions escalate to CRITICAL.',
      tags: ['risk'],
    },
    {
      type: 'TRUE_FALSE',
      prompt: 'A risk assessment tool can automatically certify that an AI system satisfies the EU AI Act.',
      options: TF,
      correct: [1],
      explanation: 'Tools can surface considerations; determining legal compliance requires qualified human and legal review.',
      tags: ['risk', 'compliance'],
    },
    {
      type: 'MULTIPLE_ANSWER',
      prompt: 'Which are appropriate responses to Shadow AI? (Select all that apply)',
      options: ['Discovery and a Shadow AI register', 'An acceptable-use policy', 'Sanctioned alternative tools', 'Deleting audit logs of usage'],
      correct: [0, 1, 2],
      explanation: 'Audit logs must be preserved; the other measures are good practice.',
      tags: ['governance', 'shadow-ai'],
    },
    {
      type: 'MULTIPLE_CHOICE',
      prompt: 'Human oversight in which a person approves each decision before it takes effect is called:',
      options: ['Human-on-the-loop', 'Human-in-the-loop', 'Human-in-command', 'Fully automated'],
      correct: [1],
      explanation: 'Human-in-the-loop requires per-decision human approval.',
      tags: ['accountability'],
    },
    {
      type: 'MULTIPLE_CHOICE',
      prompt: 'Which technique provides a mathematical bound on how much a single individual\'s data can influence an output?',
      options: ['Pseudonymisation', 'Differential privacy', 'Encryption at rest', 'k-means clustering'],
      correct: [1],
      explanation: 'Differential privacy bounds individual influence, parameterised by ε.',
      tags: ['privacy'],
    },
  ] satisfies SeedQuestion[],
};

export const LABS: { slug: string; title: string; type: LabType; description: string; instructions: string; config: object; estimatedMinutes: number }[] = [
  {
    slug: 'xai-loan-explainability',
    title: 'Explainability Lab: SHAP & LIME on loan approvals',
    type: 'XAI',
    description: 'Train a classifier and explain it globally with SHAP and locally with SHAP and LIME.',
    instructions:
      'Select the Loan Applications dataset, target `approved`, train a Gradient Boosting model with seed 42, then generate SHAP global importance and a LIME explanation for at least two applicants.',
    config: { algorithm: 'gradient_boosting', target: 'approved', randomSeed: 42, testSize: 0.25 },
    estimatedMinutes: 60,
  },
  {
    slug: 'fairness-loan-audit',
    title: 'Fairness Audit Lab: demographic parity & equalized odds',
    type: 'FAIRNESS',
    description: 'Audit group fairness and compare metrics before and after ExponentiatedGradient mitigation.',
    instructions:
      'Audit predictions by `gender` and `age_group`. Record selection rates, TPR, FPR, demographic parity difference and equalized odds difference before and after mitigation, and discuss the accuracy trade-off.',
    config: { target: 'approved', protectedAttribute: 'gender', mitigation: 'exponentiated_gradient', constraint: 'demographic_parity', randomSeed: 42 },
    estimatedMinutes: 60,
  },
  {
    slug: 'robustness-fgsm-pgd',
    title: 'Adversarial Robustness Lab: FGSM, PGD & adversarial training',
    type: 'ROBUSTNESS',
    description: 'Measure accuracy degradation under FGSM and PGD and compare with an adversarially trained model.',
    instructions:
      'Run FGSM and PGD at ε ∈ {0.05, 0.1, 0.2} against the baseline network, then train an adversarially robust model and compare clean and adversarial accuracy.',
    config: { epsilons: [0.05, 0.1, 0.2], pgdSteps: 10, pgdAlpha: 0.01, randomSeed: 42 },
    estimatedMinutes: 75,
  },
];

export const ASSIGNMENTS: { title: string; description: string; instructions: string; targetRoles: RoleName[]; moduleOrder: number; dueInDays: number; rubric: object[] }[] = [
  {
    title: 'Implement SHAP and LIME explainability',
    description: 'Developer assignment: explain a trained classifier globally and locally.',
    instructions:
      'Train a model on a tabular dataset, produce SHAP global importance and two local explanations with SHAP and LIME, compare them, and discuss where they disagree and why.',
    targetRoles: ['DEVELOPER', 'STUDENT'],
    moduleOrder: 3,
    dueInDays: 14,
    rubric: [
      { criterion: 'Correct SHAP implementation and interpretation', weight: 35 },
      { criterion: 'Correct LIME implementation and interpretation', weight: 35 },
      { criterion: 'Critical comparison and limitations', weight: 30 },
    ],
  },
  {
    title: 'Perform FGSM/PGD robustness testing',
    description: 'Security assignment: evaluate and improve adversarial robustness.',
    instructions:
      'Evaluate a model under FGSM and PGD for at least three ε values, report clean/adversarial accuracy and degradation, apply adversarial training and compare.',
    targetRoles: ['DEVELOPER'],
    moduleOrder: 6,
    dueInDays: 21,
    rubric: [
      { criterion: 'Attack implementation and evaluation protocol', weight: 40 },
      { criterion: 'Adversarial training comparison', weight: 35 },
      { criterion: 'Discussion of limitations and gradient masking', weight: 25 },
    ],
  },
  {
    title: 'Analyze a dataset for fairness',
    description: 'Student assignment: identify and mitigate bias.',
    instructions:
      'Using the demo loan dataset, measure selection rates and error rates by gender and age group, apply a mitigation technique, and report before/after metrics including the accuracy trade-off.',
    targetRoles: ['STUDENT'],
    moduleOrder: 4,
    dueInDays: 14,
    rubric: [
      { criterion: 'Correct metric computation', weight: 40 },
      { criterion: 'Mitigation and trade-off analysis', weight: 40 },
      { criterion: 'Clarity and honesty of reporting', weight: 20 },
    ],
  },
  {
    title: 'Create a Shadow AI governance policy',
    description: 'Administrator assignment: draft an acceptable-use and discovery policy.',
    instructions:
      'Draft a Shadow AI policy covering scope, discovery, registration, acceptable use of generative AI, data handling rules, sanctioned tools, exceptions and enforcement.',
    targetRoles: ['ADMIN'],
    moduleOrder: 11,
    dueInDays: 21,
    rubric: [
      { criterion: 'Completeness of policy sections', weight: 40 },
      { criterion: 'Practicality and proportionality', weight: 35 },
      { criterion: 'Alignment with governance processes', weight: 25 },
    ],
  },
  {
    title: 'Perform an AI risk assessment',
    description: 'Executive assignment: assess an AI system and decide on oversight.',
    instructions:
      'Complete the AI risk assessment wizard for an AI system in your organisation, review the generated risk factors and controls, and write a one-page decision memo on required oversight and next steps.',
    targetRoles: ['EXECUTIVE', 'PRODUCT_DEVELOPER'],
    moduleOrder: 9,
    dueInDays: 14,
    rubric: [
      { criterion: 'Accuracy of assessment inputs', weight: 30 },
      { criterion: 'Quality of decision memo', weight: 40 },
      { criterion: 'Appropriate oversight and escalation', weight: 30 },
    ],
  },
];
