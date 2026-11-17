import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthenticatedRequest } from '../../../common/auth/authenticated-request';
import { InputDocs, InputPipe } from '../../../common/domain/input';
import { context } from './catalog-context';
import { UnitsService } from '../services/units.service';
import {
  catalogQuerySchema,
  createUnitSchema,
  updateUnitSchema,
  CatalogQuery,
  CreateUnitInput,
  UpdateUnitInput,
} from '../dto/catalog.input';
import { UnitResponseDto, UnitsPageDto } from '../dto/catalog.response';

@ApiTags('units')
@ApiBearerAuth()
@Controller('organizations/:organizationId/units')
export class UnitsController {
  constructor(private readonly catalog: UnitsService) {}

  @Get()
  @ApiOkResponse({ type: UnitsPageDto })
  list(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Query(new InputPipe(catalogQuerySchema)) query: CatalogQuery,
  ) {
    return this.catalog.units(req.auth.userId, organizationId, query);
  }

  @Post()
  @ApiCreatedResponse({ type: UnitResponseDto })
  @InputDocs(createUnitSchema)
  create(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body(new InputPipe(createUnitSchema)) body: CreateUnitInput,
  ) {
    return this.catalog.createUnit(context(req, organizationId), body);
  }

  @Patch(':id')
  @ApiOkResponse({ type: UnitResponseDto })
  @InputDocs(updateUnitSchema)
  update(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new InputPipe(updateUnitSchema)) body: UpdateUnitInput,
  ) {
    return this.catalog.updateUnit(context(req, organizationId), id, body);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @ApiOkResponse({ type: UnitResponseDto })
  archive(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.catalog.archiveUnit(context(req, organizationId), id, true);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @ApiOkResponse({ type: UnitResponseDto })
  restore(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.catalog.archiveUnit(context(req, organizationId), id, false);
  }
}
