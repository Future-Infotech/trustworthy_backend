import type { LessonType } from '@prisma/client';

export interface SeedKnowledgeCheck {
  prompt: string;
  options: { id: string; text: string }[];
  correctOptionIds: string[];
  explanation: string;
}

export interface SeedLesson {
  title: string;
  type: LessonType;
  estimatedMinutes: number;
  content: string;
  codeSnippet?: string;
  codeLanguage?: string;
  knowledgeCheck?: SeedKnowledgeCheck[];
}

export interface SeedModule {
  title: string;
  summary: string;
  objectives: string[];
  estimatedMinutes: number;
  lessons: SeedLesson[];
}

const kc = (prompt: string, options: string[], correct: number[], explanation: string): SeedKnowledgeCheck => ({
  prompt,
  options: options.map((text, i) => ({ id: String.fromCharCode(97 + i), text })),
  correctOptionIds: correct.map((i) => String.fromCharCode(97 + i)),
  explanation,
});

export const COURSE = {
  title: 'Trustworthy AI-Driven Digital Transformation',
  slug: 'trustworthy-ai-driven-digital-transformation',
  summary:
    'Design, evaluate and govern AI systems that are explainable, fair, robust, privacy-preserving and accountable.',
  description: `This course equips developers, product teams, students, faculty, administrators and executives with the concepts and hands-on skills needed to deliver AI-driven digital transformation responsibly.

You will move from the foundations of Trustworthy AI through explainability (SHAP, LIME, Grad-CAM, counterfactuals), algorithmic fairness (demographic parity, equalized odds, mitigation), privacy and data governance, adversarial robustness (FGSM, PGD, adversarial training), accountability and human oversight, model documentation, risk management and governance. Practical labs use real model training and inference; the final project brings everything together in a certification submission.`,
  level: 'Intermediate',
  durationHours: 36,
};

