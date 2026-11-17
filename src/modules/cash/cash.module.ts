import { Module } from '@nestjs/common';
import { DomainModule } from '../../common/domain/domain.module';
import { CashController } from './controllers/cash.controller';
import { CashService } from './services/cash.service';

@Module({
  imports: [DomainModule],
  controllers: [CashController],
  providers: [CashService],
  exports: [CashService],
})
export class CashModule {}
