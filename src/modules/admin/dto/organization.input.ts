import { z } from 'zod';
import { label, rate, uuid } from '../../../common/domain/input';

/** Código corto en mayúsculas (sucursales, almacenes y métodos de pago). */
export const code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{0,19}$/);

export const organizationSchema = z
  .object({
    name: label,
    currency: z.string().regex(/^[A-Z]{3}$/),
    locale: z.string().min(2).max(35),
    timeZone: z.string().min(1).max(80),
  })
  .strict();
export const settingsSchema = organizationSchema
  .partial()
  .extend({
    moneyPrecision: z.number().int().min(0).max(4).optional(),
    taxRate: rate.optional(),
    taxIncluded: z.boolean().optional(),
    discountLimit: rate.optional(),
    allowNegativeStock: z.boolean().optional(),
    receiptPrefix: code.refine((value) => value.length <= 12).optional(),
  })
  .refine((v) => Object.keys(v).length > 0);
export const branchSchema = z
  .object({
    name: label,
    code,
    address: z.string().max(300).nullable().optional(),
    timeZone: z.string().min(1).max(80),
  })
  .strict();
export const branchPatch = branchSchema
  .partial()
  .extend({ archived: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0);
export const warehouseSchema = z
  .object({ branchId: uuid, name: label, code })
  .strict();

export type OrganizationInput = z.infer<typeof organizationSchema>;
export type SettingsInput = z.infer<typeof settingsSchema>;
export type BranchInput = z.infer<typeof branchSchema>;
export type BranchPatch = z.infer<typeof branchPatch>;
export type WarehouseInput = z.infer<typeof warehouseSchema>;
