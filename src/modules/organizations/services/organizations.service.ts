import { ForbiddenException, Injectable } from '@nestjs/common';
import { PageInput, paging } from '../../../common/domain/input';
import { PrismaService } from '../../../database/prisma.service';
import { OrganizationAccessService } from './organization-access.service';

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
  ) {}

  async branches(userId: string, organizationId: string, query: PageInput) {
    const membership = await this.access.membership(userId, organizationId);
    const items = await this.prisma.branch.findMany({
      where: {
        organizationId,
        archivedAt: null,
        ...(membership.allBranches
          ? {}
          : {
              accessGrants: {
                some: { membershipId: membership.id, organizationId },
              },
            }),
      },
      select: {
        id: true,
        name: true,
        code: true,
        address: true,
        timeZone: true,
      },
      orderBy: { id: 'asc' },
      ...paging(query),
    });
    return { items, page: query.page, limit: query.limit };
  }

  async members(userId: string, organizationId: string, query: PageInput) {
    const membership = await this.access.membership(userId, organizationId);
    if (membership.role !== 'OWNER' && membership.role !== 'ADMIN')
      throw new ForbiddenException('Permiso insuficiente');
    const items = await this.prisma.membership.findMany({
      where: { organizationId, revokedAt: null },
      select: {
        id: true,
        role: true,
        allBranches: true,
        permissions: true,
        branches: { select: { branchId: true } },
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { id: 'asc' },
      ...paging(query),
    });
    return { items, page: query.page, limit: query.limit };
  }
}
