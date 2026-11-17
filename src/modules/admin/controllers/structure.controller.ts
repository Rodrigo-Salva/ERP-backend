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
import { StructureService } from '../services/structure.service';
import {
  branchPatch,
  branchSchema,
  warehouseSchema,
  BranchInput,
  BranchPatch,
  WarehouseInput,
} from '../dto/organization.input';

@ApiTags('structure')
@ApiBearerAuth()
@Controller('organizations/:organizationId')
export class StructureController {
  constructor(private readonly service: StructureService) {}
  @Post('branches')
  @InputDocs(branchSchema)
  branch(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Body(new InputPipe(branchSchema)) body: BranchInput,
  ) {
    return this.service.branch(actor(req, org), body);
  }
  @Patch('branches/:id')
  @InputDocs(branchPatch)
  branchPatch(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new InputPipe(branchPatch)) body: BranchPatch,
  ) {
    return this.service.branch(actor(req, org), body, id);
  }
  @Get('warehouses')
  warehouses(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Query(new InputPipe(pageSchema)) q: PageInput,
  ) {
    return this.service.warehouses(actor(req, org), q);
  }
  @Post('warehouses')
  @InputDocs(warehouseSchema)
  warehouse(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Body(new InputPipe(warehouseSchema)) body: WarehouseInput,
  ) {
    return this.service.warehouse(actor(req, org), body);
  }
}
