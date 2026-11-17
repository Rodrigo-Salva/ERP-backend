import { Module } from '@nestjs/common';
import { DomainModule } from '../../common/domain/domain.module';
import { ExpenseCategoriesController } from './controllers/expense-categories.controller';
import { OrganizationSettingsController } from './controllers/organization-settings.controller';
import { PaymentMethodsController } from './controllers/payment-methods.controller';
import { StructureController } from './controllers/structure.controller';
import { ExpenseCategoriesService } from './services/expense-categories.service';
import { OrganizationSettingsService } from './services/organization-settings.service';
import { PaymentMethodsService } from './services/payment-methods.service';
import { StructureService } from './services/structure.service';

/** Configuración de la tienda: datos y ajustes, sucursales y almacenes, métodos de pago y categorías de gasto. */
@Module({
  imports: [DomainModule],
  controllers: [
    OrganizationSettingsController,
    StructureController,
    PaymentMethodsController,
    ExpenseCategoriesController,
  ],
  providers: [
    OrganizationSettingsService,
    StructureService,
    PaymentMethodsService,
    ExpenseCategoriesService,
  ],
})
export class AdminModule {}
