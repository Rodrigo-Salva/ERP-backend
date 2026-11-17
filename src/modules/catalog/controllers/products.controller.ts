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
import { ProductsService } from '../services/products.service';
import {
  createProductSchema,
  productsQuerySchema,
  updateProductSchema,
  CreateProductInput,
  ProductsQuery,
  UpdateProductInput,
} from '../dto/catalog.input';
import { ProductResponseDto, ProductsPageDto } from '../dto/catalog.response';

@ApiTags('products')
@ApiBearerAuth()
@Controller('organizations/:organizationId/products')
export class ProductsController {
  constructor(private readonly catalog: ProductsService) {}

  @Get()
  @ApiOkResponse({ type: ProductsPageDto })
  list(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Query(new InputPipe(productsQuerySchema)) query: ProductsQuery,
  ) {
    return this.catalog.products(req.auth.userId, organizationId, query);
  }

  @Get(':id')
  @ApiOkResponse({ type: ProductResponseDto })
  detail(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.catalog.detail(req.auth.userId, organizationId, id);
  }

  @Post()
  @ApiCreatedResponse({ type: ProductResponseDto })
  @InputDocs(createProductSchema)
  create(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body(new InputPipe(createProductSchema)) body: CreateProductInput,
  ) {
    return this.catalog.createProduct(context(req, organizationId), body);
  }

  @Patch(':id')
  @ApiOkResponse({ type: ProductResponseDto })
  @InputDocs(updateProductSchema)
  update(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new InputPipe(updateProductSchema)) body: UpdateProductInput,
  ) {
    return this.catalog.updateProduct(context(req, organizationId), id, body);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @ApiOkResponse({ type: ProductResponseDto })
  archive(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.catalog.archiveProduct(context(req, organizationId), id, true);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @ApiOkResponse({ type: ProductResponseDto })
  restore(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.catalog.archiveProduct(context(req, organizationId), id, false);
  }
}
