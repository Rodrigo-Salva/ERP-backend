import { Module } from '@nestjs/common';
import { DomainModule } from '../../common/domain/domain.module';
import { CustomersController } from './controllers/customers.controller';
import { CustomersService } from './services/customers.service';

@Module({
  imports: [DomainModule],
  controllers: [CustomersController],
  providers: [CustomersService],
})
export class CustomersModule {}
