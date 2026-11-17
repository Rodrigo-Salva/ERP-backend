import { z } from 'zod';
import {
  amount,
  quantity,
  rate,
  reason,
  uuid,
} from '../../../common/domain/input';
export const saleSchema = z
  .object({
    warehouseId: uuid,
    cashSessionId: uuid,
    customerId: uuid.optional(),
    lines: z
      .array(
        z
          .object({
            variantId: uuid,
            quantity,
            discountRate: rate.default('0'),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
export const confirmSchema = z
  .object({
    payments: z
      .array(z.object({ methodId: uuid, amount }).strict())
      .min(1)
      .max(10),
  })
  .strict();
export const returnSchema = z
  .object({
    methodId: uuid,
    cashSessionId: uuid.optional(),
    reason,
    lines: z
      .array(
        z.object({ lineId: uuid, quantity, restock: z.boolean() }).strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
export const cancelSchema = z
  .object({
    reason,
    methodId: uuid.optional(),
    cashSessionId: uuid.optional(),
    restock: z.boolean().optional(),
  })
  .strict();
export type SaleInput = z.infer<typeof saleSchema>;
export type ConfirmInput = z.infer<typeof confirmSchema>;
export type ReturnInput = z.infer<typeof returnSchema>;
export type CancelInput = z.infer<typeof cancelSchema>;
