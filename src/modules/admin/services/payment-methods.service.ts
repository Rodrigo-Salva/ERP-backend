import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Actor, DomainService } from '../../../common/domain/domain.service';
import { PageInput, paging } from '../../../common/domain/input';
import { MethodInput, MethodPatch } from '../dto/payment-method.input';

@Injectable()
export class PaymentMethodsService {
  constructor(private readonly domain: DomainService) {}

  async methods(actor: Actor, q: PageInput) {
    await this.domain.authorize(this.domain.db, actor);
    return {
      items: await this.domain.db.paymentMethod.findMany({
        where: { organizationId: actor.organizationId, archivedAt: null },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        ...paging(q),
      }),
      page: q.page,
      limit: q.limit,
    };
  }
  method(actor: Actor, body: MethodInput | MethodPatch, id?: string) {
    return this.domain.run(
      actor,
      'admin',
      'payment-method.save',
      body,
      async (tx) => {
        const { archived, ...data } = body as MethodPatch;
        if (id) {
          const before = await tx.paymentMethod.findFirst({
            where: { id, organizationId: actor.organizationId },
          });
          if (!before) throw new NotFoundException();
          if (
            data.isCash !== undefined &&
            data.isCash !== before.isCash &&
            ((await tx.payment.count({ where: { methodId: id } })) ||
              (await tx.saleReturn.count({ where: { methodId: id } })))
          )
            throw new ConflictException(
              'El tipo de un método utilizado no puede cambiar',
            );
        }
        const result = id
          ? await tx.paymentMethod.update({
              where: { id },
              data: {
                ...data,
                ...(archived !== undefined
                  ? { archivedAt: archived ? new Date() : null }
                  : {}),
              },
            })
          : await tx.paymentMethod.create({
              data: {
                organizationId: actor.organizationId,
                ...(body as MethodInput),
              },
            });
        await this.domain.audit(tx, actor, 'payment-method.saved', result.id);
        return result;
      },
    );
  }
}
