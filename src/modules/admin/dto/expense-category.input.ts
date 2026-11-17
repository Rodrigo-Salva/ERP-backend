import { z } from 'zod';

export const categorySchema = z
  .object({ name: z.string().trim().min(1).max(100) })
  .strict();
export const categoryPatch = categorySchema
  .partial()
  .extend({ archived: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0);

export type CategoryInput = z.infer<typeof categorySchema>;
export type CategoryPatch = z.infer<typeof categoryPatch>;
