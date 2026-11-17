import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { Prisma, Membership } from '../../generated/prisma/client';
import { OrganizationAccessService } from '../../modules/organizations/services/organization-access.service';
import { json, PageInput } from './input';
import { dayBounds } from './time';

export interface Actor {
  organizationId: string;
  userId: string;
  requestId: string;
}
export const requestActor = (
  req: { auth: { userId: string }; requestId: string },
  organizationId: string,
): Actor => ({
  organizationId,
  userId: req.auth.userId,
  requestId: req.requestId,
});
export type AccessMode = 'read' | 'manage' | 'sell' | 'admin';
export const PERMISSIONS = [
  'inventory.adjust',
  'inventory.negative',
  'sales.discount',
  'sales.return',
  'sales.cancel',
  'cash.adjust',
] as const;
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

@Injectable()
export class DomainService {
  constructor(
    readonly db: PrismaService,
    private readonly access: OrganizationAccessService,
  ) {}
  allowed(member: Membership, permission: string): boolean {
    return (
      ['OWNER', 'ADMIN'].includes(member.role) ||
      member.permissions.includes(permission)
    );
  }
  costs(member: Membership): boolean {
    return ['OWNER', 'ADMIN', 'MANAGER'].includes(member.role);
  }
  async authorize(
    tx: Prisma.TransactionClient,
    actor: Actor,
    mode: AccessMode = 'read',
    branchId?: string,
    permission?: string,
  ) {
    const member = await this.access.membership(
      actor.userId,
      actor.organizationId,
      tx,
    );
    const roles = {
      read: ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'VIEWER'],
      manage: ['OWNER', 'ADMIN', 'MANAGER'],
      sell: ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER'],
      admin: ['OWNER', 'ADMIN'],
    };
    if (
      !roles[mode].includes(member.role) ||
      (permission && !this.allowed(member, permission))
    )
      throw new ForbiddenException('Permiso insuficiente');
    if (branchId) {
      const branch = await tx.branch.findFirst({
        where: {
          id: branchId,
          organizationId: actor.organizationId,
          ...(member.allBranches
            ? {}
            : { accessGrants: { some: { membershipId: member.id } } }),
        },
      });
      if (!branch) throw new NotFoundException('Sucursal no encontrada');
    }
    return member;
  }
  /**
   * Convierte `fromDay`/`toDay` (días completos) en `from`/`to` usando la zona horaria de
   * la sucursal consultada o, si no hay, la de la organización; así un mismo día significa
   * lo mismo sin importar el equipo o la zona del navegador.
   */
  async days<T extends PageInput>(actor: Actor, q: T): Promise<T> {
    if (!q.fromDay && !q.toDay) return q;
    const branch = q.branchId
      ? await this.db.branch.findFirst({
          where: { id: q.branchId, organizationId: actor.organizationId },
          select: { timeZone: true },
        })
      : null;
    const timeZone =
      branch?.timeZone ??
      (
        await this.db.organization.findUniqueOrThrow({
          where: { id: actor.organizationId },
          select: { timeZone: true },
        })
      ).timeZone;
    return { ...q, ...dayBounds(timeZone, q.fromDay, q.toDay) };
  }
  async scope(actor: Actor, branchId?: string) {
    const member = await this.authorize(this.db, actor, 'read', branchId);
    const branches = await this.db.branch.findMany({
      where: {
        organizationId: actor.organizationId,
        ...(branchId ? { id: branchId } : {}),
        ...(member.allBranches
          ? {}
          : { accessGrants: { some: { membershipId: member.id } } }),
      },
      select: { id: true },
    });
    return {
      member,
      where: {
        organizationId: actor.organizationId,
        branchId: { in: branches.map((b) => b.id) },
      },
    };
  }
  async run<T>(
    actor: Actor,
    mode: AccessMode,
    operation: string,
    body: unknown,
    action: (tx: Prisma.TransactionClient, member: Membership) => Promise<T>,
    options: {
      branchId?: string;
      permission?: string;
      key?: string;
      idempotent?: boolean;
    } = {},
  ): Promise<T> {
    if (
      options.idempotent &&
      (!options.key || !/^[A-Za-z0-9._:-]{8,100}$/.test(options.key))
    )
      throw new BadRequestException(
        'Envía Idempotency-Key de 8 a 100 caracteres',
      );
    const fingerprint = createHash('sha256')
      .update(canonical(body))
      .digest('hex');
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        return await this.db.$transaction(
          async (tx) => {
            const member = await this.authorize(
              tx,
              actor,
              mode,
              options.branchId,
              options.permission,
            );
            if (options.idempotent) {
              const previous = await tx.idempotencyRecord.findUnique({
                where: {
                  organizationId_operation_key: {
                    organizationId: actor.organizationId,
                    operation,
                    key: options.key!,
                  },
                },
              });
              if (previous) {
                if (
                  previous.actorId !== actor.userId ||
                  previous.fingerprint !== fingerprint
                )
                  throw new ConflictException(
                    'Clave de idempotencia utilizada con otros datos o usuario',
                  );
                if (this.costs(member)) return previous.response as T;
                const redact = (value: Prisma.JsonValue): Prisma.JsonValue => {
                  if (Array.isArray(value)) return value.map(redact);
                  if (value && typeof value === 'object')
                    return Object.fromEntries(
                      Object.entries(value)
                        .filter(
                          ([key]) =>
                            ![
                              'cost',
                              'unitCost',
                              'valueDelta',
                              'value',
                            ].includes(key),
                        )
                        .map(([key, nested]) => [key, redact(nested ?? null)]),
                    );
                  return value;
                };
                return redact(previous.response) as T;
              }
            }
            const result = await action(tx, member);
            if (options.idempotent)
              await tx.idempotencyRecord.create({
                data: {
                  organizationId: actor.organizationId,
                  actorId: actor.userId,
                  operation,
                  key: options.key!,
                  fingerprint,
                  response: json<Prisma.InputJsonValue>(result),
                },
              });
            return result;
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            timeout: 15000,
          },
        );
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          if (
            (error.code === 'P2034' ||
              (options.idempotent && error.code === 'P2002')) &&
            attempt < 3
          )
            continue;
          if (['P2034', 'P2002'].includes(error.code))
            throw new ConflictException(
              'Operación duplicada o conflicto concurrente',
            );
          if (error.code === 'P2003')
            throw new BadRequestException(
              'Referencia inválida o registro en uso',
            );
          if (error.code === 'P2025')
            throw new NotFoundException('Registro no encontrado');
        }
        throw error;
      }
    }
    throw new ConflictException('No se pudo completar la operación');
  }
  audit(
    tx: Prisma.TransactionClient,
    actor: Actor,
    action: string,
    resourceId: string,
    changes?: unknown,
  ) {
    return tx.auditEvent.create({
      data: {
        organizationId: actor.organizationId,
        actorId: actor.userId,
        requestId: actor.requestId,
        action,
        resourceType: action.split('.')[0]!,
        resourceId,
        ...(changes ? { changes: json<Prisma.InputJsonValue>(changes) } : {}),
      },
    });
  }
  async warehouse(tx: Prisma.TransactionClient, actor: Actor, id: string) {
    const warehouse = await tx.warehouse.findFirst({
      where: {
        id,
        organizationId: actor.organizationId,
        archivedAt: null,
        branch: { archivedAt: null },
      },
    });
    if (!warehouse) throw new NotFoundException('Almacén no encontrado');
    await this.authorize(tx, actor, 'read', warehouse.branchId);
    return warehouse;
  }
  async variant(
    tx: Prisma.TransactionClient,
    organizationId: string,
    id: string,
    active = true,
  ) {
    const variant = await tx.productVariant.findFirst({
      where: {
        organizationId,
        id,
        ...(active ? { archivedAt: null, product: { archivedAt: null } } : {}),
      },
      include: { product: { include: { unit: true } } },
    });
    if (!variant) throw new NotFoundException('Artículo no encontrado');
    return variant;
  }
  /** Etiquetas legibles (SKU y nombre) de varias variantes en una sola consulta. */
  async variantLabels(
    db: Prisma.TransactionClient,
    organizationId: string,
    ids: string[],
  ): Promise<Map<string, { sku: string; name: string }>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();
    const rows = await db.productVariant.findMany({
      where: { organizationId, id: { in: unique } },
      select: {
        id: true,
        sku: true,
        name: true,
        isDefault: true,
        product: { select: { name: true } },
      },
    });
    return new Map(
      rows.map((v) => [
        v.id,
        {
          sku: v.sku,
          name: v.isDefault ? v.product.name : `${v.product.name} - ${v.name}`,
        },
      ]),
    );
  }
  /** Nombres de almacenes en una sola consulta. */
  async warehouseNames(
    db: Prisma.TransactionClient,
    organizationId: string,
    ids: string[],
  ): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();
    const rows = await db.warehouse.findMany({
      where: { organizationId, id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((w) => [w.id, w.name]));
  }
  quantity(value: string, precision: number): Prisma.Decimal {
    const quantity = new Prisma.Decimal(value);
    if (quantity.lte(0) || quantity.decimalPlaces() > precision)
      throw new BadRequestException('Cantidad incompatible con la unidad');
    return quantity;
  }
  money(value: string | Prisma.Decimal, precision: number): Prisma.Decimal {
    const amount = new Prisma.Decimal(value);
    if (amount.lt(0) || amount.decimalPlaces() > precision)
      throw new BadRequestException(
        'Importe incompatible con la precisión monetaria',
      );
    return amount;
  }
}
