import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { OrganizationAccessService } from '../../organizations/services/organization-access.service';
import { CatalogContext, CatalogCore } from './catalog-core.service';
import {
  CatalogQuery,
  CreateUnitInput,
  UpdateUnitInput,
} from '../dto/catalog.input';

@Injectable()
export class UnitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
    private readonly core: CatalogCore,
  ) {}

  async units(userId: string, organizationId: string, query: CatalogQuery) {
    await this.access.membership(userId, organizationId);
    const items = await this.prisma.unitOfMeasure.findMany({
      where: {
        organizationId,
        ...this.core.status(query),
        ...(query.q
          ? {
              OR: [
                { name: { contains: query.q, mode: 'insensitive' as const } },
                { code: { contains: query.q, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        name: true,
        code: true,
        precision: true,
        archivedAt: true,
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      ...this.core.page(query),
    });
    return { items, page: query.page, limit: query.limit };
  }

  createUnit(ctx: CatalogContext, dto: CreateUnitInput) {
    return this.core.write(ctx, async (tx) => {
      const created = await tx.unitOfMeasure.create({
        data: {
          organizationId: ctx.organizationId,
          name: dto.name,
          code: dto.code,
          precision: dto.precision ?? 0,
        },
        select: {
          id: true,
          name: true,
          code: true,
          precision: true,
          archivedAt: true,
        },
      });
      await this.core.audit(
        tx,
        ctx,
        'unit.created',
        'UnitOfMeasure',
        created.id,
        null,
        created,
      );
      return created;
    });
  }

  updateUnit(ctx: CatalogContext, id: string, dto: UpdateUnitInput) {
    return this.core.write(ctx, async (tx) => {
      this.core.requireChanges(dto);
      const before = await this.core.unit(tx, ctx.organizationId, id);
      this.core.requireActive(before);
      if (
        dto.precision !== undefined &&
        dto.precision !== before.precision &&
        (await tx.product.count({
          where: { organizationId: ctx.organizationId, unitId: id },
        }))
      ) {
        throw new ConflictException(
          'No se puede cambiar la precisión de una unidad utilizada por productos',
        );
      }
      const updated = await tx.unitOfMeasure.update({
        where: {
          organizationId_id: { organizationId: ctx.organizationId, id },
        },
        data: dto,
        select: {
          id: true,
          name: true,
          code: true,
          precision: true,
          archivedAt: true,
        },
      });
      await this.core.audit(
        tx,
        ctx,
        'unit.updated',
        'UnitOfMeasure',
        id,
        before,
        updated,
      );
      return updated;
    });
  }

  archiveUnit(ctx: CatalogContext, id: string, archive: boolean) {
    return this.core.write(ctx, async (tx) => {
      const before = await this.core.unit(tx, ctx.organizationId, id);
      if (Boolean(before.archivedAt) === archive) return before;
      if (
        archive &&
        (await tx.product.count({
          where: {
            organizationId: ctx.organizationId,
            unitId: id,
            archivedAt: null,
          },
        }))
      ) {
        throw new ConflictException('La unidad tiene productos activos');
      }
      const updated = await tx.unitOfMeasure.update({
        where: {
          organizationId_id: { organizationId: ctx.organizationId, id },
        },
        data: { archivedAt: archive ? new Date() : null },
        select: {
          id: true,
          name: true,
          code: true,
          precision: true,
          archivedAt: true,
        },
      });
      await this.core.audit(
        tx,
        ctx,
        archive ? 'unit.archived' : 'unit.restored',
        'UnitOfMeasure',
        id,
        before,
        updated,
      );
      return updated;
    });
  }
}
