import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { OrganizationAccessService } from '../../organizations/services/organization-access.service';
import { CatalogContext, CatalogCore } from './catalog-core.service';
import {
  CreateProductInput,
  ProductsQuery,
  UpdateProductInput,
} from '../dto/catalog.input';

const productInclude = { variants: { where: { isDefault: true } } } as const;
type ProductWithVariant = Prisma.ProductGetPayload<{
  include: typeof productInclude;
}>;

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
    private readonly core: CatalogCore,
  ) {}

  private async product(
    tx: Prisma.TransactionClient,
    organizationId: string,
    id: string,
  ) {
    const product = await tx.product.findUnique({
      where: { organizationId_id: { organizationId, id } },
      include: productInclude,
    });
    if (!product) throw new NotFoundException('Producto no encontrado');
    return product;
  }

  private serialize(product: ProductWithVariant, includeCost: boolean) {
    const variant = product.variants[0];
    if (!variant) throw new Error('Producto sin variante predeterminada');
    return {
      id: product.id,
      variantId: variant.id,
      name: product.name,
      description: product.description,
      categoryId: product.categoryId,
      unitId: product.unitId,
      sku: variant.sku,
      barcode: variant.barcode,
      price: variant.price.toFixed(4),
      ...(includeCost ? { cost: variant.cost.toFixed(4) } : {}),
      lowStockThreshold: product.lowStockThreshold.toFixed(3),
      archivedAt: product.archivedAt,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    };
  }

  private async references(
    tx: Prisma.TransactionClient,
    organizationId: string,
    unitId: string,
    categoryId: string | null | undefined,
    threshold: Prisma.Decimal,
  ): Promise<void> {
    const unit = await this.core.unit(tx, organizationId, unitId);
    this.core.requireActive(unit);
    if (threshold.decimalPlaces() > unit.precision)
      throw new BadRequestException(
        'El umbral excede la precisión de la unidad',
      );
    if (categoryId)
      this.core.requireActive(
        await this.core.category(tx, organizationId, categoryId),
      );
  }

  async products(userId: string, organizationId: string, query: ProductsQuery) {
    const membership = await this.access.membership(userId, organizationId);
    const where: Prisma.ProductWhereInput = {
      organizationId,
      ...this.core.status(query),
      categoryId: query.categoryId,
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              {
                variants: {
                  some: {
                    isDefault: true,
                    OR: [
                      { sku: { contains: query.q, mode: 'insensitive' } },
                      { barcode: { contains: query.q } },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
    };
    const products = await this.prisma.product.findMany({
      where,
      include: productInclude,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      ...this.core.page(query),
    });
    return {
      items: products.map((product) =>
        this.serialize(product, this.core.canManage(membership.role)),
      ),
      page: query.page,
      limit: query.limit,
    };
  }

  async detail(userId: string, organizationId: string, id: string) {
    const membership = await this.access.membership(userId, organizationId);
    return this.serialize(
      await this.product(this.prisma, organizationId, id),
      this.core.canManage(membership.role),
    );
  }

  createProduct(ctx: CatalogContext, dto: CreateProductInput) {
    return this.core.write(ctx, async (tx) => {
      const threshold = new Prisma.Decimal(dto.lowStockThreshold ?? '0');
      await this.references(
        tx,
        ctx.organizationId,
        dto.unitId,
        dto.categoryId,
        threshold,
      );
      const product = await tx.product.create({
        data: {
          organizationId: ctx.organizationId,
          name: dto.name,
          description: dto.description,
          unitId: dto.unitId,
          categoryId: dto.categoryId,
          lowStockThreshold: threshold,
        },
      });
      await tx.productVariant.create({
        data: {
          organizationId: ctx.organizationId,
          productId: product.id,
          isDefault: true,
          sku: dto.sku,
          barcode: dto.barcode,
          price: new Prisma.Decimal(dto.price),
          cost: new Prisma.Decimal(dto.cost),
        },
      });
      const result = this.serialize(
        await this.product(tx, ctx.organizationId, product.id),
        true,
      );
      await this.core.audit(
        tx,
        ctx,
        'product.created',
        'Product',
        product.id,
        null,
        result,
      );
      return result;
    });
  }

  updateProduct(ctx: CatalogContext, id: string, dto: UpdateProductInput) {
    return this.core.write(ctx, async (tx) => {
      this.core.requireChanges(dto);
      const product = await this.product(tx, ctx.organizationId, id);
      this.core.requireActive(product);
      if (dto.unitId !== undefined && dto.unitId !== product.unitId)
        throw new ConflictException(
          'La unidad de un producto no se puede cambiar',
        );
      const threshold =
        dto.lowStockThreshold !== undefined
          ? new Prisma.Decimal(dto.lowStockThreshold)
          : product.lowStockThreshold;
      const categoryId =
        dto.categoryId !== undefined ? dto.categoryId : product.categoryId;
      await this.references(
        tx,
        ctx.organizationId,
        product.unitId,
        categoryId,
        threshold,
      );
      await tx.product.update({
        where: {
          organizationId_id: { organizationId: ctx.organizationId, id },
        },
        data: {
          name: dto.name,
          description: dto.description,
          categoryId,
          lowStockThreshold: threshold,
        },
      });
      if (
        dto.sku !== undefined ||
        dto.barcode !== undefined ||
        dto.price !== undefined ||
        dto.cost !== undefined
      ) {
        const changed = await tx.productVariant.updateMany({
          where: {
            organizationId: ctx.organizationId,
            productId: id,
            isDefault: true,
          },
          data: {
            sku: dto.sku,
            barcode: dto.barcode,
            price:
              dto.price !== undefined
                ? new Prisma.Decimal(dto.price)
                : undefined,
            cost:
              dto.cost !== undefined ? new Prisma.Decimal(dto.cost) : undefined,
          },
        });
        if (changed.count !== 1)
          throw new ConflictException(
            'No se encontró la variante predeterminada del producto',
          );
      }
      const result = this.serialize(
        await this.product(tx, ctx.organizationId, id),
        true,
      );
      await this.core.audit(
        tx,
        ctx,
        'product.updated',
        'Product',
        id,
        this.serialize(product, true),
        result,
      );
      return result;
    });
  }

  archiveProduct(ctx: CatalogContext, id: string, archive: boolean) {
    return this.core.write(ctx, async (tx) => {
      const before = await this.product(tx, ctx.organizationId, id);
      if (Boolean(before.archivedAt) === archive)
        return this.serialize(before, true);
      if (!archive)
        await this.references(
          tx,
          ctx.organizationId,
          before.unitId,
          before.categoryId,
          before.lowStockThreshold,
        );
      const updated = await tx.product.update({
        where: {
          organizationId_id: { organizationId: ctx.organizationId, id },
        },
        data: { archivedAt: archive ? new Date() : null },
        include: productInclude,
      });
      const result = this.serialize(updated, true);
      await this.core.audit(
        tx,
        ctx,
        archive ? 'product.archived' : 'product.restored',
        'Product',
        id,
        this.serialize(before, true),
        result,
      );
      return result;
    });
  }
}
