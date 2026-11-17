import { z } from 'zod';
import { email, password } from '../../../common/domain/input';

/** Texto con al menos un carácter visible. */
const named = (min: number, max: number) =>
  z.string().min(min).max(max).regex(/\S/);

export const loginSchema = z.object({ email, password }).strict();

export const registerSchema = z
  .object({
    email,
    password,
    name: named(2, 120),
    organizationName: named(2, 160),
    branchName: named(2, 160),
    currency: z.string().regex(/^[A-Z]{3}$/),
    locale: z.string().min(2).max(35),
    timeZone: z.string().min(1).max(80),
  })
  .strict();

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
