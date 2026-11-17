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
import { AuthService } from '../src/modules/auth/services/auth.service';
import { PasswordService } from '../src/modules/auth/services/password.service';
import { cleanupTestData } from './cleanup';

config({ path: resolve(__dirname, '../.env'), quiet: true });
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith('_test'))
  throw new Error(
    'Configura TEST_DATABASE_URL con una base dedicada cuyo nombre termine en _test.',
  );

type Body = Record<string, any>;

describe('Variantes, códigos de barras, clientes y consulta de ventas', () => {
  let app: INestApplication;
  let server: Server;
  let orgA: string;
  let orgB: string;
  let owner: string;
  let otherOwner: string;
  let cashier: string;
  let otherCashier: string;
  let warehouse: string;
  let register: string;
  let cashMethod: string;
  let session: string;
  let unit: string;
  let product: string;
  let variantM: string;
  let variantL: string;
  const userIds: string[] = [];
  const organizationIds: string[] = [];
  const suffix = randomUUID();
  const password = 'integration-commerce-only-2026';
  const prisma = new PrismaService(
    new ConfigService<Environment, true>({ DATABASE_URL: databaseUrl }),
  );
  const key = () => `key-${randomUUID()}`;
  const path = (resource: string, organization = orgA) =>
    `/api/v1/organizations/${organization}/${resource}`;
  const get = (resource: string, token = owner, organization = orgA) =>
    request(server)
      .get(path(resource, organization))
      .auth(token, { type: 'bearer' });
  const post = (
    resource: string,
    body: Body,
    token = owner,
    idempotencyKey?: string,
    organization = orgA,
  ) => {
    const call = request(server)
      .post(path(resource, organization))
      .auth(token, { type: 'bearer' });
    if (idempotencyKey) call.set('Idempotency-Key', idempotencyKey);
    return call.send(body);
  };
  const patch = (resource: string, body: Body, token = owner) =>
    request(server)
      .patch(path(resource))
      .auth(token, { type: 'bearer' })
      .send(body);
  const created = async (
    resource: string,
    body: Body,
    token = owner,
    idempotencyKey?: string,
  ): Promise<Body> =>
    (await post(resource, body, token, idempotencyKey).expect(201))
      .body as Body;
  const sell = async (
    variantId: string,
    quantity: string,
    token = cashier,
    customerId?: string,
    methodId = cashMethod,
    amount = '1000.00',
  ) => {
    const draft = await created(
      'sales',
      {
        warehouseId: warehouse,
        cashSessionId: session,
        customerId,
        lines: [{ variantId, quantity }],
      },
      token,
    );
    return (
      await post(
        `sales/${draft.id}/confirm`,
        { payments: [{ methodId, amount }] },
        token,
        key(),
      ).expect(201)
    ).body as Body;
  };

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
      const email = `commerce-${label}-${suffix}@example.com`;
      const result = await auth.register(
        {
          email,
          password,
          name: 'Propietario',
          organizationName: `Comercio ${label}`,
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
      organizationIds.push(user.memberships[0]!.organizationId);
      if (label === 'a') {
        owner = result.accessToken;
        orgA = user.memberships[0]!.organizationId;
      } else {
        otherOwner = result.accessToken;
        orgB = user.memberships[0]!.organizationId;
      }
    }
    const passwordHash = await app.get(PasswordService).hash(password);
    for (const name of ['cashier', 'other']) {
      const user = await prisma.user.create({
        data: {
          email: `commerce-${name}-${suffix}@example.com`,
          name,
          passwordHash,
        },
      });
      userIds.push(user.id);
      await prisma.membership.create({
        data: {
          organizationId: orgA,
          userId: user.id,
          role: 'CASHIER',
          allBranches: true,
        },
      });
      const login = await auth.login(
        { email: user.email, password },
        randomUUID(),
      );
      if (name === 'cashier') cashier = login.accessToken;
      else otherCashier = login.accessToken;
    }
    warehouse = (
      await prisma.warehouse.findFirstOrThrow({
        where: { organizationId: orgA },
      })
    ).id;
    register = (
      await prisma.cashRegister.findFirstOrThrow({
        where: { organizationId: orgA },
      })
    ).id;
    cashMethod = (
      await prisma.paymentMethod.findFirstOrThrow({
        where: { organizationId: orgA, code: 'CASH' },
      })
    ).id;
    await patch('settings', { taxRate: '18', taxIncluded: false }).expect(200);
    unit = (await created('units', { code: 'UND', name: 'Unidad' }))
      .id as string;
    product = (
      await created('products', {
        name: 'Polo básico',
        sku: 'POLO',
        barcode: '7750000000000',
        unitId: unit,
        cost: '10.00',
        price: '25.00',
        lowStockThreshold: '1',
      })
    ).id as string;
    session = (
      await created(
        'cash-sessions',
        { cashRegisterId: register, opening: '0.00' },
        cashier,
        key(),
      )
    ).id as string;
  });

  afterAll(async () => {
    try {
      await cleanupTestData(prisma, organizationIds, userIds);
    } finally {
      if (app) await app.close();
      await prisma.$disconnect();
    }
  });

  it('crea variantes con SKU, código y precio propios, únicos por organización', async () => {
    const m = await created(`products/${product}/variants`, {
      name: 'Talla M',
      sku: 'polo-m',
      barcode: '7750000000001',
      price: '30.00',
      cost: '12.00',
    });
    variantM = m.id as string;
    expect(m).toMatchObject({ sku: 'POLO-M', isDefault: false, price: '30' });
    variantL = (
      await created(`products/${product}/variants`, {
        name: 'Talla L',
        sku: 'POLO-L',
        price: '32.00',
        cost: '13.00',
      })
    ).id as string;
    await post(`products/${product}/variants`, {
      name: 'Duplicada',
      sku: 'POLO-M',
      price: '1.00',
      cost: '1.00',
    }).expect(409);
    await post(`products/${product}/variants`, {
      name: 'Código repetido',
      sku: 'POLO-X',
      barcode: '7750000000001',
      price: '1.00',
      cost: '1.00',
    }).expect(409);
    await post(
      `products/${product}/variants`,
      {
        name: 'Otra tienda',
        sku: 'POLO-M',
        price: '1.00',
        cost: '1.00',
      },
      otherOwner,
      undefined,
      orgB,
    ).expect(404); // el producto es de otra organización
    expect(
      await prisma.productVariant.count({
        where: { productId: product, isDefault: true },
      }),
    ).toBe(1);
    await post(
      `products/${product}/variants`,
      {
        name: 'Costos',
        sku: 'POLO-C',
        price: '1.00',
        cost: '1.00',
      },
      cashier,
    ).expect(403);
  });

  it('busca por nombre, SKU o código de barras y oculta costos a cajeros', async () => {
    const byBarcode = await get('variants?q=7750000000001').expect(200);
    expect((byBarcode.body.items as Body[]).map((v) => v.sku)).toEqual([
      'POLO-M',
    ]);
    const byName = await get('variants?q=polo').expect(200);
    expect(byName.body.items).toHaveLength(3);
    const products = await get('products?q=7750000000000').expect(200);
    expect(products.body.items).toHaveLength(1);
    const asCashier = await get('variants?q=POLO-M', cashier).expect(200);
    expect((asCashier.body.items as Body[])[0]).not.toHaveProperty('cost');
    await get('variants?q=POLO', otherOwner, orgB)
      .expect(200)
      .expect((r) => {
        expect(r.body.items).toEqual([]);
      });
  });

  it('vende una variante con su propio precio y conserva el histórico', async () => {
    await post(
      'inventory/adjustments',
      {
        warehouseId: warehouse,
        variantId: variantM,
        delta: '5',
        unitCost: '12.00',
        reason: 'Ingreso inicial',
      },
      owner,
      key(),
    ).expect(201);
    const sale = await sell(variantM, '2');
    const line = (sale.lines as Body[])[0]!;
    expect(line).toMatchObject({
      sku: 'POLO-M',
      name: 'Polo básico - Talla M',
      price: '30',
      total: '70.8',
    });
    await patch(`products/${product}/variants/${variantM}`, {
      price: '99.00',
    }).expect(200);
    await patch(`products/${product}`, { name: 'Polo renombrado' }).expect(200);
    const saved = (await get(`sales/${sale.id}`).expect(200)).body as Body;
    expect((saved.lines as Body[])[0]).toMatchObject({
      price: '30',
      name: 'Polo básico - Talla M',
      total: '70.8',
    });
    const receipt = await get(`sales/${sale.id}/receipt?format=html`).expect(
      200,
    );
    expect(receipt.text).toContain('Polo básico - Talla M');
    expect(receipt.text).not.toContain('renombrado');
  });

  it('registra clientes con consentimiento y los asocia a ventas', async () => {
    await post('customers', {
      name: 'Ana Pérez',
      email: 'ana@example.com',
    }).expect(400);
    await post('customers', { name: 'Ana Pérez', consent: false }).expect(400);
    const customer = await created(
      'customers',
      {
        name: 'Ana Pérez',
        email: 'ana@example.com',
        consent: true,
      },
      cashier,
    );
    expect(customer.consentAt).toBeTruthy();
    const updated = await patch(
      `customers/${customer.id}`,
      { phone: '999111222' },
      cashier,
    ).expect(200);
    expect(updated.body.phone).toBe('999111222');
    await get('customers', otherOwner, orgB)
      .expect(200)
      .expect((r) => {
        expect(r.body.items).toEqual([]);
      });
    await patch(
      `customers/${customer.id}`,
      { name: 'Intruso' },
      otherOwner,
    ).expect(404);
    await post(
      'sales',
      {
        warehouseId: warehouse,
        cashSessionId: session,
        customerId: randomUUID(),
        lines: [{ variantId: variantL, quantity: '1' }],
      },
      cashier,
    ).expect(404);

    await post(
      'inventory/adjustments',
      {
        warehouseId: warehouse,
        variantId: variantL,
        delta: '4',
        unitCost: '13.00',
        reason: 'Ingreso inicial',
      },
      owner,
      key(),
    ).expect(201);
    const withCustomer = await sell(
      variantL,
      '1',
      cashier,
      customer.id as string,
    );
    await post(
      'sales',
      {
        warehouseId: warehouse,
        cashSessionId: session,
        lines: [{ variantId: variantL, quantity: '1' }],
      },
      otherCashier,
    ).expect(403); // caja de otro cajero
    const filtered = await get(`sales?customerId=${customer.id}`).expect(200);
    expect((filtered.body.items as Body[]).map((s) => s.id)).toEqual([
      withCustomer.id,
    ]);
    await patch(`customers/${customer.id}`, { archived: true }).expect(200);
    await post(
      'sales',
      {
        warehouseId: warehouse,
        cashSessionId: session,
        customerId: customer.id,
        lines: [{ variantId: variantL, quantity: '1' }],
      },
      cashier,
    ).expect(404); // archivado
    expect((await get('customers').expect(200)).body.items).toEqual([]);
  });

  it('consulta ventas por folio, fecha, cajero y limita al cajero a las suyas', async () => {
    const all = (await get('sales').expect(200)).body.items as Body[];
    expect(all.length).toBeGreaterThanOrEqual(2);
    const folio = all[0]!.folio as string;
    const byFolio = await get(`sales?q=${folio}`).expect(200);
    expect(byFolio.body.items).toHaveLength(1);
    const day = new Date();
    const from = new Date(day.getTime() - 3600_000).toISOString();
    const to = new Date(day.getTime() + 3600_000).toISOString();
    expect(
      (
        await get(
          `sales?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        ).expect(200)
      ).body.items,
    ).toHaveLength(all.length);
    const past = new Date(day.getTime() - 86400_000 * 3).toISOString();
    const earlier = new Date(day.getTime() - 86400_000 * 2).toISOString();
    expect(
      (
        await get(
          `sales?from=${encodeURIComponent(past)}&to=${encodeURIComponent(earlier)}`,
        ).expect(200)
      ).body.items,
    ).toEqual([]);
    await get(
      `sales?from=${encodeURIComponent(to)}&to=${encodeURIComponent(from)}`,
    ).expect(400);
    const cashierUser = (
      await prisma.user.findFirstOrThrow({
        where: { email: `commerce-cashier-${suffix}@example.com` },
      })
    ).id;
    const mine = await get(`sales?actorId=${cashierUser}`).expect(200);
    expect(mine.body.items).toHaveLength(all.length);
    const asOther = await get('sales', otherCashier).expect(200);
    expect(asOther.body.items).toEqual([]); // un cajero no ve ventas ajenas
    await get(`sales/${all[0]!.id}`, otherCashier).expect(403);
  });

  it('configura métodos de pago y rechaza los archivados', async () => {
    const qr = await created('payment-methods', {
      name: 'Billetera QR',
      code: 'qr',
      isCash: false,
    });
    expect(qr.code).toBe('QR');
    // El listado está paginado: cada página trae solo `limit` filas y no se repiten.
    const one = await get('payment-methods?limit=1').expect(200);
    expect(one.body.items).toHaveLength(1);
    expect(one.body).toMatchObject({ page: 1, limit: 1 });
    const two = await get('payment-methods?limit=1&page=2').expect(200);
    expect(two.body.items).toHaveLength(1);
    expect(two.body.items[0].id).not.toBe(one.body.items[0].id);
    await post('payment-methods', {
      name: 'Otra',
      code: 'QR',
      isCash: false,
    }).expect(409);
    await post(
      'payment-methods',
      { name: 'Hack', code: 'HACK', isCash: true },
      cashier,
    ).expect(403);
    await post(
      'inventory/adjustments',
      {
        warehouseId: warehouse,
        variantId: variantL,
        delta: '2',
        unitCost: '13.00',
        reason: 'Reposición',
      },
      owner,
      key(),
    ).expect(201);
    const paid = await sell(
      variantL,
      '1',
      cashier,
      undefined,
      qr.id as string,
      '37.76',
    );
    expect(paid.change).toBe('0');
    await patch(`payment-methods/${qr.id}`, { archived: true }).expect(200);
    const draft = await created(
      'sales',
      {
        warehouseId: warehouse,
        cashSessionId: session,
        lines: [{ variantId: variantL, quantity: '1' }],
      },
      cashier,
    );
    await post(
      `sales/${draft.id}/confirm`,
      { payments: [{ methodId: qr.id, amount: '37.76' }] },
      cashier,
      key(),
    ).expect(404);
    await post(
      `sales/${draft.id}/confirm`,
      {
        payments: [
          { methodId: qr.id, amount: '37.76' },
          { methodId: qr.id, amount: '1.00' },
        ],
      },
      cashier,
      key(),
    ).expect(400); // método duplicado
    await post(
      `sales/${draft.id}/cancel`,
      { reason: 'Cliente desistió' },
      cashier,
      key(),
    ).expect(201);
    expect(
      (
        await prisma.sale.findUniqueOrThrow({
          where: { id: draft.id as string },
        })
      ).status,
    ).toBe('CANCELLED');
  });

  it('archiva productos sin perder el historial y no ofrece borrado físico', async () => {
    await request(server)
      .delete(path(`products/${product}`))
      .auth(owner, { type: 'bearer' })
      .expect(404);
    await post(`products/${product}/archive`, {}).expect(200);
    const draft = post(
      'sales',
      {
        warehouseId: warehouse,
        cashSessionId: session,
        lines: [{ variantId: variantM, quantity: '1' }],
      },
      cashier,
    );
    await draft.expect(404); // un producto archivado no se vende
    expect(
      await prisma.saleLine.count({ where: { variantId: variantM } }),
    ).toBeGreaterThan(0);
    expect(
      await prisma.inventoryMovement.count({ where: { variantId: variantM } }),
    ).toBeGreaterThan(0);
    await expect(
      prisma.productVariant.delete({ where: { id: variantM } }),
    ).rejects.toThrow();
    await post(`products/${product}/restore`, {}).expect(200);
  });
});
