import { z } from 'zod';
import { paginationSchema } from '../utils/pagination';

/** Optional "true"/"false" query flag. */
export const boolString = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === 'true'));

/** Mandatory justification recorded in the audit trail. */
export const reasonSchema = z.object({ reason: z.string().trim().min(5, 'Give a reason of at least 5 characters').max(1000) });

export const idParam = z.object({ id: z.string().uuid('Invalid id') });

export const settingKeyParam = z.object({ key: z.string().min(1).max(100) });

export const updateSettingSchema = z.object({ value: z.unknown() });

export const listNotificationsQuery = paginationSchema.extend({
  unreadOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
