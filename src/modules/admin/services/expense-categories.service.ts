import { Injectable, NotFoundException } from '@nestjs/common';
import { Actor, DomainService } from '../../../common/domain/domain.service';
import { PageInput, paging } from '../../../common/domain/input';
import { CategoryInput, CategoryPatch } from '../dto/expense-category.input';

@Injectable()
export class ExpenseCategoriesService {
  constructor(private readonly domain: DomainService) {}

  async categories(actor: Actor, q: PageInput) {
    await this.domain.authorize(this.domain.db, actor, 'manage');
    return {
      items: await this.domain.db.expenseCategory.findMany({
        where: { organizationId: actor.organizationId, archivedAt: null },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        ...paging(q),
      }),
      page: q.page,
      limit: q.limit,
    };
  }
  category(actor: Actor, body: CategoryInput | CategoryPatch, id?: string) {
    return this.domain.run(
      actor,
      'admin',
      'expense-category.save',
      body,
      async (tx) => {
        if (
          id &&
          !(await tx.expenseCategory.findFirst({
            where: { id, organizationId: actor.organizationId },
          }))
        )
          throw new NotFoundException();
        const { archived, ...data } = body as CategoryPatch;
        const result = id
          ? await tx.expenseCategory.update({
              where: { id },
              data: {
                ...data,
                ...(archived !== undefined
                  ? { archivedAt: archived ? new Date() : null }
                  : {}),
              },
            })
          : await tx.expenseCategory.create({
              data: { organizationId: actor.organizationId, name: body.name! },
            });
        await this.domain.audit(tx, actor, 'expense-category.saved', result.id);
        return result;
      },
    );
  }
}
