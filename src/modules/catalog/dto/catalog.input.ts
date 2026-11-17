import { z } from 'zod';
import { uuid } from '../../../common/domain/input';

export const MONEY_PATTERN = /^(0|[1-9]\d{0,13})(\.\d{1,4})?$/;
export const QUANTITY_PATTERN = /^(0|[1-9]\d{0,14})(\.\d{1,3})?$/;

/** Listados: paginación, estado y texto de búsqueda. */
export const catalogQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(1000000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(['active', 'archived', 'all']).default('active'),
    q: z.string().trim().max(120).optional(),
  })
  .strict();

export const productsQuerySchema = catalogQuerySchema.extend({
  categoryId: uuid.optional(),
});

export const createCategorySchema = z
  .object({ name: z.string().trim().min(1).max(120) })
  .strict();
export const updateCategorySchema = createCategorySchema.partial();

export const createUnitSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9][A-Z0-9_-]{0,19}$/),
    name: z.string().trim().min(1).max(80),
    precision: z.number().int().min(0).max(3).optional(),
  })
  .strict();
export const updateUnitSchema = createUnitSchema.partial();

export const createProductSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    description: z.string().max(2000).nullable().optional(),
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
    categoryId: uuid.nullable().optional(),
    unitId: uuid,
    /** Decimales exactos no negativos: hasta 4 decimales y 14 dígitos enteros. */
    cost: z.string().regex(MONEY_PATTERN),
    price: z.string().regex(MONEY_PATTERN),
    lowStockThreshold: z.string().regex(QUANTITY_PATTERN).optional(),
  })
  .strict();
export const updateProductSchema = createProductSchema.partial();

export type CatalogQuery = z.infer<typeof catalogQuerySchema>;
export type ProductsQuery = z.infer<typeof productsQuerySchema>;
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type CreateUnitInput = z.infer<typeof createUnitSchema>;
export type UpdateUnitInput = z.infer<typeof updateUnitSchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
