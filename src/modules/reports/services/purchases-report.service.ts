import { Injectable } from '@nestjs/common';
import { Actor, DomainService } from '../../../common/domain/domain.service';
import { dates, PageInput, paging } from '../../../common/domain/input';
import { bucketSeries } from '../../../common/domain/time';
import { Prisma } from '../../../generated/prisma/client';
import type { ReportPage } from '../dto/report-type';
import {
  MAX_SERIES_ROWS,
  ReportSupportService,
} from './report-support.service';

type ReceiptLines = Array<{ quantity: string; unitCost: string }>;

/** Valor de una recepción: suma de cantidad × costo de sus líneas. */
const receiptTotal = (lines: unknown) =>
  (lines as ReceiptLines).reduce(
    (sum, l) => sum.plus(new Prisma.Decimal(l.quantity).mul(l.unitCost)),
    new Prisma.Decimal(0),
  );

/** Mercadería recibida. */
@Injectable()
export class PurchasesReportService {
  constructor(
    private readonly domain: DomainService,
    private readonly support: ReportSupportService,
  ) {}

  private async scopeOf(actor: Actor, q: PageInput) {
    await this.domain.authorize(this.domain.db, actor, 'manage');
    return (await this.domain.scope(actor, q.branchId)).where;
  }

  async receipts(actor: Actor, q: PageInput): Promise<ReportPage> {
    const scope = await this.scopeOf(actor, q);
    const receipts = await this.domain.db.goodsReceipt.findMany({
      where: { ...scope, createdAt: dates(q) },
      ...paging(q),
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
    return {
      items: receipts.map((r) => ({ ...r, total: receiptTotal(r.lines) })),
      page: q.page,
      limit: q.limit,
    };
  }

  /** Valor recibido por día (o por mes en rangos largos). */
  async receiptsCharts(actor: Actor, q: PageInput) {
    const scope = await this.scopeOf(actor, q);
    const zone = await this.support.zoneOf(actor, q.branchId);
    const range = this.support.chartRange(q, zone);
    const rows = await this.domain.db.goodsReceipt.findMany({
      where: { ...scope, createdAt: { gte: range.from, lte: range.to } },
      select: { createdAt: true, lines: true },
      take: MAX_SERIES_ROWS,
    });
    return {
      daily: bucketSeries(
        rows.map((r) => ({
          at: r.createdAt,
          value: receiptTotal(r.lines).toNumber(),
        })),
        zone,
        range.from,
        range.to,
      ),
    };
  }
}
