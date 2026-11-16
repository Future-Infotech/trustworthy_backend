import type { Request, Response } from 'express';
import { authContext } from '../middleware/authorize';
import { incidentService } from '../services/governance/incident.service';
import { inventoryService } from '../services/governance/inventory.service';
import { governanceOverviewService } from '../services/governance/overview.service';
import { policyService } from '../services/governance/policy.service';
import { complianceService, oversightService, reviewScheduleService, riskRegisterService, vendorService } from '../services/governance/registers.service';

/* eslint-disable @typescript-eslint/no-explicit-any -- query objects are validated and coerced by the route's zod schema */
const query = (req: Request) => req.query as any;

export const governanceController = {
  overview: async (_req: Request, res: Response) => res.json(await governanceOverviewService.overview()),
  approvals: async (req: Request, res: Response) => res.json(await governanceOverviewService.approvals(authContext(req))),

  listSystems: async (req: Request, res: Response) => res.json(await inventoryService.list(query(req))),
  getSystem: async (req: Request, res: Response) => res.json(await inventoryService.get(req.params.id)),
  createSystem: async (req: Request, res: Response) => res.status(201).json(await inventoryService.create(authContext(req), req.body)),
  updateSystem: async (req: Request, res: Response) => res.json(await inventoryService.update(authContext(req), req.params.id, req.body)),
  resolveShadow: async (req: Request, res: Response) => res.json(await inventoryService.resolveShadow(authContext(req), req.params.id, req.body)),
  systemHistory: async (req: Request, res: Response) => res.json(await inventoryService.history(req.params.id)),

  listPolicies: async (req: Request, res: Response) => res.json(await policyService.list(query(req))),
  getPolicy: async (req: Request, res: Response) => res.json(await policyService.get(authContext(req), req.params.id)),
  createPolicy: async (req: Request, res: Response) => res.status(201).json(await policyService.create(authContext(req), req.body)),
  updatePolicy: async (req: Request, res: Response) => res.json(await policyService.update(authContext(req), req.params.id, req.body)),
  submitPolicy: async (req: Request, res: Response) => res.json(await policyService.submit(authContext(req), req.params.id)),
  approvePolicy: async (req: Request, res: Response) => res.json(await policyService.approve(authContext(req), req.params.id, req.body)),
  rejectPolicy: async (req: Request, res: Response) => res.json(await policyService.reject(authContext(req), req.params.id, req.body.comment)),
  revisePolicy: async (req: Request, res: Response) => res.json(await policyService.revise(authContext(req), req.params.id, req.body.reason)),
  retirePolicy: async (req: Request, res: Response) => res.json(await policyService.retire(authContext(req), req.params.id, req.body.reason)),
  policyHistory: async (req: Request, res: Response) => res.json(await policyService.history(req.params.id)),

  listIncidents: async (req: Request, res: Response) => res.json(await incidentService.list(authContext(req), query(req))),
  getIncident: async (req: Request, res: Response) => res.json(await incidentService.get(authContext(req), req.params.id)),
  reportIncident: async (req: Request, res: Response) => res.status(201).json(await incidentService.report(authContext(req), req.body)),
  updateIncident: async (req: Request, res: Response) => res.json(await incidentService.update(authContext(req), req.params.id, req.body)),
  incidentHistory: async (req: Request, res: Response) => res.json(await incidentService.history(authContext(req), req.params.id)),

  listRisks: async (req: Request, res: Response) => res.json(await riskRegisterService.list(query(req))),
  createRisk: async (req: Request, res: Response) => res.status(201).json(await riskRegisterService.create(authContext(req), req.body)),
  updateRisk: async (req: Request, res: Response) => res.json(await riskRegisterService.update(authContext(req), req.params.id, req.body)),

  listCompliance: async (req: Request, res: Response) => res.json(await complianceService.list(query(req))),
  updateCompliance: async (req: Request, res: Response) => res.json(await complianceService.update(authContext(req), req.params.id, req.body)),

  listVendors: async (req: Request, res: Response) => res.json(await vendorService.list(query(req))),
  createVendor: async (req: Request, res: Response) => res.status(201).json(await vendorService.create(authContext(req), req.body)),
  updateVendor: async (req: Request, res: Response) => res.json(await vendorService.update(authContext(req), req.params.id, req.body)),
  decideVendor: async (req: Request, res: Response) => res.json(await vendorService.decide(authContext(req), req.params.id, req.body)),

  listOversight: async (req: Request, res: Response) => res.json(await oversightService.list(query(req))),
  createOversight: async (req: Request, res: Response) => res.status(201).json(await oversightService.create(authContext(req), req.body)),

  listReviews: async (req: Request, res: Response) => res.json(await reviewScheduleService.list(query(req))),
  createReview: async (req: Request, res: Response) => res.status(201).json(await reviewScheduleService.create(authContext(req), req.body)),
  completeReview: async (req: Request, res: Response) => res.json(await reviewScheduleService.complete(authContext(req), req.params.id, req.body.notes)),
};
