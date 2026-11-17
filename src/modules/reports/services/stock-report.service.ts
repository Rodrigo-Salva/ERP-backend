import { ForbiddenException, Injectable } from '@nestjs/common';
import { Actor, DomainService } from '../../../common/domain/domain.service';
import { dates, PageInput, paging } from '../../../common/domain/input';
import { Prisma } from '../../../generated/prisma/client';
import type { ReportPage } from '../dto/report-type';

/** Valoración de inventario y movimientos de existencias. */
@Injectable()
export class StockReportService {
  constructor(private readonly domain: DomainService) {}

  async valuation(
    actor: Actor,
    q: PageInput,
  ): Promise<ReportPage & { valuation: Prisma.Decimal }> {
    const scope = await this.domain.scope(actor, q.branchId);
    if (!this.domain.costs(scope.member))
      throw new ForbiddenException(
        'No puedes consultar valoración de inventario',
      );
    const balances = await this.domain.db.inventoryBalance.findMany({
      where: scope.where,
      ...paging(q),
      orderBy: { id: 'asc' },
    });
    const [labels, warehouses, total] = await Promise.all([
      this.domain.variantLabels(
        this.domain.db,
        actor.organizationId,
        balances.map((b) => b.variantId),
      ),
      this.domain.warehouseNames(
        this.domain.db,
        actor.organizationId,
        balances.map((b) => b.warehouseId),
      ),
      this.domain.db.inventoryBalance.aggregate({
        where: scope.where,
        _sum: { value: true },
      }),
    ]);
    return {
      items: balances.map((b) => ({
        ...b,
        sku: labels.get(b.variantId)?.sku ?? null,
        name: labels.get(b.variantId)?.name ?? null,
        warehouseName: warehouses.get(b.warehouseId) ?? null,
      })),
      valuation: total._sum.value ?? new Prisma.Decimal(0),
      page: q.page,
      limit: q.limit,
    };
  }

  /** Artículos que concentran más valor en existencias. */
  async valuationCharts(actor: Actor, q: PageInput) {
    const scope = await this.domain.scope(actor, q.branchId);
    const grouped = await this.domain.db.inventoryBalance.groupBy({
      by: ['variantId'],
      where: scope.where,
      _sum: { value: true },
      orderBy: { _sum: { value: 'desc' } },
      take: 8,
    });
    const labels = await this.domain.variantLabels(
      this.domain.db,
      actor.organizationId,
      grouped.map((g) => g.variantId),
    );
    return {
      topByValue: grouped
        .map((g) => ({
          sku: labels.get(g.variantId)?.sku ?? null,
          name: labels.get(g.variantId)?.name ?? 'Artículo',
          value: Number(g._sum.value ?? 0),
        }))
        .filter((g) => g.value > 0),
    };
  }

  async movements(actor: Actor, q: PageInput): Promise<ReportPage> {
    const scope = await this.domain.scope(actor, q.branchId);
    const costs = this.domain.costs(scope.member);
    const items = await this.domain.db.inventoryMovement.findMany({
      where: { ...scope.where, createdAt: dates(q) },
      ...paging(q),
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
    const [labels, warehouses] = await Promise.all([
      this.domain.variantLabels(
        this.domain.db,
        actor.organizationId,
        items.map((i) => i.variantId),
      ),
      this.domain.warehouseNames(
        this.domain.db,
        actor.organizationId,
        items.map((i) => i.warehouseId),
      ),
    ]);
    return {
      items: items.map(({ unitCost, valueDelta, ...movement }) => ({
        ...movement,
        sku: labels.get(movement.variantId)?.sku ?? null,
        name: labels.get(movement.variantId)?.name ?? null,
        warehouseName: warehouses.get(movement.warehouseId) ?? null,
        ...(costs ? { unitCost, valueDelta } : {}),
      })),
      page: q.page,
      limit: q.limit,
    };
  }

  /** Cantidad de movimientos por tipo en el período. */
  async movementsCharts(actor: Actor, q: PageInput) {
    const scope = await this.domain.scope(actor, q.branchId);
    const kinds = await this.domain.db.inventoryMovement.groupBy({
      by: ['kind'],
      where: { ...scope.where, createdAt: dates(q) },
      _count: true,
    });
    return {
      byKind: kinds
        .map((k) => ({ kind: k.kind, count: k._count }))
        .sort((a, b) => b.count - a.count),
    };
  }
}
