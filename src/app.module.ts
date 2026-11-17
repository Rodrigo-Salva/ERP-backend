import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { resolve } from 'node:path';
import { RequestContextMiddleware } from './common/http/request-context.middleware';
import { validateEnvironment } from './config/environment';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { IdentityModule } from './modules/identity/identity.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { PurchasesModule } from './modules/purchases/purchases.module';
import { SalesModule } from './modules/sales/sales.module';
import { CashModule } from './modules/cash/cash.module';
import { CustomersModule } from './modules/customers/customers.module';
import { AdminModule } from './modules/admin/admin.module';
import { ReportsModule } from './modules/reports/reports.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: resolve(__dirname, '../.env'),
      validate: validateEnvironment,
    }),
    HealthModule,
    AuthModule,
    IdentityModule,
    OrganizationsModule,
    CatalogModule,
    InventoryModule,
    PurchasesModule,
    SalesModule,
    CashModule,
    CustomersModule,
    AdminModule,
    ReportsModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('{*path}');
  }
}
