import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { Actor } from '../../../common/domain/domain.service';
import { PageInput } from '../../../common/domain/input';
import type {
  ListReportType,
  ReportPage,
  ReportType,
  Row,
} from '../dto/report-type';
import { AuditReportService } from './audit-report.service';
import { CashReportService } from './cash-report.service';
import { PurchasesReportService } from './purchases-report.service';
import { ReportSupportService } from './report-support.service';
import { SalesReportService } from './sales-report.service';
import { StockReportService } from './stock-report.service';

const BATCH = 100;
const MAX_EXPORT_PAGES = 1000;

/** Una fuente de reporte de filas: la página de datos y, opcionalmente, datos de gráficas. */
interface ListSource {
  page(actor: Actor, q: PageInput): Promise<ReportPage>;
  charts?(actor: Actor, q: PageInput): Promise<Row>;
}

/**
 * Punto único para consultar reportes. Resuelve los días del filtro una sola vez y delega
 * en el servicio de cada tema; las exportaciones leen las mismas fuentes, sin gráficas.
 */
@Injectable()
export class ReportsService {
  private readonly sources: Record<ListReportType, ListSource>;

  constructor(
    private readonly support: ReportSupportService,
    private readonly sales: SalesReportService,
    private readonly audits: AuditReportService,
    stock: StockReportService,
    cash: CashReportService,
    purchases: PurchasesReportService,
  ) {
    this.sources = {
      inventory: {
        page: (a, q) => stock.valuation(a, q),
        charts: (a, q) => stock.valuationCharts(a, q),
      },
      movements: {
        page: (a, q) => stock.movements(a, q),
        charts: (a, q) => stock.movementsCharts(a, q),
      },
      cash: { page: (a, q) => cash.sessions(a, q) },
      purchases: {
        page: (a, q) => purchases.receipts(a, q),
        charts: (a, q) => purchases.receiptsCharts(a, q),
      },
      expenses: {
        page: (a, q) => cash.expenses(a, q),
        charts: (a, q) => cash.expensesCharts(a, q),
      },
    };
  }

  /** Reporte para pantalla: datos principales más los de las gráficas. */
  async report(actor: Actor, type: ReportType, raw: PageInput) {
    const q = await this.support.resolveDays(actor, raw);
    if (type === 'sales')
      return {
        daily: await this.sales.series(actor, q),
        ...(await this.sales.summary(actor, q)),
      };
    const source = this.sources[type];
    return {
      ...(await source.charts?.(actor, q)),
      ...(await source.page(actor, q)),
    };
  }

  /** Resumen de ventas para exportar (sin series ni rankings). */
  async salesSummary(actor: Actor, raw: PageInput) {
    return this.sales.summary(
      actor,
      await this.support.resolveDays(actor, raw),
    );
  }

  /** Todas las filas del filtro, recorriendo las páginas (lotes de 100, orden estable). */
  async collect(
    actor: Actor,
    type: ListReportType,
    raw: PageInput,
  ): Promise<Row[]> {
    const q = await this.support.resolveDays(actor, raw);
    const items: Row[] = [];
    for (let page = 1; ; page++) {
      if (page > MAX_EXPORT_PAGES)
        throw new UnprocessableEntityException(
          'La exportación supera el máximo permitido; acota el rango de fechas',
        );
      const batch = (
        await this.sources[type].page(actor, { ...q, page, limit: BATCH })
      ).items;
      items.push(...batch);
      if (batch.length < BATCH) break;
    }
    return items;
  }

  async audit(actor: Actor, raw: PageInput) {
    return this.audits.events(
      actor,
      await this.support.resolveDays(actor, raw),
    );
  }
}
