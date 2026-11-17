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
import { requestActor as actor } from '../../../common/domain/domain.service';
import { AuthenticatedRequest } from '../../../common/auth/authenticated-request';
import { CashService } from '../services/cash.service';
import {
  cashMovementSchema,
  closeCashSchema,
  expenseSchema,
  openCashSchema,
  registerSchema,
  CashMovementInput,
  CloseCashInput,
  ExpenseInput,
  OpenCashInput,
  RegisterInput,
} from '../dto/cash.input';

@ApiTags('cash')
@ApiBearerAuth()
@Controller('organizations/:organizationId')
export class CashController {
  constructor(private readonly cash: CashService) {}
  @Get('cash-registers')
  registersList(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Query(new InputPipe(pageSchema)) q: PageInput,
  ) {
    return this.cash.listRegisters(actor(req, org), q);
  }
  @Post('cash-registers')
  @InputDocs(registerSchema)
  register(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Body(new InputPipe(registerSchema)) body: RegisterInput,
  ) {
    return this.cash.registers(actor(req, org), body);
  }
  @Get('cash-sessions')
  cashList(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Query(new InputPipe(pageSchema)) q: PageInput,
  ) {
    return this.cash.list(actor(req, org), q);
  }
  @Get('cash-sessions/:id')
  cashDetail(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.cash.detail(actor(req, org), id);
  }
  @Post('cash-sessions')
  @InputDocs(openCashSchema)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  open(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Body(new InputPipe(openCashSchema)) body: OpenCashInput,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.cash.open(actor(req, org), body, key);
  }
  @Post('cash-sessions/:id/close')
  @InputDocs(closeCashSchema)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  close(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new InputPipe(closeCashSchema)) body: CloseCashInput,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.cash.close(actor(req, org), id, body, key);
  }
  @Post('cash-sessions/:id/movements')
  @InputDocs(cashMovementSchema)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  movement(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new InputPipe(cashMovementSchema)) body: CashMovementInput,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.cash.manual(actor(req, org), id, body, key);
  }
  @Get('expenses')
  expenses(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Query(new InputPipe(pageSchema)) q: PageInput,
  ) {
    return this.cash.expenses(actor(req, org), q);
  }
  @Post('expenses')
  @InputDocs(expenseSchema)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  expense(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Body(new InputPipe(expenseSchema)) body: ExpenseInput,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.cash.expense(actor(req, org), body, key);
  }
}
