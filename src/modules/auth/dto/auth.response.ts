import { ApiProperty } from '@nestjs/swagger';

/* Formas de las respuestas, solo para documentar la API en Swagger. */

export class SessionResponseDto {
  @ApiProperty({
    description:
      'Token opaco; se entrega una sola vez. Mantener en memoria del cliente.',
  })
  accessToken!: string;

  @ApiProperty({ example: 'Bearer' })
  tokenType!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: Date;
}

export class UserSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'admin@example.com' })
  email!: string;

  @ApiProperty({ example: 'Administrador' })
  name!: string;
}

class OrganizationSummaryDto {
  @ApiProperty()
  name!: string;

  @ApiProperty({ example: 'PEN' })
  currency!: string;

  @ApiProperty({ example: 'es-PE' })
  locale!: string;

  @ApiProperty({ example: 'America/Lima' })
  timeZone!: string;
}

class MembershipSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ enum: ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'VIEWER'] })
  role!: string;

  @ApiProperty()
  allBranches!: boolean;

  @ApiProperty({
    type: [String],
    description: 'Permisos explícitos adicionales al rol',
  })
  permissions!: string[];

  @ApiProperty({ type: OrganizationSummaryDto })
  organization!: OrganizationSummaryDto;
}

export class ProfileResponseDto extends UserSummaryDto {
  @ApiProperty({ type: [MembershipSummaryDto] })
  memberships!: MembershipSummaryDto[];
}
