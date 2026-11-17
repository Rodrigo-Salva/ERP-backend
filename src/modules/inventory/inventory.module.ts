import { Module } from '@nestjs/common';
import { DomainModule } from '../../common/domain/domain.module';
import { InventoryController } from './controllers/inventory.controller';
import { InventoryService } from './services/inventory.service';
@Module({
  imports: [DomainModule],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
