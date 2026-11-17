import { Injectable } from '@nestjs/common';
import { Actor, DomainService } from '../../../common/domain/domain.service';
import { PageInput } from '../../../common/domain/input';
import type { ListReportType, ReportType, Row } from '../dto/report-type';
import { csv, flattenRow } from '../exports/csv';
import {
  cashSheets,
  expensesSheets,
  inventorySheets,
  movementsSheets,
  purchasesSheets,
  salesSheets,
} from '../exports/report-sheets';
import {
  buildWorkbook,
  formatLocal,
  type Sheet,
  type WorkbookMeta,
} from '../exports/report-workbook';
import { ReportsService } from './reports.service';

/** Exportaciones: CSV y libro de Excel con el mismo alcance y filtros que la pantalla. */
@Injectable()
export class ReportExportService {
  constructor(
    private readonly domain: DomainService,
    private readonly reports: ReportsService,
  ) {}

  async csv(actor: Actor, type: ReportType, q: PageInput): Promise<string> {
    if (type === 'sales') {
      // Solo los totales: los rankings y cobros por método tienen su propia hoja en Excel.
      const summary = await this.reports.salesSummary(actor, q);
      return csv([
        Object.fromEntries(
          Object.entries(summary).filter(
            ([key]) => key !== 'topProducts' && key !== 'byMethod',
          ),
        ),
      ]);
    }
    return csv((await this.reports.collect(actor, type, q)).map(flattenRow));
  }

  async workbook(actor: Actor, type: ReportType, q: PageInput) {
    const [meta, sheets] = await Promise.all([
      this.meta(actor, q),
      this.sheets(actor, type, q),
    ]);
    return { buffer: await buildWorkbook(sheets, meta) };
  }

  /** Datos de cabecera: tienda, sucursal, período, zona horaria y símbolo de moneda. */
  private async meta(actor: Actor, q: PageInput): Promise<WorkbookMeta> {
    const [organization, branch] = await Promise.all([
      this.domain.db.organization.findUniqueOrThrow({
        where: { id: actor.organizationId },
      }),
      q.branchId
        ? this.domain.db.branch.findFirst({
            where: { id: q.branchId, organizationId: actor.organizationId },
          })
        : null,
    ]);
    const timeZone = branch?.timeZone ?? organization.timeZone;
    const day = (iso: string) =>
      formatLocal(new Date(iso), timeZone).split(',')[0];
    return {
      organization: organization.name,
      branch: branch?.name ?? 'Todas las sucursales',
      period:
        q.fromDay || q.toDay
          ? `${q.fromDay ?? 'inicio'} a ${q.toDay ?? 'hoy'}`
          : q.from || q.to
            ? `${q.from ? day(q.from) : 'inicio'} a ${q.to ? day(q.to) : 'hoy'}`
            : 'Todo el historial',
      timeZone,
      currencySymbol:
        new Intl.NumberFormat(organization.locale, {
          style: 'currency',
          currency: organization.currency,
        })
          .formatToParts(0)
          .find((part) => part.type === 'currency')?.value ??
        organization.currency,
      generatedAt: new Date(),
    };
  }

  private async sheets(
    actor: Actor,
    type: ReportType,
    q: PageInput,
  ): Promise<Sheet[]> {
    if (type === 'sales')
      return salesSheets(await this.reports.salesSummary(actor, q));
    const items = await this.reports.collect(actor, type, q);
    return this.listSheets(actor, type, items);
  }

  private async listSheets(
    actor: Actor,
    type: ListReportType,
    items: Row[],
  ): Promise<Sheet[]> {
    switch (type) {
      case 'inventory':
        return inventorySheets(items);
      case 'movements':
        return movementsSheets(items);
      case 'purchases':
        return purchasesSheets(items);
      case 'cash':
        return cashSheets(items, await this.registerNames(actor, items));
      case 'expenses':
        return expensesSheets(items, await this.categoryNames(actor, items));
    }
  }

  private async registerNames(actor: Actor, items: Row[]) {
    const rows = await this.domain.db.cashRegister.findMany({
      where: {
        organizationId: actor.organizationId,
        id: { in: items.map((i) => String(i.cashRegisterId)) },
      },
      select: { id: true, name: true },
    });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private async categoryNames(actor: Actor, items: Row[]) {
    const rows = await this.domain.db.expenseCategory.findMany({
      where: {
        organizationId: actor.organizationId,
        id: { in: items.map((i) => String(i.categoryId)) },
      },
      select: { id: true, name: true },
    });
    return new Map(rows.map((r) => [r.id, r.name]));
  }
}
