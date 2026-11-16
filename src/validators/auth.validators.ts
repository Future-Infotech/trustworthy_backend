import { RoleName } from '@prisma/client';
import { z } from 'zod';
import { passwordPolicy } from '../services/password.service';

const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(254);
const personName = z.string().trim().min(1, 'Required').max(80);

export const registerSchema = z.object({
  email,
  password: passwordPolicy,
  firstName: personName,
  lastName: personName,
  organization: z.string().trim().max(120).optional(),
  role: z.nativeEnum(RoleName).optional(),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: 'You must accept the terms and privacy notice' }) }),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required').max(128),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: passwordPolicy,
  })
  .refine((d) => d.currentPassword !== d.newPassword, {
    message: 'New password must differ from the current password',
    path: ['newPassword'],
  });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
