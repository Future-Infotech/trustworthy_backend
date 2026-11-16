import { RoleName, UserStatus } from '@prisma/client';
import { z } from 'zod';
import { passwordPolicy } from '../services/password.service';
import { paginationSchema } from '../utils/pagination';

export const listUsersQuery = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  role: z.nativeEnum(RoleName).optional(),
  status: z.nativeEnum(UserStatus).optional(),
});

export const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  role: z.nativeEnum(RoleName),
  password: passwordPolicy,
  organization: z.string().trim().max(120).optional(),
  jobTitle: z.string().trim().max(120).optional(),
});

export const updateUserSchema = z
  .object({
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    role: z.nativeEnum(RoleName),
    status: z.enum(['ACTIVE', 'SUSPENDED']),
    organization: z.string().trim().max(120).nullable(),
    jobTitle: z.string().trim().max(120).nullable(),
    reason: z.string().trim().max(500).optional(),
  })
  .partial()
  .refine((d) => Object.keys(d).some((k) => k !== 'reason'), { message: 'No changes supplied' });

export const deleteUserSchema = z.object({ reason: z.string().trim().max(500).optional() });

export type ListUsersQuery = z.infer<typeof listUsersQuery>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
