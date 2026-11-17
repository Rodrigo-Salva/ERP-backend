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
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import {
  InputDocs,
  InputPipe,
  PageInput,
  pageSchema,
} from '../../../common/domain/input';
import { AuthenticatedRequest } from '../../../common/auth/authenticated-request';
import {
  AdjustmentInput,
  adjustmentSchema,
  TransferInput,
  transferSchema,
} from '../dto/inventory.input';
import { InventoryService } from '../services/inventory.service';
export const actor = (req: AuthenticatedRequest, organizationId: string) => ({
  organizationId,
  userId: req.auth.userId,
  requestId: req.requestId,
});
@ApiTags('inventory')
@ApiBearerAuth()
@Controller('organizations/:organizationId/inventory')
export class InventoryController {
  constructor(private readonly service: InventoryService) {}
  @Get('balances')
  balances(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Query(new InputPipe(pageSchema)) q: PageInput,
  ) {
    return this.service.balances(actor(req, org), q);
  }
  @Get('movements')
  movements(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Query(new InputPipe(pageSchema)) q: PageInput,
  ) {
    return this.service.movements(actor(req, org), q);
  }
  @Get('low-stock')
  low(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Query('warehouseId', ParseUUIDPipe) warehouseId: string,
  ) {
    return this.service.lowStock(actor(req, org), warehouseId);
  }
  @Post('adjustments')
  @InputDocs(adjustmentSchema)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  adjust(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Body(new InputPipe(adjustmentSchema)) body: AdjustmentInput,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.service.adjust(actor(req, org), body, key);
  }
  @Get('transfers')
  transfers(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Query(new InputPipe(pageSchema)) q: PageInput,
  ) {
    return this.service.transfers(actor(req, org), q);
  }
  @Post('transfers')
  @InputDocs(transferSchema)
  create(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Body(new InputPipe(transferSchema)) body: TransferInput,
  ) {
    return this.service.createTransfer(actor(req, org), body);
  }
  @Post('transfers/:id/send')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  send(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.service.transition(actor(req, org), id, 'send', key);
  }
  @Post('transfers/:id/receive')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  receive(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.service.transition(actor(req, org), id, 'receive', key);
  }
  @Post('transfers/:id/cancel')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  cancel(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.service.transition(actor(req, org), id, 'cancel', key);
  }
}
