import { z } from 'zod';
import { code } from './organization.input';

export const methodSchema = z
  .object({ name: z.string().trim().min(1).max(80), code, isCash: z.boolean() })
  .strict();
export const methodPatch = methodSchema
  .partial()
  .extend({ archived: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0);

export type MethodInput = z.infer<typeof methodSchema>;
export type MethodPatch = z.infer<typeof methodPatch>;
