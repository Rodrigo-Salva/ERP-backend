import ExcelJS from 'exceljs';

export type CellKind = 'text' | 'money' | 'qty' | 'int' | 'datetime';

export interface Column {
  header: string;
  key: string;
  width: number;
  kind: CellKind;
}

export interface Sheet {
  name: string;
  title: string;
  columns: Column[];
  /** Una fila puede cambiar el formato de una celda con `__kind: { columna: 'money' }`. */
  rows: Array<Record<string, unknown>>;
  /** Fila final de totales, por columna. */
  totals?: Record<string, number>;
  totalsLabel?: string;
}

export interface WorkbookMeta {
  organization: string;
  branch: string;
  period: string;
  timeZone: string;
  currencySymbol: string;
  generatedAt: Date;
}

// Paleta alineada con la interfaz: rojo coral de marca, ámbar de detalle y neutros cálidos.
const BRAND = 'FFD62F37';
const BRAND_DARK = 'FF7A1B22';
const BRAND_SOFT = 'FFFDF3F2';
const BRAND_TOTAL = 'FFFBDCDA';
const AMBER = 'FFE8A317';
const GRAY_LINE = 'FFE7E1DB';
const GRAY_TEXT = 'FF6B6560';

/** Fecha “de pared” de la zona de la tienda: Excel no guarda zonas, así que se escribe local. */
function wallClock(date: Date, timeZone: string): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, Number(p.value)]),
  );
  return new Date(
    Date.UTC(
      parts.year!,
      parts.month! - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    ),
  );
}

export function formatLocal(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('es-PE', {
    timeZone,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function numberFormat(kind: CellKind, symbol: string): string | undefined {
  switch (kind) {
    case 'money':
      return `"${symbol}" #,##0.00;[Red]-"${symbol}" #,##0.00`;
    case 'qty':
      return '#,##0.###';
    case 'int':
      return '#,##0';
    case 'datetime':
      return 'dd/mm/yyyy hh:mm';
    default:
      return undefined;
  }
}

const thin = { style: 'thin' as const, color: { argb: GRAY_LINE } };

export async function buildWorkbook(
  sheets: Sheet[],
  meta: WorkbookMeta,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Tendio';
  workbook.created = meta.generatedAt;

  for (const sheet of sheets) {
    const ws = workbook.addWorksheet(sheet.name, {
      properties: { tabColor: { argb: BRAND } },
      views: [{ showGridLines: false, state: 'frozen', ySplit: 5 }],
      pageSetup: {
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
      },
    });
    const last = sheet.columns.length;
    ws.columns = sheet.columns.map((c) => ({ key: c.key, width: c.width }));

    // Encabezado del documento.
    ws.mergeCells(1, 1, 1, last);
    const title = ws.getCell(1, 1);
    title.value = sheet.title;
    title.font = {
      name: 'Calibri',
      size: 18,
      bold: true,
      color: { argb: BRAND },
    };
    ws.getRow(1).height = 30;
    ws.mergeCells(2, 1, 2, last);
    const subtitle = ws.getCell(2, 1);
    subtitle.value = `${meta.organization} · ${meta.branch}`;
    subtitle.font = { size: 11, bold: true, color: { argb: BRAND_DARK } };
    ws.mergeCells(3, 1, 3, last);
    const info = ws.getCell(3, 1);
    info.value = `Período: ${meta.period}  ·  Zona horaria: ${meta.timeZone}  ·  Generado: ${formatLocal(meta.generatedAt, meta.timeZone)}`;
    info.font = { size: 10, color: { argb: GRAY_TEXT } };

    // Franja de acento bajo el encabezado del documento.
    for (let c = 1; c <= last; c++)
      ws.getCell(4, c).border = {
        top: { style: 'medium', color: { argb: AMBER } },
      };
    ws.getRow(4).height = 8;

    // Fila de títulos de columna.
    const header = ws.getRow(5);
    header.height = 26;
    sheet.columns.forEach((column, index) => {
      const cell = header.getCell(index + 1);
      cell.value = column.header;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: BRAND },
      };
      cell.alignment = {
        vertical: 'middle',
        horizontal: column.kind === 'text' ? 'left' : 'right',
        indent: column.kind === 'text' ? 1 : 2,
      };
    });

    // Datos con filas alternadas.
    sheet.rows.forEach((row, rowIndex) => {
      const excelRow = ws.getRow(6 + rowIndex);
      excelRow.height = 20;
      const kinds = (row.__kind ?? {}) as Record<string, CellKind>;
      sheet.columns.forEach((column, index) => {
        const kind = kinds[column.key] ?? column.kind;
        const raw = row[column.key];
        const cell = excelRow.getCell(index + 1);
        cell.value =
          raw instanceof Date
            ? wallClock(raw, meta.timeZone)
            : ((raw ?? null) as ExcelJS.CellValue);
        const format = numberFormat(kind, meta.currencySymbol);
        if (format) cell.numFmt = format;
        cell.alignment = {
          vertical: 'middle',
          horizontal: kind === 'text' ? 'left' : 'right',
          indent: 1,
        };
        cell.font = { size: 11 };
        cell.border = { bottom: thin };
        if (rowIndex % 2 === 1)
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: BRAND_SOFT },
          };
      });
    });

    // Totales.
    let end = 5 + sheet.rows.length;
    if (sheet.totals) {
      end += 1;
      const total = ws.getRow(end);
      total.height = 24;
      sheet.columns.forEach((column, index) => {
        const cell = total.getCell(index + 1);
        const value = sheet.totals![column.key];
        if (index === 0) cell.value = sheet.totalsLabel ?? 'Total';
        else if (value !== undefined) {
          cell.value = value;
          const format = numberFormat(column.kind, meta.currencySymbol);
          if (format) cell.numFmt = format;
        }
        cell.font = { bold: true, size: 11, color: { argb: BRAND_DARK } };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: BRAND_TOTAL },
        };
        cell.alignment = {
          vertical: 'middle',
          horizontal: index === 0 ? 'left' : 'right',
          indent: 1,
        };
        cell.border = { top: { style: 'medium', color: { argb: BRAND } } };
      });
    }

    if (sheet.rows.length)
      ws.autoFilter = {
        from: { row: 5, column: 1 },
        to: { row: 5 + sheet.rows.length, column: last },
      };
    if (!sheet.rows.length) {
      ws.mergeCells(6, 1, 6, last);
      const empty = ws.getCell(6, 1);
      empty.value = 'No hay datos para los filtros elegidos.';
      empty.font = { italic: true, color: { argb: GRAY_TEXT } };
      empty.alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getRow(6).height = 32;
    }
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
