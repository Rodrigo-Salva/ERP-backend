import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { SessionPrincipal } from '../../../common/auth/authenticated-request';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import {
  provisionBranchDefaults,
  provisionOrganizationDefaults,
} from '../../../common/domain/defaults';
import { Environment } from '../../../config/environment';
import { PrismaService } from '../../../database/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { LoginInput, RegisterInput } from '../dto/auth.input';
import { PasswordService } from './password.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly config: ConfigService<Environment, true>,
  ) {}

  private createToken() {
    const accessToken = randomBytes(32).toString('base64url');
    return {
      accessToken,
      tokenHash: createHash('sha256').update(accessToken).digest('hex'),
    };
  }

  private expiration(): Date {
    return new Date(
      Date.now() +
        this.config.get('SESSION_TTL_HOURS', { infer: true }) * 3600000,
    );
  }

  async register(dto: RegisterInput, requestId: string) {
    try {
      new Intl.DateTimeFormat(dto.locale, { timeZone: dto.timeZone }).format();
      if (
        Intl.DateTimeFormat.supportedLocalesOf([dto.locale]).length === 0 ||
        !Intl.supportedValuesOf('currency').includes(dto.currency)
      )
        throw new Error();
    } catch {
      throw new BadRequestException('Moneda, idioma o zona horaria no válidos');
    }
    const passwordHash = await this.passwords.hash(dto.password);
    const token = this.createToken();
    const expiresAt = this.expiration();
    try {
      await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { email: dto.email, name: dto.name.trim(), passwordHash },
        });
        const organization = await tx.organization.create({
          data: {
            name: dto.organizationName.trim(),
            currency: dto.currency,
            moneyPrecision: new Intl.NumberFormat(dto.locale, {
              style: 'currency',
              currency: dto.currency,
            }).resolvedOptions().maximumFractionDigits,
            locale: dto.locale,
            timeZone: dto.timeZone,
          },
        });
        const branch = await tx.branch.create({
          data: {
            organizationId: organization.id,
            name: dto.branchName.trim(),
            code: 'MAIN',
            timeZone: dto.timeZone,
          },
        });
        await tx.warehouse.create({
          data: {
            organizationId: organization.id,
            branchId: branch.id,
            name: 'Principal',
            code: 'MAIN',
          },
        });
        await provisionOrganizationDefaults(tx, organization.id);
        await provisionBranchDefaults(tx, organization.id, branch.id);
        await tx.membership.create({
          data: {
            organizationId: organization.id,
            userId: user.id,
            role: 'OWNER',
            allBranches: true,
          },
        });
        await tx.session.create({
          data: { userId: user.id, tokenHash: token.tokenHash, expiresAt },
        });
        await tx.auditEvent.create({
          data: {
            actorId: user.id,
            organizationId: organization.id,
            action: 'organization.registered',
            resourceType: 'Organization',
            resourceId: organization.id,
            requestId,
          },
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'No se pudo registrar la cuenta con esos datos',
        );
      }
      throw error;
    }
    return { accessToken: token.accessToken, tokenType: 'Bearer', expiresAt };
  }

  async login(dto: LoginInput, requestId: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    const valid = await this.passwords.matches(
      dto.password,
      user?.passwordHash,
    );
    if (!user || user.disabledAt || !valid)
      throw new UnauthorizedException('Credenciales incorrectas');
    const token = this.createToken();
    const expiresAt = this.expiration();
    await this.prisma.$transaction(async (tx) => {
      await tx.session.create({
        data: { userId: user.id, tokenHash: token.tokenHash, expiresAt },
      });
      await this.auditSessions(tx, user.id, requestId, 'session.login');
    });
    return { accessToken: token.accessToken, tokenType: 'Bearer', expiresAt };
  }

  async authenticate(token: string): Promise<SessionPrincipal> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: createHash('sha256').update(token).digest('hex') },
      include: { user: { select: { disabledAt: true } } },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.user.disabledAt
    ) {
      throw new UnauthorizedException('Sesión no válida o vencida');
    }
    return {
      sessionId: session.id,
      userId: session.userId,
      expiresAt: session.expiresAt,
    };
  }

  async refresh(principal: SessionPrincipal) {
    const token = this.createToken();
    await this.prisma.$transaction(async (tx) => {
      const revoked = await tx.session.updateMany({
        where: {
          id: principal.sessionId,
          revokedAt: null,
          expiresAt: { gt: new Date() },
          user: { disabledAt: null },
        },
        data: { revokedAt: new Date() },
      });
      if (revoked.count !== 1)
        throw new UnauthorizedException('Sesión no válida o vencida');
      await tx.session.create({
        data: {
          userId: principal.userId,
          tokenHash: token.tokenHash,
          expiresAt: principal.expiresAt,
        },
      });
    });
    return {
      accessToken: token.accessToken,
      tokenType: 'Bearer',
      expiresAt: principal.expiresAt,
    };
  }

  async logout(principal: SessionPrincipal, requestId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const revoked = await tx.session.updateMany({
        where: { id: principal.sessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (revoked.count)
        await this.auditSessions(
          tx,
          principal.userId,
          requestId,
          'session.logout',
        );
    });
  }

  private async auditSessions(
    tx: Prisma.TransactionClient,
    userId: string,
    requestId: string,
    action: string,
  ): Promise<void> {
    const memberships = await tx.membership.findMany({
      where: { userId, revokedAt: null, organization: { archivedAt: null } },
      select: { organizationId: true },
    });
    if (memberships.length)
      await tx.auditEvent.createMany({
        data: memberships.map(({ organizationId }) => ({
          actorId: userId,
          organizationId,
          action,
          resourceType: 'User',
          resourceId: userId,
          requestId,
        })),
      });
  }

  async profile(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, email: true, name: true },
    });
    const memberships = await this.prisma.membership.findMany({
      where: { userId, revokedAt: null, organization: { archivedAt: null } },
      select: {
        id: true,
        role: true,
        organizationId: true,
        allBranches: true,
        permissions: true,
        organization: {
          select: { name: true, currency: true, locale: true, timeZone: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return { ...user, memberships };
  }
}
