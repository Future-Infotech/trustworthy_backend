import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { env } from '../config/env';

export const passwordPolicy = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[0-9]/, 'Password must contain a number')
  .regex(/[^A-Za-z0-9]/, 'Password must contain a symbol');

// Pre-computed hash used to keep login timing constant for unknown accounts.
const DUMMY_HASH = bcrypt.hashSync('timing-attack-mitigation-dummy', 10);

export const passwordService = {
  hash(password: string): Promise<string> {
    return bcrypt.hash(password, env.BCRYPT_ROUNDS);
  },

  verify(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  },

  async verifyDummy(password: string): Promise<false> {
    await bcrypt.compare(password, DUMMY_HASH);
    return false;
  },
};
