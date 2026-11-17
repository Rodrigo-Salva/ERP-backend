import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from '../../database/database.module';
import { AuthController, MeController } from './controllers/auth.controller';
import { AuthService } from './services/auth.service';
import { PasswordService } from './services/password.service';
import { SessionGuard } from './guards/session.guard';
import { DomainModule } from '../../common/domain/domain.module';
import { MailService } from './services/mail.service';

@Module({
  imports: [
    DatabaseModule,
    DomainModule,
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 10 }]),
  ],
  controllers: [AuthController, MeController],
  providers: [
    AuthService,
    PasswordService,
    MailService,
    { provide: APP_GUARD, useClass: SessionGuard },
  ],
  // Lo comparte con IdentityModule (correo, contraseñas y límite de peticiones).
  exports: [ThrottlerModule, PasswordService, MailService],
})
export class AuthModule {}
