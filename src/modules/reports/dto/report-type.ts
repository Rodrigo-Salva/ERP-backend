import { z } from 'zod';

export const REPORT_TYPES = [
  'sales',
  'inventory',
  'movements',
  'cash',
  'purchases',
  'expenses',
] as const;

export type ReportType = (typeof REPORT_TYPES)[number];
/** Reportes que listan filas (todos menos el resumen de ventas). */
export type ListReportType = Exclude<ReportType, 'sales'>;

export const reportTypeSchema = z.enum(REPORT_TYPES);

export type Row = Record<string, unknown>;

/** Respuesta paginada de un reporte de filas. */
export interface ReportPage {
  items: Row[];
  page: number;
  limit: number;
}
