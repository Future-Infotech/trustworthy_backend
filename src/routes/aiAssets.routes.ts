import { Router } from 'express';
import { datasetController as d, experimentController as e, modelController as m } from '../controllers/aiAssets.controller';
import { authenticate } from '../middleware/authenticate';
import { requireAnyPermission, requirePermission } from '../middleware/authorize';
import { singleFileUpload } from '../middleware/upload';
import { validate } from '../middleware/validate';
import { PERMISSIONS as P } from '../rbac/permissions';
import { asyncHandler as h } from '../utils/asyncHandler';
import {
  createModelSchema,
  createVersionSchema,
  lifecycleSchema,
  listDatasetsQuery,
  listModelsQuery,
  previewQuery,
  reasonSchema,
  updateDatasetSchema,
  updateModelSchema,
  uploadDatasetSchema,
} from '../validators/asset.validators';
import { idParam } from '../validators/common.validators';
import { createExperimentSchema, listExperimentsQuery } from '../validators/experiment.validators';

const id = validate(idParam, 'params');

export const datasetRouter = Router();
const editDatasets = requireAnyPermission(P.DATASETS_UPLOAD, P.DATASETS_MANAGE);
datasetRouter.use(authenticate, requirePermission(P.DATASETS_READ));
datasetRouter.get('/', validate(listDatasetsQuery, 'query'), h(d.list));
datasetRouter.post('/', requirePermission(P.DATASETS_UPLOAD), singleFileUpload('file', 'uploads.maxDatasetSizeMb'), validate(uploadDatasetSchema), h(d.upload));
datasetRouter.get('/:id', id, h(d.get));
datasetRouter.patch('/:id', editDatasets, id, validate(updateDatasetSchema), h(d.update));
datasetRouter.get('/:id/preview', id, validate(previewQuery, 'query'), h(d.preview));
datasetRouter.get('/:id/download', editDatasets, id, h(d.download));
datasetRouter.post('/:id/analyze', requirePermission(P.EXPERIMENTS_RUN), id, h(d.analyze));
datasetRouter.delete('/:id', editDatasets, id, validate(reasonSchema), h(d.remove));

export const modelRouter = Router();
const editModels = requireAnyPermission(P.MODELS_UPLOAD, P.MODELS_MANAGE);
modelRouter.use(authenticate, requirePermission(P.MODELS_READ));
modelRouter.get('/', validate(listModelsQuery, 'query'), h(m.list));
modelRouter.post('/', editModels, validate(createModelSchema), h(m.create));
modelRouter.get('/:id', id, h(m.get));
modelRouter.patch('/:id', editModels, id, validate(updateModelSchema), h(m.update));
modelRouter.post('/:id/lifecycle', editModels, id, validate(lifecycleSchema), h(m.transition));
modelRouter.post('/:id/versions', editModels, id, singleFileUpload('file', 'uploads.maxModelSizeMb'), validate(createVersionSchema), h(m.createVersion));

export const modelVersionRouter = Router();
modelVersionRouter.use(authenticate, requirePermission(P.MODELS_READ));
modelVersionRouter.get('/:id', id, h(m.getVersion));
modelVersionRouter.get('/:id/artifact', id, h(m.downloadArtifact));

export const experimentRouter = Router();
experimentRouter.use(authenticate, requireAnyPermission(P.EXPERIMENTS_RUN, P.EXPERIMENTS_READ_ALL, P.XAI_RUN, P.FAIRNESS_RUN, P.ROBUSTNESS_RUN));
experimentRouter.get('/algorithms', h(e.algorithms));
experimentRouter.get('/sources', h(e.sources));
experimentRouter.get('/', validate(listExperimentsQuery, 'query'), h(e.list));
experimentRouter.post('/', validate(createExperimentSchema), h(e.create));
experimentRouter.get('/:id', id, h(e.get));
experimentRouter.post('/:id/cancel', id, h(e.cancel));
experimentRouter.post('/:id/rerun', id, h(e.rerun));
