import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { OrganizationAccessService } from '../../organizations/services/organization-access.service';
import { CatalogContext, CatalogCore } from './catalog-core.service';
import {
  CatalogQuery,
  CreateCategoryInput,
  UpdateCategoryInput,
} from '../dto/catalog.input';

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
    private readonly core: CatalogCore,
  ) {}

  async categories(
    userId: string,
    organizationId: string,
    query: CatalogQuery,
  ) {
    await this.access.membership(userId, organizationId);
    const items = await this.prisma.category.findMany({
      where: {
        organizationId,
        ...this.core.status(query),
        ...(query.q
          ? { name: { contains: query.q, mode: 'insensitive' } }
          : {}),
      },
      select: { id: true, name: true, archivedAt: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      ...this.core.page(query),
    });
    return { items, page: query.page, limit: query.limit };
  }

  createCategory(ctx: CatalogContext, dto: CreateCategoryInput) {
    return this.core.write(ctx, async (tx) => {
      const created = await tx.category.create({
        data: {
          organizationId: ctx.organizationId,
          name: dto.name,
          nameKey: dto.name.toLowerCase(),
        },
        select: { id: true, name: true, archivedAt: true },
      });
      await this.core.audit(
        tx,
        ctx,
        'category.created',
        'Category',
        created.id,
        null,
        created,
      );
      return created;
    });
  }

  updateCategory(ctx: CatalogContext, id: string, dto: UpdateCategoryInput) {
    return this.core.write(ctx, async (tx) => {
      this.core.requireChanges(dto);
      const before = await this.core.category(tx, ctx.organizationId, id);
      this.core.requireActive(before);
      const updated = await tx.category.update({
        where: {
          organizationId_id: { organizationId: ctx.organizationId, id },
        },
        data: { name: dto.name, nameKey: dto.name?.toLowerCase() },
        select: { id: true, name: true, archivedAt: true },
      });
      await this.core.audit(
        tx,
        ctx,
        'category.updated',
        'Category',
        id,
        before,
        updated,
      );
      return updated;
    });
  }

  archiveCategory(ctx: CatalogContext, id: string, archive: boolean) {
    return this.core.write(ctx, async (tx) => {
      const before = await this.core.category(tx, ctx.organizationId, id);
      if (Boolean(before.archivedAt) === archive) return before;
      if (
        archive &&
        (await tx.product.count({
          where: {
            organizationId: ctx.organizationId,
            categoryId: id,
            archivedAt: null,
          },
        }))
      ) {
        throw new ConflictException(
          'La categoría tiene productos activos. Reasígnalos o archívalos primero',
        );
      }
      const updated = await tx.category.update({
        where: {
          organizationId_id: { organizationId: ctx.organizationId, id },
        },
        data: { archivedAt: archive ? new Date() : null },
        select: { id: true, name: true, archivedAt: true },
      });
      await this.core.audit(
        tx,
        ctx,
        archive ? 'category.archived' : 'category.restored',
        'Category',
        id,
        before,
        updated,
      );
      return updated;
    });
  }
}
