import { Module } from '@nestjs/common';
import { DomainModule } from '../../common/domain/domain.module';
import { ReportsController } from './controllers/reports.controller';
import { AuditReportService } from './services/audit-report.service';
import { CashReportService } from './services/cash-report.service';
import { DashboardService } from './services/dashboard.service';
import { PurchasesReportService } from './services/purchases-report.service';
import { ReportExportService } from './services/report-export.service';
import { ReportSupportService } from './services/report-support.service';
import { ReportsService } from './services/reports.service';
import { SalesReportService } from './services/sales-report.service';
import { StockReportService } from './services/stock-report.service';

@Module({
  imports: [DomainModule],
  controllers: [ReportsController],
  providers: [
    ReportSupportService,
    SalesReportService,
    StockReportService,
    CashReportService,
    PurchasesReportService,
    AuditReportService,
    DashboardService,
    ReportsService,
    ReportExportService,
  ],
})
export class ReportsModule {}
