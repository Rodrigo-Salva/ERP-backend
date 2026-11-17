import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { Actor, DomainService } from '../../../common/domain/domain.service';
import { PageInput, paging } from '../../../common/domain/input';
import { Prisma } from '../../../generated/prisma/client';
import {
  AcceptInput,
  InviteInput,
  MembershipInput,
  ResetInput,
} from '../dto/identity.input';
import { PasswordService } from '../../auth/services/password.service';
import { MailService } from '../../auth/services/mail.service';
const digest = (token: string) =>
  createHash('sha256').update(token).digest('hex');
@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);
  constructor(
    private readonly domain: DomainService,
    private readonly passwords: PasswordService,
    private readonly mail: MailService,
  ) {}
  private async atomic<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let i = 0; i < 4; i++) {
      try {
        return await this.domain.db.$transaction(fn, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          ['P2034', 'P2002'].includes(e.code) &&
          i < 3
        )
          continue;
        throw e;
      }
    }
    throw new ConflictException();
  }
  async forgot(email: string) {
    const user = await this.domain.db.user.findFirst({
      where: { email, disabledAt: null },
    });
    if (user) {
      const token = randomBytes(32).toString('base64url');
      await this.atomic(async (tx) => {
        await tx.passwordReset.updateMany({
          where: { userId: user.id, usedAt: null },
          data: { usedAt: new Date() },
        });
        await tx.passwordReset.create({
          data: {
            userId: user.id,
            tokenHash: digest(token),
            expiresAt: new Date(Date.now() + 30 * 60000),
          },
        });
      });
      try {
        await this.mail.send(
          email,
          'Recuperar contraseña',
          '/reset-password',
          token,
        );
      } catch {
        this.logger.error({
          event: 'mail_delivery_failed',
          kind: 'password_reset',
        });
      }
    }
    return { message: 'Si la cuenta está disponible, recibirás instrucciones' };
  }
  async reset(body: ResetInput, requestId: string) {
    const passwordHash = await this.passwords.hash(body.password);
    await this.atomic(async (tx) => {
      const reset = await tx.passwordReset.findFirst({
        where: {
          tokenHash: digest(body.token),
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
      });
      if (
        !reset ||
        !(await tx.user.findFirst({
          where: { id: reset.userId, disabledAt: null },
        }))
      )
        throw new BadRequestException('Enlace no válido o vencido');
      const used = await tx.passwordReset.updateMany({
        where: { id: reset.id, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (used.count !== 1)
        throw new BadRequestException('Enlace no válido o vencido');
      await tx.user.update({
        where: { id: reset.userId },
        data: { passwordHash },
      });
      await tx.session.updateMany({
        where: { userId: reset.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.passwordReset.updateMany({
        where: { userId: reset.userId, usedAt: null },
        data: { usedAt: new Date() },
      });
      const memberships = await tx.membership.findMany({
        where: { userId: reset.userId, revokedAt: null },
      });
      for (const member of memberships)
        await this.domain.audit(
          tx,
          {
            organizationId: member.organizationId,
            userId: reset.userId,
            requestId,
          },
          'user.password_reset',
          reset.userId,
        );
    });
    return { reset: true };
  }
  private async branches(
    tx: Prisma.TransactionClient,
    organizationId: string,
    ids: string[],
  ) {
    if (new Set(ids).size !== ids.length)
      throw new BadRequestException('Sucursal duplicada');
    if (
      (await tx.branch.count({
        where: { organizationId, id: { in: ids }, archivedAt: null },
      })) !== ids.length
    )
      throw new BadRequestException(
        'Alguna sucursal no pertenece a la organización',
      );
  }
  async invite(actor: Actor, body: InviteInput) {
    const token = randomBytes(32).toString('base64url');
    const result = await this.domain.run(
      actor,
      'admin',
      'invitation.create',
      body,
      async (tx) => {
        await this.branches(tx, actor.organizationId, body.branchIds);
        await tx.invitation.updateMany({
          where: {
            organizationId: actor.organizationId,
            email: body.email,
            usedAt: null,
            revokedAt: null,
          },
          data: { revokedAt: new Date() },
        });
        const invitation = await tx.invitation.create({
          data: {
            organizationId: actor.organizationId,
            ...body,
            invitedBy: actor.userId,
            tokenHash: digest(token),
            expiresAt: new Date(Date.now() + 48 * 3600000),
          },
        });
        await this.domain.audit(
          tx,
          actor,
          'invitation.created',
          invitation.id,
          { role: body.role, branchIds: body.branchIds },
        );
        return { id: invitation.id, expiresAt: invitation.expiresAt };
      },
    );
    await this.mail.send(
      body.email,
      'Invitación a la tienda',
      '/accept-invitation',
      token,
    );
    return result;
  }
  async accept(body: AcceptInput, requestId: string) {
    const lookup = await this.domain.db.invitation.findFirst({
      where: {
        tokenHash: digest(body.token),
        usedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (!lookup)
      throw new BadRequestException('Invitación no válida o vencida');
    const existing = await this.domain.db.user.findUnique({
      where: { email: lookup.email },
    });
    if (
      existing &&
      (existing.disabledAt ||
        !(await this.passwords.matches(body.password, existing.passwordHash)))
    )
      throw new BadRequestException(
        'Inicia sesión con la contraseña de tu cuenta existente',
      );
    const passwordHash =
      existing?.passwordHash ?? (await this.passwords.hash(body.password));
    await this.atomic(async (tx) => {
      const invite = await tx.invitation.findFirst({
        where: {
          id: lookup.id,
          usedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      });
      if (!invite)
        throw new BadRequestException('Invitación no válida o vencida');
      await this.domain.authorize(
        tx,
        {
          organizationId: invite.organizationId,
          userId: invite.invitedBy,
          requestId,
        },
        'admin',
      );
      await this.branches(tx, invite.organizationId, invite.branchIds);
      const current = await tx.user.findUnique({
        where: { email: invite.email },
      });
      if (
        current &&
        (!existing ||
          current.id !== existing.id ||
          current.disabledAt ||
          current.passwordHash !== existing.passwordHash)
      )
        throw new ConflictException(
          'La cuenta cambió; vuelve a iniciar el proceso',
        );
      const user =
        current ??
        (await tx.user.create({
          data: { email: invite.email, name: body.name, passwordHash },
        }));
      const member = await tx.membership.findUnique({
        where: {
          organizationId_userId: {
            organizationId: invite.organizationId,
            userId: user.id,
          },
        },
      });
      if (member && !member.revokedAt)
        throw new ConflictException(
          'El usuario ya pertenece a la organización',
        );
      const data = {
        role: invite.role,
        allBranches: invite.allBranches,
        permissions: invite.permissions,
        revokedAt: null,
      };
      const membership = member
        ? await tx.membership.update({ where: { id: member.id }, data })
        : await tx.membership.create({
            data: {
              ...data,
              organizationId: invite.organizationId,
              userId: user.id,
            },
          });
      await tx.membershipBranch.deleteMany({
        where: { membershipId: membership.id },
      });
      if (!invite.allBranches)
        await tx.membershipBranch.createMany({
          data: invite.branchIds.map((branchId) => ({
            organizationId: invite.organizationId,
            membershipId: membership.id,
            branchId,
          })),
        });
      await tx.invitation.update({
        where: { id: invite.id },
        data: { usedAt: new Date() },
      });
      await this.domain.audit(
        tx,
        { organizationId: invite.organizationId, userId: user.id, requestId },
        'invitation.accepted',
        invite.id,
        { membershipId: membership.id },
      );
    });
    return { accepted: true };
  }
  membership(actor: Actor, id: string, body: MembershipInput) {
    return this.domain.run(
      actor,
      'admin',
      'membership.update',
      body,
      async (tx) => {
        const member = await tx.membership.findFirst({
          where: { id, organizationId: actor.organizationId },
        });
        if (!member) throw new NotFoundException('Membresía no encontrada');
        if (member.role === 'OWNER' || member.userId === actor.userId)
          throw new ConflictException(
            'No puedes alterar al propietario ni tu propia membresía',
          );
        await this.branches(tx, actor.organizationId, body.branchIds);
        const updated = await tx.membership.update({
          where: { id },
          data: {
            role: body.role,
            allBranches: body.allBranches,
            permissions: body.permissions,
            revokedAt: body.revoked ? new Date() : null,
          },
        });
        await tx.membershipBranch.deleteMany({ where: { membershipId: id } });
        if (!body.allBranches)
          await tx.membershipBranch.createMany({
            data: body.branchIds.map((branchId) => ({
              organizationId: actor.organizationId,
              membershipId: id,
              branchId,
            })),
          });
        await this.domain.audit(tx, actor, 'membership.updated', id, {
          role: body.role,
          allBranches: body.allBranches,
          permissions: body.permissions,
          branchIds: body.branchIds,
          revoked: body.revoked,
        });
        return updated;
      },
    );
  }
  async invitations(actor: Actor, q: PageInput) {
    await this.domain.authorize(this.domain.db, actor, 'admin');
    const items = await this.domain.db.invitation.findMany({
      where: { organizationId: actor.organizationId },
      select: {
        id: true,
        email: true,
        role: true,
        expiresAt: true,
        usedAt: true,
        revokedAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      ...paging(q),
    });
    return { items, page: q.page, limit: q.limit };
  }
  revoke(actor: Actor, id: string) {
    return this.domain.run(
      actor,
      'admin',
      'invitation.revoke',
      { id },
      async (tx) => {
        const count = await tx.invitation.updateMany({
          where: { id, organizationId: actor.organizationId, usedAt: null },
          data: { revokedAt: new Date() },
        });
        if (!count.count)
          throw new NotFoundException('Invitación no encontrada');
        await this.domain.audit(tx, actor, 'invitation.revoked', id);
        return { revoked: true };
      },
    );
  }
}
