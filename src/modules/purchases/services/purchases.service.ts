import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Actor, DomainService } from '../../../common/domain/domain.service';
import { dates, json, PageInput, paging } from '../../../common/domain/input';
import { Prisma } from '../../../generated/prisma/client';
import { InventoryService } from '../../inventory/services/inventory.service';
import {
  PurchaseInput,
  ReceiptInput,
  SupplierInput,
  SupplierPatch,
} from '../dto/purchases.input';
@Injectable()
export class PurchasesService {
  constructor(
    private readonly domain: DomainService,
    private readonly inventory: InventoryService,
  ) {}
  async suppliers(actor: Actor, query: PageInput) {
    await this.domain.authorize(this.domain.db, actor, 'manage');
    return {
      items: await this.domain.db.supplier.findMany({
        where: {
          organizationId: actor.organizationId,
          ...(query.status === 'archived'
            ? { archivedAt: { not: null } }
            : { archivedAt: null }),
          ...(query.q
            ? { name: { contains: query.q, mode: 'insensitive' } }
            : {}),
        },
        ...paging(query),
        orderBy: { name: 'asc' },
      }),
      page: query.page,
      limit: query.limit,
    };
  }
  supplier(actor: Actor, body: SupplierInput | SupplierPatch, id?: string) {
    return this.domain.run(
      actor,
      'manage',
      'supplier.save',
      body,
      async (tx) => {
        const { archived, ...data } = body as SupplierPatch;
        if (
          id &&
          !(await tx.supplier.findFirst({
            where: { id, organizationId: actor.organizationId },
          }))
        )
          throw new NotFoundException('Proveedor no encontrado');
        const result = id
          ? await tx.supplier.update({
              where: { id },
              data: {
                ...data,
                ...(archived !== undefined
                  ? { archivedAt: archived ? new Date() : null }
                  : {}),
              },
            })
          : await tx.supplier.create({
              data: {
                ...(body as SupplierInput),
                organizationId: actor.organizationId,
              },
            });
        await this.domain.audit(
          tx,
          actor,
          id ? 'supplier.updated' : 'supplier.created',
          result.id,
        );
        return result;
      },
    );
  }
  create(actor: Actor, body: PurchaseInput) {
    return this.domain.run(
      actor,
      'manage',
      'purchase.create',
      body,
      async (tx) => {
        const warehouse = await this.domain.warehouse(
          tx,
          actor,
          body.warehouseId,
        );
        if (
          !(await tx.supplier.findFirst({
            where: {
              id: body.supplierId,
              organizationId: actor.organizationId,
              archivedAt: null,
            },
          }))
        )
          throw new NotFoundException('Proveedor no encontrado');
        if (
          new Set(body.lines.map((l) => l.variantId)).size !== body.lines.length
        )
          throw new BadRequestException('Artículo duplicado');
        for (const line of body.lines)
          this.domain.quantity(
            line.quantity,
            (
              await this.domain.variant(
                tx,
                actor.organizationId,
                line.variantId,
              )
            ).product.unit.precision,
          );
        const created = await tx.purchaseOrder.create({
          data: {
            organizationId: actor.organizationId,
            branchId: warehouse.branchId,
            warehouseId: warehouse.id,
            supplierId: body.supplierId,
            actorId: actor.userId,
            notes: body.notes,
          },
        });
        await tx.purchaseOrderLine.createMany({
          data: body.lines.map((line) => ({
            ...line,
            organizationId: actor.organizationId,
            purchaseOrderId: created.id,
          })),
        });
        const order = await tx.purchaseOrder.findUniqueOrThrow({
          where: { id: created.id },
          include: { lines: true },
        });
        await this.domain.audit(tx, actor, 'purchase.created', order.id);
        return order;
      },
    );
  }
  private async present<
    T extends {
      supplierId: string;
      warehouseId: string;
      lines: Array<{ variantId: string }>;
    },
  >(actor: Actor, orders: T[]) {
    const labels = await this.domain.variantLabels(
      this.domain.db,
      actor.organizationId,
      orders.flatMap((o) => o.lines.map((l) => l.variantId)),
    );
    const warehouses = await this.domain.warehouseNames(
      this.domain.db,
      actor.organizationId,
      orders.map((o) => o.warehouseId),
    );
    const suppliers = new Map(
      (
        await this.domain.db.supplier.findMany({
          where: {
            organizationId: actor.organizationId,
            id: { in: [...new Set(orders.map((o) => o.supplierId))] },
          },
          select: { id: true, name: true },
        })
      ).map((s) => [s.id, s.name]),
    );
    return orders.map((order) => ({
      ...order,
      supplierName: suppliers.get(order.supplierId) ?? null,
      warehouseName: warehouses.get(order.warehouseId) ?? null,
      lines: order.lines.map((line) => ({
        ...line,
        sku: labels.get(line.variantId)?.sku ?? null,
        name: labels.get(line.variantId)?.name ?? null,
      })),
    }));
  }
  async detail(actor: Actor, id: string) {
    const order = await this.get(actor, id);
    return (await this.present(actor, [order]))[0]!;
  }
  async get(actor: Actor, id: string) {
    const order = await this.domain.db.purchaseOrder.findFirst({
      where: { id, organizationId: actor.organizationId },
      include: { lines: true },
    });
    if (!order) throw new NotFoundException('Compra no encontrada');
    await this.domain.authorize(
      this.domain.db,
      actor,
      'manage',
      order.branchId,
    );
    return order;
  }
  async list(actor: Actor, query: PageInput) {
    query = await this.domain.days(actor, query);
    await this.domain.authorize(this.domain.db, actor, 'manage');
    const scope = await this.domain.scope(actor, query.branchId);
    const orders = await this.domain.db.purchaseOrder.findMany({
      where: {
        ...scope.where,
        createdAt: dates(query),
        ...(query.status ? { status: query.status } : {}),
      },
      ...paging(query),
      orderBy: { createdAt: 'desc' },
      include: { lines: true },
    });
    return {
      items: await this.present(actor, orders),
      page: query.page,
      limit: query.limit,
    };
  }
  async transition(actor: Actor, id: string, status: 'SENT' | 'CANCELLED') {
    const original = await this.get(actor, id);
    return this.domain.run(
      actor,
      'manage',
      'purchase.status',
      { id, status },
      async (tx) => {
        const order = await tx.purchaseOrder.findUniqueOrThrow({
          where: { id },
          include: { lines: true },
        });
        if (
          status === 'SENT'
            ? order.status !== 'DRAFT'
            : !['DRAFT', 'SENT'].includes(order.status)
        )
          throw new ConflictException(
            'La compra ya tiene recepciones o no permite esta transición',
          );
        const updated = await tx.purchaseOrder.update({
          where: { id },
          data: { status },
        });
        await this.domain.audit(
          tx,
          actor,
          `purchase.${status.toLowerCase()}`,
          id,
        );
        return updated;
      },
      { branchId: original.branchId },
    );
  }
  async receive(actor: Actor, id: string, body: ReceiptInput, key?: string) {
    const original = await this.get(actor, id);
    return this.domain.run(
      actor,
      'manage',
      `purchase.receive:${id}`,
      body,
      async (tx, member) => {
        const order = await tx.purchaseOrder.findUniqueOrThrow({
          where: { id },
          include: { lines: true },
        });
        if (!['SENT', 'PARTIAL'].includes(order.status))
          throw new ConflictException(
            'La compra no está pendiente de recepción',
          );
        if (new Set(body.lines.map((l) => l.lineId)).size !== body.lines.length)
          throw new BadRequestException('Línea duplicada');
        const receipt = await tx.goodsReceipt.create({
          data: {
            organizationId: actor.organizationId,
            branchId: order.branchId,
            purchaseOrderId: id,
            actorId: actor.userId,
            lines: json<Prisma.InputJsonValue>(body.lines),
          },
        });
        for (const input of body.lines) {
          const line = order.lines.find((line) => line.id === input.lineId);
          if (!line) throw new NotFoundException('Línea no encontrada');
          const variant = await this.domain.variant(
            tx,
            actor.organizationId,
            line.variantId,
          );
          const quantity = this.domain.quantity(
            input.quantity,
            variant.product.unit.precision,
          );
          if (line.received.plus(quantity).gt(line.quantity))
            throw new ConflictException('La recepción excede lo pendiente');
          await this.inventory.move(
            tx,
            actor,
            member,
            order.warehouseId,
            line.variantId,
            quantity,
            'PURCHASE',
            receipt.id,
            'Recepción de compra',
            new Prisma.Decimal(input.unitCost),
          );
          await tx.purchaseOrderLine.update({
            where: { id: line.id },
            data: { received: line.received.plus(quantity) },
          });
        }
        const lines = await tx.purchaseOrderLine.findMany({
          where: { purchaseOrderId: id },
        });
        await tx.purchaseOrder.update({
          where: { id },
          data: {
            status: lines.every((l) => l.received.eq(l.quantity))
              ? 'RECEIVED'
              : 'PARTIAL',
          },
        });
        await this.domain.audit(tx, actor, 'purchase.received', receipt.id, {
          purchaseOrderId: id,
        });
        return receipt;
      },
      { branchId: original.branchId, idempotent: true, key },
    );
  }
  async receipts(actor: Actor, id: string) {
    await this.get(actor, id);
    return this.domain.db.goodsReceipt.findMany({
      where: { organizationId: actor.organizationId, purchaseOrderId: id },
      orderBy: { createdAt: 'asc' },
      take: 1000,
    });
  }
}
