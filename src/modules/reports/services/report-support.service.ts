import { Injectable } from '@nestjs/common';
import { Actor, DomainService } from '../../../common/domain/domain.service';
import { PageInput } from '../../../common/domain/input';
import { addDaysToKey, dayBounds, dayKey } from '../../../common/domain/time';

/** Límite de filas que se leen para armar una serie de gráfica. */
export const MAX_SERIES_ROWS = 20000;

/** Piezas que comparten varios reportes: zona horaria, rango de gráficas y alcance. */
@Injectable()
export class ReportSupportService {
  constructor(private readonly domain: DomainService) {}

  /** Convierte `fromDay`/`toDay` en `from`/`to` según la zona de la tienda o sucursal. */
  resolveDays(actor: Actor, q: PageInput): Promise<PageInput> {
    return this.domain.days(actor, q);
  }

  /** Zona horaria de la sucursal consultada o, si no hay, la de la organización. */
  async zoneOf(actor: Actor, branchId?: string): Promise<string> {
    if (branchId) {
      const branch = await this.domain.db.branch.findFirst({
        where: { id: branchId, organizationId: actor.organizationId },
        select: { timeZone: true },
      });
      if (branch) return branch.timeZone;
    }
    return (
      await this.domain.db.organization.findUniqueOrThrow({
        where: { id: actor.organizationId },
        select: { timeZone: true },
      })
    ).timeZone;
  }

  /** Rango de una gráfica: el filtro, o los últimos 30 días si no hay fechas. */
  chartRange(q: PageInput, timeZone: string): { from: Date; to: Date } {
    const to = q.to ? new Date(q.to) : new Date();
    const from = q.from
      ? new Date(q.from)
      : new Date(
          dayBounds(timeZone, addDaysToKey(dayKey(to, timeZone), -29)).from!,
        );
    return { from, to };
  }
}
