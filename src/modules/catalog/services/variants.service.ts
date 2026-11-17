import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Actor, DomainService } from '../../../common/domain/domain.service';
import { PageInput, paging } from '../../../common/domain/input';
import { VariantInput, VariantPatch } from '../dto/variants.input';

@Injectable()
export class VariantsService {
  constructor(private readonly domain: DomainService) {}

  async variants(actor: Actor, q: PageInput, productId?: string) {
    const member = await this.domain.authorize(this.domain.db, actor);
    if (
      productId &&
      !(await this.domain.db.product.findFirst({
        where: { id: productId, organizationId: actor.organizationId },
      }))
    )
      throw new NotFoundException('Producto no encontrado');
    const items = await this.domain.db.productVariant.findMany({
      where: {
        organizationId: actor.organizationId,
        ...(productId ? { productId } : {}),
        archivedAt: q.status === 'archived' ? { not: null } : null,
        product: { archivedAt: null },
        ...(q.q
          ? {
              OR: [
                { sku: { contains: q.q, mode: 'insensitive' } },
                { barcode: { contains: q.q } },
                { product: { name: { contains: q.q, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: { product: { select: { name: true, unitId: true } } },
      ...paging(q),
      orderBy: { sku: 'asc' },
    });
    return {
      items: items.map(({ cost, ...variant }) => ({
        ...variant,
        ...(this.domain.costs(member) ? { cost } : {}),
      })),
      page: q.page,
      limit: q.limit,
    };
  }
  variant(
    actor: Actor,
    productId: string,
    body: VariantInput | VariantPatch,
    id?: string,
  ) {
    return this.domain.run(
      actor,
      'manage',
      'variant.save',
      body,
      async (tx) => {
        if (
          !(await tx.product.findFirst({
            where: {
              id: productId,
              organizationId: actor.organizationId,
              archivedAt: null,
            },
          }))
        )
          throw new NotFoundException('Producto no encontrado');
        const { archived, ...data } = body as VariantPatch;
        if (id) {
          const before = await tx.productVariant.findFirst({
            where: { id, productId, organizationId: actor.organizationId },
          });
          if (!before) throw new NotFoundException('Variante no encontrada');
          if (before.isDefault && archived)
            throw new ConflictException(
              'Archiva el producto para desactivar su variante predeterminada',
            );
        }
        const result = id
          ? await tx.productVariant.update({
              where: { id },
              data: {
                ...data,
                ...(archived !== undefined
                  ? { archivedAt: archived ? new Date() : null }
                  : {}),
              },
            })
          : await tx.productVariant.create({
              data: {
                id: randomUUID(),
                organizationId: actor.organizationId,
                productId,
                isDefault: false,
                ...(body as VariantInput),
              },
            });
        await this.domain.audit(
          tx,
          actor,
          id ? 'variant.updated' : 'variant.created',
          result.id,
          { after: result },
        );
        return result;
      },
    );
  }
}
