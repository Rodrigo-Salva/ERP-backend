import { z } from 'zod';
import { label } from '../../../common/domain/input';

export const customerSchema = z
  .object({
    name: label,
    email: z.email().max(254).nullable().optional(),
    phone: z.string().max(40).nullable().optional(),
    consent: z.literal(true),
  })
  .strict();
export const customerPatch = customerSchema
  .partial()
  .extend({ archived: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0);

export type CustomerInput = z.infer<typeof customerSchema>;
export type CustomerPatch = z.infer<typeof customerPatch>;
