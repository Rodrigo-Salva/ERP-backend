import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Actor, DomainService } from '../../../common/domain/domain.service';
import { Prisma } from '../../../generated/prisma/client';

export const includeSale = { lines: true, payments: true } as const;
export type SaleDocument = Prisma.SaleGetPayload<{
  include: typeof includeSale;
}>;

/** Lectura y totales de documentos de venta, compartidos por ventas y devoluciones. */
@Injectable()
export class SaleDocumentsService {
  constructor(private readonly domain: DomainService) {}

  view(sale: SaleDocument, costs: boolean) {
    return {
      ...sale,
      lines: sale.lines.map(({ cost, ...line }) => ({
        ...line,
        ...(costs ? { cost } : {}),
      })),
    };
  }
  async document(
    actor: Actor,
    id: string,
    tx: Prisma.TransactionClient = this.domain.db,
  ) {
    const sale = await tx.sale.findFirst({
      where: { id, organizationId: actor.organizationId },
      include: includeSale,
    });
    if (!sale) throw new NotFoundException('Venta no encontrada');
    const member = await this.domain.authorize(
      tx,
      actor,
      'read',
      sale.branchId,
    );
    if (member.role === 'CASHIER' && sale.actorId !== actor.userId)
      throw new ForbiddenException('Solo puedes consultar tus ventas');
    return { sale, member };
  }
  totals(
    lines: Array<{
      gross: Prisma.Decimal;
      discount: Prisma.Decimal;
      tax: Prisma.Decimal;
      total: Prisma.Decimal;
    }>,
  ) {
    const result = {
      gross: new Prisma.Decimal(0),
      discount: new Prisma.Decimal(0),
      tax: new Prisma.Decimal(0),
      total: new Prisma.Decimal(0),
    };
    for (const line of lines)
      for (const key of ['gross', 'discount', 'tax', 'total'] as const)
        result[key] = result[key].plus(line[key]);
    if (Object.values(result).some((v) => v.gt('99999999999999.9999')))
      throw new BadRequestException('Importe fuera del límite permitido');
    return result;
  }
}
