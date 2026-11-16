import { z } from 'zod';
import { paginationSchema } from '../utils/pagination';
import { boolString } from './common.validators';

export const eligibilityQuery = z.object({ courseId: z.string().uuid().optional() });

export const requestCertificateSchema = z.object({ courseId: z.string().uuid() });

export const listCertificatesQuery = paginationSchema.extend({
  status: z.enum(['PENDING_APPROVAL', 'ISSUED', 'REVOKED']).optional(),
  search: z.string().trim().max(200).optional(),
  mine: boolString,
});
export type ListCertificatesQuery = z.infer<typeof listCertificatesQuery>;

export const approveCertificateSchema = z.object({ comment: z.string().trim().max(1000).optional() });

export const verificationCodeParam = z.object({ code: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/, 'Invalid verification code') });
