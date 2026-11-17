import {
  BadRequestException,
  Injectable,
  PipeTransform,
  applyDecorators,
} from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';
import { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { z } from 'zod';

@Injectable()
export class InputPipe implements PipeTransform {
  constructor(private readonly schema: z.ZodType) {}
  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success)
      throw new BadRequestException(
        result.error.issues.map(
          (issue) => `${issue.path.join('.') || 'datos'}: ${issue.message}`,
        ),
      );
    return result.data;
  }
}
export const InputDocs = (schema: z.ZodType) =>
  applyDecorators(
    ApiBody({
      schema: z.toJSONSchema(schema, {
        target: 'openapi-3.0',
        io: 'input',
        unrepresentable: 'any',
      }) as SchemaObject,
    }),
  );
export const uuid = z.uuid();
/** Correo normalizado: sin espacios y en minúsculas. */
export const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const password = z.string().min(12).max(128);
export const amount = z.string().regex(/^(0|[1-9]\d{0,13})(\.\d{1,4})?$/);
export const quantity = z
  .string()
  .regex(/^(0|[1-9]\d{0,11})(\.\d{1,3})?$/)
  .refine((s) => /[1-9]/.test(s), 'Debe ser mayor que cero');
export const rate = z
  .string()
  .regex(/^(0|[1-9]\d?)(\.\d{1,4})?$|^100(\.0{1,4})?$/);
export const label = z.string().trim().min(1).max(160);
export const reason = z.string().trim().min(3).max(300);
export const pageSchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    branchId: uuid.optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    /** Días completos (AAAA-MM-DD) en la zona horaria de la sucursal u organización. */
    fromDay: z.iso.date().optional(),
    toDay: z.iso.date().optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    q: z.string().trim().max(100).optional(),
    actorId: uuid.optional(),
    customerId: uuid.optional(),
    status: z.string().max(20).optional(),
  })
  .strict()
  .refine(
    (q) => !q.from || !q.to || new Date(q.from) <= new Date(q.to),
    'El rango de fechas es inválido',
  )
  .refine(
    (q) => !q.fromDay || !q.toDay || q.fromDay <= q.toDay,
    'El rango de días es inválido',
  );
export type PageInput = z.infer<typeof pageSchema>;
export function paging(q: { page: number; limit: number }) {
  return { skip: (q.page - 1) * q.limit, take: q.limit };
}
export function dates(q: PageInput) {
  return {
    ...(q.from ? { gte: new Date(q.from) } : {}),
    ...(q.to ? { lte: new Date(q.to) } : {}),
  };
}
export function json<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
/** Texto plano de un valor arbitrario; los objetos se serializan como JSON. */
export function toText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  )
    return String(value);
  return JSON.stringify(value) ?? '';
}
