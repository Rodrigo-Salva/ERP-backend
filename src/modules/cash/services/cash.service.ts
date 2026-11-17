import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Actor, DomainService } from '../../../common/domain/domain.service';
import { dates, PageInput, paging } from '../../../common/domain/input';
import { Prisma } from '../../../generated/prisma/client';
import {
  CashMovementInput,
  CloseCashInput,
  ExpenseInput,
  OpenCashInput,
  RegisterInput,
} from '../dto/cash.input';
@Injectable()
export class CashService {
  constructor(private readonly domain: DomainService) {}
  async session(
    tx: Prisma.TransactionClient,
    actor: Actor,
    id: string,
    open = true,
  ) {
    const session = await tx.cashSession.findFirst({
      where: { id, organizationId: actor.organizationId },
    });
    if (!session) throw new NotFoundException('Sesión de caja no encontrada');
    const member = await this.domain.authorize(
      tx,
      actor,
      'sell',
      session.branchId,
    );
    if (member.role === 'CASHIER' && session.actorId !== actor.userId)
      throw new ForbiddenException('Esta caja pertenece a otro cajero');
    if (open && session.closedAt)
      throw new ConflictException('La caja está cerrada');
    return session;
  }
  async movement(
    tx: Prisma.TransactionClient,
    actor: Actor,
    sessionId: string,
    amount: Prisma.Decimal,
    kind: string,
    referenceId: string,
    reason: string,
  ) {
    const session = await this.session(tx, actor, sessionId);
    return tx.cashMovement.create({
      data: {
        organizationId: actor.organizationId,
        branchId: session.branchId,
        cashSessionId: sessionId,
        actorId: actor.userId,
        amount,
        kind,
        reason,
        referenceId,
      },
    });
  }
  registers(actor: Actor, body: RegisterInput) {
    return this.domain.run(
      actor,
      'admin',
      'cash-register.create',
      body,
      async (tx) => {
        const result = await tx.cashRegister.create({
          data: { organizationId: actor.organizationId, ...body },
        });
        await this.domain.audit(tx, actor, 'cash-register.created', result.id);
        return result;
      },
      { branchId: body.branchId },
    );
  }
  async listRegisters(actor: Actor, query: PageInput) {
    const scope = await this.domain.scope(actor, query.branchId);
    return {
      items: await this.domain.db.cashRegister.findMany({
        where: { ...scope.where, archivedAt: null },
        ...paging(query),
        orderBy: { name: 'asc' },
      }),
      page: query.page,
      limit: query.limit,
    };
  }
  async open(actor: Actor, body: OpenCashInput, key?: string) {
    const register = await this.domain.db.cashRegister.findFirst({
      where: {
        id: body.cashRegisterId,
        organizationId: actor.organizationId,
        archivedAt: null,
      },
    });
    if (!register) throw new NotFoundException('Punto de caja no encontrado');
    return this.domain.run(
      actor,
      'sell',
      'cash.open',
      body,
      async (tx) => {
        if (
          await tx.cashSession.findFirst({
            where: { cashRegisterId: register.id, closedAt: null },
          })
        )
          throw new ConflictException('Este punto ya tiene una caja abierta');
        const settings = await tx.organization.findUniqueOrThrow({
          where: { id: actor.organizationId },
        });
        const session = await tx.cashSession.create({
          data: {
            organizationId: actor.organizationId,
            branchId: register.branchId,
            cashRegisterId: register.id,
            actorId: actor.userId,
            opening: this.domain.money(body.opening, settings.moneyPrecision),
          },
        });
        await this.domain.audit(tx, actor, 'cash.opened', session.id, {
          opening: body.opening,
        });
        return session;
      },
      { branchId: register.branchId, idempotent: true, key },
    );
  }
  async expected(
    tx: Prisma.TransactionClient,
    id: string,
    opening: Prisma.Decimal,
  ) {
    const sum = await tx.cashMovement.aggregate({
      where: { cashSessionId: id },
      _sum: { amount: true },
    });
    return opening.plus(sum._sum.amount ?? 0);
  }
  async close(actor: Actor, id: string, body: CloseCashInput, key?: string) {
    const original = await this.session(this.domain.db, actor, id, false);
    return this.domain.run(
      actor,
      'sell',
      `cash.close:${id}`,
      body,
      async (tx) => {
        const session = await this.session(tx, actor, id);
        const settings = await tx.organization.findUniqueOrThrow({
          where: { id: actor.organizationId },
        });
        const counted = this.domain.money(
          body.counted,
          settings.moneyPrecision,
        );
        const expected = await this.expected(tx, id, session.opening);
        const closed = await tx.cashSession.update({
          where: { id },
          data: {
            counted,
            expected,
            difference: counted.minus(expected),
            closedAt: new Date(),
            closedBy: actor.userId,
          },
        });
        await this.domain.audit(tx, actor, 'cash.closed', id, {
          counted,
          expected,
          difference: closed.difference,
        });
        return closed;
      },
      { branchId: original.branchId, idempotent: true, key },
    );
  }
  async manual(
    actor: Actor,
    id: string,
    body: CashMovementInput,
    key?: string,
  ) {
    const session = await this.session(this.domain.db, actor, id);
    return this.domain.run(
      actor,
      'sell',
      `cash.manual:${id}`,
      body,
      async (tx) => {
        const settings = await tx.organization.findUniqueOrThrow({
          where: { id: actor.organizationId },
        });
        const value = this.domain.money(body.amount, settings.moneyPrecision);
        if (value.lte(0))
          throw new BadRequestException('El importe debe ser positivo');
        const movement = await this.movement(
          tx,
          actor,
          id,
          body.direction === 'OUT' ? value.negated() : value,
          'MANUAL',
          randomUUID(),
          body.reason,
        );
        await this.domain.audit(tx, actor, 'cash.adjusted', movement.id, {
          amount: movement.amount,
          reason: body.reason,
        });
        return movement;
      },
      {
        branchId: session.branchId,
        permission: 'cash.adjust',
        idempotent: true,
        key,
      },
    );
  }
  async list(actor: Actor, query: PageInput) {
    query = await this.domain.days(actor, query);
    const scope = await this.domain.scope(actor, query.branchId);
    return {
      items: await this.domain.db.cashSession.findMany({
        where: {
          ...scope.where,
          ...(scope.member.role === 'CASHIER' ? { actorId: actor.userId } : {}),
          createdAt: dates(query),
        },
        ...paging(query),
        orderBy: { createdAt: 'desc' },
      }),
      page: query.page,
      limit: query.limit,
    };
  }
  async detail(actor: Actor, id: string) {
    const session = await this.session(this.domain.db, actor, id, false);
    return {
      ...session,
      currentExpected:
        session.expected ??
        (await this.expected(this.domain.db, id, session.opening)),
      movements: await this.domain.db.cashMovement.findMany({
        where: { cashSessionId: id, organizationId: actor.organizationId },
        orderBy: { createdAt: 'desc' },
        take: 1000,
      }),
    };
  }
  expense(actor: Actor, body: ExpenseInput, key?: string) {
    return this.domain.run(
      actor,
      'manage',
      'expense.create',
      body,
      async (tx) => {
        if (
          !(await tx.expenseCategory.findFirst({
            where: {
              id: body.categoryId,
              organizationId: actor.organizationId,
              archivedAt: null,
            },
          }))
        )
          throw new NotFoundException('Categoría de gasto no encontrada');
        const settings = await tx.organization.findUniqueOrThrow({
          where: { id: actor.organizationId },
        });
        const amount = this.domain.money(body.amount, settings.moneyPrecision);
        if (amount.lte(0))
          throw new BadRequestException('El gasto debe ser positivo');
        if (body.cashSessionId) {
          const cash = await this.session(tx, actor, body.cashSessionId);
          if (cash.branchId !== body.branchId)
            throw new BadRequestException('La caja pertenece a otra sucursal');
        }
        const expense = await tx.expense.create({
          data: {
            organizationId: actor.organizationId,
            actorId: actor.userId,
            ...body,
            amount,
            occurredAt: new Date(body.occurredAt),
          },
        });
        if (body.cashSessionId)
          await this.movement(
            tx,
            actor,
            body.cashSessionId,
            amount.negated(),
            'EXPENSE',
            expense.id,
            body.description,
          );
        await this.domain.audit(tx, actor, 'expense.created', expense.id, {
          amount,
        });
        return expense;
      },
      {
        branchId: body.branchId,
        permission: body.cashSessionId ? 'cash.adjust' : undefined,
        idempotent: true,
        key,
      },
    );
  }
  async expenses(actor: Actor, query: PageInput) {
    query = await this.domain.days(actor, query);
    await this.domain.authorize(this.domain.db, actor, 'manage');
    const scope = await this.domain.scope(actor, query.branchId);
    return {
      items: await this.domain.db.expense.findMany({
        where: { ...scope.where, occurredAt: dates(query) },
        ...paging(query),
        orderBy: { occurredAt: 'desc' },
      }),
      page: query.page,
      limit: query.limit,
    };
  }
}
