import { z } from 'zod';
import { amount, quantity, reason, uuid } from '../../../common/domain/input';
export const adjustmentSchema = z
  .object({
    warehouseId: uuid,
    variantId: uuid,
    delta: z.string().regex(/^-?(0|[1-9]\d{0,11})(\.\d{1,3})?$/),
    unitCost: amount.optional(),
    reason,
  })
  .strict();
export const transferSchema = z
  .object({
    sourceWarehouseId: uuid,
    targetWarehouseId: uuid,
    reason,
    lines: z
      .array(z.object({ variantId: uuid, quantity }).strict())
      .min(1)
      .max(100),
  })
  .strict();
export type AdjustmentInput = z.infer<typeof adjustmentSchema>;
export type TransferInput = z.infer<typeof transferSchema>;
export interface TransferLine {
  variantId: string;
  quantity: string;
  unitCost?: string;
}
