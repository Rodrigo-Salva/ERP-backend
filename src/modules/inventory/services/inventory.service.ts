import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Actor, DomainService } from '../../../common/domain/domain.service';
import { dates, json, PageInput, paging } from '../../../common/domain/input';
import { Membership, Prisma } from '../../../generated/prisma/client';
import {
  AdjustmentInput,
  TransferInput,
  TransferLine,
} from '../dto/inventory.input';

@Injectable()
export class InventoryService {
  constructor(private readonly domain: DomainService) {}
  async move(
    tx: Prisma.TransactionClient,
    actor: Actor,
    member: Membership,
    warehouseId: string,
    variantId: string,
    delta: Prisma.Decimal,
    kind: string,
    referenceId: string,
    reason: string,
    incomingCost?: Prisma.Decimal,
  ) {
    const warehouse = await this.domain.warehouse(tx, actor, warehouseId);
    const variant = await this.domain.variant(
      tx,
      actor.organizationId,
      variantId,
      false,
    );
    this.domain.quantity(
      delta.abs().toString(),
      variant.product.unit.precision,
    );
    const key = {
      organizationId: actor.organizationId,
      warehouseId,
      variantId,
    };
    const balance = await tx.inventoryBalance.upsert({
      where: { organizationId_warehouseId_variantId: key },
      create: { ...key, branchId: warehouse.branchId },
      update: {},
    });
    const after = balance.quantity.plus(delta);
    const settings = await tx.organization.findUniqueOrThrow({
      where: { id: actor.organizationId },
    });
    if (
      after.lt(0) &&
      !(
        settings.allowNegativeStock &&
        this.domain.allowed(member, 'inventory.negative')
      )
    )
      throw new ConflictException('Existencias insuficientes');
    const average = balance.quantity.gt(0)
      ? balance.value.div(balance.quantity)
      : variant.cost;
    const cost = delta.gt(0) ? incomingCost : average;
    if (!cost || cost.lt(0))
      throw new BadRequestException('Indica el costo de entrada');
    let valueDelta = delta
      .mul(cost)
      .toDecimalPlaces(7, Prisma.Decimal.ROUND_HALF_UP);
    if (after.eq(0)) valueDelta = balance.value.negated();
    await tx.inventoryBalance.update({
      where: { id: balance.id },
      data: { quantity: after, value: balance.value.plus(valueDelta) },
    });
    const movement = await tx.inventoryMovement.create({
      data: {
        ...key,
        branchId: warehouse.branchId,
        actorId: actor.userId,
        kind,
        referenceId,
        reason,
        delta,
        before: balance.quantity,
        after,
        unitCost: valueDelta.div(delta).toDecimalPlaces(7),
        valueDelta,
      },
    });
    return movement;
  }
  async balances(actor: Actor, query: PageInput) {
    const scope = await this.domain.scope(actor, query.branchId);
    const items = await this.domain.db.inventoryBalance.findMany({
      where: scope.where,
      ...paging(query),
      orderBy: { id: 'asc' },
    });
    const labels = await this.domain.variantLabels(
      this.domain.db,
      actor.organizationId,
      items.map((i) => i.variantId),
    );
    const warehouses = await this.domain.warehouseNames(
      this.domain.db,
      actor.organizationId,
      items.map((i) => i.warehouseId),
    );
    return {
      items: items.map(({ value, ...balance }) => ({
        ...balance,
        sku: labels.get(balance.variantId)?.sku ?? null,
        name: labels.get(balance.variantId)?.name ?? null,
        warehouseName: warehouses.get(balance.warehouseId) ?? null,
        ...(this.domain.costs(scope.member) ? { value } : {}),
      })),
      page: query.page,
      limit: query.limit,
    };
  }
  async movements(actor: Actor, query: PageInput) {
    query = await this.domain.days(actor, query);
    const scope = await this.domain.scope(actor, query.branchId);
    const items = await this.domain.db.inventoryMovement.findMany({
      where: { ...scope.where, createdAt: dates(query) },
      ...paging(query),
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
    const labels = await this.domain.variantLabels(
      this.domain.db,
      actor.organizationId,
      items.map((i) => i.variantId),
    );
    const warehouses = await this.domain.warehouseNames(
      this.domain.db,
      actor.organizationId,
      items.map((i) => i.warehouseId),
    );
    return {
      items: items.map(({ unitCost, valueDelta, ...movement }) => ({
        ...movement,
        sku: labels.get(movement.variantId)?.sku ?? null,
        name: labels.get(movement.variantId)?.name ?? null,
        warehouseName: warehouses.get(movement.warehouseId) ?? null,
        ...(this.domain.costs(scope.member) ? { unitCost, valueDelta } : {}),
      })),
      page: query.page,
      limit: query.limit,
    };
  }
  async lowStock(actor: Actor, warehouseId: string) {
    await this.domain.authorize(this.domain.db, actor);
    await this.domain.warehouse(this.domain.db, actor, warehouseId);
    // SQL pagina directamente los artículos bajo umbral, incluidos los que nunca tuvieron saldo.
    return this.domain.db.$queryRaw<
      Array<{
        variantId: string;
        sku: string;
        name: string;
        quantity: string;
        threshold: string;
      }>
    >`
      SELECT v.id AS "variantId", v.sku, p.name, COALESCE(b.quantity,0)::text AS quantity, p."lowStockThreshold"::text AS threshold
      FROM "ProductVariant" v JOIN "Product" p ON p.id=v."productId" AND p."organizationId"=v."organizationId"
      LEFT JOIN "InventoryBalance" b ON b."variantId"=v.id AND b."organizationId"=v."organizationId" AND b."warehouseId"=${warehouseId}::uuid
      WHERE v."organizationId"=${actor.organizationId}::uuid AND v."archivedAt" IS NULL AND p."archivedAt" IS NULL
      AND COALESCE(b.quantity,0)<=p."lowStockThreshold" ORDER BY v.sku LIMIT 100`;
  }
  async adjust(actor: Actor, body: AdjustmentInput, key?: string) {
    const warehouse = await this.domain.warehouse(
      this.domain.db,
      actor,
      body.warehouseId,
    );
    return this.domain.run(
      actor,
      'manage',
      'inventory.adjust',
      body,
      async (tx, member) => {
        const variant = await this.domain.variant(
          tx,
          actor.organizationId,
          body.variantId,
        );
        const delta = new Prisma.Decimal(body.delta);
        this.domain.quantity(
          delta.abs().toString(),
          variant.product.unit.precision,
        );
        const id = randomUUID();
        const movement = await this.move(
          tx,
          actor,
          member,
          body.warehouseId,
          body.variantId,
          delta,
          'ADJUSTMENT',
          id,
          body.reason,
          body.unitCost !== undefined
            ? new Prisma.Decimal(body.unitCost)
            : undefined,
        );
        await this.domain.audit(tx, actor, 'inventory.adjusted', movement.id, {
          delta: body.delta,
          reason: body.reason,
          after: movement.after,
        });
        return movement;
      },
      {
        branchId: warehouse.branchId,
        permission: 'inventory.adjust',
        idempotent: true,
        key,
      },
    );
  }
  async createTransfer(actor: Actor, body: TransferInput) {
    return this.domain.run(
      actor,
      'manage',
      'transfer.create',
      body,
      async (tx) => {
        const source = await this.domain.warehouse(
          tx,
          actor,
          body.sourceWarehouseId,
        );
        const target = await this.domain.warehouse(
          tx,
          actor,
          body.targetWarehouseId,
        );
        if (source.id === target.id)
          throw new BadRequestException(
            'Origen y destino deben ser diferentes',
          );
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
        const transfer = await tx.inventoryTransfer.create({
          data: {
            organizationId: actor.organizationId,
            branchId: source.branchId,
            targetBranchId: target.branchId,
            sourceWarehouseId: source.id,
            targetWarehouseId: target.id,
            actorId: actor.userId,
            reason: body.reason,
            lines: json<Prisma.InputJsonValue>(body.lines),
          },
        });
        await this.domain.audit(tx, actor, 'transfer.created', transfer.id);
        return transfer;
      },
    );
  }
  async transition(
    actor: Actor,
    id: string,
    action: 'send' | 'receive' | 'cancel',
    key?: string,
  ) {
    const existing = await this.domain.db.inventoryTransfer.findFirst({
      where: { id, organizationId: actor.organizationId },
    });
    if (!existing) throw new NotFoundException('Transferencia no encontrada');
    // Ambas sucursales se autorizan incluso al repetir una confirmación.
    await this.domain.authorize(
      this.domain.db,
      actor,
      'manage',
      existing.branchId,
    );
    await this.domain.authorize(
      this.domain.db,
      actor,
      'manage',
      existing.targetBranchId,
    );
    return this.domain.run(
      actor,
      'manage',
      `transfer.${action}:${id}`,
      { id },
      async (tx, member) => {
        const transfer = await tx.inventoryTransfer.findUniqueOrThrow({
          where: { id },
        });
        await this.domain.authorize(tx, actor, 'manage', transfer.branchId);
        await this.domain.authorize(
          tx,
          actor,
          'manage',
          transfer.targetBranchId,
        );
        const lines = transfer.lines as unknown as TransferLine[];
        if (
          (action === 'send' && transfer.status !== 'DRAFT') ||
          (action === 'receive' && transfer.status !== 'IN_TRANSIT') ||
          (action === 'cancel' &&
            !['DRAFT', 'IN_TRANSIT'].includes(transfer.status))
        )
          throw new ConflictException('Transición no permitida');
        for (const line of lines) {
          if (action === 'send') {
            await this.domain.variant(tx, actor.organizationId, line.variantId);
            const moved = await this.move(
              tx,
              actor,
              member,
              transfer.sourceWarehouseId,
              line.variantId,
              new Prisma.Decimal(line.quantity).negated(),
              'TRANSFER_OUT',
              id,
              transfer.reason,
            );
            line.unitCost = moved.unitCost.toString();
          } else if (action === 'receive' || transfer.status === 'IN_TRANSIT') {
            await this.move(
              tx,
              actor,
              member,
              action === 'receive'
                ? transfer.targetWarehouseId
                : transfer.sourceWarehouseId,
              line.variantId,
              new Prisma.Decimal(line.quantity),
              action === 'receive' ? 'TRANSFER_IN' : 'TRANSFER_CANCEL',
              id,
              transfer.reason,
              new Prisma.Decimal(line.unitCost!),
            );
          }
        }
        const updated = await tx.inventoryTransfer.update({
          where: { id },
          data: {
            status:
              action === 'send'
                ? 'IN_TRANSIT'
                : action === 'receive'
                  ? 'RECEIVED'
                  : 'CANCELLED',
            lines: json<Prisma.InputJsonValue>(lines),
          },
        });
        await this.domain.audit(tx, actor, `transfer.${action}`, id);
        return updated;
      },
      { branchId: existing.branchId, idempotent: true, key },
    );
  }
  async transfers(actor: Actor, query: PageInput) {
    const scope = await this.domain.scope(actor, query.branchId);
    if (!this.domain.costs(scope.member))
      throw new ForbiddenException('Permiso insuficiente');
    const transfers = await this.domain.db.inventoryTransfer.findMany({
      where: { ...scope.where, targetBranchId: scope.where.branchId },
      ...paging(query),
      orderBy: { createdAt: 'desc' },
    });
    const linesOf = (t: { lines: unknown }) => t.lines as TransferLine[];
    const labels = await this.domain.variantLabels(
      this.domain.db,
      actor.organizationId,
      transfers.flatMap((t) => linesOf(t).map((l) => l.variantId)),
    );
    const warehouses = await this.domain.warehouseNames(
      this.domain.db,
      actor.organizationId,
      transfers.flatMap((t) => [t.sourceWarehouseId, t.targetWarehouseId]),
    );
    return {
      items: transfers.map((t) => ({
        ...t,
        sourceWarehouseName: warehouses.get(t.sourceWarehouseId) ?? null,
        targetWarehouseName: warehouses.get(t.targetWarehouseId) ?? null,
        lines: linesOf(t).map((l) => ({
          ...l,
          sku: labels.get(l.variantId)?.sku ?? null,
          name: labels.get(l.variantId)?.name ?? null,
        })),
      })),
      page: query.page,
      limit: query.limit,
    };
  }
}
