import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Actor, DomainService } from '../../../common/domain/domain.service';
import { json } from '../../../common/domain/input';
import { Membership, Prisma } from '../../../generated/prisma/client';
import { CashService } from '../../cash/services/cash.service';
import { InventoryService } from '../../inventory/services/inventory.service';
import { returnPart } from '../domain/calculations';
import { CancelInput, ReturnInput } from '../dto/sales.input';
import {
  includeSale,
  SaleDocument,
  SaleDocumentsService,
} from './sale-documents.service';

/** Devoluciones parciales o totales y anulación de ventas (con reintegro y reposición). */
@Injectable()
export class SaleReturnsService {
  constructor(
    private readonly domain: DomainService,
    private readonly inventory: InventoryService,
    private readonly cash: CashService,
    private readonly documents: SaleDocumentsService,
  ) {}

  private async refund(
    tx: Prisma.TransactionClient,
    actor: Actor,
    member: Membership,
    sale: SaleDocument,
    body: ReturnInput,
    cancel = false,
  ) {
    if (!['CONFIRMED', 'PARTIAL_RETURN'].includes(sale.status))
      throw new ConflictException('La venta no admite devolución');
    if (new Set(body.lines.map((l) => l.lineId)).size !== body.lines.length)
      throw new BadRequestException('Línea duplicada');
    const method = await tx.paymentMethod.findFirst({
      where: {
        id: body.methodId,
        organizationId: actor.organizationId,
        archivedAt: null,
      },
    });
    if (!method)
      throw new NotFoundException('Método de reembolso no encontrado');
    if (method.isCash) {
      if (!body.cashSessionId)
        throw new BadRequestException(
          'Selecciona una caja abierta para el reembolso',
        );
      const cash = await this.cash.session(tx, actor, body.cashSessionId);
      if (cash.branchId !== sale.branchId)
        throw new BadRequestException(
          'La caja debe ser de la sucursal de la venta',
        );
    }
    const snapshots = [];
    for (const input of body.lines) {
      const line = sale.lines.find((l) => l.id === input.lineId);
      if (!line) throw new NotFoundException('Línea no encontrada');
      const variant = await this.domain.variant(
        tx,
        actor.organizationId,
        line.variantId,
        false,
      );
      const quantity = this.domain.quantity(
        input.quantity,
        variant.product.unit.precision,
      );
      if (line.returned.plus(quantity).gt(line.quantity))
        throw new ConflictException(
          'La devolución excede la cantidad vendida pendiente',
        );
      const gross = returnPart(
          line.gross,
          line.quantity,
          line.returned,
          quantity,
          sale.moneyPrecision,
        ),
        discount = returnPart(
          line.discount,
          line.quantity,
          line.returned,
          quantity,
          sale.moneyPrecision,
        ),
        tax = returnPart(
          line.tax,
          line.quantity,
          line.returned,
          quantity,
          sale.moneyPrecision,
        );
      const total = gross.minus(discount).plus(sale.taxIncluded ? 0 : tax);
      snapshots.push({
        lineId: line.id,
        variantId: line.variantId,
        quantity: quantity.toString(),
        restock: input.restock,
        gross,
        discount,
        tax,
        total,
        unitCost: line.cost.toString(),
      });
      await tx.saleLine.update({
        where: { id: line.id },
        data: { returned: line.returned.plus(quantity) },
      });
    }
    const sum = this.documents.totals(snapshots);
    const result = await tx.saleReturn.create({
      data: {
        organizationId: actor.organizationId,
        branchId: sale.branchId,
        saleId: sale.id,
        actorId: actor.userId,
        methodId: method.id,
        cashSessionId: method.isCash ? body.cashSessionId : undefined,
        reason: body.reason,
        ...sum,
        lines: json<Prisma.InputJsonValue>(snapshots),
      },
    });
    for (const line of snapshots)
      if (line.restock)
        await this.inventory.move(
          tx,
          actor,
          member,
          sale.warehouseId,
          line.variantId,
          new Prisma.Decimal(line.quantity),
          'RETURN',
          result.id,
          body.reason,
          new Prisma.Decimal(line.unitCost),
        );
    if (method.isCash && sum.total.gt(0))
      await this.cash.movement(
        tx,
        actor,
        body.cashSessionId!,
        sum.total.negated(),
        'REFUND',
        result.id,
        body.reason,
      );
    const remaining = await tx.saleLine.findMany({
      where: { saleId: sale.id },
    });
    await tx.sale.update({
      where: { id: sale.id },
      data: {
        status: remaining.every((l) => l.quantity.eq(l.returned))
          ? cancel
            ? 'CANCELLED'
            : 'RETURNED'
          : 'PARTIAL_RETURN',
      },
    });
    await this.domain.audit(
      tx,
      actor,
      cancel ? 'sale.cancelled' : 'sale.returned',
      result.id,
      { saleId: sale.id, total: sum.total, reason: body.reason },
    );
    const safeLines = snapshots.map(({ unitCost, ...line }) => ({
      ...line,
      ...(this.domain.costs(member) ? { unitCost } : {}),
    }));
    return { ...result, lines: safeLines };
  }
  async returns(actor: Actor, id: string, body: ReturnInput, key?: string) {
    const { sale } = await this.documents.document(actor, id);
    return this.domain.run(
      actor,
      'sell',
      `sale.return:${id}`,
      body,
      async (tx, member) =>
        this.refund(
          tx,
          actor,
          member,
          (await this.documents.document(actor, id, tx)).sale,
          body,
        ),
      {
        branchId: sale.branchId,
        permission: 'sales.return',
        idempotent: true,
        key,
      },
    );
  }
  async cancel(actor: Actor, id: string, body: CancelInput, key?: string) {
    const { sale } = await this.documents.document(actor, id);
    return this.domain.run(
      actor,
      'sell',
      `sale.cancel:${id}`,
      body,
      async (tx, member) => {
        const current = (await this.documents.document(actor, id, tx)).sale;
        if (current.status === 'DRAFT') {
          const result = await tx.sale.update({
            where: { id },
            data: { status: 'CANCELLED' },
            include: includeSale,
          });
          await this.domain.audit(tx, actor, 'sale.cancelled', id, {
            reason: body.reason,
          });
          return this.documents.view(result, this.domain.costs(member));
        }
        if (!body.methodId || body.restock === undefined)
          throw new BadRequestException(
            'Indica método de reembolso y decisión de reintegro',
          );
        return this.refund(
          tx,
          actor,
          member,
          current,
          {
            methodId: body.methodId,
            cashSessionId: body.cashSessionId,
            reason: body.reason,
            lines: current.lines
              .filter((l) => l.returned.lt(l.quantity))
              .map((l) => ({
                lineId: l.id,
                quantity: l.quantity.minus(l.returned).toString(),
                restock: body.restock!,
              })),
          },
          true,
        );
      },
      {
        branchId: sale.branchId,
        // Descartar un borrador no tiene efectos; anular una venta confirmada sí.
        permission: sale.status === 'DRAFT' ? undefined : 'sales.cancel',
        idempotent: true,
        key,
      },
    );
  }
}
