import { ConfigService } from '@nestjs/config';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Environment } from '../src/config/environment';
import { PrismaService } from '../src/database/prisma.service';
import { HealthController } from '../src/modules/health/controllers/health.controller';

config({ path: resolve(__dirname, '../.env'), quiet: true });
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl)
  throw new Error(
    'Define TEST_DATABASE_URL y aplica las migraciones a esa base antes de ejecutar la integración.',
  );
if (!new URL(databaseUrl).pathname.endsWith('_test')) {
  throw new Error(
    'TEST_DATABASE_URL debe apuntar a una base cuyo nombre termine en _test.',
  );
}

describe('PostgreSQL: migración y pertenencia de almacenes', () => {
  const organizationA = randomUUID();
  const organizationB = randomUUID();
  const branchA = randomUUID();
  const prisma = new PrismaService(
    new ConfigService<Environment, true>({ DATABASE_URL: databaseUrl }),
  );

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.organization.createMany({
      data: [organizationA, organizationB].map((id) => ({
        id,
        name: 'Organización de prueba',
        currency: 'PEN',
        locale: 'es-PE',
        timeZone: 'America/Lima',
      })),
    });
    await prisma.branch.create({
      data: {
        id: branchA,
        organizationId: organizationA,
        name: 'Principal',
        code: 'MAIN',
        timeZone: 'America/Lima',
      },
    });
  });

  afterAll(async () => {
    try {
      // Solo elimina registros con los UUID generados para esta ejecución.
      await prisma.warehouse.deleteMany({
        where: { organizationId: { in: [organizationA, organizationB] } },
      });
      await prisma.branch.deleteMany({
        where: { organizationId: { in: [organizationA, organizationB] } },
      });
      await prisma.organization.deleteMany({
        where: { id: { in: [organizationA, organizationB] } },
      });
    } finally {
      await prisma.$disconnect();
    }
  });

  it('consulta PostgreSQL desde el endpoint de salud', async () => {
    await expect(new HealthController(prisma).ready()).resolves.toEqual({
      status: 'ok',
      database: 'up',
    });
  });

  it('permite un almacén de la misma organización y sucursal', async () => {
    const warehouse = await prisma.warehouse.create({
      data: {
        organizationId: organizationA,
        branchId: branchA,
        name: 'Principal',
        code: 'MAIN',
      },
    });
    expect(warehouse.organizationId).toBe(organizationA);
  });

  it('rechaza un almacén enlazado a una sucursal de otra organización', async () => {
    await expect(
      prisma.warehouse.create({
        data: {
          organizationId: organizationB,
          branchId: branchA,
          name: 'No permitido',
          code: 'CROSS',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('permite códigos repetidos entre organizaciones pero no dentro de una', async () => {
    await prisma.branch.create({
      data: {
        organizationId: organizationB,
        name: 'Otra principal',
        code: 'MAIN',
        timeZone: 'America/Lima',
      },
    });
    await expect(
      prisma.branch.create({
        data: {
          organizationId: organizationA,
          name: 'Duplicada',
          code: 'MAIN',
          timeZone: 'America/Lima',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('impide borrar una organización con sucursales', async () => {
    await expect(
      prisma.organization.delete({ where: { id: organizationA } }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });
});
