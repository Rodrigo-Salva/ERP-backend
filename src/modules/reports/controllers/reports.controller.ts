import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { requestActor as actor } from '../../../common/domain/domain.service';
import { InputPipe, PageInput, pageSchema } from '../../../common/domain/input';
import { AuthenticatedRequest } from '../../../common/auth/authenticated-request';
import { ReportType, reportTypeSchema } from '../dto/report-type';
import { DashboardService } from '../services/dashboard.service';
import { ReportExportService } from '../services/report-export.service';
import { ReportsService } from '../services/reports.service';

const XLSX_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** Nombre del archivo exportado, en español, según el reporte. */
const FILE_NAMES: Record<ReportType, string> = {
  sales: 'ventas',
  inventory: 'valoracion',
  movements: 'movimientos',
  cash: 'caja',
  purchases: 'compras',
  expenses: 'gastos',
};

@ApiTags('reports')
@ApiBearerAuth()
@Controller('organizations/:organizationId')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly exports: ReportExportService,
    private readonly dashboards: DashboardService,
  ) {}

  @Get('dashboard')
  dashboard(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Query(new InputPipe(pageSchema)) q: PageInput,
  ) {
    return this.dashboards.dashboard(actor(req, org), q.branchId);
  }

  @Get('audit-events')
  audit(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Query(new InputPipe(pageSchema)) q: PageInput,
  ) {
    return this.reports.audit(actor(req, org), q);
  }

  @Get('reports/:type')
  report(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Param('type', new InputPipe(reportTypeSchema)) type: ReportType,
    @Query(new InputPipe(pageSchema)) q: PageInput,
  ) {
    return this.reports.report(actor(req, org), type, q);
  }

  @Get('reports/:type/csv')
  async csv(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Param('type', new InputPipe(reportTypeSchema)) type: ReportType,
    @Query(new InputPipe(pageSchema)) q: PageInput,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.type('text/csv');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${type}.csv"`,
    );
    return this.exports.csv(actor(req, org), type, q);
  }

  @Get('reports/:type/xlsx')
  async workbook(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Param('type', new InputPipe(reportTypeSchema)) type: ReportType,
    @Query(new InputPipe(pageSchema)) q: PageInput,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.exports.workbook(actor(req, org), type, q);
    response.type(XLSX_TYPE);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="tendio-${FILE_NAMES[type]}-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    );
    return new StreamableFile(file.buffer);
  }
}
