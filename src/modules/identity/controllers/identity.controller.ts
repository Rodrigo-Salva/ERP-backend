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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  InputDocs,
  InputPipe,
  PageInput,
  pageSchema,
} from '../../../common/domain/input';
import { requestActor as actor } from '../../../common/domain/domain.service';
import {
  AuthenticatedRequest,
  Public,
} from '../../../common/auth/authenticated-request';
import { IdentityService } from '../services/identity.service';
import {
  acceptSchema,
  AcceptInput,
  forgotSchema,
  inviteSchema,
  InviteInput,
  membershipSchema,
  MembershipInput,
  resetSchema,
  ResetInput,
} from '../dto/identity.input';
@ApiTags('users')
@Controller()
export class IdentityController {
  constructor(private readonly service: IdentityService) {}
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('auth/forgot-password')
  @HttpCode(202)
  @InputDocs(forgotSchema)
  forgot(@Body(new InputPipe(forgotSchema)) body: { email: string }) {
    return this.service.forgot(body.email);
  }
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('auth/reset-password')
  @HttpCode(200)
  @InputDocs(resetSchema)
  reset(
    @Req() req: AuthenticatedRequest,
    @Body(new InputPipe(resetSchema)) body: ResetInput,
  ) {
    return this.service.reset(body, req.requestId);
  }
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('auth/accept-invitation')
  @HttpCode(200)
  @InputDocs(acceptSchema)
  accept(
    @Req() req: AuthenticatedRequest,
    @Body(new InputPipe(acceptSchema)) body: AcceptInput,
  ) {
    return this.service.accept(body, req.requestId);
  }
  @ApiBearerAuth()
  @Post('organizations/:organizationId/invitations')
  @InputDocs(inviteSchema)
  invite(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Body(new InputPipe(inviteSchema)) body: InviteInput,
  ) {
    return this.service.invite(actor(req, org), body);
  }
  @ApiBearerAuth()
  @Get('organizations/:organizationId/invitations')
  list(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Query(new InputPipe(pageSchema)) q: PageInput,
  ) {
    return this.service.invitations(actor(req, org), q);
  }
  @ApiBearerAuth()
  @Post('organizations/:organizationId/invitations/:id/revoke')
  revoke(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.revoke(actor(req, org), id);
  }
  @ApiBearerAuth()
  @Patch('organizations/:organizationId/members/:id')
  @InputDocs(membershipSchema)
  member(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) org: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new InputPipe(membershipSchema)) body: MembershipInput,
  ) {
    return this.service.membership(actor(req, org), id, body);
  }
}
