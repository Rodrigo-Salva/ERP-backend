import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { Prisma } from '../../../generated/prisma/client';

@Injectable()
export class OrganizationAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async membership(
    userId: string,
    organizationId: string,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const membership = await db.membership.findFirst({
      where: {
        userId,
        organizationId,
        revokedAt: null,
        user: { disabledAt: null },
        organization: { archivedAt: null },
      },
    });
    if (!membership) throw new NotFoundException('Organización no encontrada');
    return membership;
  }
}
