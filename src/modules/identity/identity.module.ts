import { Module } from '@nestjs/common';
import { DomainModule } from '../../common/domain/domain.module';
import { AuthModule } from '../auth/auth.module';
import { IdentityController } from './controllers/identity.controller';
import { IdentityService } from './services/identity.service';

/** Invitaciones, recuperación de contraseña y membresías (accesos por rol y sucursal). */
@Module({
  imports: [DomainModule, AuthModule],
  controllers: [IdentityController],
  providers: [IdentityService],
})
export class IdentityModule {}
