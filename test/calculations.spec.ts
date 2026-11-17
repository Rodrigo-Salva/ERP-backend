import { Prisma } from '../src/generated/prisma/client';
import {
  lineTotals,
  returnPart,
} from '../src/modules/sales/domain/calculations';
import { dayBounds, dayRange } from '../src/common/domain/time';
import { csv } from '../src/modules/reports/exports/csv';

const D = (value: string | number) => new Prisma.Decimal(value);
const show = (totals: ReturnType<typeof lineTotals>) =>
  Object.fromEntries(
    Object.entries(totals).map(([key, value]) => [key, value.toString()]),
  );

describe('Cálculo de líneas de venta', () => {
  it('agrega el impuesto después del descuento', () => {
    // 3 × 10.00 = 30.00; descuento 10 % = 3.00; base 27.00; IGV 18 % = 4.86
    expect(
      show(lineTotals(D('10'), D('3'), D('10'), D('18'), false, 2)),
    ).toEqual({
      gross: '30',
      discount: '3',
      tax: '4.86',
      total: '31.86',
    });
  });

  it('extrae el impuesto cuando ya está incluido en el precio', () => {
    // 118.00 incluye 18.00 de impuesto
    expect(
      show(lineTotals(D('118'), D('1'), D('0'), D('18'), true, 2)),
    ).toEqual({
      gross: '118',
      discount: '0',
      tax: '18',
      total: '118',
    });
  });

  it('redondea cada línea hacia arriba en el punto medio (HALF_UP)', () => {
    // 0.5 × 0.05 = 0.025 → 0.03; el impuesto 0 % no cambia el total
    expect(
      show(lineTotals(D('0.05'), D('0.5'), D('0'), D('0'), false, 2)).gross,
    ).toBe('0.03');
    // 1.005 con 2 decimales → 1.01 (no 1.00 como con coma flotante)
    expect(
      show(lineTotals(D('1.005'), D('1'), D('0'), D('0'), false, 2)).gross,
    ).toBe('1.01');
    // sin decimales: 2.5 → 3
    expect(
      show(lineTotals(D('2.5'), D('1'), D('0'), D('0'), false, 0)).gross,
    ).toBe('3');
  });

  it('no pierde céntimos con cantidades fraccionarias', () => {
    // 0.333 kg × 9.99 = 3.32667 → 3.33
    expect(
      show(lineTotals(D('9.99'), D('0.333'), D('0'), D('0'), false, 2)).gross,
    ).toBe('3.33');
  });

  it('un descuento del 100 % deja total cero', () => {
    expect(
      show(lineTotals(D('10'), D('2'), D('100'), D('18'), false, 2)),
    ).toEqual({
      gross: '20',
      discount: '20',
      tax: '0',
      total: '0',
    });
  });
});

describe('Devoluciones parciales', () => {
  it('suman exactamente el importe original al completar la devolución', () => {
    // Línea de 3 unidades por 10.00 en total; se devuelve de una en una.
    const parts = [0, 1, 2].map((already) =>
      returnPart(D('10'), D('3'), D(already), D('1'), 2),
    );
    expect(parts.map(String)).toEqual(['3.33', '3.34', '3.33']);
    expect(parts.reduce((sum, part) => sum.plus(part), D(0)).toString()).toBe(
      '10',
    );
  });

  it('devuelve el total en un solo paso', () => {
    expect(returnPart(D('10'), D('3'), D(0), D('3'), 2).toString()).toBe('10');
  });
});

describe('Exportación CSV', () => {
  it('entrecomilla, escapa comillas y conserva el BOM', () => {
    const output = csv([{ nombre: 'Agua "fría"', nota: 'a,b' }]);
    expect(output.startsWith('﻿')).toBe(true);
    expect(output).toContain('"Agua ""fría"""');
    expect(output).toContain('"a,b"');
  });

  it('neutraliza fórmulas pero no altera números negativos', () => {
    const output = csv([{ a: '=SUMA(A1)', b: '-0.5', c: '-cmd', d: '@x' }]);
    expect(output).toContain(`"'=SUMA(A1)"`);
    expect(output).toContain('"-0.5"');
    expect(output).toContain(`"'-cmd"`);
    expect(output).toContain(`"'@x"`);
  });

  it('devuelve solo el BOM sin filas', () => {
    expect(csv([])).toBe('﻿');
  });
});

describe('Rango del día en la zona horaria de la sucursal', () => {
  it('abarca de 00:00 a 23:59:59.999 locales convertidos a UTC', () => {
    const range = dayRange('America/Lima', new Date('2026-10-30T03:00:00Z')); // 29/10 22:00 en Lima
    expect(range.from).toBe('2026-10-29T05:00:00.000Z');
    expect(range.to).toBe('2026-10-30T04:59:59.999Z');
  });

  it('respeta zonas con horario distinto', () => {
    const range = dayRange('Asia/Tokyo', new Date('2026-10-30T20:00:00Z')); // 31/10 05:00 en Tokio
    expect(range.from).toBe('2026-10-30T15:00:00.000Z');
    expect(range.to).toBe('2026-10-31T14:59:59.999Z');
  });
});

describe('Días completos en la zona de la tienda (dayBounds)', () => {
  it('el mismo día equivale a instantes distintos según la zona', () => {
    expect(dayBounds('America/Lima', '2026-10-29', '2026-10-29')).toEqual({
      from: '2026-10-29T05:00:00.000Z',
      to: '2026-10-30T04:59:59.999Z',
    });
    expect(dayBounds('Asia/Tokyo', '2026-10-29', '2026-10-29')).toEqual({
      from: '2026-10-28T15:00:00.000Z',
      to: '2026-10-29T14:59:59.999Z',
    });
  });

  it('resuelve días de 23 y 25 horas por cambio de horario', () => {
    // Nueva York: adelanta la hora el 8/3/2026 y la atrasa el 1/11/2026.
    const spring = dayBounds('America/New_York', '2026-03-08', '2026-03-08');
    expect(
      (new Date(spring.to!).getTime() + 1 - new Date(spring.from!).getTime()) /
        3600000,
    ).toBe(23);
    const fall = dayBounds('America/New_York', '2026-11-01', '2026-11-01');
    expect(
      (new Date(fall.to!).getTime() + 1 - new Date(fall.from!).getTime()) /
        3600000,
    ).toBe(25);
  });

  it('admite solo un extremo', () => {
    expect(dayBounds('America/Lima', '2026-10-29')).toEqual({
      from: '2026-10-29T05:00:00.000Z',
    });
    expect(dayBounds('America/Lima', undefined, '2026-10-29')).toEqual({
      to: '2026-10-30T04:59:59.999Z',
    });
  });
});
