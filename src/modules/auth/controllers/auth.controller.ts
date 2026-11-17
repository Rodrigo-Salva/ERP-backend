import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { InputDocs, InputPipe } from '../../../common/domain/input';
import { RequestWithId } from '../../../common/http/request-context.middleware';
import {
  loginSchema,
  registerSchema,
  LoginInput,
  RegisterInput,
} from '../dto/auth.input';
import { ProfileResponseDto, SessionResponseDto } from '../dto/auth.response';
import { AuthService } from '../services/auth.service';
import {
  AuthenticatedRequest,
  Public,
} from '../../../common/auth/authenticated-request';

@ApiTags('auth')
@Controller('auth')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 10, ttl: 60000 } })
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({
    summary:
      'Crea propietario, organización, sucursal y almacén en una transacción',
  })
  @ApiCreatedResponse({ type: SessionResponseDto })
  @InputDocs(registerSchema)
  register(
    @Body(new InputPipe(registerSchema)) body: RegisterInput,
    @Req() request: RequestWithId,
  ) {
    return this.auth.register(body, request.requestId);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOkResponse({ type: SessionResponseDto })
  @InputDocs(loginSchema)
  login(
    @Body(new InputPipe(loginSchema)) body: LoginInput,
    @Req() request: RequestWithId,
  ) {
    return this.auth.login(body, request.requestId);
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Rota el token y conserva el vencimiento original de la sesión',
  })
  @ApiOkResponse({ type: SessionResponseDto })
  refresh(@Req() request: AuthenticatedRequest) {
    return this.auth.refresh(request.auth);
  }

  @Post('logout')
  @HttpCode(204)
  @ApiBearerAuth()
  logout(@Req() request: AuthenticatedRequest) {
    return this.auth.logout(request.auth, request.requestId);
  }
}

@ApiTags('auth')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  @ApiOperation({ summary: 'Usuario actual y membresías vigentes' })
  @ApiOkResponse({ type: ProfileResponseDto })
  profile(@Req() request: AuthenticatedRequest) {
    return this.auth.profile(request.auth.userId);
  }
}
