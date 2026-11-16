import { Router } from 'express';
import { certificateController as c } from '../controllers/certificate.controller';
import { authenticate } from '../middleware/authenticate';
import { requireAnyPermission, requirePermission } from '../middleware/authorize';
import { verifyRateLimit } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import { PERMISSIONS as P } from '../rbac/permissions';
import { asyncHandler as h } from '../utils/asyncHandler';
import { approveCertificateSchema, eligibilityQuery, listCertificatesQuery, requestCertificateSchema, verificationCodeParam } from '../validators/certificate.validators';
import { idParam, reasonSchema } from '../validators/common.validators';

const id = validate(idParam, 'params');
const manage = requirePermission(P.CERTIFICATES_MANAGE);
const own = requirePermission(P.CERTIFICATES_READ_OWN);

export const certificateRouter = Router();
certificateRouter.use(authenticate, requireAnyPermission(P.CERTIFICATES_READ_OWN, P.CERTIFICATES_MANAGE));
certificateRouter.get('/', validate(listCertificatesQuery, 'query'), h(c.list));
certificateRouter.get('/eligibility', own, validate(eligibilityQuery, 'query'), h(c.eligibility));
certificateRouter.post('/request', own, validate(requestCertificateSchema), h(c.request));
certificateRouter.get('/:id', id, h(c.get));
certificateRouter.get('/:id/pdf', id, h(c.pdf));
certificateRouter.get('/:id/history', id, h(c.history));
certificateRouter.post('/:id/approve', manage, id, validate(approveCertificateSchema), h(c.approve));
certificateRouter.post('/:id/decline', manage, id, validate(reasonSchema), h(c.decline));
certificateRouter.post('/:id/revoke', manage, id, validate(reasonSchema), h(c.revoke));

/** Public, unauthenticated certificate verification (linked from the QR code). */
export const verifyRouter = Router();
verifyRouter.get('/:code', verifyRateLimit, validate(verificationCodeParam, 'params'), h(c.verify));
