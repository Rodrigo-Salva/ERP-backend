import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import { z } from 'zod';
import {
  InputDocs,
  InputPipe,
  PageInput,
  pageSchema,
} from '../../../common/domain/input';
import { requestActor as actor } from '../../../common/domain/domain.service';
import { AuthenticatedRequest } from '../../../common/auth/authenticated-request';
import { SaleReturnsService } from '../services/sale-returns.service';
import { SalesService } from '../services/sales.service';
import {
  saleSchema,
  confirmSchema,
  returnSchema,
  cancelSchema,
  SaleInput,
  ConfirmInput,
  ReturnInput,
  CancelInput,
} from '../dto/sales.input';
@ApiTags('sales')
@ApiBearerAuth()
@Controller('organizations/:organizationId')
export class SalesController {
  constructor(
    private readonly sales: SalesService,
    private readonly saleReturns: SaleReturnsService,
  ) {}
  @Get('sales')
  salesList(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Query(new InputPipe(pageSchema)) q: PageInput,
  ) {
    return this.sales.list(actor(req, org), q);
  }
  @Get('sales/:id')
  sale(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.sales.get(actor(req, org), id);
  }
  @Post('sales')
  @InputDocs(saleSchema)
  create(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Body(new InputPipe(saleSchema)) body: SaleInput,
  ) {
    return this.sales.create(actor(req, org), body);
  }
  @Post('sales/:id/confirm')
  @InputDocs(confirmSchema)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  confirm(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new InputPipe(confirmSchema)) body: ConfirmInput,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.sales.confirm(actor(req, org), id, body, key);
  }
  @Post('sales/:id/returns')
  @InputDocs(returnSchema)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  returns(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new InputPipe(returnSchema)) body: ReturnInput,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.saleReturns.returns(actor(req, org), id, body, key);
  }
  @Post('sales/:id/cancel')
  @InputDocs(cancelSchema)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  cancel(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new InputPipe(cancelSchema)) body: CancelInput,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.saleReturns.cancel(actor(req, org), id, body, key);
  }
  @Get('sales/:id/receipt')
  @ApiProduces('application/json', 'text/html')
  async receipt(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('format', new InputPipe(z.enum(['json', 'html']).default('json')))
    format: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.type(format === 'html' ? 'text/html' : 'application/json');
    return this.sales.receipt(actor(req, org), id, format === 'html');
  }
}
