import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { provisionBranchDefaults } from '../../../common/domain/defaults';
import { Actor, DomainService } from '../../../common/domain/domain.service';
import { PageInput, paging } from '../../../common/domain/input';
import {
  BranchInput,
  BranchPatch,
  WarehouseInput,
} from '../dto/organization.input';

@Injectable()
export class StructureService {
  constructor(private readonly domain: DomainService) {}

  branch(actor: Actor, body: BranchInput | BranchPatch, id?: string) {
    return this.domain.run(actor, 'admin', 'branch.save', body, async (tx) => {
      const { archived, ...data } = body as BranchPatch;
      if (data.timeZone)
        try {
          new Intl.DateTimeFormat('es', { timeZone: data.timeZone }).format();
        } catch {
          throw new BadRequestException('Zona horaria inválida');
        }
      if (id) {
        await this.domain.authorize(tx, actor, 'admin', id);
        if (
          archived &&
          ((await tx.cashSession.count({
            where: { branchId: id, closedAt: null },
          })) ||
            (await tx.inventoryBalance.count({
              where: { branchId: id, quantity: { not: 0 } },
            })) ||
            (await tx.purchaseOrder.count({
              where: { branchId: id, status: { in: ['SENT', 'PARTIAL'] } },
            })) ||
            (await tx.inventoryTransfer.count({
              where: {
                organizationId: actor.organizationId,
                status: 'IN_TRANSIT',
                OR: [{ branchId: id }, { targetBranchId: id }],
              },
            })))
        )
          throw new ConflictException(
            'La sucursal tiene operaciones o existencias pendientes',
          );
      }
      const result = id
        ? await tx.branch.update({
            where: { id },
            data: {
              ...data,
              ...(archived !== undefined
                ? { archivedAt: archived ? new Date() : null }
                : {}),
            },
          })
        : await tx.branch.create({
            data: {
              organizationId: actor.organizationId,
              ...(body as BranchInput),
            },
          });
      if (!id) {
        await tx.warehouse.create({
          data: {
            organizationId: actor.organizationId,
            branchId: result.id,
            name: 'Principal',
            code: 'MAIN',
          },
        });
        await provisionBranchDefaults(tx, actor.organizationId, result.id);
      }
      await this.domain.audit(
        tx,
        actor,
        id ? 'branch.updated' : 'branch.created',
        result.id,
      );
      return result;
    });
  }
  warehouse(actor: Actor, body: WarehouseInput) {
    return this.domain.run(
      actor,
      'admin',
      'warehouse.create',
      body,
      async (tx) => {
        const result = await tx.warehouse.create({
          data: { organizationId: actor.organizationId, ...body },
        });
        await this.domain.audit(tx, actor, 'warehouse.created', result.id);
        return result;
      },
      { branchId: body.branchId },
    );
  }
  async warehouses(actor: Actor, q: PageInput) {
    const scope = await this.domain.scope(actor, q.branchId);
    return {
      items: await this.domain.db.warehouse.findMany({
        where: { ...scope.where, archivedAt: null },
        ...paging(q),
        orderBy: { name: 'asc' },
      }),
      page: q.page,
      limit: q.limit,
    };
  }
}
