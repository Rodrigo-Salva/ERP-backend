import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { Prisma, Role } from '../../../generated/prisma/client';
import { OrganizationAccessService } from '../../organizations/services/organization-access.service';
import { paging } from '../../../common/domain/input';
import type { CatalogQuery } from '../dto/catalog.input';

/** Quién y desde qué petición modifica el catálogo (para permisos y auditoría). */
export interface CatalogContext {
  userId: string;
  organizationId: string;
  requestId: string;
}

/**
 * Infraestructura común del catálogo: permisos, transacción serializable con reintentos,
 * auditoría y utilidades de listado compartidas por categorías, unidades y productos.
 */
@Injectable()
export class CatalogCore {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
  ) {}

  canManage(role: Role): boolean {
    return role === 'OWNER' || role === 'ADMIN' || role === 'MANAGER';
  }

  async write<T>(
    ctx: CatalogContext,
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const membership = await this.access.membership(
              ctx.userId,
              ctx.organizationId,
              tx,
            );
            if (!this.canManage(membership.role))
              throw new ForbiddenException('No puedes modificar el catálogo');
            return operation(tx);
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          if (error.code === 'P2034' && attempt < 2) continue;
          if (error.code === 'P2034')
            throw new ConflictException(
              'El catálogo cambió durante la operación. Inténtalo de nuevo',
            );
          if (error.code === 'P2002')
            throw new ConflictException(
              'El nombre, SKU o código ya está registrado en esta organización',
            );
          if (error.code === 'P2003')
            throw new BadRequestException(
              'La referencia no pertenece a esta organización o está en uso',
            );
        }
        throw error;
      }
    }
    throw new ConflictException('No se pudo completar la operación');
  }

  audit(
    tx: Prisma.TransactionClient,
    ctx: CatalogContext,
    action: string,
    resourceType: string,
    resourceId: string,
    before: unknown,
    after: unknown,
  ) {
    // Solo snapshots del catálogo, construidos por este servicio; nunca cuerpos arbitrarios.
    const changes = JSON.parse(
      JSON.stringify({ before, after }),
    ) as Prisma.InputJsonValue;
    return tx.auditEvent.create({
      data: {
        organizationId: ctx.organizationId,
        actorId: ctx.userId,
        requestId: ctx.requestId,
        action,
        resourceType,
        resourceId,
        changes,
      },
    });
  }

  status(query: CatalogQuery) {
    return query.status === 'all'
      ? {}
      : { archivedAt: query.status === 'archived' ? { not: null } : null };
  }

  page(query: CatalogQuery) {
    return paging(query);
  }

  requireChanges(dto: object): void {
    if (Object.keys(dto).length === 0)
      throw new BadRequestException('Indica al menos un campo para modificar');
  }

  requireActive(record: { archivedAt: Date | null }): void {
    if (record.archivedAt)
      throw new ConflictException('Restaura el registro antes de modificarlo');
  }

  async category(
    tx: Prisma.TransactionClient,
    organizationId: string,
    id: string,
  ) {
    const category = await tx.category.findUnique({
      where: { organizationId_id: { organizationId, id } },
      select: { id: true, name: true, archivedAt: true },
    });
    if (!category) throw new NotFoundException('Categoría no encontrada');
    return category;
  }

  async unit(tx: Prisma.TransactionClient, organizationId: string, id: string) {
    const unit = await tx.unitOfMeasure.findUnique({
      where: { organizationId_id: { organizationId, id } },
      select: {
        id: true,
        name: true,
        code: true,
        precision: true,
        archivedAt: true,
      },
    });
    if (!unit) throw new NotFoundException('Unidad no encontrada');
    return unit;
  }
}
