import type { ReviewStatus } from '@prisma/client';
import type { AuthContext } from '../../middleware/authorize';
import { Errors } from '../../utils/errors';
import type { ReviewDecisionInput } from '../../validators/assessment.validators';
import { auditService } from '../audit.service';

/**
 * Review workflow shared by risk assessments and algorithmic impact assessments:
 *
 *   DRAFT ─submit→ SUBMITTED ─start review→ UNDER_REVIEW ─decide→ APPROVED | REJECTED | CHANGES_REQUESTED
 *   CHANGES_REQUESTED ─submit→ SUBMITTED;  SUBMITTED ─withdraw→ DRAFT;  APPROVED | REJECTED ─retire→ RETIRED
 *
 * Reviewers can never act on work they own (segregation of duties).
 */
export const EDITABLE: ReviewStatus[] = ['DRAFT', 'CHANGES_REQUESTED'];

export const DECISION_STATUS: Record<ReviewDecisionInput['decision'], ReviewStatus> = {
  APPROVE: 'APPROVED',
  REJECT: 'REJECTED',
  REQUEST_CHANGES: 'CHANGES_REQUESTED',
};

const label = (s: ReviewStatus) => s.toLowerCase().replace(/_/g, ' ');

export function requireStatus(current: ReviewStatus, allowed: ReviewStatus[], noun: string, action: string) {
  if (!allowed.includes(current)) throw Errors.conflict(`A ${noun} that is ${label(current)} cannot be ${action}`);
}

export function requireOwner(ownerId: string, auth: AuthContext, noun: string, action: string) {
  if (ownerId !== auth.actor.id) throw Errors.forbidden(`Only the ${noun} owner can ${action}`);
}

/** Blocks and audits a reviewer acting on their own submission. */
export async function requireIndependentReviewer(ownerId: string, auth: AuthContext, resource: string, resourceId: string, noun: string) {
  if (ownerId !== auth.actor.id) return;
  await auditService.record({
    action: `${resource}.review_blocked`,
    resource,
    resourceId,
    actor: auth.actor,
    context: auth.ctx,
    result: 'DENIED',
    severity: 'MEDIUM',
    reason: 'Segregation of duties',
  });
  throw Errors.forbidden(`Segregation of duties: you cannot review your own ${noun}`);
}

export function workflowPermissions(status: ReviewStatus, own: boolean, reviewer: boolean, everSubmitted: boolean) {
  return {
    edit: own && EDITABLE.includes(status),
    submit: own && EDITABLE.includes(status),
    withdraw: own && status === 'SUBMITTED',
    startReview: reviewer && !own && status === 'SUBMITTED',
    review: reviewer && !own && status === 'UNDER_REVIEW',
    retire: reviewer && (status === 'APPROVED' || status === 'REJECTED'),
    delete: own && status === 'DRAFT' && !everSubmitted,
  };
}
