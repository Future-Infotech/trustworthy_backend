import type { Request, Response } from 'express';
import { sendFile } from '../utils/sendFile';
import { authContext } from '../middleware/authorize';
import { datasetService } from '../services/dataset.service';
import { experimentService } from '../services/experiments/experiment.service';
import { modelService } from '../services/model.service';
import type { ListDatasetsQuery, ListModelsQuery } from '../validators/asset.validators';
import type { ListExperimentsQuery } from '../validators/experiment.validators';

export const datasetController = {
  list: async (req: Request, res: Response) => res.json(await datasetService.list(authContext(req), req.query as unknown as ListDatasetsQuery)),
  get: async (req: Request, res: Response) => res.json(await datasetService.get(authContext(req), req.params.id)),
  upload: async (req: Request, res: Response) => res.status(201).json(await datasetService.upload(authContext(req), req.file, req.body)),
  update: async (req: Request, res: Response) => res.json(await datasetService.update(authContext(req), req.params.id, req.body)),
  preview: async (req: Request, res: Response) =>
    res.json(await datasetService.preview(authContext(req), req.params.id, req.query as unknown as { limit: number; offset: number })),
  download: async (req: Request, res: Response) => {
    const { body, fileName } = await datasetService.download(authContext(req), req.params.id);
    sendFile(res, body, fileName, 'text/csv; charset=utf-8');
  },
  analyze: async (req: Request, res: Response) => res.status(202).json(await datasetService.analyze(authContext(req), req.params.id)),
  remove: async (req: Request, res: Response) => {
    await datasetService.remove(authContext(req), req.params.id, req.body.reason);
    res.status(204).end();
  },
};

export const modelController = {
  list: async (req: Request, res: Response) => res.json(await modelService.list(authContext(req), req.query as unknown as ListModelsQuery)),
  get: async (req: Request, res: Response) => res.json(await modelService.get(authContext(req), req.params.id)),
  create: async (req: Request, res: Response) => res.status(201).json(await modelService.create(authContext(req), req.body)),
  update: async (req: Request, res: Response) => res.json(await modelService.update(authContext(req), req.params.id, req.body)),
  transition: async (req: Request, res: Response) => res.json(await modelService.transition(authContext(req), req.params.id, req.body)),
  createVersion: async (req: Request, res: Response) => res.status(201).json(await modelService.createVersion(authContext(req), req.params.id, req.body, req.file)),
  getVersion: async (req: Request, res: Response) => res.json(await modelService.getVersion(req.params.id)),
  downloadArtifact: async (req: Request, res: Response) => {
    const { body, fileName } = await modelService.downloadArtifact(authContext(req), req.params.id);
    sendFile(res, body, fileName, 'application/octet-stream');
  },
};

export const experimentController = {
  list: async (req: Request, res: Response) => res.json(await experimentService.list(authContext(req), req.query as unknown as ListExperimentsQuery)),
  get: async (req: Request, res: Response) => res.json(await experimentService.get(authContext(req), req.params.id)),
  create: async (req: Request, res: Response) => res.status(202).json(await experimentService.create(authContext(req), req.body)),
  cancel: async (req: Request, res: Response) => {
    await experimentService.cancel(authContext(req), req.params.id);
    res.status(204).end();
  },
  rerun: async (req: Request, res: Response) => res.status(202).json(await experimentService.rerun(authContext(req), req.params.id)),
  algorithms: async (_req: Request, res: Response) => res.json({ algorithms: await experimentService.algorithms() }),
  sources: async (req: Request, res: Response) => res.json(await experimentService.sources(authContext(req))),
};
