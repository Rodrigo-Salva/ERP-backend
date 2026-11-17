import { Injectable } from '@nestjs/common';
import { Actor, DomainService } from '../../../common/domain/domain.service';
import {
  addDaysToKey,
  dayBounds,
  dayKey,
  dayRange,
} from '../../../common/domain/time';
import { Prisma } from '../../../generated/prisma/client';
import { ReportSupportService } from './report-support.service';
import { SalesReportService } from './sales-report.service';

/** Resumen del día para el panel: ventas, tendencia semanal, cajas abiertas y alertas de stock. */
@Injectable()
export class DashboardService {
  constructor(
    private readonly domain: DomainService,
    private readonly support: ReportSupportService,
    private readonly sales: SalesReportService,
  ) {}

  async dashboard(actor: Actor, branchId?: string) {
    const scope = await this.domain.scope(actor, branchId);
    const zone = await this.support.zoneOf(actor, branchId);
    const period = dayRange(zone);
    const query = { page: 1, limit: 20, branchId };
    const [summary, trend, open, lowStockAlerts] = await Promise.all([
      this.sales.summary(actor, { ...period, ...query }),
      // Últimos 7 días (hoy incluido) para la gráfica del panel.
      this.sales.series(actor, {
        ...query,
        from: dayBounds(zone, addDaysToKey(dayKey(new Date(), zone), -6)).from!,
        to: period.to,
      }),
      this.domain.db.cashSession.count({
        where: {
          ...scope.where,
          closedAt: null,
          ...(scope.member.role === 'CASHIER' ? { actorId: actor.userId } : {}),
        },
      }),
      this.lowStockAlerts(actor, scope.where),
    ]);
    return {
      period,
      timeZone: zone,
      sales: summary,
      trend,
      openCashSessions: open,
      lowStockAlerts,
    };
  }

  /** Cantidad de artículos en o bajo su umbral, por almacén activo. */
  private async lowStockAlerts(
    actor: Actor,
    where: { organizationId: string; branchId: { in: string[] } },
  ): Promise<number> {
    const warehouses = await this.domain.db.warehouse.findMany({
      where: { ...where, archivedAt: null },
      select: { id: true },
    });
    if (!warehouses.length) return 0;
    const ids = Prisma.join(warehouses.map((w) => Prisma.sql`${w.id}::uuid`));
    const count = await this.domain.db.$queryRaw<Array<{ count: bigint }>>(
      Prisma.sql`SELECT count(*) FROM "Warehouse" w CROSS JOIN "ProductVariant" v JOIN "Product" p ON p.id=v."productId" AND p."organizationId"=v."organizationId" LEFT JOIN "InventoryBalance" b ON b."warehouseId"=w.id AND b."variantId"=v.id AND b."organizationId"=v."organizationId" WHERE w.id IN (${ids}) AND v."organizationId"=${actor.organizationId}::uuid AND v."archivedAt" IS NULL AND p."archivedAt" IS NULL AND COALESCE(b.quantity,0)<=p."lowStockThreshold"`,
    );
    return Number(count[0]?.count ?? 0);
  }
}
