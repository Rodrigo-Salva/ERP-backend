import { z } from 'zod';
import { amount } from '../../../common/domain/input';

export const variantSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    sku: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9][A-Z0-9._-]{0,63}$/),
    barcode: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^\S+$/)
      .nullable()
      .optional(),
    price: amount,
    cost: amount,
  })
  .strict();
export const variantPatch = variantSchema
  .partial()
  .extend({ archived: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0);

export type VariantInput = z.infer<typeof variantSchema>;
export type VariantPatch = z.infer<typeof variantPatch>;
