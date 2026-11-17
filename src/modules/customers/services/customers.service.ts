import { Injectable, NotFoundException } from '@nestjs/common';
import { Actor, DomainService } from '../../../common/domain/domain.service';
import { PageInput, paging } from '../../../common/domain/input';
import { CustomerInput, CustomerPatch } from '../dto/customers.input';

@Injectable()
export class CustomersService {
  constructor(private readonly domain: DomainService) {}
  async list(actor: Actor, q: PageInput) {
    await this.domain.authorize(this.domain.db, actor);
    return {
      items: await this.domain.db.customer.findMany({
        where: {
          organizationId: actor.organizationId,
          archivedAt: q.status === 'archived' ? { not: null } : null,
          ...(q.q ? { name: { contains: q.q, mode: 'insensitive' } } : {}),
        },
        ...paging(q),
        orderBy: { name: 'asc' },
      }),
      page: q.page,
      limit: q.limit,
    };
  }
  save(actor: Actor, body: CustomerInput | CustomerPatch, id?: string) {
    return this.domain.run(actor, 'sell', 'customer.save', body, async (tx) => {
      const { consent, archived, ...data } = body as CustomerPatch;
      if (
        id &&
        !(await tx.customer.findFirst({
          where: { id, organizationId: actor.organizationId },
        }))
      )
        throw new NotFoundException('Cliente no encontrado');
      const result = id
        ? await tx.customer.update({
            where: { id },
            data: {
              ...data,
              ...(consent ? { consentAt: new Date() } : {}),
              ...(archived !== undefined
                ? { archivedAt: archived ? new Date() : null }
                : {}),
            },
          })
        : await tx.customer.create({
            data: {
              ...data,
              name: body.name!,
              organizationId: actor.organizationId,
              consentAt: new Date(),
            },
          });
      await this.domain.audit(
        tx,
        actor,
        id ? 'customer.updated' : 'customer.created',
        result.id,
      );
      return result;
    });
  }
}
