import { Router } from 'express';
import { governanceController as c } from '../controllers/governance.controller';
import { authenticate } from '../middleware/authenticate';
import { requireAnyPermission, requirePermission } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { PERMISSIONS as P } from '../rbac/permissions';
import { asyncHandler as h } from '../utils/asyncHandler';
import { idParam, reasonSchema } from '../validators/common.validators';
import {
  approvePolicySchema,
  completeReviewSchema,
  createAiSystemSchema,
  createOversightSchema,
  createPolicySchema,
  createReviewSchema,
  createRiskEntrySchema,
  createVendorSchema,
  decideVendorSchema,
  listAiSystemsQuery,
  listComplianceQuery,
  listIncidentsQuery,
  listOversightQuery,
  listPoliciesQuery,
  listReviewsQuery,
  listRiskEntriesQuery,
  listVendorsQuery,
  rejectPolicySchema,
  reportIncidentSchema,
  resolveShadowSchema,
  updateAiSystemSchema,
  updateComplianceSchema,
  updateIncidentSchema,
  updatePolicySchema,
  updateRiskEntrySchema,
  updateVendorSchema,
} from '../validators/governance.validators';

const id = validate(idParam, 'params');
const read = requirePermission(P.GOVERNANCE_READ);
const manage = requirePermission(P.GOVERNANCE_MANAGE);
const q = (schema: Parameters<typeof validate>[0]) => validate(schema, 'query');

export const governanceRouter = Router();
governanceRouter.use(authenticate);

governanceRouter.get('/overview', read, h(c.overview));
governanceRouter.get('/approvals', read, h(c.approvals));

const systems = requirePermission(P.AI_SYSTEMS_MANAGE);
governanceRouter.get('/ai-systems', read, q(listAiSystemsQuery), h(c.listSystems));
governanceRouter.post('/ai-systems', systems, validate(createAiSystemSchema), h(c.createSystem));
governanceRouter.get('/ai-systems/:id', read, id, h(c.getSystem));
governanceRouter.patch('/ai-systems/:id', systems, id, validate(updateAiSystemSchema), h(c.updateSystem));
governanceRouter.post('/ai-systems/:id/resolve-shadow', systems, id, validate(resolveShadowSchema), h(c.resolveShadow));
governanceRouter.get('/ai-systems/:id/history', read, id, h(c.systemHistory));

const policies = requirePermission(P.POLICIES_MANAGE);
governanceRouter.get('/policies', read, q(listPoliciesQuery), h(c.listPolicies));
governanceRouter.post('/policies', policies, validate(createPolicySchema), h(c.createPolicy));
governanceRouter.get('/policies/:id', read, id, h(c.getPolicy));
governanceRouter.patch('/policies/:id', policies, id, validate(updatePolicySchema), h(c.updatePolicy));
governanceRouter.post('/policies/:id/submit', policies, id, h(c.submitPolicy));
governanceRouter.post('/policies/:id/approve', policies, id, validate(approvePolicySchema), h(c.approvePolicy));
governanceRouter.post('/policies/:id/reject', policies, id, validate(rejectPolicySchema), h(c.rejectPolicy));
governanceRouter.post('/policies/:id/revise', policies, id, validate(reasonSchema), h(c.revisePolicy));
governanceRouter.post('/policies/:id/retire', policies, id, validate(reasonSchema), h(c.retirePolicy));
governanceRouter.get('/policies/:id/history', read, id, h(c.policyHistory));

const incidentReaders = requireAnyPermission(P.GOVERNANCE_READ, P.INCIDENTS_REPORT, P.INCIDENTS_MANAGE);
governanceRouter.get('/incidents', incidentReaders, q(listIncidentsQuery), h(c.listIncidents));
governanceRouter.post('/incidents', requirePermission(P.INCIDENTS_REPORT), validate(reportIncidentSchema), h(c.reportIncident));
governanceRouter.get('/incidents/:id', incidentReaders, id, h(c.getIncident));
governanceRouter.patch('/incidents/:id', requirePermission(P.INCIDENTS_MANAGE), id, validate(updateIncidentSchema), h(c.updateIncident));
governanceRouter.get('/incidents/:id/history', incidentReaders, id, h(c.incidentHistory));

governanceRouter.get('/risks', read, q(listRiskEntriesQuery), h(c.listRisks));
governanceRouter.post('/risks', manage, validate(createRiskEntrySchema), h(c.createRisk));
governanceRouter.patch('/risks/:id', manage, id, validate(updateRiskEntrySchema), h(c.updateRisk));

governanceRouter.get('/compliance', read, q(listComplianceQuery), h(c.listCompliance));
governanceRouter.patch('/compliance/:id', requirePermission(P.COMPLIANCE_MANAGE), id, validate(updateComplianceSchema), h(c.updateCompliance));

governanceRouter.get('/vendors', read, q(listVendorsQuery), h(c.listVendors));
governanceRouter.post('/vendors', manage, validate(createVendorSchema), h(c.createVendor));
governanceRouter.patch('/vendors/:id', manage, id, validate(updateVendorSchema), h(c.updateVendor));
governanceRouter.post('/vendors/:id/decision', manage, id, validate(decideVendorSchema), h(c.decideVendor));

governanceRouter.get('/oversight', read, q(listOversightQuery), h(c.listOversight));
governanceRouter.post('/oversight', requireAnyPermission(P.GOVERNANCE_MANAGE, P.RISK_REVIEW), validate(createOversightSchema), h(c.createOversight));

governanceRouter.get('/reviews', read, q(listReviewsQuery), h(c.listReviews));
governanceRouter.post('/reviews', manage, validate(createReviewSchema), h(c.createReview));
governanceRouter.post('/reviews/:id/complete', manage, id, validate(completeReviewSchema), h(c.completeReview));
