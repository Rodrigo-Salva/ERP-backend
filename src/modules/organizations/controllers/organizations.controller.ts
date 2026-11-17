import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InputPipe, PageInput, pageSchema } from '../../../common/domain/input';
import { OrganizationsService } from '../services/organizations.service';
import { AuthenticatedRequest } from '../../../common/auth/authenticated-request';

@ApiTags('organizations')
@ApiBearerAuth()
@Controller('organizations/:organizationId')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get('branches')
  async branches(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Query(new InputPipe(pageSchema)) query: PageInput,
  ) {
    return this.organizations.branches(req.auth.userId, organizationId, query);
  }

  @Get('members')
  async members(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Query(new InputPipe(pageSchema)) query: PageInput,
  ) {
    return this.organizations.members(req.auth.userId, organizationId, query);
  }
}
