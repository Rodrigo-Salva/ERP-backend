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
import { CategoriesService } from '../services/categories.service';
import {
  catalogQuerySchema,
  createCategorySchema,
  updateCategorySchema,
  CatalogQuery,
  CreateCategoryInput,
  UpdateCategoryInput,
} from '../dto/catalog.input';
import {
  CategoriesPageDto,
  CategoryResponseDto,
} from '../dto/catalog.response';

@ApiTags('categories')
@ApiBearerAuth()
@Controller('organizations/:organizationId/categories')
export class CategoriesController {
  constructor(private readonly catalog: CategoriesService) {}

  @Get()
  @ApiOkResponse({ type: CategoriesPageDto })
  list(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Query(new InputPipe(catalogQuerySchema)) query: CatalogQuery,
  ) {
    return this.catalog.categories(req.auth.userId, organizationId, query);
  }

  @Post()
  @ApiCreatedResponse({ type: CategoryResponseDto })
  @InputDocs(createCategorySchema)
  create(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body(new InputPipe(createCategorySchema)) body: CreateCategoryInput,
  ) {
    return this.catalog.createCategory(context(req, organizationId), body);
  }

  @Patch(':id')
  @ApiOkResponse({ type: CategoryResponseDto })
  @InputDocs(updateCategorySchema)
  update(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new InputPipe(updateCategorySchema)) body: UpdateCategoryInput,
  ) {
    return this.catalog.updateCategory(context(req, organizationId), id, body);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @ApiOkResponse({ type: CategoryResponseDto })
  archive(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.catalog.archiveCategory(context(req, organizationId), id, true);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @ApiOkResponse({ type: CategoryResponseDto })
  restore(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.catalog.archiveCategory(
      context(req, organizationId),
      id,
      false,
    );
  }
}
