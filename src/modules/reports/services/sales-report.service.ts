import { Injectable } from '@nestjs/common';
import { Actor, DomainService } from '../../../common/domain/domain.service';
import { dates, PageInput } from '../../../common/domain/input';
import { bucketSeries, type Series } from '../../../common/domain/time';
import { Prisma } from '../../../generated/prisma/client';
import {
  MAX_SERIES_ROWS,
  ReportSupportService,
} from './report-support.service';

const dec = (value: Prisma.Decimal | null | undefined) =>
  value ?? new Prisma.Decimal(0);

@Injectable()
export class SalesReportService {
  constructor(
    private readonly domain: DomainService,
    private readonly support: ReportSupportService,
  ) {}

  /** Alcance de lectura: un cajero solo ve lo suyo; los demás pueden filtrar por usuario. */
  private async scopeOf(actor: Actor, q: PageInput) {
    const scope = await this.domain.scope(actor, q.branchId);
    const own =
      scope.member.role === 'CASHIER'
        ? { actorId: actor.userId }
        : q.actorId
          ? { actorId: q.actorId }
          : {};
    return { base: scope.where, own };
  }

  /** Totales del período, productos más vendidos y cobros por método de pago. */
  async summary(actor: Actor, q: PageInput) {
    const { base, own } = await this.scopeOf(actor, q);
    const where = { ...base, confirmedAt: { not: null, ...dates(q) }, ...own };
    const returnsWhere = { ...base, createdAt: dates(q), ...own };
    const [sales, returns, top, methods] = await Promise.all([
      this.domain.db.sale.aggregate({
        where,
        _count: true,
        _sum: { gross: true, discount: true, tax: true, total: true },
      }),
      this.domain.db.saleReturn.aggregate({
        where: returnsWhere,
        _sum: { gross: true, discount: true, tax: true, total: true },
      }),
      this.domain.db.saleLine.groupBy({
        by: ['variantId', 'sku', 'name'],
        where: { sale: where },
        _sum: { quantity: true, total: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 20,
      }),
      this.domain.db.payment.groupBy({
        by: ['methodName'],
        where: { sale: where },
        _sum: { amount: true },
        orderBy: { _sum: { amount: 'desc' } },
        take: 8,
      }),
    ]);
    const total = dec(sales._sum.total);
    const refund = dec(returns._sum.total);
    const tax = dec(sales._sum.tax).minus(dec(returns._sum.tax));
    return {
      byMethod: methods.map((m) => ({
        method: m.methodName,
        total: Number(m._sum.amount ?? 0),
      })),
      saleCount: sales._count,
      gross: dec(sales._sum.gross),
      discount: dec(sales._sum.discount),
      salesTotal: total,
      returnsTotal: refund,
      netTax: tax,
      netTotal: total.minus(refund),
      netSalesExcludingTax: total.minus(refund).minus(tax),
      averageTicket: sales._count
        ? total.div(sales._count).toDecimalPlaces(4)
        : new Prisma.Decimal(0),
      topProducts: top.map((p) => ({
        variantId: p.variantId,
        sku: p.sku,
        name: p.name,
        grossQuantity: p._sum.quantity,
        total: p._sum.total,
      })),
    };
  }

  /** Total vendido por día (o por mes en rangos largos), para las gráficas. */
  async series(actor: Actor, q: PageInput): Promise<Series> {
    const { base, own } = await this.scopeOf(actor, q);
    const zone = await this.support.zoneOf(actor, q.branchId);
    const range = this.support.chartRange(q, zone);
    const rows = await this.domain.db.sale.findMany({
      where: {
        ...base,
        ...own,
        confirmedAt: { not: null, gte: range.from, lte: range.to },
      },
      select: { confirmedAt: true, total: true },
      take: MAX_SERIES_ROWS,
    });
    return bucketSeries(
      rows.map((r) => ({ at: r.confirmedAt!, value: Number(r.total) })),
      zone,
      range.from,
      range.to,
    );
  }
}
