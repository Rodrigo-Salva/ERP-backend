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
import { ExpenseCategoriesService } from '../services/expense-categories.service';
import {
  categoryPatch,
  categorySchema,
  CategoryInput,
  CategoryPatch,
} from '../dto/expense-category.input';

@ApiTags('expense-categories')
@ApiBearerAuth()
@Controller('organizations/:organizationId')
export class ExpenseCategoriesController {
  constructor(private readonly service: ExpenseCategoriesService) {}
  @Get('expense-categories')
  categories(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Query(new InputPipe(pageSchema)) q: PageInput,
  ) {
    return this.service.categories(actor(req, org), q);
  }
  @Post('expense-categories')
  @InputDocs(categorySchema)
  category(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Body(new InputPipe(categorySchema)) body: CategoryInput,
  ) {
    return this.service.category(actor(req, org), body);
  }
  @Patch('expense-categories/:id')
  @InputDocs(categoryPatch)
  categoryPatch(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new InputPipe(categoryPatch)) body: CategoryPatch,
  ) {
    return this.service.category(actor(req, org), body, id);
  }
}
