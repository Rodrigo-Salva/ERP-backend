import { z } from 'zod';
import { amount, label, quantity, uuid } from '../../../common/domain/input';
export const supplierSchema = z
  .object({
    name: label,
    email: z.email().max(254).nullable().optional(),
    phone: z.string().max(40).nullable().optional(),
    address: z.string().max(300).nullable().optional(),
  })
  .strict();
export const supplierPatch = supplierSchema
  .partial()
  .extend({ archived: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0);
export const purchaseSchema = z
  .object({
    warehouseId: uuid,
    supplierId: uuid,
    notes: z.string().max(2000).optional(),
    lines: z
      .array(z.object({ variantId: uuid, quantity, unitCost: amount }).strict())
      .min(1)
      .max(100),
  })
  .strict();
export const receiptSchema = z
  .object({
    lines: z
      .array(z.object({ lineId: uuid, quantity, unitCost: amount }).strict())
      .min(1)
      .max(100),
  })
  .strict();
export type SupplierInput = z.infer<typeof supplierSchema>;
export type SupplierPatch = z.infer<typeof supplierPatch>;
export type PurchaseInput = z.infer<typeof purchaseSchema>;
export type ReceiptInput = z.infer<typeof receiptSchema>;
