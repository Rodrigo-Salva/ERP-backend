import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import {
  provisionBranchDefaults,
  provisionOrganizationDefaults,
} from '../../../common/domain/defaults';
import { Actor, DomainService } from '../../../common/domain/domain.service';
import { OrganizationInput, SettingsInput } from '../dto/organization.input';

@Injectable()
export class OrganizationSettingsService {
  constructor(private readonly domain: DomainService) {}

  private regional(data: OrganizationInput) {
    try {
      new Intl.DateTimeFormat(data.locale, {
        timeZone: data.timeZone,
      }).format();
      if (
        !Intl.supportedValuesOf('currency').includes(data.currency) ||
        !Intl.DateTimeFormat.supportedLocalesOf(data.locale).length
      )
        throw new Error();
    } catch {
      throw new BadRequestException('Configuración regional inválida');
    }
  }
  async createOrganization(
    userId: string,
    requestId: string,
    body: OrganizationInput,
  ) {
    this.regional(body);
    return this.domain.db.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          ...body,
          moneyPrecision: new Intl.NumberFormat(body.locale, {
            style: 'currency',
            currency: body.currency,
          }).resolvedOptions().maximumFractionDigits,
        },
      });
      const branch = await tx.branch.create({
        data: {
          organizationId: org.id,
          name: 'Principal',
          code: 'MAIN',
          timeZone: body.timeZone,
        },
      });
      await tx.warehouse.create({
        data: {
          organizationId: org.id,
          branchId: branch.id,
          name: 'Principal',
          code: 'MAIN',
        },
      });
      await provisionOrganizationDefaults(tx, org.id);
      await provisionBranchDefaults(tx, org.id, branch.id);
      await tx.membership.create({
        data: {
          organizationId: org.id,
          userId,
          role: 'OWNER',
          allBranches: true,
        },
      });
      await this.domain.audit(
        tx,
        { organizationId: org.id, userId, requestId },
        'organization.created',
        org.id,
      );
      return org;
    });
  }
  async settings(actor: Actor) {
    await this.domain.authorize(this.domain.db, actor, 'admin');
    return this.domain.db.organization.findUniqueOrThrow({
      where: { id: actor.organizationId },
    });
  }
  updateSettings(actor: Actor, body: SettingsInput) {
    return this.domain.run(
      actor,
      'admin',
      'organization.settings',
      body,
      async (tx) => {
        const before = await tx.organization.findUniqueOrThrow({
          where: { id: actor.organizationId },
        });
        this.regional({ ...before, ...body });
        if (
          body.currency &&
          body.currency !== before.currency &&
          ((await tx.product.count({
            where: { organizationId: actor.organizationId },
          })) ||
            (await tx.sale.count({
              where: { organizationId: actor.organizationId },
            })) ||
            (await tx.cashSession.count({
              where: { organizationId: actor.organizationId },
            })))
        )
          throw new ConflictException(
            'La moneda no puede cambiar después de registrar productos u operaciones',
          );
        if (
          body.moneyPrecision !== undefined &&
          body.moneyPrecision !== before.moneyPrecision &&
          (await tx.cashSession.count({
            where: { organizationId: actor.organizationId },
          }))
        )
          throw new ConflictException(
            'La precisión monetaria no puede cambiar después de abrir cajas',
          );
        const result = await tx.organization.update({
          where: { id: actor.organizationId },
          data: body,
        });
        await this.domain.audit(
          tx,
          actor,
          'organization.configured',
          actor.organizationId,
          { before, after: result },
        );
        return result;
      },
    );
  }
}
