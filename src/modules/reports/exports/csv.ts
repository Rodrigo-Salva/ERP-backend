import { Prisma } from '../../../generated/prisma/client';
import { toText } from '../../../common/domain/input';

/** CSV con BOM (Excel lo abre en UTF-8). Neutraliza fórmulas sin alterar negativos. */
export function csv(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return '\uFEFF';
  const headers = Object.keys(rows[0]!);
  const cell = (value: unknown) => {
    let text =
      value instanceof Prisma.Decimal ? value.toString() : toText(value);
    if (/^[=+\-@\t\r\n]/.test(text) && !/^-\d+(\.\d+)?$/.test(text))
      text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  return (
    '\uFEFF' +
    [
      headers.map(cell).join(','),
      ...rows.map((row) => headers.map((key) => cell(row[key])).join(',')),
    ].join('\r\n')
  );
}

/** Prepara una fila para CSV: fechas en ISO y listas como JSON. */
export function flattenRow(row: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      value instanceof Date
        ? value.toISOString()
        : Array.isArray(value)
          ? JSON.stringify(value)
          : value,
    ]),
  );
}
