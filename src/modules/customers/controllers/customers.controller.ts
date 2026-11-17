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
import { CustomersService } from '../services/customers.service';
import {
  customerPatch,
  customerSchema,
  CustomerInput,
  CustomerPatch,
} from '../dto/customers.input';

@ApiTags('customers')
@ApiBearerAuth()
@Controller('organizations/:organizationId/customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}
  @Get()
  list(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Query(new InputPipe(pageSchema)) q: PageInput,
  ) {
    return this.customers.list(actor(req, org), q);
  }
  @Post()
  @InputDocs(customerSchema)
  save(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Body(new InputPipe(customerSchema)) body: CustomerInput,
  ) {
    return this.customers.save(actor(req, org), body);
  }
  @Patch(':id')
  @InputDocs(customerPatch)
  update(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new InputPipe(customerPatch)) body: CustomerPatch,
  ) {
    return this.customers.save(actor(req, org), body, id);
  }
}
