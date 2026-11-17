import { Module } from '@nestjs/common';
import { DomainModule } from '../../common/domain/domain.module';
import { CashModule } from '../cash/cash.module';
import { InventoryModule } from '../inventory/inventory.module';
import { SaleDocumentsService } from './services/sale-documents.service';
import { SaleReturnsService } from './services/sale-returns.service';
import { SalesService } from './services/sales.service';
import { SalesController } from './controllers/sales.controller';
@Module({
  imports: [DomainModule, InventoryModule, CashModule],
  controllers: [SalesController],
  providers: [SaleDocumentsService, SalesService, SaleReturnsService],
})
export class SalesModule {}
