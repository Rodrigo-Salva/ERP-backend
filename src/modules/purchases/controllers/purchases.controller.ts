import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import {
  InputDocs,
  InputPipe,
  PageInput,
  pageSchema,
} from '../../../common/domain/input';
import { requestActor as actor } from '../../../common/domain/domain.service';
import { AuthenticatedRequest } from '../../../common/auth/authenticated-request';
import { PurchasesService } from '../services/purchases.service';
import {
  SupplierInput,
  SupplierPatch,
  PurchaseInput,
  ReceiptInput,
  supplierSchema,
  supplierPatch,
  purchaseSchema,
  receiptSchema,
} from '../dto/purchases.input';
@ApiTags('purchases')
@ApiBearerAuth()
@Controller('organizations/:organizationId')
export class PurchasesController {
  constructor(private readonly service: PurchasesService) {}
  @Get('suppliers')
  suppliers(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Query(new InputPipe(pageSchema)) q: PageInput,
  ) {
    return this.service.suppliers(actor(req, org), q);
  }

  @Post('suppliers')
  @InputDocs(supplierSchema)
  supplier(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Body(new InputPipe(supplierSchema)) body: SupplierInput,
  ) {
    return this.service.supplier(actor(req, org), body);
  }

  @Patch('suppliers/:id')
  @InputDocs(supplierPatch)
  update(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new InputPipe(supplierPatch)) body: SupplierPatch,
  ) {
    return this.service.supplier(actor(req, org), body, id);
  }

  @Post('purchase-orders')
  @InputDocs(purchaseSchema)
  create(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Body(new InputPipe(purchaseSchema)) body: PurchaseInput,
  ) {
    return this.service.create(actor(req, org), body);
  }

  @Get('purchase-orders')
  list(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Query(new InputPipe(pageSchema)) q: PageInput,
  ) {
    return this.service.list(actor(req, org), q);
  }

  @Get('purchase-orders/:id')
  detail(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.detail(actor(req, org), id);
  }

  @Post('purchase-orders/:id/send')
  send(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.transition(actor(req, org), id, 'SENT');
  }

  @Post('purchase-orders/:id/cancel')
  cancel(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.transition(actor(req, org), id, 'CANCELLED');
  }

  @Get('purchase-orders/:id/receipts')
  receipts(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.receipts(actor(req, org), id);
  }

  @Post('purchase-orders/:id/receipts')
  @InputDocs(receiptSchema)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  receive(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new InputPipe(receiptSchema)) body: ReceiptInput,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.service.receive(actor(req, org), id, body, key);
  }
}
