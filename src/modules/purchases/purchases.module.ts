import { Module } from '@nestjs/common';
import { DomainModule } from '../../common/domain/domain.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PurchasesService } from './services/purchases.service';
import { PurchasesController } from './controllers/purchases.controller';
@Module({
  imports: [DomainModule, InventoryModule],
  controllers: [PurchasesController],
  providers: [PurchasesService],
})
export class PurchasesModule {}
