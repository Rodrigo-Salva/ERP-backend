import { Injectable } from '@nestjs/common';
import { Actor, DomainService } from '../../../common/domain/domain.service';
import { dates, PageInput, paging } from '../../../common/domain/input';
import { Prisma } from '../../../generated/prisma/client';
import type { ReportPage } from '../dto/report-type';

/** Sesiones de caja y gastos. */
@Injectable()
export class CashReportService {
  constructor(private readonly domain: DomainService) {}

  async sessions(actor: Actor, q: PageInput): Promise<ReportPage> {
    const scope = await this.domain.scope(actor, q.branchId);
    return {
      items: await this.domain.db.cashSession.findMany({
        where: {
          ...scope.where,
          createdAt: dates(q),
          ...(scope.member.role === 'CASHIER' ? { actorId: actor.userId } : {}),
        },
        ...paging(q),
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      }),
      page: q.page,
      limit: q.limit,
    };
  }

  private async expenseWhere(actor: Actor, q: PageInput) {
    await this.domain.authorize(this.domain.db, actor, 'manage');
    const scope = await this.domain.scope(actor, q.branchId);
    return { ...scope.where, occurredAt: dates(q) };
  }

  async expenses(
    actor: Actor,
    q: PageInput,
  ): Promise<ReportPage & { total: Prisma.Decimal }> {
    const where = await this.expenseWhere(actor, q);
    const [items, total] = await Promise.all([
      this.domain.db.expense.findMany({
        where,
        ...paging(q),
        orderBy: [{ occurredAt: 'desc' }, { id: 'asc' }],
      }),
      this.domain.db.expense.aggregate({ where, _sum: { amount: true } }),
    ]);
    return {
      items,
      total: total._sum.amount ?? new Prisma.Decimal(0),
      page: q.page,
      limit: q.limit,
    };
  }

  /** Gasto total por categoría (las 8 mayores). */
  async expensesCharts(actor: Actor, q: PageInput) {
    const where = await this.expenseWhere(actor, q);
    const grouped = await this.domain.db.expense.groupBy({
      by: ['categoryId'],
      where,
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
      take: 8,
    });
    const names = new Map(
      (
        await this.domain.db.expenseCategory.findMany({
          where: {
            organizationId: actor.organizationId,
            id: { in: grouped.map((g) => g.categoryId) },
          },
          select: { id: true, name: true },
        })
      ).map((c) => [c.id, c.name]),
    );
    return {
      byCategory: grouped.map((g) => ({
        category: names.get(g.categoryId) ?? 'Sin categoría',
        total: Number(g._sum.amount ?? 0),
      })),
    };
  }
}