export const MODULES: SeedModule[] = [
  {
    title: 'Introduction to Digital Transformation and Trustworthy AI',
    summary: 'Why AI-driven transformation succeeds or fails on trust, and what "trustworthy" means in practice.',
    objectives: [
      'Explain how AI changes business processes and decision-making',
      'Identify trust failures in historical AI deployments',
      'Describe the lifecycle in which trustworthiness must be engineered',
    ],
    estimatedMinutes: 90,
    lessons: [
      {
        title: 'AI as a driver of digital transformation',
        type: 'TEXT',
        estimatedMinutes: 20,
        content: `## From digitisation to intelligent operations

Digital transformation progresses through three stages:

1. **Digitisation** – converting analogue information into digital form.
2. **Digitalisation** – using digital data to improve existing processes.
3. **Transformation** – redesigning products, services and operating models around data and AI.

AI accelerates the third stage by automating perception (vision, language), prediction (risk, demand, churn) and decision support. The more consequential the decisions delegated to AI, the more the organisation depends on those systems being **reliable, fair, explainable and well-governed**.

### Why trust is the bottleneck

Most AI initiatives that fail do so not because a model cannot be trained, but because it cannot be **adopted**: users do not understand it, regulators question it, affected people contest it, or it behaves unpredictably outside the lab. Trustworthy AI is therefore a precondition for value, not a compliance afterthought.`,
      },
      {
        title: 'Lessons from AI trust failures',
        type: 'TEXT',
        estimatedMinutes: 25,
        content: `## Recurring failure patterns

Public case studies of AI failures tend to share a small number of root causes:

| Pattern | Typical root cause | Trustworthy AI pillar |
|---|---|---|
| Recruiting models that down-rank certain groups | Historical bias in training labels | Fairness |
| Risk scores nobody can explain to affected people | Opaque models, no explanation tooling | Transparency |
| Vision models fooled by small perturbations | No adversarial testing | Robustness |
| Re-identification of "anonymised" data | Weak privacy engineering | Privacy |
| Automated decisions with no route to appeal | Missing human oversight | Accountability |

The common thread is that **risk was not assessed before deployment** and **controls were not proportionate** to the impact of decisions. The rest of this course gives you the methods and tools to avoid each pattern.`,
        knowledgeCheck: [
          kc(
            'A hiring model trained on ten years of past hiring decisions systematically ranks one group lower. What is the most likely root cause?',
            ['Too few model parameters', 'Historical bias encoded in the training labels', 'An insecure API', 'Lack of GPU capacity'],
            [1],
            'Labels that reflect past human decisions can encode historical discrimination; the model learns to reproduce it.',
          ),
        ],
      },
      {
        title: 'The trustworthy AI lifecycle',
        type: 'TEXT',
        estimatedMinutes: 20,
        content: `## Trust is engineered across the lifecycle

| Stage | Key trust activities |
|---|---|
| **Problem framing** | Purpose definition, stakeholder mapping, initial risk assessment |
| **Data** | Provenance, consent, representativeness, sensitive attributes, minimisation |
| **Modelling** | Interpretable baselines, fairness constraints, robustness by design |
| **Evaluation** | Subgroup metrics, explanation review, adversarial testing |
| **Deployment** | Model card, human oversight design, approvals |
| **Operation** | Monitoring, incident response, periodic review, retirement |

Each module of this course maps to one or more of these stages.`,
      },
    ],
  },
  {
    title: 'Core Pillars of Trustworthy AI',
    summary: 'The five pillars: transparency, robustness, fairness, privacy and accountability.',
    objectives: [
      'Define each of the five pillars and their scope',
      'Relate pillars to measurable metrics and recognised standards',
      'Recognise trade-offs and interactions between pillars',
    ],
    estimatedMinutes: 100,
    lessons: [
      {
        title: 'The five pillars at a glance',
        type: 'TEXT',
        estimatedMinutes: 25,
        content: `## Five pillars

1. **Transparency & Explainability** – stakeholders can understand what the system does, why it produced an output and what its limitations are.
2. **Technical Robustness & Safety** – the system performs reliably, degrades gracefully and resists manipulation.
3. **Fairness & Non-Discrimination** – outcomes and error rates do not unjustifiably differ across groups.
4. **Privacy & Data Governance** – personal data is collected, used and retained lawfully, minimally and securely.
5. **Accountability & Oversight** – named people are responsible, decisions are traceable and humans can intervene.

These pillars align with widely referenced frameworks such as the OECD AI Principles, the EU High-Level Expert Group's *Ethics Guidelines for Trustworthy AI*, the NIST AI Risk Management Framework and ISO/IEC 42001.`,
      },
      {
        title: 'Metrics, standards and stakeholders per pillar',
        type: 'TEXT',
        estimatedMinutes: 35,
        content: `## Making pillars measurable

| Pillar | Example metrics | Reference standards | Key stakeholders |
|---|---|---|---|
| Transparency | Explanation coverage, explanation fidelity, model card completeness | ISO/IEC TR 24028, NIST AI RMF (MAP/MEASURE) | End users, reviewers, regulators |
| Robustness | Clean vs adversarial accuracy, calibration error, drift alerts | ISO/IEC 24029, NIST AI 100-2 (adversarial ML taxonomy) | Security, SRE, model owners |
| Fairness | Demographic parity difference, equalized odds difference, disparity ratio | ISO/IEC TR 24027, NIST SP 1270 | Affected groups, legal, ethics boards |
| Privacy | Re-identification risk, data minimisation ratio, retention compliance | ISO/IEC 27701, privacy-by-design principles | Data protection officers, data subjects |
| Accountability | % decisions with human review, audit trail completeness, time-to-resolve incidents | ISO/IEC 42001, NIST AI RMF (GOVERN) | Executives, governance boards |

> Metrics are indicators, not proof. A model can satisfy one fairness metric while violating another; expert judgement is always required.`,
        knowledgeCheck: [
          kc(
            'Which metrics are fairness metrics? (Select all that apply)',
            ['Demographic parity difference', 'Equalized odds difference', 'Clean accuracy', 'Disparity ratio'],
            [0, 1, 3],
            'Clean accuracy is a performance metric; the others compare outcomes or error rates across groups.',
          ),
        ],
      },
      {
        title: 'Trade-offs between pillars',
        type: 'TEXT',
        estimatedMinutes: 20,
        content: `## Pillars interact

- **Fairness vs accuracy** – enforcing demographic parity can reduce overall accuracy when base rates differ between groups.
- **Privacy vs fairness** – you cannot measure group fairness without some access to protected attributes.
- **Explainability vs robustness** – detailed explanations can help attackers craft adversarial inputs.
- **Robustness vs accuracy** – adversarial training typically lowers clean accuracy slightly in exchange for resilience.

Trustworthy AI is about making these trade-offs **explicit, documented and approved by accountable people**, not about pretending they do not exist.`,
      },
    ],
  },
  {
    title: 'Explainability and Interpretability',
    summary: 'Global and local explanations with SHAP, LIME, Grad-CAM and counterfactuals.',
    objectives: [
      'Distinguish interpretable models from post-hoc explanation methods',
      'Compute and interpret SHAP values and LIME explanations',
      'Explain image classifiers with Grad-CAM and individuals with counterfactuals',
    ],
    estimatedMinutes: 150,
    lessons: [
      {
        title: 'Interpretability vs explainability',
        type: 'TEXT',
        estimatedMinutes: 20,
        content: `## Two routes to understanding

- **Intrinsically interpretable models** (linear/logistic regression, shallow decision trees, rule lists) can be understood directly from their structure.
- **Post-hoc explanation methods** approximate the behaviour of complex models (gradient boosting, neural networks) after training.

**Global explanations** describe overall model behaviour ("income is the most influential feature"). **Local explanations** describe a single prediction ("this application was declined mainly because of a high debt-to-income ratio").

> Prefer the simplest model that meets performance requirements, especially for high-impact decisions.`,
      },
      {
        title: 'SHAP: Shapley additive explanations',
        type: 'CODE',
        estimatedMinutes: 40,
        content: `## Game theory for feature attribution

SHAP assigns each feature a contribution such that contributions sum to the difference between the model output and a baseline (the expected output):

\`f(x) = E[f(X)] + Σ φᵢ\`

- **Positive φᵢ** pushes the prediction up; **negative φᵢ** pushes it down.
- The **mean |φᵢ|** across a dataset gives global feature importance.
- **TreeExplainer** computes exact SHAP values efficiently for tree ensembles.

In the Explainability Lab you will produce summary (beeswarm), bar and individual waterfall-style explanations from your own trained model.`,
        codeLanguage: 'python',
        codeSnippet: `import shap
from sklearn.ensemble import GradientBoostingClassifier

model = GradientBoostingClassifier(random_state=42).fit(X_train, y_train)
explainer = shap.TreeExplainer(model)
shap_values = explainer.shap_values(X_test)

# Global importance: mean absolute SHAP value per feature
importance = abs(shap_values).mean(axis=0)

# Local explanation for one applicant
shap.plots.waterfall(explainer(X_test.iloc[[0]])[0])`,
        knowledgeCheck: [
          kc(
            'For a single prediction, what do the SHAP values of all features sum to?',
            ['Zero', 'The model output minus the expected (baseline) output', 'The accuracy of the model', 'One'],
            [1],
            'SHAP values are additive: baseline + sum of contributions = model output for that instance.',
          ),
        ],
      },
      {
        title: 'LIME: local surrogate explanations',
        type: 'CODE',
        estimatedMinutes: 30,
        content: `## Explaining one prediction with a simple model

LIME perturbs the instance of interest, queries the black-box model on those samples and fits a weighted linear model that is faithful **locally**. The surrogate's coefficients are the feature weights of the explanation.

Strengths: model-agnostic, intuitive. Limitations: explanations can vary between runs (fix the random seed), and the locality kernel width matters.`,
        codeLanguage: 'python',
        codeSnippet: `from lime.lime_tabular import LimeTabularExplainer

explainer = LimeTabularExplainer(
    X_train.values, feature_names=X_train.columns.tolist(),
    class_names=["declined", "approved"], mode="classification", random_state=42,
)
exp = explainer.explain_instance(X_test.values[0], model.predict_proba, num_features=8)
print(exp.as_list())`,
      },
      {
        title: 'Grad-CAM and counterfactual explanations',
        type: 'TEXT',
        estimatedMinutes: 30,
        content: `## Visual and actionable explanations

**Grad-CAM** uses the gradients of a target class flowing into the last convolutional layer of a CNN to produce a heatmap highlighting the image regions that drove the prediction. It helps detect models that rely on spurious cues (e.g. a watermark rather than the object).

**Counterfactual explanations** answer: *"What is the smallest change to the input that would change the outcome?"* – e.g. "If your debt-to-income ratio were below 0.35, the application would be approved." Good counterfactuals are **minimal, plausible and actionable**, and must never suggest changing protected attributes.`,
        knowledgeCheck: [
          kc(
            'Which property should a counterfactual explanation for a loan applicant NOT have?',
            ['Minimal change', 'Actionable features', 'Suggesting a change of gender', 'Plausible values'],
            [2],
            'Counterfactuals must not recommend changing protected or immutable attributes.',
          ),
        ],
      },
    ],
  },
  {
    title: 'Algorithmic Bias and Fairness',
    summary: 'Sources of bias, group fairness metrics and mitigation with Fairlearn.',
    objectives: [
      'Identify sources of bias across the ML lifecycle',
      'Compute demographic parity, equalized odds and disparity ratios',
      'Apply and critically evaluate mitigation techniques',
    ],
    estimatedMinutes: 150,
    lessons: [
      {
        title: 'Where bias comes from',
        type: 'TEXT',
        estimatedMinutes: 25,
        content: `## Sources of bias

- **Historical bias** – the world (and past decisions) were unfair; labels reflect that.
- **Representation bias** – some groups are under-sampled.
- **Measurement bias** – proxies measure groups differently (e.g. arrests as a proxy for crime).
- **Aggregation bias** – one model for heterogeneous populations.
- **Deployment bias** – a system used in a context it was not designed for.

Removing the protected attribute ("fairness through unawareness") rarely works: correlated **proxy variables** such as postcode or job title can reconstruct it.`,
      },
      {
        title: 'Group fairness metrics',
        type: 'CODE',
        estimatedMinutes: 45,
        content: `## Measuring fairness

For a binary classifier with prediction Ŷ, label Y and group A:

- **Selection rate**: P(Ŷ=1 | A=a)
- **Demographic parity difference**: max_a P(Ŷ=1|A=a) − min_a P(Ŷ=1|A=a)
- **Disparity ratio**: min selection rate / max selection rate (the "four-fifths rule" flags values below 0.8)
- **True positive rate (TPR)** and **false positive rate (FPR)** per group
- **Equalized odds difference**: the larger of the TPR gap and the FPR gap across groups

Different metrics encode different notions of fairness and are generally **mutually incompatible** when base rates differ. Choose metrics with stakeholders and document why.`,
        codeLanguage: 'python',
        codeSnippet: `from fairlearn.metrics import (
    MetricFrame, selection_rate, true_positive_rate, false_positive_rate,
    demographic_parity_difference, equalized_odds_difference,
)

mf = MetricFrame(
    metrics={"selection_rate": selection_rate, "tpr": true_positive_rate, "fpr": false_positive_rate},
    y_true=y_test, y_pred=y_pred, sensitive_features=A_test,
)
print(mf.by_group)
print("DPD:", demographic_parity_difference(y_test, y_pred, sensitive_features=A_test))
print("EOD:", equalized_odds_difference(y_test, y_pred, sensitive_features=A_test))`,
        knowledgeCheck: [
          kc(
            'Group A has a selection rate of 0.30 and group B 0.50. What is the disparity ratio?',
            ['0.20', '0.60', '0.80', '1.67'],
            [1],
            '0.30 / 0.50 = 0.60, which is below the 0.8 four-fifths threshold.',
          ),
        ],
      },
      {
        title: 'Mitigation and its trade-offs',
        type: 'CODE',
        estimatedMinutes: 40,
        content: `## Pre-, in- and post-processing

- **Pre-processing**: reweighing, resampling, removing proxies.
- **In-processing**: constrained optimisation such as Fairlearn's **ExponentiatedGradient** with a **DemographicParity** or **EqualizedOdds** constraint.
- **Post-processing**: group-specific thresholds (ThresholdOptimizer).

Mitigation usually **reduces disparity at some cost to accuracy**. Always report metrics **before and after** mitigation, including unfavourable results, and have accountable humans approve the trade-off.`,
        codeLanguage: 'python',
        codeSnippet: `from fairlearn.reductions import ExponentiatedGradient, DemographicParity
from sklearn.linear_model import LogisticRegression

mitigator = ExponentiatedGradient(
    LogisticRegression(max_iter=1000), constraints=DemographicParity(), eps=0.01,
)
mitigator.fit(X_train, y_train, sensitive_features=A_train)
y_pred_mitigated = mitigator.predict(X_test)`,
      },
    ],
  },
  {
    title: 'Privacy and Data Governance',
    summary: 'Lawful, minimal and secure use of data across the AI lifecycle.',
    objectives: [
      'Apply data minimisation and purpose limitation to ML datasets',
      'Describe privacy-enhancing technologies and their limits',
      'Design retention, deletion and consent processes',
    ],
    estimatedMinutes: 110,
    lessons: [
      {
        title: 'Data governance foundations',
        type: 'TEXT',
        estimatedMinutes: 30,
        content: `## Govern data before you model it

- **Provenance** – where did each dataset come from and under what terms?
- **Purpose limitation** – is this use compatible with why the data was collected?
- **Minimisation** – drop features that are not needed; aggregate where possible.
- **Quality & representativeness** – missing values, duplicates, coverage of subgroups.
- **Sensitive attributes** – identify them explicitly; restrict access, but retain the ability to audit fairness.
- **Retention & deletion** – define how long data is kept and how deletion propagates to derived artefacts.

The platform's Dataset Management module automates validation (types, missing values, duplicates) and flags sensitive columns, with values masked in previews.`,
      },
      {
        title: 'Privacy-enhancing technologies',
        type: 'TEXT',
        estimatedMinutes: 35,
        content: `## PETs and their limits

| Technique | What it protects | Limitation |
|---|---|---|
| Pseudonymisation | Direct identifiers | Re-identification via quasi-identifiers |
| k-anonymity / generalisation | Linkage attacks | Utility loss; vulnerable to homogeneity attacks |
| Differential privacy | Membership inference | Accuracy cost controlled by ε |
| Federated learning | Raw data centralisation | Gradients can still leak information |
| Encryption at rest/in transit | Storage & network exposure | Does not protect data in use |

Models themselves can leak training data (membership inference, model inversion). Treat trained models as potentially sensitive artefacts.`,
        knowledgeCheck: [
          kc(
            'True or false: removing names and IDs from a dataset guarantees individuals cannot be re-identified.',
            ['True', 'False'],
            [1],
            'Combinations of quasi-identifiers (age, postcode, gender) can often re-identify individuals.',
          ),
        ],
      },
    ],
  },
  {
    title: 'Technical Robustness and Safety',
    summary: 'Adversarial attacks (FGSM, PGD), adversarial training and safe failure.',
    objectives: [
      'Explain how gradient-based adversarial attacks work',
      'Measure clean vs adversarial accuracy and degradation',
      'Use adversarial training and other defences appropriately',
    ],
    estimatedMinutes: 150,
    lessons: [
      {
        title: 'Robustness beyond accuracy',
        type: 'TEXT',
        estimatedMinutes: 25,
        content: `## What robustness means

A robust system maintains acceptable performance under:

- **Natural distribution shift** (new populations, seasonality, sensor changes)
- **Noisy or corrupted inputs**
- **Adversarial manipulation** (deliberately crafted inputs)
- **Operational faults** (missing features, latency, dependency failures)

Safety also requires **graceful degradation**: confidence thresholds, abstention, fall-back to human review and monitoring.`,
      },
      {
        title: 'FGSM and PGD attacks',
        type: 'CODE',
        estimatedMinutes: 45,
        content: `## Gradient-based evasion attacks

**FGSM** (Fast Gradient Sign Method) perturbs an input in the direction that increases the loss, in a single step:

\`x_adv = x + ε · sign(∇ₓ L(θ, x, y))\`

**PGD** (Projected Gradient Descent) applies many smaller steps of size α and projects back into the ε-ball around x after each step. PGD is a much stronger attack and is the standard for robustness evaluation.

Report **clean accuracy**, **FGSM accuracy**, **PGD accuracy** and the **accuracy degradation** for several ε values.`,
        codeLanguage: 'python',
        codeSnippet: `import torch

def fgsm(model, x, y, eps, loss_fn):
    x = x.clone().requires_grad_(True)
    loss = loss_fn(model(x), y)
    loss.backward()
    return (x + eps * x.grad.sign()).detach()

def pgd(model, x, y, eps, alpha, steps, loss_fn):
    x_adv = x.clone()
    for _ in range(steps):
        x_adv.requires_grad_(True)
        loss = loss_fn(model(x_adv), y)
        grad, = torch.autograd.grad(loss, x_adv)
        x_adv = x_adv.detach() + alpha * grad.sign()
        x_adv = torch.min(torch.max(x_adv, x - eps), x + eps)
    return x_adv.detach()`,
        knowledgeCheck: [
          kc(
            'Why is PGD generally considered a stronger attack than FGSM?',
            [
              'It uses a larger ε',
              'It takes multiple projected gradient steps within the ε-ball',
              'It does not need gradients',
              'It modifies the model weights',
            ],
            [1],
            'PGD iterates small gradient steps and projects back into the allowed perturbation set, finding stronger adversarial examples.',
          ),
        ],
      },
      {
        title: 'Adversarial training and defences',
        type: 'TEXT',
        estimatedMinutes: 30,
        content: `## Defending models

- **Adversarial training** – train on a mix of clean and adversarial (typically PGD) examples. Improves robustness, usually with a modest drop in clean accuracy.
- **Input validation** – range checks, schema validation, anomaly detection.
- **Rate limiting & monitoring** – make query-based attacks expensive and visible.
- **Ensembles and certified defences** – stronger guarantees at higher cost.

Beware of **gradient masking**: defences that only hide gradients give a false sense of security. Always evaluate with strong, adaptive attacks.`,
      },
    ],
  },
  {
    title: 'Accountability and Human Oversight',
    summary: 'Clear responsibility, traceability and meaningful human control.',
    objectives: [
      'Design human-in-the-loop, on-the-loop and in-command oversight',
      'Avoid automation bias in reviewer workflows',
      'Build audit trails that support accountability',
    ],
    estimatedMinutes: 90,
    lessons: [
      {
        title: 'Models of human oversight',
        type: 'TEXT',
        estimatedMinutes: 30,
        content: `## Human oversight patterns

- **Human-in-the-loop (HITL)** – a human approves each decision before it takes effect.
- **Human-on-the-loop (HOTL)** – the system acts autonomously; humans monitor and can intervene.
- **Human-in-command (HIC)** – humans decide when and how the system is used at all.

Oversight is only meaningful if reviewers have **competence, time, authority and information** (including explanations) to disagree with the system. Otherwise reviewers suffer **automation bias** and rubber-stamp outputs.`,
      },
      {
        title: 'Traceability and audit trails',
        type: 'TEXT',
        estimatedMinutes: 25,
        content: `## Who did what, when, and why

An accountable AI system records: the model version and configuration used, the input data reference, the output and explanation, the human decision (accept / override / escalate) with rationale, and every governance action (approvals, policy changes, role changes).

On this platform audit logs are **append-only**: the database rejects updates and deletions, and the user interface offers no way to modify them.`,
        knowledgeCheck: [
          kc(
            'Which conditions make human oversight meaningful? (Select all that apply)',
            ['Reviewer competence', 'Authority to override', 'Access to explanations', 'A 100% approval target'],
            [0, 1, 2],
            'Approval targets encourage rubber-stamping; the other conditions enable genuine oversight.',
          ),
        ],
      },
    ],
  },
  {
    title: 'Model Cards',
    summary: 'Structured, honest documentation of models for every stakeholder.',
    objectives: ['Describe the purpose and sections of a model card', 'Write intended and out-of-scope uses', 'Report subgroup and fairness metrics transparently'],
    estimatedMinutes: 80,
    lessons: [
      {
        title: 'Anatomy of a model card',
        type: 'TEXT',
        estimatedMinutes: 30,
        content: `## Model cards (Mitchell et al., 2019)

A model card documents: model details (developer, version, architecture, licence), **intended use** and **out-of-scope use**, training and evaluation data, performance metrics overall and **per subgroup**, fairness metrics and thresholds, mitigation applied, privacy and security mechanisms, human oversight, known limitations, ethical considerations and deployment requirements.

### Example – Trustworthy Loan Risk Evaluator

- **Architecture:** Gradient Boosted Decision Tree / LightGBM
- **Intended use:** Small-business credit risk assessment supporting loan officers
- **Out-of-scope:** Automated rejection without human review`,
      },
      {
        title: 'Writing honest limitations',
        type: 'EXERCISE',
        estimatedMinutes: 30,
        content: `## Exercise

Draft the *Known limitations* and *Ethical considerations* sections for a model you have trained in the labs. Include:

1. Populations or contexts where performance was not evaluated.
2. Subgroups with materially worse error rates.
3. Fairness metric(s) that were not met, and why the residual risk was accepted (or not).
4. Conditions under which the model must not be used.

Unfavourable results must be reported, not omitted.`,
      },
    ],
  },
  {
    title: 'AI Risk Management',
    summary: 'Identify, score and treat AI risks with proportionate controls.',
    objectives: ['Apply a structured AI risk assessment', 'Map risk levels to controls and oversight', 'Maintain a living AI risk register'],
    estimatedMinutes: 100,
    lessons: [
      {
        title: 'Structured AI risk assessment',
        type: 'TEXT',
        estimatedMinutes: 35,
        content: `## Assessing risk

The platform's risk assessment uses explicit, versioned scoring rules covering: application domain, affected people and scale, data sensitivity, decision impact, automation level, human oversight, fairness, privacy and security exposure, and explainability gaps. Escalation rules set minimum levels – for example, fully automated life-changing decisions are always **CRITICAL**.

| Level | Score | Typical oversight |
|---|---|---|
| LOW | 0–24 | Periodic owner review |
| MEDIUM | 25–49 | Human-on-the-loop with escalation |
| HIGH | 50–74 | Human-in-the-loop for adverse decisions |
| CRITICAL | 75–100 | Mandatory human approval; board sign-off |

The output lists **potential compliance considerations** for human and legal review – it never certifies compliance.`,
      },
      {
        title: 'The AI risk register',
        type: 'TEXT',
        estimatedMinutes: 25,
        content: `## Living risk management

A risk register records each risk with likelihood (1–5), impact (1–5), inherent score, mitigation, residual score, owner and review date. It is reviewed on a schedule and whenever incidents occur, models change or new regulations apply. Frameworks such as the NIST AI RMF (Govern, Map, Measure, Manage) and ISO/IEC 23894 provide structure for these processes.`,
        knowledgeCheck: [
          kc(
            'A risk has likelihood 4 and impact 5. Using likelihood × impact, what is its inherent score?',
            ['9', '20', '1', '45'],
            [1],
            '4 × 5 = 20 out of a maximum of 25.',
          ),
        ],
      },
    ],
  },
  {
    title: 'Practical Trustworthy AI Labs',
    summary: 'Hands-on explainability, fairness and robustness experiments on real models.',
    objectives: ['Train and evaluate models reproducibly', 'Run SHAP/LIME, fairness audits and FGSM/PGD tests', 'Interpret and report experiment results'],
    estimatedMinutes: 240,
    lessons: [
      {
        title: 'How the labs work',
        type: 'TEXT',
        estimatedMinutes: 20,
        content: `## Reproducible, sandboxed experiments

Every lab run is an **experiment** with an ID, dataset, algorithm, parameters and random seed, so it can be reproduced exactly. Experiments execute in an isolated ML worker with CPU, memory and time limits; uploaded code is never executed.

- **Explainability Lab** – train a model, inspect metrics, SHAP global/local explanations and LIME explanations.
- **Fairness Audit Lab** – choose a protected attribute, compare group metrics before and after ExponentiatedGradient mitigation.
- **Adversarial Robustness Lab** – run FGSM/PGD, compare a normal and an adversarially trained model.

> Lab results are educational analyses. They are not proof of regulatory compliance.`,
      },
      {
        title: 'Lab walkthrough: the loan approval dataset',
        type: 'EXERCISE',
        estimatedMinutes: 40,
        content: `## Exercise

The demo **Loan Applications (synthetic)** dataset contains 1,000 synthetic applicants with a historical \`approved\` label. The generator deliberately encodes historical bias so that you can detect and mitigate it.

1. Open the dataset and review its profile, missing values and sensitive columns.
2. In the Explainability Lab, train a Gradient Boosting model to predict \`approved\` and review SHAP importances. Do any proxies for protected attributes appear?
3. In the Fairness Audit Lab, audit by \`gender\` and \`age_group\`. Record demographic parity difference and equalized odds difference before and after mitigation, together with the accuracy change.`,
      },
    ],
  },
  {
    title: 'AI Governance',
    summary: 'Policies, inventories, approvals, incidents and Shadow AI.',
    objectives: ['Establish AI governance structures and policies', 'Maintain AI system and model inventories', 'Manage Shadow AI, vendors and incidents'],
    estimatedMinutes: 110,
    lessons: [
      {
        title: 'Governance operating model',
        type: 'TEXT',
        estimatedMinutes: 30,
        content: `## Structures and artefacts

- **Roles**: executive sponsor, AI governance board, model owners, independent reviewers, legal/privacy.
- **Policies**: responsible AI policy, acceptable use (including generative AI), model risk management standard, incident response procedure.
- **Inventories**: every AI system and model, its owner, purpose, risk level and lifecycle stage.
- **Workflows**: risk assessment → impact assessment → approval → deployment → periodic review → retirement.
- **Evidence**: model cards, experiment reports, approvals and audit logs.`,
      },
      {
        title: 'Shadow AI, vendors and incidents',
        type: 'TEXT',
        estimatedMinutes: 30,
        content: `## Managing what you did not build

**Shadow AI** is AI usage that bypasses governance – for example staff pasting customer data into public generative AI tools. Respond with discovery (surveys, network telemetry), a register, a clear acceptable-use policy and sanctioned alternatives rather than blanket bans.

**Vendor AI assessment** covers data use, model documentation, evaluation evidence, security, contractual rights to audit and incident notification.

**AI incidents** (harmful outputs, discriminatory outcomes, security breaches) need severity classification, owners, root-cause analysis and corrective actions, all logged.`,
        knowledgeCheck: [
          kc(
            'What is generally the most effective first response to discovering widespread Shadow AI usage?',
            ['Ignore it', 'Dismiss the staff involved', 'Register usage, publish an acceptable-use policy and offer sanctioned alternatives', 'Block the internet'],
            [2],
            'Discovery, clear policy and sanctioned tools reduce risk while preserving productivity.',
          ),
        ],
      },
    ],
  },
  {
    title: 'Final Certification Project',
    summary: 'Apply every pillar to an end-to-end Trustworthy AI case study.',
    objectives: ['Deliver an evidence-based trustworthiness assessment', 'Communicate results to technical and executive audiences'],
    estimatedMinutes: 300,
    lessons: [
      {
        title: 'Project brief',
        type: 'EXERCISE',
        estimatedMinutes: 60,
        content: `## Brief

Select a dataset and use case (or use the demo loan dataset) and deliver:

1. A risk assessment and, if HIGH or above, an Algorithmic Impact Assessment.
2. A trained model with reproducible experiment IDs.
3. SHAP and LIME explanations with your interpretation.
4. A fairness audit before and after mitigation, with the trade-off discussed.
5. A robustness evaluation (FGSM and PGD) and, where relevant, adversarial training.
6. A complete model card, including limitations and ethical considerations.
7. A two-page executive summary with a deployment recommendation.

Submissions are reviewed and approved by faculty before a certificate is issued.`,
      },
    ],
  },
];
