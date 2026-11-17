import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { OrganizationsModule } from '../../modules/organizations/organizations.module';
import { DomainService } from './domain.service';
@Module({
  imports: [DatabaseModule, OrganizationsModule],
  providers: [DomainService],
  exports: [DomainService],
})
export class DomainModule {}
