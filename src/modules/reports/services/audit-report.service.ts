import { ForbiddenException, Injectable } from '@nestjs/common';
import { Actor, DomainService } from '../../../common/domain/domain.service';
import { dates, PageInput, paging } from '../../../common/domain/input';

@Injectable()
export class AuditReportService {
  constructor(private readonly domain: DomainService) {}

  async events(actor: Actor, q: PageInput) {
    const member = await this.domain.authorize(this.domain.db, actor, 'admin');
    if (!member.allBranches)
      throw new ForbiddenException(
        'La auditoría global requiere acceso a todas las sucursales',
      );
    return {
      items: await this.domain.db.auditEvent.findMany({
        where: {
          organizationId: actor.organizationId,
          createdAt: dates(q),
          ...(q.q ? { action: { contains: q.q } } : {}),
        },
        ...paging(q),
        orderBy: { createdAt: 'desc' },
      }),
      page: q.page,
      limit: q.limit,
    };
  }
}
