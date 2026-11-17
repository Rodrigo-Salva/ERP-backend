/** Instante UTC en que empieza el día `year-month-day` en la zona horaria indicada. */
export function zonedMidnight(
  timeZone: string,
  year: number,
  month: number,
  day: number,
): Date {
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = (date: Date) =>
    Object.fromEntries(
      format
        .formatToParts(date)
        .filter((p) => p.type !== 'literal')
        .map((p) => [p.type, Number(p.value)]),
    );
  const target = Date.UTC(year, month - 1, day);
  let utc = target;
  // Converge aunque el día tenga un cambio de horario (23 o 25 horas).
  for (let i = 0; i < 4; i++) {
    const p = parts(new Date(utc));
    const represented = Date.UTC(
      p.year!,
      p.month! - 1,
      p.day,
      p.hour,
      p.minute,
      p.second,
    );
    const next = target - (represented - utc);
    if (next === utc) break;
    utc = next;
  }
  return new Date(utc);
}

/** Rango [inicio del día `from`, fin del día `to`] (AAAA-MM-DD) en la zona indicada. */
export function dayBounds(
  timeZone: string,
  fromDay?: string,
  toDay?: string,
): { from?: string; to?: string } {
  const split = (day: string) =>
    day.split('-').map(Number) as [number, number, number];
  return {
    ...(fromDay
      ? { from: zonedMidnight(timeZone, ...split(fromDay)).toISOString() }
      : {}),
    ...(toDay
      ? {
          to: new Date(
            zonedMidnight(
              timeZone,
              split(toDay)[0],
              split(toDay)[1],
              split(toDay)[2] + 1,
            ).getTime() - 1,
          ).toISOString(),
        }
      : {}),
  };
}

/** Día (AAAA-MM-DD) en que cae un instante, en la zona indicada. */
export function dayKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(date);
}

export function addDaysToKey(day: string, amount: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + amount)).toISOString().slice(0, 10);
}

export interface SeriesPoint {
  /** AAAA-MM-DD, o AAAA-MM si la serie es mensual. */
  key: string;
  total: number;
  count: number;
}

export interface Series {
  granularity: 'day' | 'month';
  points: SeriesPoint[];
}

/**
 * Agrupa filas (instante + valor) por día de la zona indicada, rellenando con ceros los
 * días sin movimiento para que la gráfica no “salte”. Si el rango pasa de 92 días se agrupa
 * por mes.
 */
export function bucketSeries(
  rows: Array<{ at: Date; value: number }>,
  timeZone: string,
  from: Date,
  to: Date,
): Series {
  const first = dayKey(from, timeZone);
  const last = dayKey(to, timeZone);
  const span =
    (Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) /
    86400000;
  const granularity = span > 92 ? 'month' : 'day';
  const keyOf = (day: string) =>
    granularity === 'month' ? day.slice(0, 7) : day;
  const map = new Map<string, SeriesPoint>();
  for (let day = first; day <= last; day = addDaysToKey(day, 1)) {
    const key = keyOf(day);
    if (!map.has(key)) map.set(key, { key, total: 0, count: 0 });
  }
  for (const row of rows) {
    const point = map.get(keyOf(dayKey(row.at, timeZone)));
    if (point) {
      point.total += row.value;
      point.count += 1;
    }
  }
  return { granularity, points: [...map.values()] };
}

/** Rango [00:00, 23:59:59.999] de “hoy” en la zona indicada, como instantes ISO. */
export function dayRange(timeZone: string, now = new Date()) {
  const today = dayKey(now, timeZone);
  return dayBounds(timeZone, today, today) as { from: string; to: string };
}
