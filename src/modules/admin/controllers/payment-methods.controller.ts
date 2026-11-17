import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  InputDocs,
  InputPipe,
  PageInput,
  pageSchema,
} from '../../../common/domain/input';
import { requestActor as actor } from '../../../common/domain/domain.service';
import { AuthenticatedRequest } from '../../../common/auth/authenticated-request';
import { PaymentMethodsService } from '../services/payment-methods.service';
import {
  methodPatch,
  methodSchema,
  MethodInput,
  MethodPatch,
} from '../dto/payment-method.input';

@ApiTags('payment-methods')
@ApiBearerAuth()
@Controller('organizations/:organizationId')
export class PaymentMethodsController {
  constructor(private readonly service: PaymentMethodsService) {}
  @Get('payment-methods')
  methods(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Query(new InputPipe(pageSchema)) q: PageInput,
  ) {
    return this.service.methods(actor(req, org), q);
  }
  @Post('payment-methods')
  @InputDocs(methodSchema)
  method(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Body(new InputPipe(methodSchema)) body: MethodInput,
  ) {
    return this.service.method(actor(req, org), body);
  }
  @Patch('payment-methods/:id')
  @InputDocs(methodPatch)
  methodPatch(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new InputPipe(methodPatch)) body: MethodPatch,
  ) {
    return this.service.method(actor(req, org), body, id);
  }
}
