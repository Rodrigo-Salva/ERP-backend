import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Actor, DomainService } from '../../../common/domain/domain.service';
import { dates, PageInput, paging, toText } from '../../../common/domain/input';
import { Membership, Prisma } from '../../../generated/prisma/client';
import { InventoryService } from '../../inventory/services/inventory.service';
import { CashService } from '../../cash/services/cash.service';
import { lineTotals } from '../domain/calculations';
import { ConfirmInput, SaleInput } from '../dto/sales.input';
import { includeSale, SaleDocumentsService } from './sale-documents.service';
const escapeHtml = (text: unknown) =>
  toText(text).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
@Injectable()
export class SalesService {
  constructor(
    private readonly domain: DomainService,
    private readonly inventory: InventoryService,
    private readonly cash: CashService,
    private readonly documents: SaleDocumentsService,
  ) {}
  private checkDiscount(
    member: Membership,
    discount: Prisma.Decimal,
    limit: Prisma.Decimal,
  ) {
    if (discount.gt(limit) && !this.domain.allowed(member, 'sales.discount'))
      throw new ForbiddenException('Descuento no autorizado');
  }
  create(actor: Actor, body: SaleInput) {
    return this.domain.run(
      actor,
      'sell',
      'sale.create',
      body,
      async (tx, member) => {
        const warehouse = await this.domain.warehouse(
          tx,
          actor,
          body.warehouseId,
        );
        const cash = await this.cash.session(tx, actor, body.cashSessionId);
        if (cash.branchId !== warehouse.branchId)
          throw new BadRequestException(
            'Caja y almacén deben pertenecer a la misma sucursal',
          );
        if (
          body.customerId &&
          !(await tx.customer.findFirst({
            where: {
              id: body.customerId,
              organizationId: actor.organizationId,
              archivedAt: null,
            },
          }))
        )
          throw new NotFoundException('Cliente no encontrado');
        if (
          new Set(body.lines.map((l) => l.variantId)).size !== body.lines.length
        )
          throw new BadRequestException('Artículo duplicado');
        const settings = await tx.organization.findUniqueOrThrow({
          where: { id: actor.organizationId },
        });
        const lines = [];
        for (const line of body.lines) {
          const variant = await this.domain.variant(
            tx,
            actor.organizationId,
            line.variantId,
          );
          const quantity = this.domain.quantity(
            line.quantity,
            variant.product.unit.precision,
          );
          const discountRate = new Prisma.Decimal(line.discountRate);
          this.checkDiscount(member, discountRate, settings.discountLimit);
          lines.push({
            organizationId: actor.organizationId,
            variantId: variant.id,
            sku: variant.sku,
            name: variant.isDefault
              ? variant.product.name
              : `${variant.product.name} - ${variant.name}`,
            quantity,
            price: variant.price,
            discountRate,
            ...lineTotals(
              variant.price,
              quantity,
              discountRate,
              settings.taxRate,
              settings.taxIncluded,
              settings.moneyPrecision,
            ),
          });
        }
        const created = await tx.sale.create({
          data: {
            organizationId: actor.organizationId,
            branchId: warehouse.branchId,
            warehouseId: warehouse.id,
            cashSessionId: cash.id,
            customerId: body.customerId,
            actorId: actor.userId,
            currency: settings.currency,
            moneyPrecision: settings.moneyPrecision,
            taxRate: settings.taxRate,
            taxIncluded: settings.taxIncluded,
            storeSnapshot: { name: settings.name, timeZone: settings.timeZone },
            ...this.documents.totals(lines),
          },
        });
        await tx.saleLine.createMany({
          data: lines.map((line) => ({ ...line, saleId: created.id })),
        });
        const sale = await tx.sale.findUniqueOrThrow({
          where: { id: created.id },
          include: includeSale,
        });
        await this.domain.audit(tx, actor, 'sale.created', sale.id);
        return this.documents.view(sale, this.domain.costs(member));
      },
    );
  }
  async confirm(actor: Actor, id: string, body: ConfirmInput, key?: string) {
    const original = await this.documents.document(actor, id);
    return this.domain.run(
      actor,
      'sell',
      `sale.confirm:${id}`,
      body,
      async (tx, member) => {
        const { sale } = await this.documents.document(actor, id, tx);
        if (sale.status !== 'DRAFT')
          throw new ConflictException('La venta ya fue confirmada o cancelada');
        await this.cash.session(tx, actor, sale.cashSessionId);
        const settings = await tx.organization.findUniqueOrThrow({
          where: { id: actor.organizationId },
        });
        const branch = await tx.branch.findUniqueOrThrow({
          where: { id: sale.branchId },
        });
        const totals = [];
        for (const line of sale.lines) {
          const variant = await this.domain.variant(
            tx,
            actor.organizationId,
            line.variantId,
          );
          this.checkDiscount(member, line.discountRate, settings.discountLimit);
          const calculated = lineTotals(
            variant.price,
            line.quantity,
            line.discountRate,
            settings.taxRate,
            settings.taxIncluded,
            settings.moneyPrecision,
          );
          totals.push(calculated);
          const moved = await this.inventory.move(
            tx,
            actor,
            member,
            sale.warehouseId,
            line.variantId,
            line.quantity.negated(),
            'SALE',
            sale.id,
            'Venta confirmada',
          );
          await tx.saleLine.update({
            where: { id: line.id },
            data: {
              ...calculated,
              price: variant.price,
              sku: variant.sku,
              name: variant.isDefault
                ? variant.product.name
                : `${variant.product.name} - ${variant.name}`,
              cost: moved.unitCost,
            },
          });
        }
        const sum = this.documents.totals(totals);
        let tendered = new Prisma.Decimal(0);
        let cashTotal = new Prisma.Decimal(0);
        if (
          new Set(body.payments.map((p) => p.methodId)).size !==
          body.payments.length
        )
          throw new BadRequestException('Método de pago duplicado');
        for (const payment of body.payments) {
          const method = await tx.paymentMethod.findFirst({
            where: {
              id: payment.methodId,
              organizationId: actor.organizationId,
              archivedAt: null,
            },
          });
          if (!method)
            throw new NotFoundException('Método de pago no encontrado');
          const amount = this.domain.money(
            payment.amount,
            settings.moneyPrecision,
          );
          tendered = tendered.plus(amount);
          if (method.isCash) cashTotal = cashTotal.plus(amount);
          await tx.payment.create({
            data: {
              organizationId: actor.organizationId,
              saleId: id,
              methodId: method.id,
              methodName: method.name,
              isCash: method.isCash,
              amount,
            },
          });
        }
        const change = tendered.minus(sum.total);
        if (change.lt(0) || change.gt(cashTotal))
          throw new BadRequestException(
            'Pago insuficiente o excedente no reembolsable en efectivo',
          );
        const counter = await tx.documentCounter.upsert({
          where: {
            organizationId_namespace: {
              organizationId: actor.organizationId,
              namespace: 'SALE',
            },
          },
          create: {
            organizationId: actor.organizationId,
            namespace: 'SALE',
            value: 1,
          },
          update: { value: { increment: 1 } },
        });
        const result = await tx.sale.update({
          where: { id },
          data: {
            ...sum,
            change,
            status: 'CONFIRMED',
            confirmedAt: new Date(),
            folio: `${settings.receiptPrefix}-${String(counter.value).padStart(8, '0')}`,
            currency: settings.currency,
            moneyPrecision: settings.moneyPrecision,
            taxRate: settings.taxRate,
            taxIncluded: settings.taxIncluded,
            storeSnapshot: {
              name: settings.name,
              branch: branch.name,
              address: branch.address,
              timeZone: branch.timeZone,
            },
          },
          include: includeSale,
        });
        if (cashTotal.minus(change).gt(0))
          await this.cash.movement(
            tx,
            actor,
            sale.cashSessionId,
            cashTotal.minus(change),
            'SALE',
            id,
            'Cobro de venta',
          );
        await this.domain.audit(tx, actor, 'sale.confirmed', id, {
          total: sum.total,
          folio: result.folio,
        });
        return this.documents.view(result, this.domain.costs(member));
      },
      { branchId: original.sale.branchId, idempotent: true, key },
    );
  }
  async get(actor: Actor, id: string) {
    const { sale, member } = await this.documents.document(actor, id);
    return this.documents.view(sale, this.domain.costs(member));
  }
  async list(actor: Actor, q: PageInput) {
    q = await this.domain.days(actor, q);
    const scope = await this.domain.scope(actor, q.branchId);
    const sales = await this.domain.db.sale.findMany({
      where: {
        ...scope.where,
        createdAt: dates(q),
        ...(scope.member.role === 'CASHIER'
          ? { actorId: actor.userId }
          : q.actorId
            ? { actorId: q.actorId }
            : {}),
        ...(q.customerId ? { customerId: q.customerId } : {}),
        ...(q.q ? { folio: { contains: q.q, mode: 'insensitive' } } : {}),
        ...(q.status ? { status: q.status } : {}),
      },
      ...paging(q),
      orderBy: { createdAt: 'desc' },
      include: includeSale,
    });
    return {
      items: sales.map((s) =>
        this.documents.view(s, this.domain.costs(scope.member)),
      ),
      page: q.page,
      limit: q.limit,
    };
  }
  async receipt(actor: Actor, id: string, html: boolean) {
    const { sale } = await this.documents.document(actor, id);
    if (!sale.confirmedAt)
      throw new ConflictException('La venta no está confirmada');
    const receipt = this.documents.view(sale, false);
    if (!html) return receipt;
    const store = sale.storeSnapshot as Record<string, Prisma.JsonValue>;
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Recibo ${escapeHtml(sale.folio)}</title><style>body{font:14px sans-serif;max-width:700px;margin:30px auto}table{width:100%;border-collapse:collapse}td,th{padding:8px;text-align:left;border-bottom:1px solid #ddd}@media print{body{margin:0}}</style></head><body><h1>${escapeHtml(store.name)}</h1><p>${escapeHtml(store.branch)} · ${escapeHtml(store.address)}</p><h2>Recibo ${escapeHtml(sale.folio)}</h2><p>${escapeHtml(sale.confirmedAt.toISOString())} · ${escapeHtml(sale.currency)} · ${escapeHtml(sale.status)}</p><table><tr><th>Artículo</th><th>Cantidad</th><th>Precio</th><th>Total</th></tr>${sale.lines.map((l) => `<tr><td>${escapeHtml(l.sku)} ${escapeHtml(l.name)}</td><td>${l.quantity.toString()}</td><td>${l.price.toFixed(sale.moneyPrecision)}</td><td>${l.total.toFixed(sale.moneyPrecision)}</td></tr>`).join('')}</table><p>Bruto: ${sale.gross.toFixed(sale.moneyPrecision)} · Descuento: ${sale.discount.toFixed(sale.moneyPrecision)} · Impuestos (${sale.taxRate.toString()}% ${sale.taxIncluded ? 'incluidos' : 'agregados'}): ${sale.tax.toFixed(sale.moneyPrecision)}</p><h2>Total: ${sale.total.toFixed(sale.moneyPrecision)} ${escapeHtml(sale.currency)}</h2>${sale.payments.map((p) => `<p>${escapeHtml(p.methodName)}: ${p.amount.toFixed(sale.moneyPrecision)}</p>`).join('')}<p>Cambio: ${sale.change.toFixed(sale.moneyPrecision)}</p><p>Recibo interno. No es un comprobante fiscal certificado.</p></body></html>`;
  }
}
