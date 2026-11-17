import type { SalesReportService } from '../services/sales-report.service';
import type { Row } from '../dto/report-type';
import type { CellKind, Column, Sheet } from './report-workbook';

type SalesSummary = Awaited<ReturnType<SalesReportService['summary']>>;

/** Número a partir de un Decimal, texto o número; null si no hay valor. */
const num = (value: unknown): number | null =>
  value === null || value === undefined
    ? null
    : Number((value as { toString(): string }).toString());

const sum = (rows: Row[], key: string) =>
  rows.reduce((total, row) => total + (num(row[key]) ?? 0), 0);

const text = (header: string, key: string, width: number): Column => ({
  header,
  key,
  width,
  kind: 'text',
});
const money = (header: string, key: string, width: number): Column => ({
  header,
  key,
  width,
  kind: 'money',
});
const when = (header: string, key: string): Column => ({
  header,
  key,
  width: 18,
  kind: 'datetime',
});

/** Hojas del reporte de ventas: resumen del período y productos más vendidos. */
export function salesSheets(summary: SalesSummary): Sheet[] {
  const line = (concepto: string, valor: unknown, kind: CellKind) => ({
    concepto,
    valor: num(valor),
    __kind: { valor: kind },
  });
  return [
    {
      name: 'Resumen',
      title: 'Reporte de ventas',
      columns: [text('Concepto', 'concepto', 38), money('Valor', 'valor', 20)],
      rows: [
        line('Número de ventas', summary.saleCount, 'int'),
        line('Ventas brutas', summary.gross, 'money'),
        line('Descuentos', summary.discount, 'money'),
        line('Total vendido', summary.salesTotal, 'money'),
        line('Devoluciones', summary.returnsTotal, 'money'),
        line('Impuestos netos', summary.netTax, 'money'),
        line('Ventas netas', summary.netTotal, 'money'),
        line(
          'Ventas netas sin impuestos',
          summary.netSalesExcludingTax,
          'money',
        ),
        line('Ticket promedio', summary.averageTicket, 'money'),
      ],
    },
    {
      name: 'Más vendidos',
      title: 'Productos más vendidos',
      columns: [
        text('SKU', 'sku', 16),
        text('Artículo', 'name', 42),
        { header: 'Cantidad', key: 'quantity', width: 14, kind: 'qty' },
        money('Total', 'total', 18),
      ],
      rows: summary.topProducts.map((p) => ({
        sku: p.sku,
        name: p.name,
        quantity: num(p.grossQuantity),
        total: num(p.total),
      })),
      totals: {
        total: summary.topProducts.reduce(
          (total, p) => total + (num(p.total) ?? 0),
          0,
        ),
      },
    },
  ];
}

export function inventorySheets(items: Row[]): Sheet[] {
  return [
    {
      name: 'Valoración',
      title: 'Valoración de inventario',
      columns: [
        text('SKU', 'sku', 16),
        text('Artículo', 'name', 42),
        text('Almacén', 'warehouseName', 22),
        { header: 'Cantidad', key: 'quantity', width: 14, kind: 'qty' },
        money('Valor', 'value', 18),
      ],
      rows: items.map((i) => ({
        ...i,
        quantity: num(i.quantity),
        value: num(i.value),
      })),
      totals: { value: sum(items, 'value') },
      totalsLabel: 'Valor total',
    },
  ];
}

export function movementsSheets(items: Row[]): Sheet[] {
  // Los costos solo llegan a quienes pueden verlos.
  const withCosts = items.some((i) => 'unitCost' in i);
  return [
    {
      name: 'Movimientos',
      title: 'Movimientos de inventario',
      columns: [
        when('Fecha', 'createdAt'),
        text('Tipo', 'kind', 18),
        text('Motivo', 'reason', 34),
        text('SKU', 'sku', 16),
        text('Artículo', 'name', 36),
        text('Almacén', 'warehouseName', 20),
        { header: 'Cantidad', key: 'delta', width: 14, kind: 'qty' },
        ...(withCosts
          ? [
              money('Costo unitario', 'unitCost', 16),
              money('Valor', 'valueDelta', 16),
            ]
          : []),
      ],
      rows: items.map((i) => ({
        ...i,
        delta: num(i.delta),
        unitCost: num(i.unitCost),
        valueDelta: num(i.valueDelta),
      })),
      ...(withCosts
        ? { totals: { valueDelta: sum(items, 'valueDelta') } }
        : {}),
    },
  ];
}

export function cashSheets(
  items: Row[],
  registerNames: Map<string, string>,
): Sheet[] {
  return [
    {
      name: 'Caja',
      title: 'Sesiones de caja',
      columns: [
        when('Apertura', 'createdAt'),
        when('Cierre', 'closedAt'),
        text('Caja', 'register', 20),
        text('Estado', 'status', 12),
        money('Fondo inicial', 'opening', 16),
        money('Esperado', 'expected', 16),
        money('Contado', 'counted', 16),
        money('Diferencia', 'difference', 16),
      ],
      rows: items.map((i) => ({
        ...i,
        register: registerNames.get(String(i.cashRegisterId)) ?? '',
        status: i.closedAt ? 'Cerrada' : 'Abierta',
        opening: num(i.opening),
        expected: num(i.expected),
        counted: num(i.counted),
        difference: num(i.difference),
      })),
      totals: { difference: sum(items, 'difference') },
      totalsLabel: 'Diferencia total',
    },
  ];
}

export function purchasesSheets(items: Row[]): Sheet[] {
  return [
    {
      name: 'Compras',
      title: 'Mercadería recibida',
      columns: [
        when('Fecha', 'createdAt'),
        text('Orden', 'order', 14),
        { header: 'Líneas', key: 'lineCount', width: 10, kind: 'int' },
        money('Total', 'total', 18),
      ],
      rows: items.map((i) => ({
        ...i,
        order: String(i.purchaseOrderId).slice(0, 8).toUpperCase(),
        lineCount: Array.isArray(i.lines) ? i.lines.length : 0,
        total: num(i.total),
      })),
      totals: { total: sum(items, 'total') },
    },
  ];
}

export function expensesSheets(
  items: Row[],
  categoryNames: Map<string, string>,
): Sheet[] {
  return [
    {
      name: 'Gastos',
      title: 'Gastos',
      columns: [
        when('Fecha', 'occurredAt'),
        text('Descripción', 'description', 44),
        text('Categoría', 'category', 24),
        money('Monto', 'amount', 18),
      ],
      rows: items.map((i) => ({
        ...i,
        category: categoryNames.get(String(i.categoryId)) ?? '',
        amount: num(i.amount),
      })),
      totals: { amount: sum(items, 'amount') },
    },
  ];
}
