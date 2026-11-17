import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { Server } from 'node:http';
import { resolve } from 'node:path';
import ExcelJS from 'exceljs';
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

type Body = Record<string, any>;

describe('Operación completa: compras, inventario, ventas y caja', () => {
  let app: INestApplication;
  let server: Server;
  let orgA: string;
  let orgB: string;
  let owner: string;
  let otherOwner: string;
  let manager: string;
  let cashier: string;
  let branchA: string;
  let warehouseA: string;
  let registerA: string;
  let cashMethod: string;
  let transferMethod: string;
  let expenseCategory: string;
  let unit: string;
  let product: string;
  let variant: string;
  let session: string;
  let saleId: string;
  const userIds: string[] = [];
  const organizationIds: string[] = [];
  const suffix = randomUUID();
  const password = 'integration-operations-only-2026';
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
  const balance = async (warehouseId = warehouseA, variantId = variant) => {
    const row = await prisma.inventoryBalance.findFirst({
      where: { warehouseId, variantId },
    });
    return row ? row.quantity.toString() : '0';
  };
  const draft = async (
    quantity: string,
    variantId = variant,
    token = cashier,
  ) =>
    (
      await created(
        'sales',
        {
          warehouseId: warehouseA,
          cashSessionId: session,
          lines: [{ variantId, quantity }],
        },
        token,
      )
    ).id as string;

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
      const email = `ops-${label}-${suffix}@example.com`;
      const result = await auth.register(
        {
          email,
          password,
          name: 'Propietario',
          organizationName: `Operaciones ${label}`,
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
    for (const role of ['MANAGER', 'CASHIER'] as Role[]) {
      const user = await prisma.user.create({
        data: {
          email: `ops-${role}-${suffix}@example.com`,
          name: role,
          passwordHash,
        },
      });
      userIds.push(user.id);
      await prisma.membership.create({
        data: {
          organizationId: orgA,
          userId: user.id,
          role,
          allBranches: true,
        },
      });
      const login = await auth.login(
        { email: user.email, password },
        randomUUID(),
      );
      if (role === 'MANAGER') manager = login.accessToken;
      else cashier = login.accessToken;
    }
    branchA = (
      await prisma.branch.findFirstOrThrow({ where: { organizationId: orgA } })
    ).id;
    warehouseA = (
      await prisma.warehouse.findFirstOrThrow({
        where: { organizationId: orgA },
      })
    ).id;
    registerA = (
      await prisma.cashRegister.findFirstOrThrow({
        where: { organizationId: orgA },
      })
    ).id;
    cashMethod = (
      await prisma.paymentMethod.findFirstOrThrow({
        where: { organizationId: orgA, code: 'CASH' },
      })
    ).id;
    transferMethod = (
      await prisma.paymentMethod.findFirstOrThrow({
        where: { organizationId: orgA, code: 'TRANSFER' },
      })
    ).id;
    expenseCategory = (
      await prisma.expenseCategory.findFirstOrThrow({
        where: { organizationId: orgA },
      })
    ).id;
    await patch('settings', {
      taxRate: '18',
      taxIncluded: false,
      discountLimit: '10',
      receiptPrefix: 'T',
    }).expect(200);
    unit = (await created('units', { code: 'UND', name: 'Unidad' }))
      .id as string;
    product = (
      await created('products', {
        name: 'Agua 500 ml',
        sku: 'AGUA-500',
        unitId: unit,
        cost: '4.00',
        price: '10.00',
        lowStockThreshold: '3',
      })
    ).id as string;
    variant = (
      await prisma.productVariant.findFirstOrThrow({
        where: { productId: product },
      })
    ).id;
  });

  afterAll(async () => {
    try {
      await cleanupTestData(prisma, organizationIds, userIds);
    } finally {
      if (app) await app.close();
      await prisma.$disconnect();
    }
  });

  it('crea los valores iniciales para operar desde el registro', async () => {
    expect(cashMethod).toBeDefined();
    expect(transferMethod).toBeDefined();
    expect(registerA).toBeDefined();
    expect(expenseCategory).toBeDefined();
    expect(
      await prisma.paymentMethod.count({
        where: { organizationId: orgA, isCash: true },
      }),
    ).toBe(1);
  });

  it('recibe compras parcial y totalmente, una sola vez y con costo promedio', async () => {
    const supplier = (await created('suppliers', { name: 'Distribuidora Sur' }))
      .id as string;
    const order = await created('purchase-orders', {
      warehouseId: warehouseA,
      supplierId: supplier,
      lines: [{ variantId: variant, quantity: '10', unitCost: '4.00' }],
    });
    const lineId = (order.lines as Body[])[0]!.id as string;
    const receive = (
      quantity: string,
      unitCost: string,
      idempotencyKey?: string,
      token = manager,
    ) =>
      post(
        `purchase-orders/${order.id}/receipts`,
        { lines: [{ lineId, quantity, unitCost }] },
        token,
        idempotencyKey,
      );

    await receive('4', '4.00', key()).expect(409); // todavía en borrador
    await post(`purchase-orders/${order.id}/send`, {}, manager).expect(201);
    await receive('4', '4.00').expect(400); // exige clave de idempotencia
    const firstKey = key();
    const first = await receive('4', '4.00', firstKey).expect(201);
    const replay = await receive('4', '4.00', firstKey).expect(201);
    expect(replay.body.id).toBe(first.body.id);
    await receive('5', '4.00', firstKey).expect(409); // misma clave, otro contenido
    expect(await balance()).toBe('4');
    expect(
      (
        await prisma.purchaseOrder.findUniqueOrThrow({
          where: { id: order.id },
        })
      ).status,
    ).toBe('PARTIAL');

    await receive('7', '5.00', key()).expect(409); // excede lo pendiente
    await receive('6', '5.00', key()).expect(201);
    expect(await balance()).toBe('10');
    expect(
      (
        await prisma.purchaseOrder.findUniqueOrThrow({
          where: { id: order.id },
        })
      ).status,
    ).toBe('RECEIVED');
    const stock = await prisma.inventoryBalance.findFirstOrThrow({
      where: { variantId: variant },
    });
    expect(stock.value.toString()).toBe('46'); // 4×4.00 + 6×5.00
    await receive('1', '5.00', key()).expect(409); // ya recibida
    await receive('1', '5.00', key(), cashier).expect(403);
    const movements = await prisma.inventoryMovement.findMany({
      where: { variantId: variant },
      orderBy: { createdAt: 'asc' },
    });
    expect(
      movements.map((m) => [m.kind, m.before.toString(), m.after.toString()]),
    ).toEqual([
      ['PURCHASE', '0', '4'],
      ['PURCHASE', '4', '10'],
    ]);
  });

  it('abre caja una sola vez por punto y rechaza abrir con otra clave', async () => {
    const opened = await created(
      'cash-sessions',
      { cashRegisterId: registerA, opening: '100.00' },
      cashier,
      key(),
    );
    session = opened.id as string;
    await post(
      'cash-sessions',
      { cashRegisterId: registerA, opening: '50.00' },
      manager,
      key(),
    ).expect(409);
    await expect(
      prisma.cashSession.create({
        data: {
          organizationId: orgA,
          branchId: branchA,
          cashRegisterId: registerA,
          actorId: userIds[0]!,
          opening: '1',
        },
      }),
    ).rejects.toThrow();
  });

  it('vende con impuesto agregado, calcula cambio y descuenta stock', async () => {
    await post(
      'sales',
      {
        warehouseId: warehouseA,
        cashSessionId: session,
        lines: [{ variantId: variant, quantity: '1', discountRate: '50' }],
      },
      cashier,
    ).expect(403);
    saleId = await draft('2');
    const confirmKey = key();
    const payload = { payments: [{ methodId: cashMethod, amount: '30.00' }] };
    const confirmed = await post(
      `sales/${saleId}/confirm`,
      payload,
      cashier,
      confirmKey,
    ).expect(201);
    expect(confirmed.body).toMatchObject({
      status: 'CONFIRMED',
      folio: 'T-00000001',
      gross: '20',
      tax: '3.6',
      total: '23.6',
      change: '6.4',
    });
    expect((confirmed.body.lines as Body[])[0]).not.toHaveProperty('cost');
    expect(await balance()).toBe('8');
    const line = await prisma.saleLine.findFirstOrThrow({ where: { saleId } });
    expect(line.cost.toString()).toBe('4.6'); // promedio ponderado móvil
    expect(line.price.toString()).toBe('10');

    const replay = await post(
      `sales/${saleId}/confirm`,
      payload,
      cashier,
      confirmKey,
    ).expect(201);
    expect(replay.body.folio).toBe('T-00000001');
    expect(await balance()).toBe('8'); // el reintento no vuelve a descontar
    await post(
      `sales/${saleId}/confirm`,
      { payments: [{ methodId: cashMethod, amount: '40.00' }] },
      cashier,
      confirmKey,
    ).expect(409);
    await post(`sales/${saleId}/confirm`, payload, cashier, key()).expect(409); // ya confirmada
    expect(
      await prisma.sale.count({
        where: { organizationId: orgA, folio: 'T-00000001' },
      }),
    ).toBe(1);
  });

  it('rechaza pagos insuficientes sin dejar efectos y registra pagos mixtos', async () => {
    const short = await draft('1');
    await post(
      `sales/${short}/confirm`,
      { payments: [{ methodId: cashMethod, amount: '1.00' }] },
      cashier,
      key(),
    ).expect(400);
    expect(await balance()).toBe('8');
    expect(await prisma.payment.count({ where: { saleId: short } })).toBe(0);
    // 11.80 = 5.90 en efectivo + 5.90 por transferencia; la transferencia no suma efectivo.
    const mixed = await post(
      `sales/${short}/confirm`,
      {
        payments: [
          { methodId: transferMethod, amount: '5.90' },
          { methodId: cashMethod, amount: '5.90' },
        ],
      },
      cashier,
      key(),
    ).expect(201);
    expect(mixed.body.total).toBe('11.8');
    expect(mixed.body.change).toBe('0');
    const cash = await prisma.cashMovement.findFirstOrThrow({
      where: { referenceId: short },
    });
    expect(cash.amount.toString()).toBe('5.9');
    expect(await balance()).toBe('7');
  });

  it('impide vender más de lo disponible aun con ventas concurrentes', async () => {
    const scarce = (
      await created('products', {
        name: 'Escaso',
        sku: 'ESCASO-1',
        unitId: unit,
        cost: '2.00',
        price: '5.00',
        lowStockThreshold: '0',
      })
    ).id as string;
    const scarceVariant = (
      await prisma.productVariant.findFirstOrThrow({
        where: { productId: scarce },
      })
    ).id;
    await post(
      'inventory/adjustments',
      {
        warehouseId: warehouseA,
        variantId: scarceVariant,
        delta: '1',
        unitCost: '2.00',
        reason: 'Conteo inicial',
      },
      manager,
      key(),
    ).expect(403); // requiere inventory.adjust
    await post(
      'inventory/adjustments',
      {
        warehouseId: warehouseA,
        variantId: scarceVariant,
        delta: '1',
        unitCost: '2.00',
        reason: 'Conteo inicial',
      },
      owner,
      key(),
    ).expect(201);
    const [one, two] = [
      await draft('1', scarceVariant),
      await draft('1', scarceVariant),
    ];
    const pay = { payments: [{ methodId: cashMethod, amount: '6.00' }] };
    const results = await Promise.all([
      post(`sales/${one}/confirm`, pay, cashier, key()),
      post(`sales/${two}/confirm`, pay, cashier, key()),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await balance(warehouseA, scarceVariant)).toBe('0');
    const final = await prisma.inventoryBalance.findFirstOrThrow({
      where: { variantId: scarceVariant },
    });
    expect(final.value.toString()).toBe('0');
  });

  it('devuelve parcial y totalmente con autorización y reintegro explícito', async () => {
    const lineId = (
      await prisma.saleLine.findFirstOrThrow({ where: { saleId } })
    ).id;
    const refund = (
      quantity: string,
      restock: boolean,
      token = owner,
      idempotencyKey = key(),
    ) =>
      post(
        `sales/${saleId}/returns`,
        {
          methodId: cashMethod,
          cashSessionId: session,
          reason: 'Producto devuelto',
          lines: [{ lineId, quantity, restock }],
        },
        token,
        idempotencyKey,
      );
    await refund('1', true, cashier).expect(403);
    const part = await refund('1', true).expect(201);
    expect(part.body.total).toBe('11.8');
    expect(await balance()).toBe('8');
    expect(
      (await prisma.sale.findUniqueOrThrow({ where: { id: saleId } })).status,
    ).toBe('PARTIAL_RETURN');
    await refund('2', true).expect(409);
    await refund('1', false).expect(201); // artículo dañado: no vuelve al inventario
    expect(await balance()).toBe('8');
    expect(
      (await prisma.sale.findUniqueOrThrow({ where: { id: saleId } })).status,
    ).toBe('RETURNED');
    const total = await prisma.saleReturn.aggregate({
      where: { saleId },
      _sum: { total: true },
    });
    expect(total._sum.total!.toString()).toBe('23.6'); // exactamente lo cobrado
    expect(await prisma.saleReturn.count({ where: { saleId } })).toBe(2);
  });

  it('registra gastos y movimientos manuales de caja una sola vez', async () => {
    const expense = {
      branchId: branchA,
      categoryId: expenseCategory,
      cashSessionId: session,
      amount: '5.00',
      description: 'Bolsas',
      occurredAt: new Date().toISOString(),
    };
    await post('expenses', expense, cashier, key()).expect(403);
    const expenseKey = key();
    const first = await post('expenses', expense, owner, expenseKey).expect(
      201,
    );
    const replay = await post('expenses', expense, owner, expenseKey).expect(
      201,
    );
    expect(replay.body.id).toBe(first.body.id);
    expect(
      await prisma.cashMovement.count({
        where: { referenceId: first.body.id as string },
      }),
    ).toBe(1);
    await post(
      `cash-sessions/${session}/movements`,
      { direction: 'IN', amount: '10.00', reason: 'Fondo extra' },
      cashier,
      key(),
    ).expect(403);
    await post(
      `cash-sessions/${session}/movements`,
      { direction: 'IN', amount: '10.00', reason: 'Fondo extra' },
      owner,
      key(),
    ).expect(201);
  });

  it('cierra caja con diferencia visible, la conserva y bloquea nuevas ventas', async () => {
    const pending = await draft('1');
    // 100 apertura + 23.60 + 5.90 (ventas) - 23.60 (reembolsos) - 5 (gasto) + 10 (entrada) + 5.90 (escaso)
    const closed = await post(
      `cash-sessions/${session}/close`,
      { counted: '116.30' },
      cashier,
      key(),
    ).expect(201);
    expect(closed.body).toMatchObject({
      expected: '116.8',
      counted: '116.3',
      difference: '-0.5',
    });
    expect(closed.body.closedAt).toBeTruthy();
    await post(
      `sales/${pending}/confirm`,
      { payments: [{ methodId: cashMethod, amount: '20.00' }] },
      cashier,
      key(),
    ).expect(409);
    await post(
      `cash-sessions/${session}/close`,
      { counted: '1.00' },
      cashier,
      key(),
    ).expect(409);
    await expect(
      prisma.cashSession.update({
        where: { id: session },
        data: { counted: '1.00' },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.cashSession.delete({ where: { id: session } }),
    ).rejects.toThrow();
    const detail = await get(`cash-sessions/${session}`, cashier).expect(200);
    expect(detail.body.difference).toBe('-0.5');
  });

  it('no permite modificar ni borrar movimientos ni documentos finalizados', async () => {
    const movement = await prisma.inventoryMovement.findFirstOrThrow({
      where: { organizationId: orgA },
    });
    await expect(
      prisma.inventoryMovement.update({
        where: { id: movement.id },
        data: { reason: 'x' },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.inventoryMovement.delete({ where: { id: movement.id } }),
    ).rejects.toThrow();
    const cash = await prisma.cashMovement.findFirstOrThrow({
      where: { organizationId: orgA },
    });
    await expect(
      prisma.cashMovement.delete({ where: { id: cash.id } }),
    ).rejects.toThrow();
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { organizationId: orgA },
    });
    await expect(
      prisma.auditEvent.update({
        where: { id: audit.id },
        data: { action: 'x' },
      }),
    ).rejects.toThrow();
  });

  it('transfiere entre sucursales sin duplicar existencias', async () => {
    const branch = await created('branches', {
      name: 'Norte',
      code: 'NORTE',
      timeZone: 'America/Lima',
    });
    const targetWarehouse = (
      await prisma.warehouse.findFirstOrThrow({
        where: { organizationId: orgA, branchId: branch.id as string },
      })
    ).id;
    expect(
      await prisma.cashRegister.count({
        where: { branchId: branch.id as string },
      }),
    ).toBe(1);
    const transfer = async (quantity: string) =>
      (
        await created(
          'inventory/transfers',
          {
            sourceWarehouseId: warehouseA,
            targetWarehouseId: targetWarehouse,
            reason: 'Reposición',
            lines: [{ variantId: variant, quantity }],
          },
          manager,
        )
      ).id as string;
    const big = await transfer('99');
    await post(`inventory/transfers/${big}/send`, {}, manager, key()).expect(
      409,
    ); // sin stock suficiente
    expect(await balance()).toBe('8');

    const moving = await transfer('3');
    await post(
      `inventory/transfers/${moving}/receive`,
      {},
      manager,
      key(),
    ).expect(409); // aún en borrador
    await post(`inventory/transfers/${moving}/send`, {}, manager, key()).expect(
      201,
    );
    expect(await balance()).toBe('5');
    expect(await balance(targetWarehouse)).toBe('0'); // en tránsito: ni origen ni destino
    const receiveKey = key();
    await post(
      `inventory/transfers/${moving}/receive`,
      {},
      manager,
      receiveKey,
    ).expect(201);
    await post(
      `inventory/transfers/${moving}/receive`,
      {},
      manager,
      receiveKey,
    ).expect(201); // reintento
    expect(await balance(targetWarehouse)).toBe('3');
    await post(
      `inventory/transfers/${moving}/cancel`,
      {},
      manager,
      key(),
    ).expect(409);

    const cancelled = await transfer('2');
    await post(
      `inventory/transfers/${cancelled}/send`,
      {},
      manager,
      key(),
    ).expect(201);
    expect(await balance()).toBe('3');
    await post(
      `inventory/transfers/${cancelled}/cancel`,
      {},
      manager,
      key(),
    ).expect(201);
    expect(await balance()).toBe('5');
    const total = await prisma.inventoryBalance.aggregate({
      where: { variantId: variant },
      _sum: { quantity: true },
    });
    expect(total._sum.quantity!.toString()).toBe('8');
  });

  it('oculta costos a cajeros y limita sus ventas y cajas', async () => {
    const asCashier = await get(`sales/${saleId}`, cashier).expect(200);
    expect((asCashier.body.lines as Body[])[0]).not.toHaveProperty('cost');
    const asOwner = await get(`sales/${saleId}`).expect(200);
    expect((asOwner.body.lines as Body[])[0]).toHaveProperty('cost');
    await get(`sales/${saleId}`, manager).expect(200);
    const balances = await get('inventory/balances', cashier).expect(200);
    expect((balances.body.items as Body[])[0]).not.toHaveProperty('value');
    await get('reports/inventory', cashier).expect(403);
    await get('audit-events', manager).expect(403);
    await get('suppliers', cashier).expect(403);
  });

  it('aísla organizaciones aunque se conozca el identificador', async () => {
    await get(`sales/${saleId}`, otherOwner, orgA).expect(404);
    await get(`sales/${saleId}`, otherOwner, orgB).expect(404);
    await get(`cash-sessions/${session}`, otherOwner, orgB).expect(404);
    await post(
      'sales',
      {
        warehouseId: warehouseA,
        cashSessionId: session,
        lines: [{ variantId: variant, quantity: '1' }],
      },
      otherOwner,
      undefined,
      orgB,
    ).expect(404);
    const sales = await get('sales', otherOwner, orgB).expect(200);
    expect(sales.body.items).toEqual([]);
  });

  it('entrega recibo imprimible con desglose', async () => {
    const html = await get(
      `sales/${saleId}/receipt?format=html`,
      cashier,
    ).expect(200);
    expect(html.type).toBe('text/html');
    expect(html.text).toContain('T-00000001');
    expect(html.text).toContain('Impuestos (18% agregados)');
    expect(html.text).toContain('Efectivo');
    const json = await get(`sales/${saleId}/receipt`, cashier).expect(200);
    expect(json.body.lines[0]).not.toHaveProperty('cost');
  });

  it('concilia los reportes con las operaciones fuente', async () => {
    const confirmed = await prisma.sale.aggregate({
      where: { organizationId: orgA, confirmedAt: { not: null } },
      _count: true,
      _sum: { total: true, tax: true },
    });
    const returned = await prisma.saleReturn.aggregate({
      where: { organizationId: orgA },
      _sum: { total: true },
    });
    const report = (await get('reports/sales').expect(200)).body as Body;
    expect(report.saleCount).toBe(confirmed._count);
    expect(report.salesTotal).toBe(confirmed._sum.total!.toString());
    expect(report.returnsTotal).toBe(returned._sum.total!.toString());
    expect(report.netTotal).toBe(
      confirmed._sum.total!.minus(returned._sum.total!).toString(),
    );
    // Series para las gráficas: los totales diarios suman lo vendido en el período.
    const series = report.daily as {
      granularity: string;
      points: Array<{ key: string; total: number }>;
    };
    expect(series.granularity).toBe('day');
    expect(series.points).toHaveLength(30); // sin filtro: últimos 30 días
    expect(
      series.points.reduce((sum, point) => sum + point.total, 0),
    ).toBeCloseTo(Number(report.salesTotal), 2);
    const methods = report.byMethod as Array<{ method: string; total: number }>;
    expect(methods.length).toBeGreaterThan(0);
    expect(methods.every((m) => m.total > 0)).toBe(true);
    await get('reports/sales?branchId=' + randomUUID()).expect(404);
    const inventory = (await get('reports/inventory').expect(200)).body as Body;
    const value = await prisma.inventoryBalance.aggregate({
      where: { organizationId: orgA },
      _sum: { value: true },
    });
    expect(inventory.valuation).toBe(value._sum.value!.toString());
    expect(inventory.topByValue.length).toBeGreaterThan(0);
    expect(inventory.topByValue[0].value).toBeGreaterThan(0);
    const csv = await get('reports/cash/csv').expect(200);
    expect(csv.type).toBe('text/csv');
    expect(csv.text).toContain('-0.5'); // los negativos no se alteran
    expect(csv.text).not.toContain("'-0.5");
    // El CSV recorre todas las páginas: 105 gastos nuevos superan el lote de 100.
    const before = await prisma.expense.count({
      where: { organizationId: orgA },
    });
    await prisma.expense.createMany({
      data: Array.from({ length: 105 }, (_, i) => ({
        organizationId: orgA,
        branchId: branchA,
        categoryId: expenseCategory,
        actorId: userIds[0]!,
        amount: '1.00',
        description: `Gasto exportable ${i}`,
        occurredAt: new Date(),
      })),
    });
    const expensesCsv = await get('reports/expenses/csv').expect(200);
    const lines = expensesCsv.text.replace('\uFEFF', '').split('\r\n');
    expect(lines.length - 1).toBe(before + 105); // sin la fila de cabecera
    expect(
      new Set(lines.filter((l) => l.includes('Gasto exportable'))).size,
    ).toBe(105); // sin repetidos ni saltos entre páginas
    await get('reports/expenses/csv', otherOwner, orgB)
      .expect(200)
      .expect((res) => expect(res.text).not.toContain('Gasto exportable'));
    // El Excel trae todas las filas, con formato y totales.
    const binary = (
      res: import('superagent').Response,
      done: (err: Error | null, body: Buffer) => void,
    ) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    };
    const xlsx = await get('reports/expenses/xlsx')
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect(xlsx.type).toContain('spreadsheetml');
    expect(xlsx.headers['content-disposition']).toMatch(
      /tendio-gastos-\d{4}-\d{2}-\d{2}\.xlsx/,
    );
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(xlsx.body as ArrayBuffer);
    const sheet = book.getWorksheet('Gastos')!;
    expect(sheet.getCell('A5').value).toBe('Fecha');
    expect(sheet.getCell('A5').fill).toMatchObject({
      fgColor: { argb: 'FFD62F37' },
    });
    const dataRows = sheet.rowCount - 5 - 1; // cabecera y fila de totales
    expect(dataRows).toBe(before + 105);
    expect(sheet.getCell(5 + dataRows + 1, 1).value).toBe('Total');
    const sales = await get('reports/sales/xlsx')
      .buffer(true)
      .parse(binary)
      .expect(200);
    const salesBook = new ExcelJS.Workbook();
    await salesBook.xlsx.load(sales.body as ArrayBuffer);
    expect(salesBook.worksheets.map((w) => w.name)).toEqual([
      'Resumen',
      'Más vendidos',
    ]);
    await get('reports/expenses/xlsx', otherOwner, orgB)
      .buffer(true)
      .parse(binary)
      .expect(200);
    // Los días completos se interpretan en la zona de la tienda (Lima), no en la del cliente.
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Lima',
    }).format(new Date());
    const byDay = (
      await get(`reports/sales?fromDay=${today}&toDay=${today}`).expect(200)
    ).body as Body;
    expect(byDay.saleCount).toBeGreaterThan(0);
    const farPast = (
      await get('reports/sales?fromDay=2001-01-01&toDay=2001-01-02').expect(200)
    ).body as Body;
    expect(farPast.saleCount).toBe(0);
    await get('reports/sales?fromDay=2026-02-02&toDay=2026-02-01').expect(400);
    const dashboard = (await get('dashboard').expect(200)).body as Body;
    expect(dashboard.sales.saleCount).toBeGreaterThan(0);
    expect(dashboard.openCashSessions).toBe(0);
    expect(dashboard.trend.points).toHaveLength(7);
    const movements = (await get('reports/movements').expect(200)).body as Body;
    expect(movements.items.length).toBeGreaterThan(0);
    const low = await get(
      `inventory/low-stock?warehouseId=${warehouseA}`,
    ).expect(200);
    expect((low.body as Body[]).map((r) => r.sku)).toContain('ESCASO-1');
  });

  it('devuelve nombres legibles en saldos, movimientos, compras y transferencias', async () => {
    const balances = await get('inventory/balances').expect(200);
    expect(balances.body.items).toContainEqual(
      expect.objectContaining({
        sku: 'AGUA-500',
        name: 'Agua 500 ml',
        warehouseName: 'Principal',
      }),
    );
    const movements = await get('inventory/movements').expect(200);
    expect(
      (movements.body.items as Body[]).every(
        (m) => typeof m.sku === 'string' && typeof m.name === 'string',
      ),
    ).toBe(true);
    const orders = await get('purchase-orders').expect(200);
    expect(orders.body.items[0]).toMatchObject({
      supplierName: 'Distribuidora Sur',
      warehouseName: 'Principal',
    });
    expect(orders.body.items[0].lines[0]).toMatchObject({
      sku: 'AGUA-500',
      name: 'Agua 500 ml',
    });
    const detail = await get(
      `purchase-orders/${orders.body.items[0].id}`,
    ).expect(200);
    expect(detail.body.lines[0].name).toBe('Agua 500 ml');
    const transfers = await get('inventory/transfers').expect(200);
    expect(transfers.body.items[0]).toMatchObject({
      sourceWarehouseName: 'Principal',
    });
    expect(transfers.body.items[0].lines[0].name).toBe('Agua 500 ml');
  });

  it('audita operaciones sensibles sin secretos', async () => {
    const events = await get('audit-events?limit=100').expect(200);
    const actions = (events.body.items as Body[]).map(
      (e) => e.action as string,
    );
    for (const action of [
      'sale.confirmed',
      'sale.returned',
      'cash.opened',
      'cash.closed',
      'purchase.received',
      'inventory.adjusted',
      'expense.created',
      'cash.adjusted',
      'transfer.send',
    ])
      expect(actions).toContain(action);
    const text = JSON.stringify(events.body);
    expect(text).not.toMatch(/argon2|accessToken|Bearer |passwordHash/i);
  });
});
