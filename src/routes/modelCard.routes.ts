import { Router } from 'express';
import { modelCardController as c } from '../controllers/modelCard.controller';
import { authenticate } from '../middleware/authenticate';
import { requirePermission } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { PERMISSIONS as P } from '../rbac/permissions';
import { asyncHandler as h } from '../utils/asyncHandler';
import { idParam } from '../validators/common.validators';
import {
  archiveSchema,
  createModelCardSchema,
  exportQuery,
  listModelCardsQuery,
  newVersionSchema,
  prefillQuery,
  reviewModelCardSchema,
  updateModelCardSchema,
} from '../validators/modelCard.validators';

const id = validate(idParam, 'params');
const manage = requirePermission(P.MODEL_CARDS_MANAGE);

export const modelCardRouter = Router();
modelCardRouter.use(authenticate, requirePermission(P.MODEL_CARDS_READ));
modelCardRouter.get('/', validate(listModelCardsQuery, 'query'), h(c.list));
modelCardRouter.get('/prefill', manage, requirePermission(P.MODELS_READ), validate(prefillQuery, 'query'), h(c.prefill));
modelCardRouter.post('/', manage, validate(createModelCardSchema), h(c.create));
modelCardRouter.get('/:id', id, h(c.get));
modelCardRouter.patch('/:id', manage, id, validate(updateModelCardSchema), h(c.update));
modelCardRouter.delete('/:id', manage, id, h(c.remove));
modelCardRouter.post('/:id/submit', manage, id, h(c.submit));
modelCardRouter.post('/:id/withdraw', manage, id, h(c.withdraw));
modelCardRouter.post('/:id/review', requirePermission(P.MODEL_CARDS_PUBLISH), id, validate(reviewModelCardSchema), h(c.review));
modelCardRouter.post('/:id/versions', manage, id, validate(newVersionSchema), h(c.newVersion));
modelCardRouter.post('/:id/archive', id, validate(archiveSchema), h(c.archive));
modelCardRouter.get('/:id/versions', id, h(c.versions));
modelCardRouter.get('/:id/history', id, h(c.history));
modelCardRouter.get('/:id/export', id, validate(exportQuery, 'query'), h(c.export));
