import { Module } from '@nestjs/common';
import { DomainModule } from '../../common/domain/domain.module';
import { DatabaseModule } from '../../database/database.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { CategoriesController } from './controllers/categories.controller';
import { ProductsController } from './controllers/products.controller';
import { UnitsController } from './controllers/units.controller';
import { VariantsController } from './controllers/variants.controller';
import { CatalogCore } from './services/catalog-core.service';
import { CategoriesService } from './services/categories.service';
import { ProductsService } from './services/products.service';
import { UnitsService } from './services/units.service';
import { VariantsService } from './services/variants.service';

@Module({
  imports: [DatabaseModule, DomainModule, OrganizationsModule],
  controllers: [
    CategoriesController,
    ProductsController,
    UnitsController,
    VariantsController,
  ],
  providers: [
    CatalogCore,
    CategoriesService,
    UnitsService,
    ProductsService,
    VariantsService,
  ],
})
export class CatalogModule {}
