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
import { VariantsService } from '../services/variants.service';
import {
  variantPatch,
  variantSchema,
  VariantInput,
  VariantPatch,
} from '../dto/variants.input';

@ApiTags('variants')
@ApiBearerAuth()
@Controller('organizations/:organizationId')
export class VariantsController {
  constructor(private readonly service: VariantsService) {}
  @Get('variants')
  variants(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Query(new InputPipe(pageSchema)) q: PageInput,
  ) {
    return this.service.variants(actor(req, org), q);
  }
  @Get('products/:id/variants')
  productVariants(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new InputPipe(pageSchema)) q: PageInput,
  ) {
    return this.service.variants(actor(req, org), q, id);
  }
  @Post('products/:id/variants')
  @InputDocs(variantSchema)
  variant(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new InputPipe(variantSchema)) body: VariantInput,
  ) {
    return this.service.variant(actor(req, org), id, body);
  }
  @Patch('products/:id/variants/:variantId')
  @InputDocs(variantPatch)
  variantPatch(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body(new InputPipe(variantPatch)) body: VariantPatch,
  ) {
    return this.service.variant(actor(req, org), id, body, variantId);
  }
}
