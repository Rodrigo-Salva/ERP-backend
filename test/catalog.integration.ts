import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { Server } from 'node:http';
import { resolve } from 'node:path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { Environment } from '../src/config/environment';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import { Role } from '../src/generated/prisma/client';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { PasswordService } from '../src/modules/auth/services/password.service';
import { cleanupTestData } from './cleanup';

config({ path: resolve(__dirname, '../.env'), quiet: true });
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith('_test'))
  throw new Error(
    'Configura TEST_DATABASE_URL con una base dedicada cuyo nombre termine en _test.',
  );

interface RecordBody {
  id: string;
}
interface PageBody {
  items: Array<RecordBody & { cost?: string; sku?: string }>;
  page: number;
  limit: number;
}

describe('Catálogo: reglas, permisos e integridad', () => {
  let app: INestApplication;
  let server: Server;
  let organizationA: string;
  let organizationB: string;
  let owner: string;
  let otherOwner: string;
  let cashier: string;
  let viewer: string;
  let manager: string;
  let categoryA: string;
  let categoryB: string;
  let unitA: string;
  let unitB: string;
  let fractionalUnit: string;
  let productA: string;
  let productB: string;
  const userIds: string[] = [];
  const organizationIds: string[] = [];
  const suffix = randomUUID();
  const password = 'integration-catalog-only-2026';
  const prisma = new PrismaService(
    new ConfigService<Environment, true>({ DATABASE_URL: databaseUrl }),
  );
  const path = (resource: string, organizationId = organizationA) =>
    `/api/v1/organizations/${organizationId}/${resource}`;
  const productData = (overrides: Record<string, unknown> = {}) => ({
    name: 'Agua mineral',
    sku: 'AGUA-500',
    barcode: '0001234567890',
    unitId: unitA,
    categoryId: categoryA,
    description: 'Botella',
    cost: '1.2345',
    price: '2.50',
    lowStockThreshold: '5',
    ...overrides,
  });
  const id = (response: { body: unknown }) => (response.body as RecordBody).id;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = module.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    server = app.getHttpServer() as Server;
    const auth = app.get(AuthService);
    for (const label of ['a', 'b']) {
      const email = `catalog-${label}-${suffix}@example.com`;
      const session = await auth.register(
        {
          email,
          password,
          name: 'Propietario',
          organizationName: `Catálogo ${label}`,
          branchName: 'Principal',
          currency: 'PEN',
          locale: 'es-PE',
          timeZone: 'America/Lima',
        },
        randomUUID(),
      );
      const user = await prisma.user.findUniqueOrThrow({
        where: { email },
        include: { memberships: true },
      });
      userIds.push(user.id);
      const organizationId = user.memberships[0]!.organizationId;
      organizationIds.push(organizationId);
      if (label === 'a') {
        owner = session.accessToken;
        organizationA = organizationId;
      } else {
        otherOwner = session.accessToken;
        organizationB = organizationId;
      }
    }
    const passwordHash = await app.get(PasswordService).hash(password);
    for (const role of ['CASHIER', 'VIEWER', 'MANAGER'] as Role[]) {
      const user = await prisma.user.create({
        data: {
          email: `catalog-${role}-${suffix}@example.com`,
          name: role,
          passwordHash,
        },
      });
      userIds.push(user.id);
      await prisma.membership.create({
        data: {
          organizationId: organizationA,
          userId: user.id,
          role,
          allBranches: false,
        },
      });
      const session = await auth.login(
        { email: user.email, password },
        randomUUID(),
      );
      if (role === 'CASHIER') cashier = session.accessToken;
      if (role === 'VIEWER') viewer = session.accessToken;
      if (role === 'MANAGER') manager = session.accessToken;
    }
    categoryA = id(
      await request(server)
        .post(path('categories'))
        .auth(owner, { type: 'bearer' })
        .send({ name: ' Bebidas ' })
        .expect(201),
    );
    unitA = id(
      await request(server)
        .post(path('units'))
        .auth(owner, { type: 'bearer' })
        .send({ name: 'Unidad', code: ' und ' })
        .expect(201),
    );
    fractionalUnit = id(
      await request(server)
        .post(path('units'))
        .auth(owner, { type: 'bearer' })
        .send({ name: 'Kilogramo', code: 'KG', precision: 3 })
        .expect(201),
    );
    categoryB = id(
      await request(server)
        .post(path('categories', organizationB))
        .auth(otherOwner, { type: 'bearer' })
        .send({ name: 'Bebidas' })
        .expect(201),
    );
    unitB = id(
      await request(server)
        .post(path('units', organizationB))
        .auth(otherOwner, { type: 'bearer' })
        .send({ name: 'Unidad', code: 'UND' })
        .expect(201),
    );
    const first = await request(server)
      .post(path('products'))
      .auth(owner, { type: 'bearer' })
      .send(productData({ sku: ' agua-500 ' }))
      .expect(201);
    productA = id(first);
    expect(first.body).toMatchObject({
      sku: 'AGUA-500',
      cost: '1.2345',
      price: '2.5000',
      lowStockThreshold: '5.000',
    });
    productB = id(
      await request(server)
        .post(path('products', organizationB))
        .auth(otherOwner, { type: 'bearer' })
        .send(productData({ unitId: unitB, categoryId: categoryB }))
        .expect(201),
    );
  });

  afterAll(async () => {
    try {
      await cleanupTestData(prisma, organizationIds, userIds);
    } finally {
      if (app) await app.close();
      await prisma.$disconnect();
    }
  });

  it('crea una variante predeterminada y auditoría con importes exactos', async () => {
    const variants = await prisma.productVariant.findMany({
      where: { organizationId: organizationA, productId: productA },
    });
    expect(variants).toHaveLength(1);
    expect(variants[0]!.isDefault).toBe(true);
    expect(variants[0]!.cost.toFixed(4)).toBe('1.2345');
    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { resourceId: productA, action: 'product.created' },
    });
    expect(event.changes).toMatchObject({
      before: null,
      after: { sku: 'AGUA-500', cost: '1.2345', price: '2.5000' },
    });
    expect(JSON.stringify(event)).not.toContain(owner);
  });

  it('requiere sesión y evita consultar o modificar otra organización', async () => {
    await request(server).get(path('products')).expect(401);
    await request(server)
      .get(path('products', organizationB))
      .auth(owner, { type: 'bearer' })
      .expect(404);
    await request(server)
      .get(path(`products/${productB}`))
      .auth(owner, { type: 'bearer' })
      .expect(404);
    await request(server)
      .patch(path(`products/${productB}`))
      .auth(owner, { type: 'bearer' })
      .send({ price: '0' })
      .expect(404);
    await request(server)
      .post(path(`products/${productB}/archive`))
      .auth(owner, { type: 'bearer' })
      .expect(404);
    await request(server)
      .post(path(`products/${productB}/restore`))
      .auth(owner, { type: 'bearer' })
      .expect(404);
    await request(server)
      .patch(path(`categories/${categoryB}`))
      .auth(owner, { type: 'bearer' })
      .send({ name: 'Ajena' })
      .expect(404);
    await request(server)
      .get(path('units', organizationB))
      .auth(owner, { type: 'bearer' })
      .expect(404);
  });

  it('rechaza categorías y unidades ajenas al crear productos', async () => {
    for (const foreign of [{ categoryId: categoryB }, { unitId: unitB }]) {
      await request(server)
        .post(path('products'))
        .auth(owner, { type: 'bearer' })
        .send(productData({ sku: 'FOREIGN', barcode: null, ...foreign }))
        .expect(404);
    }
    await request(server)
      .post(path('products'))
      .auth(owner, { type: 'bearer' })
      .send(productData({ organizationId: organizationB }))
      .expect(400);
  });

  it('oculta costos al cajero y usuario de lectura en detalle y listados', async () => {
    for (const token of [cashier, viewer]) {
      const detail = await request(server)
        .get(path(`products/${productA}`))
        .auth(token, { type: 'bearer' })
        .expect(200);
      expect(detail.body).not.toHaveProperty('cost');
      expect(detail.body).not.toHaveProperty('variants');
      const list = await request(server)
        .get(path('products'))
        .auth(token, { type: 'bearer' })
        .expect(200);
      expect(list.text).not.toContain('"cost"');
      expect(list.text).not.toContain('1.2345');
    }
  });

  it('impide al cajero y usuario de lectura escribir o archivar el catálogo', async () => {
    for (const token of [cashier, viewer]) {
      await request(server)
        .post(path('products'))
        .auth(token, { type: 'bearer' })
        .send(productData({ sku: 'FORBIDDEN', barcode: null }))
        .expect(403);
      await request(server)
        .patch(path(`products/${productA}`))
        .auth(token, { type: 'bearer' })
        .send({ price: '1' })
        .expect(403);
      await request(server)
        .post(path(`products/${productA}/archive`))
        .auth(token, { type: 'bearer' })
        .expect(403);
      await request(server)
        .post(path('categories'))
        .auth(token, { type: 'bearer' })
        .send({ name: 'No permitido' })
        .expect(403);
      await request(server)
        .post(path('units'))
        .auth(token, { type: 'bearer' })
        .send({ name: 'Caja', code: 'BOX' })
        .expect(403);
    }
  });

  it('permite al encargado gestionar catálogo y consultar costos', async () => {
    const created = await request(server)
      .post(path('products'))
      .auth(manager, { type: 'bearer' })
      .send(productData({ sku: 'MANAGER', barcode: null }))
      .expect(201);
    const updated = await request(server)
      .patch(path(`products/${id(created)}`))
      .auth(manager, { type: 'bearer' })
      .send({ price: '3.1250' })
      .expect(200);
    expect(updated.body).toMatchObject({ cost: '1.2345', price: '3.1250' });
  });

  it('mantiene SKU y códigos únicos por organización, sin registros parciales', async () => {
    const count = await prisma.product.count({
      where: { organizationId: organizationA },
    });
    const auditCount = await prisma.auditEvent.count({
      where: { organizationId: organizationA, action: 'product.created' },
    });
    await request(server)
      .post(path('products'))
      .auth(owner, { type: 'bearer' })
      .send(productData({ sku: 'agua-500', barcode: null }))
      .expect(409);
    await request(server)
      .post(path('products'))
      .auth(owner, { type: 'bearer' })
      .send(productData({ sku: 'NEW-SKU' }))
      .expect(409);
    await request(server)
      .post(path('categories'))
      .auth(owner, { type: 'bearer' })
      .send({ name: 'bebidas' })
      .expect(409);
    await request(server)
      .post(path('units'))
      .auth(owner, { type: 'bearer' })
      .send({ name: 'Duplicada', code: 'und' })
      .expect(409);
    expect(
      await prisma.product.count({ where: { organizationId: organizationA } }),
    ).toBe(count);
    expect(
      await prisma.auditEvent.count({
        where: { organizationId: organizationA, action: 'product.created' },
      }),
    ).toBe(auditCount);
    expect(
      await prisma.productVariant.count({
        where: { sku: 'AGUA-500', organizationId: { in: organizationIds } },
      }),
    ).toBe(2);
  });

  it('resuelve dos altas concurrentes del mismo SKU sin duplicados', async () => {
    const responses = await Promise.all(
      [1, 2].map(() =>
        request(server)
          .post(path('products'))
          .auth(owner, { type: 'bearer' })
          .send(productData({ sku: 'CONCURRENT', barcode: null })),
      ),
    );
    expect(responses.map((res) => res.status).sort()).toEqual([201, 409]);
    expect(
      await prisma.productVariant.count({
        where: { organizationId: organizationA, sku: 'CONCURRENT' },
      }),
    ).toBe(1);
  });

  it.each([
    { price: 2.5 },
    { price: '-1' },
    { price: '1.00001' },
    { price: '1e2' },
    { price: '100000000000000' },
    { cost: '-0.1' },
    { cost: null },
    { name: null },
    { unitId: null },
    { lowStockThreshold: null },
    { lowStockThreshold: '1.0001' },
  ])('rechaza importes o campos inválidos: %j', async (invalid) => {
    await request(server)
      .patch(path(`products/${productA}`))
      .auth(owner, { type: 'bearer' })
      .send(invalid)
      .expect(400);
  });

  it('valida umbrales según precisión y conserva importes grandes sin redondearlos', async () => {
    await request(server)
      .post(path('products'))
      .auth(owner, { type: 'bearer' })
      .send(
        productData({
          sku: 'FRACTION-UND',
          barcode: null,
          lowStockThreshold: '0.5',
        }),
      )
      .expect(400);
    const response = await request(server)
      .post(path('products'))
      .auth(owner, { type: 'bearer' })
      .send(
        productData({
          sku: 'FRACTION-KG',
          barcode: null,
          unitId: fractionalUnit,
          lowStockThreshold: '0.125',
          price: '99999999999999.9999',
          cost: '0',
        }),
      )
      .expect(201);
    expect(response.body).toMatchObject({
      price: '99999999999999.9999',
      cost: '0.0000',
      lowStockThreshold: '0.125',
    });
    await request(server)
      .patch(path(`units/${fractionalUnit}`))
      .auth(owner, { type: 'bearer' })
      .send({ precision: 0 })
      .expect(409);
    const unit = await request(server)
      .patch(path(`units/${fractionalUnit}`))
      .auth(owner, { type: 'bearer' })
      .send({ name: 'Kilogramos' })
      .expect(200);
    expect(unit.body).toMatchObject({ precision: 3 });
    await request(server)
      .patch(path(`products/${productA}`))
      .auth(owner, { type: 'bearer' })
      .send({ unitId: fractionalUnit })
      .expect(409);
  });

  it('busca por nombre, SKU o código y aplica filtros y paginación', async () => {
    for (const q of ['mineral', 'agua-500', '0001234567890']) {
      const response = await request(server)
        .get(path('products'))
        .query({ q, categoryId: categoryA })
        .auth(owner, { type: 'bearer' })
        .expect(200);
      expect(
        (response.body as PageBody).items.some((item) => item.id === productA),
      ).toBe(true);
    }
    const first = await request(server)
      .get(path('products'))
      .query({ page: 1, limit: 1 })
      .auth(owner, { type: 'bearer' })
      .expect(200);
    const second = await request(server)
      .get(path('products'))
      .query({ page: 2, limit: 1 })
      .auth(owner, { type: 'bearer' })
      .expect(200);
    expect((first.body as PageBody).items).toHaveLength(1);
    expect((first.body as PageBody).items[0]!.id).not.toBe(
      (second.body as PageBody).items[0]!.id,
    );
    await request(server)
      .get(path('products'))
      .query({ limit: 101 })
      .auth(owner, { type: 'bearer' })
      .expect(400);
    await request(server)
      .get(path('products'))
      .query({ status: 'inventado' })
      .auth(owner, { type: 'bearer' })
      .expect(400);
  });

  it('permite limpiar campos opcionales sin alterar los demás y audita antes/después', async () => {
    const response = await request(server)
      .patch(path(`products/${productA}`))
      .auth(owner, { type: 'bearer' })
      .send({
        description: null,
        categoryId: null,
        barcode: null,
        name: 'Agua editada',
      })
      .expect(200);
    expect(response.body).toMatchObject({
      description: null,
      categoryId: null,
      barcode: null,
      sku: 'AGUA-500',
      price: '2.5000',
      unitId: unitA,
    });
    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { resourceId: productA, action: 'product.updated' },
      orderBy: { createdAt: 'desc' },
    });
    expect(event.changes).toMatchObject({
      before: { name: 'Agua mineral', barcode: '0001234567890' },
      after: { name: 'Agua editada', barcode: null },
    });
    await request(server)
      .patch(path(`products/${productA}`))
      .auth(owner, { type: 'bearer' })
      .send({})
      .expect(400);
    await request(server)
      .patch(path(`products/${productA}`))
      .auth(owner, { type: 'bearer' })
      .send({ name: '   ' })
      .expect(400);
    const renamed = await request(server)
      .patch(path(`products/${productA}`))
      .auth(owner, { type: 'bearer' })
      .send({ name: 'Solo nombre' })
      .expect(200);
    expect(renamed.body).toMatchObject({
      name: 'Solo nombre',
      sku: 'AGUA-500',
      price: '2.5000',
    });
  });

  it('archiva sin borrar, mantiene el SKU reservado y exige referencias activas al restaurar', async () => {
    const category = id(
      await request(server)
        .post(path('categories'))
        .auth(owner, { type: 'bearer' })
        .send({ name: 'Temporal' })
        .expect(201),
    );
    const unit = id(
      await request(server)
        .post(path('units'))
        .auth(owner, { type: 'bearer' })
        .send({ code: 'TEMP', name: 'Temporal' })
        .expect(201),
    );
    const product = id(
      await request(server)
        .post(path('products'))
        .auth(owner, { type: 'bearer' })
        .send(
          productData({
            sku: 'ARCHIVE',
            barcode: null,
            categoryId: category,
            unitId: unit,
          }),
        )
        .expect(201),
    );
    await request(server)
      .post(path(`categories/${category}/archive`))
      .auth(owner, { type: 'bearer' })
      .expect(409);
    await request(server)
      .post(path(`units/${unit}/archive`))
      .auth(owner, { type: 'bearer' })
      .expect(409);
    await request(server)
      .post(path(`products/${product}/archive`))
      .auth(owner, { type: 'bearer' })
      .expect(200);
    await request(server)
      .post(path(`products/${product}/archive`))
      .auth(owner, { type: 'bearer' })
      .expect(200);
    expect(
      await prisma.auditEvent.count({
        where: { resourceId: product, action: 'product.archived' },
      }),
    ).toBe(1);
    await request(server)
      .patch(path(`products/${product}`))
      .auth(owner, { type: 'bearer' })
      .send({ price: '0' })
      .expect(409);
    const active = await request(server)
      .get(path('products'))
      .query({ q: 'ARCHIVE' })
      .auth(owner, { type: 'bearer' })
      .expect(200);
    expect((active.body as PageBody).items).toHaveLength(0);
    const archived = await request(server)
      .get(path('products'))
      .query({ q: 'ARCHIVE', status: 'archived' })
      .auth(owner, { type: 'bearer' })
      .expect(200);
    expect((archived.body as PageBody).items[0]!.id).toBe(product);
    await request(server)
      .post(path('products'))
      .auth(owner, { type: 'bearer' })
      .send(productData({ sku: 'ARCHIVE', barcode: null }))
      .expect(409);
    await request(server)
      .post(path(`categories/${category}/archive`))
      .auth(owner, { type: 'bearer' })
      .expect(200);
    await request(server)
      .post(path(`units/${unit}/archive`))
      .auth(owner, { type: 'bearer' })
      .expect(200);
    await request(server)
      .post(path(`products/${product}/restore`))
      .auth(owner, { type: 'bearer' })
      .expect(409);
    await request(server)
      .post(path(`units/${unit}/restore`))
      .auth(owner, { type: 'bearer' })
      .expect(200);
    await request(server)
      .post(path(`products/${product}/restore`))
      .auth(owner, { type: 'bearer' })
      .expect(409);
    await request(server)
      .post(path(`categories/${category}/restore`))
      .auth(owner, { type: 'bearer' })
      .expect(200);
    const restored = await request(server)
      .post(path(`products/${product}/restore`))
      .auth(owner, { type: 'bearer' })
      .expect(200);
    expect(restored.body).toMatchObject({
      archivedAt: null,
      sku: 'ARCHIVE',
      price: '2.5000',
    });
    expect(
      await prisma.productVariant.count({ where: { productId: product } }),
    ).toBe(1);
  });

  it('PostgreSQL impide referencias cruzadas y una segunda variante predeterminada', async () => {
    await expect(
      prisma.product.create({
        data: {
          organizationId: organizationA,
          unitId: unitA,
          categoryId: categoryB,
          name: 'Ajeno',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      prisma.productVariant.create({
        data: {
          organizationId: organizationB,
          productId: productA,
          sku: 'CROSS',
          price: '1',
          cost: '1',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      prisma.productVariant.create({
        data: {
          organizationId: organizationA,
          productId: productA,
          sku: 'SECOND-DEFAULT',
          price: '1',
          cost: '1',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(
      prisma.category.delete({ where: { id: categoryA } }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('PostgreSQL también rechaza importes negativos y precisiones fuera de rango', async () => {
    const variant = await prisma.productVariant.findFirstOrThrow({
      where: { productId: productA },
    });
    await expect(
      prisma.productVariant.update({
        where: { id: variant.id },
        data: { price: '-1' },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.unitOfMeasure.update({
        where: { id: unitA },
        data: { precision: 4 },
      }),
    ).rejects.toThrow();
    const unchanged = await prisma.productVariant.findUniqueOrThrow({
      where: { id: variant.id },
    });
    expect(unchanged.price.toFixed(4)).toBe('2.5000');
  });

  it('resuelve el archivado concurrente de una categoría sin dejar productos activos en ella', async () => {
    const category = id(
      await request(server)
        .post(path('categories'))
        .auth(owner, { type: 'bearer' })
        .send({ name: 'Concurrente' })
        .expect(201),
    );
    const responses = await Promise.all([
      request(server)
        .post(path(`categories/${category}/archive`))
        .auth(owner, { type: 'bearer' }),
      request(server)
        .post(path('products'))
        .auth(owner, { type: 'bearer' })
        .send(
          productData({
            sku: 'RACE-ARCHIVE',
            barcode: null,
            categoryId: category,
          }),
        ),
    ]);
    expect(responses.some((res) => res.status === 409)).toBe(true);
    expect(responses.every((res) => [200, 201, 409].includes(res.status))).toBe(
      true,
    );
    const stored = await prisma.category.findUniqueOrThrow({
      where: { id: category },
    });
    const activeProducts = await prisma.product.count({
      where: {
        organizationId: organizationA,
        categoryId: category,
        archivedAt: null,
      },
    });
    expect(Boolean(stored.archivedAt) && activeProducts > 0).toBe(false);
  });
});
