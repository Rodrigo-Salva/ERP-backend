import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InputDocs, InputPipe } from '../../../common/domain/input';
import { requestActor as actor } from '../../../common/domain/domain.service';
import { AuthenticatedRequest } from '../../../common/auth/authenticated-request';
import { OrganizationSettingsService } from '../services/organization-settings.service';
import {
  organizationSchema,
  settingsSchema,
  OrganizationInput,
  SettingsInput,
} from '../dto/organization.input';

@ApiTags('organizations')
@ApiBearerAuth()
@Controller('organizations')
export class OrganizationSettingsController {
  constructor(private readonly service: OrganizationSettingsService) {}
  @Post()
  @InputDocs(organizationSchema)
  createOrganization(
    @Req() req: AuthenticatedRequest,
    @Body(new InputPipe(organizationSchema)) body: OrganizationInput,
  ) {
    return this.service.createOrganization(
      req.auth.userId,
      req.requestId,
      body,
    );
  }
  @Get(':organizationId/settings')
  settings(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
  ) {
    return this.service.settings(actor(req, org));
  }
  @Patch(':organizationId/settings')
  @InputDocs(settingsSchema)
  updateSettings(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Body(new InputPipe(settingsSchema)) body: SettingsInput,
  ) {
    return this.service.updateSettings(actor(req, org), body);
  }
}
