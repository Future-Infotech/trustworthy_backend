import type { RoleName } from '@prisma/client';

/**
 * Permission catalogue. Keys use the `resource:action` convention.
 * This file is the source of truth: `prisma/seed.ts` synchronises it into the
 * roles / permissions / role_permissions tables.
 */
export const PERMISSIONS = {
  // Platform administration
  USERS_READ: 'users:read',
  USERS_MANAGE: 'users:manage',
  ROLES_READ: 'roles:read',
  ROLES_MANAGE: 'roles:manage',
  SETTINGS_READ: 'settings:read',
  SETTINGS_MANAGE: 'settings:manage',
  AUDIT_LOGS_READ: 'audit-logs:read',
  AUDIT_LOGS_EXPORT: 'audit-logs:export',

  // Analytics
  ANALYTICS_ADMIN: 'analytics:admin',
  ANALYTICS_EXECUTIVE: 'analytics:executive',
  ANALYTICS_LEARNING: 'analytics:learning',

  // Learning
  COURSES_READ: 'courses:read',
  COURSES_MANAGE: 'courses:manage',
  PROGRESS_TRACK: 'progress:track',
  LABS_RUN: 'labs:run',
  LABS_MANAGE: 'labs:manage',
  ASSIGNMENTS_SUBMIT: 'assignments:submit',
  ASSIGNMENTS_MANAGE: 'assignments:manage',
  ASSIGNMENTS_GRADE: 'assignments:grade',
  QUIZZES_TAKE: 'quizzes:take',
  QUIZZES_MANAGE: 'quizzes:manage',
  CERTIFICATES_READ_OWN: 'certificates:read-own',
  CERTIFICATES_MANAGE: 'certificates:manage',

  // Data & models
  DATASETS_READ: 'datasets:read',
  DATASETS_UPLOAD: 'datasets:upload',
  DATASETS_MANAGE: 'datasets:manage',
  MODELS_READ: 'models:read',
  MODELS_UPLOAD: 'models:upload',
  MODELS_MANAGE: 'models:manage',
  EXPERIMENTS_RUN: 'experiments:run',
  EXPERIMENTS_READ_ALL: 'experiments:read-all',

  // Trustworthy AI labs
  XAI_RUN: 'xai:run',
  FAIRNESS_RUN: 'fairness:run',
  ROBUSTNESS_RUN: 'robustness:run',

  // Documentation & assessment
  MODEL_CARDS_READ: 'model-cards:read',
  MODEL_CARDS_MANAGE: 'model-cards:manage',
  MODEL_CARDS_PUBLISH: 'model-cards:publish',
  RISK_READ: 'risk:read',
  RISK_ASSESS: 'risk:assess',
  RISK_REVIEW: 'risk:review',
  AIA_READ: 'aia:read',
  AIA_MANAGE: 'aia:manage',
  AIA_APPROVE: 'aia:approve',
  REPORTS_GENERATE: 'reports:generate',

  // Governance
  GOVERNANCE_READ: 'governance:read',
  GOVERNANCE_MANAGE: 'governance:manage',
  POLICIES_MANAGE: 'policies:manage',
  AI_SYSTEMS_MANAGE: 'ai-systems:manage',
  INCIDENTS_REPORT: 'incidents:report',
  INCIDENTS_MANAGE: 'incidents:manage',
  COMPLIANCE_MANAGE: 'compliance:manage',

  // Personal
  NOTIFICATIONS_READ: 'notifications:read',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

const P = PERMISSIONS;

/** Capabilities shared by every learner-facing role. */
const LEARNER: Permission[] = [
  P.COURSES_READ,
  P.PROGRESS_TRACK,
  P.LABS_RUN,
  P.ASSIGNMENTS_SUBMIT,
  P.QUIZZES_TAKE,
  P.CERTIFICATES_READ_OWN,
  P.NOTIFICATIONS_READ,
];

export const ROLE_PERMISSIONS: Record<RoleName, Permission[]> = {
  SUPER_ADMIN: ALL_PERMISSIONS,

  ADMIN: [
    P.USERS_READ,
    P.USERS_MANAGE,
    P.ROLES_READ,
    P.SETTINGS_READ,
    P.SETTINGS_MANAGE,
    P.AUDIT_LOGS_READ,
    P.AUDIT_LOGS_EXPORT,
    P.ANALYTICS_ADMIN,
    P.ANALYTICS_EXECUTIVE,
    P.ANALYTICS_LEARNING,
    P.COURSES_READ,
    P.ASSIGNMENTS_SUBMIT,
    P.ASSIGNMENTS_MANAGE,
    P.CERTIFICATES_MANAGE,
    P.DATASETS_READ,
    P.DATASETS_MANAGE,
    P.MODELS_READ,
    P.MODELS_MANAGE,
    P.EXPERIMENTS_READ_ALL,
    P.MODEL_CARDS_READ,
    P.MODEL_CARDS_PUBLISH,
    P.RISK_READ,
    P.RISK_REVIEW,
    P.AIA_READ,
    P.AIA_APPROVE,
    P.REPORTS_GENERATE,
    P.GOVERNANCE_READ,
    P.GOVERNANCE_MANAGE,
    P.POLICIES_MANAGE,
    P.AI_SYSTEMS_MANAGE,
    P.INCIDENTS_REPORT,
    P.INCIDENTS_MANAGE,
    P.COMPLIANCE_MANAGE,
    P.NOTIFICATIONS_READ,
  ],

  FACULTY: [
    ...LEARNER,
    P.COURSES_MANAGE,
    P.LABS_MANAGE,
    P.ASSIGNMENTS_MANAGE,
    P.ASSIGNMENTS_GRADE,
    P.QUIZZES_MANAGE,
    P.CERTIFICATES_MANAGE,
    P.ANALYTICS_LEARNING,
    P.DATASETS_READ,
    P.DATASETS_UPLOAD,
    P.DATASETS_MANAGE,
    P.MODELS_READ,
    P.EXPERIMENTS_RUN,
    P.EXPERIMENTS_READ_ALL,
    P.XAI_RUN,
    P.FAIRNESS_RUN,
    P.ROBUSTNESS_RUN,
    P.MODEL_CARDS_READ,
    P.REPORTS_GENERATE,
  ],

  STUDENT: [
    ...LEARNER,
    P.DATASETS_READ,
    P.EXPERIMENTS_RUN,
    P.XAI_RUN,
    P.FAIRNESS_RUN,
    P.ROBUSTNESS_RUN,
    P.MODEL_CARDS_READ,
  ],

  DEVELOPER: [
    ...LEARNER,
    P.DATASETS_READ,
    P.DATASETS_UPLOAD,
    P.MODELS_READ,
    P.MODELS_UPLOAD,
    P.EXPERIMENTS_RUN,
    P.XAI_RUN,
    P.FAIRNESS_RUN,
    P.ROBUSTNESS_RUN,
    P.MODEL_CARDS_READ,
    P.MODEL_CARDS_MANAGE,
    P.REPORTS_GENERATE,
    P.GOVERNANCE_READ,
    P.INCIDENTS_REPORT,
  ],

  PRODUCT_DEVELOPER: [
    ...LEARNER,
    P.DATASETS_READ,
    P.MODELS_READ,
    P.EXPERIMENTS_RUN,
    P.XAI_RUN,
    P.FAIRNESS_RUN,
    P.ROBUSTNESS_RUN,
    P.MODEL_CARDS_READ,
    P.RISK_READ,
    P.RISK_ASSESS,
    P.AIA_READ,
    P.AIA_MANAGE,
    P.REPORTS_GENERATE,
    P.GOVERNANCE_READ,
    P.INCIDENTS_REPORT,
  ],

  EXECUTIVE: [
    ...LEARNER,
    P.ANALYTICS_EXECUTIVE,
    P.MODELS_READ,
    P.MODEL_CARDS_READ,
    P.RISK_READ,
    P.RISK_ASSESS,
    P.AIA_READ,
    P.REPORTS_GENERATE,
    P.GOVERNANCE_READ,
  ],
};

export const ROLE_METADATA: Record<RoleName, { displayName: string; description: string }> = {
  SUPER_ADMIN: { displayName: 'Super Administrator', description: 'Unrestricted platform access.' },
  ADMIN: {
    displayName: 'Administrator',
    description: 'Manages users, governance policies, compliance requirements, AI systems and audit logs.',
  },
  FACULTY: {
    displayName: 'Faculty',
    description: 'Creates courses, labs and assignments; reviews submissions and evaluates projects.',
  },
  STUDENT: {
    displayName: 'Student',
    description: 'Learns the course content, runs labs, submits assignments and earns certificates.',
  },
  DEVELOPER: {
    displayName: 'Developer',
    description: 'Runs XAI, fairness and robustness experiments; uploads models and authors model cards.',
  },
  PRODUCT_DEVELOPER: {
    displayName: 'Product Developer',
    description: 'Performs model risk and impact assessments; reviews explainability, fairness and robustness.',
  },
  EXECUTIVE: {
    displayName: 'Executive',
    description: 'Oversees organisational AI risk, compliance posture and the model inventory.',
  },
};

/**
 * Role hierarchy used to prevent privilege escalation when assigning roles.
 * A user may only assign roles whose rank is strictly lower than their own,
 * except SUPER_ADMIN who may assign any role.
 */
export const ROLE_RANK: Record<RoleName, number> = {
  SUPER_ADMIN: 100,
  ADMIN: 80,
  EXECUTIVE: 50,
  FACULTY: 50,
  PRODUCT_DEVELOPER: 40,
  DEVELOPER: 40,
  STUDENT: 10,
};

export function canAssignRole(actorRole: RoleName, targetRole: RoleName): boolean {
  if (actorRole === 'SUPER_ADMIN') return true;
  return ROLE_RANK[targetRole] < ROLE_RANK[actorRole];
}

/** Roles that may ever be chosen during public self-registration. */
export const SELF_REGISTRATION_ELIGIBLE_ROLES: RoleName[] = ['STUDENT', 'DEVELOPER', 'PRODUCT_DEVELOPER'];

export function describePermission(key: Permission): { resource: string; action: string } {
  const [resource, action] = key.split(':');
  return { resource, action };
}
