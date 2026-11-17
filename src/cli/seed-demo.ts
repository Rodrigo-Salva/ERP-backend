import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { randomBytes, randomUUID } from 'node:crypto';
import { AppModule } from '../app.module';
import { configureApp } from '../configure-app';
import { PrismaService } from '../database/prisma.service';
import { PasswordService } from '../modules/auth/services/password.service';

type Json = Record<string, any>;

/**
 * Crea una tienda de demostración recorriendo la API real: así los datos pasan por la
 * misma validación, autorización y auditoría que en producción. No se ejecuta en
 * `NODE_ENV=production` y no duplica datos si el usuario demo ya existe.
 */
async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production')
    throw new Error('Los datos de demostración no se cargan en producción.');
  const email = (process.env.SEED_EMAIL ?? 'demo@example.test').toLowerCase();
  const generated = !process.env.SEED_PASSWORD;
  const password =
    process.env.SEED_PASSWORD ?? randomBytes(15).toString('base64url');
  if (password.length < 12 || password.length > 128)
    throw new Error('SEED_PASSWORD debe tener entre 12 y 128 caracteres.');

  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/api/v1`;
  const prisma = app.get(PrismaService);

  try {
    if (await prisma.user.findUnique({ where: { email } })) {
      process.stdout.write(
        `Ya existe ${email}; no se cargaron datos de demostración.\n`,
      );
      return;
    }
    const call = async (
      method: 'GET' | 'POST' | 'PATCH',
      path: string,
      token?: string,
      body?: unknown,
      idempotent = false,
    ): Promise<Json> => {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(idempotent ? { 'Idempotency-Key': `seed-${randomUUID()}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      if (!response.ok)
        throw new Error(`${method} ${path} → ${response.status} ${text}`);
      return text ? (JSON.parse(text) as Json) : {};
    };

    const registered = await call('POST', '/auth/register', undefined, {
      email,
      password,
      name: 'Administrador Demo',
      organizationName: 'Tienda Demo',
      branchName: 'Sucursal Central',
      currency: 'PEN',
      locale: 'es-PE',
      timeZone: 'America/Lima',
    });
    const owner = registered.accessToken as string;
    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      include: { memberships: true },
    });
    const org = user.memberships[0]!.organizationId;
    const o = (resource: string) => `/organizations/${org}/${resource}`;
    const warehouse = await prisma.warehouse.findFirstOrThrow({
      where: { organizationId: org },
    });
    const register = await prisma.cashRegister.findFirstOrThrow({
      where: { organizationId: org },
    });
    const methods = await prisma.paymentMethod.findMany({
      where: { organizationId: org },
    });
    const cash = methods.find((m) => m.isCash)!.id;
    const transfer = methods.find((m) => !m.isCash)!.id;
    const expenseCategory = await prisma.expenseCategory.findFirstOrThrow({
      where: { organizationId: org },
    });

    await call('PATCH', o('settings'), owner, {
      taxRate: '18',
      taxIncluded: false,
      discountLimit: '10',
      receiptPrefix: 'DEMO',
    });

    // Usuarios con roles distintos (en producción se crean por invitación).
    const hash = await app.get(PasswordService).hash(password);
    const tokens: Record<string, string> = {};
    for (const [role, label] of [
      ['MANAGER', 'encargado'],
      ['CASHIER', 'cajero'],
      ['VIEWER', 'lectura'],
    ] as const) {
      const [local, domain] = email.split('@');
      const account = await prisma.user.create({
        data: {
          email: `${local}+${label}@${domain}`,
          name: label,
          passwordHash: hash,
        },
      });
      await prisma.membership.create({
        data: {
          organizationId: org,
          userId: account.id,
          role,
          allBranches: true,
        },
      });
      const login = await call('POST', '/auth/login', undefined, {
        email: account.email,
        password,
      });
      tokens[role] = login.accessToken as string;
    }
    const manager = tokens.MANAGER!;
    const cashier = tokens.CASHIER!;

    const unit = (
      await call('POST', o('units'), owner, { code: 'UND', name: 'Unidad' })
    ).id as string;
    const kg = (
      await call('POST', o('units'), owner, {
        code: 'KG',
        name: 'Kilogramo',
        precision: 3,
      })
    ).id as string;
    const categories: Record<string, string> = {};
    for (const name of ['Bebidas', 'Abarrotes', 'Limpieza'])
      categories[name] = (await call('POST', o('categories'), owner, { name }))
        .id as string;

    const catalog = [
      [
        'AGUA-500',
        'Agua mineral 500 ml',
        'Bebidas',
        unit,
        '0.90',
        '2.00',
        '12',
        '7750000000011',
      ],
      [
        'GASEOSA-1L',
        'Gaseosa 1 litro',
        'Bebidas',
        unit,
        '2.50',
        '4.50',
        '12',
        '7750000000028',
      ],
      [
        'ARROZ-1KG',
        'Arroz extra (por kg)',
        'Abarrotes',
        kg,
        '3.20',
        '4.80',
        '10',
        '7750000000035',
      ],
      [
        'ACEITE-1L',
        'Aceite vegetal 1 litro',
        'Abarrotes',
        unit,
        '7.00',
        '10.50',
        '6',
        '7750000000042',
      ],
      [
        'FIDEOS-500',
        'Fideos 500 g',
        'Abarrotes',
        unit,
        '1.80',
        '3.20',
        '8',
        '7750000000059',
      ],
      [
        'DETERGENTE-1KG',
        'Detergente 1 kg',
        'Limpieza',
        unit,
        '6.50',
        '9.90',
        '4',
        '7750000000066',
      ],
    ] as const;
    const variants: Record<string, string> = {};
    for (const [
      sku,
      name,
      category,
      unitId,
      cost,
      price,
      threshold,
      barcode,
    ] of catalog) {
      const product = await call('POST', o('products'), owner, {
        sku,
        name,
        barcode,
        unitId,
        categoryId: categories[category],
        cost,
        price,
        lowStockThreshold: threshold,
      });
      variants[sku] = (
        await prisma.productVariant.findFirstOrThrow({
          where: { productId: product.id as string },
        })
      ).id;
    }

    const supplier = await call('POST', o('suppliers'), manager, {
      name: 'Distribuidora Demo S.A.',
      email: 'ventas@distribuidora.example',
      phone: '014000000',
    });
    const order = await call('POST', o('purchase-orders'), manager, {
      warehouseId: warehouse.id,
      supplierId: supplier.id,
      notes: 'Reposición inicial',
      lines: catalog.map(([sku, , , , cost]) => ({
        variantId: variants[sku],
        quantity: sku === 'ARROZ-1KG' ? '50' : '40',
        unitCost: cost,
      })),
    });
    await call('POST', o(`purchase-orders/${order.id}/send`), manager, {});
    await call(
      'POST',
      o(`purchase-orders/${order.id}/receipts`),
      manager,
      {
        lines: (order.lines as Json[]).map((line) => ({
          lineId: line.id,
          quantity: line.quantity,
          unitCost: line.unitCost,
        })),
      },
      true,
    );

    // Primer turno: ventas, devolución, gasto y cierre con una pequeña diferencia.
    const shift = await call(
      'POST',
      o('cash-sessions'),
      cashier,
      { cashRegisterId: register.id, opening: '100.00' },
      true,
    );
    const sell = async (
      lines: Array<[string, string]>,
      payments: Array<[string, string]>,
      token = cashier,
      session = shift.id as string,
    ): Promise<Json> => {
      const draft = await call('POST', o('sales'), token, {
        warehouseId: warehouse.id,
        cashSessionId: session,
        lines: lines.map(([sku, quantity]) => ({
          variantId: variants[sku],
          quantity,
        })),
      });
      return call(
        'POST',
        o(`sales/${draft.id}/confirm`),
        token,
        {
          payments: payments.map(([methodId, amount]) => ({
            methodId,
            amount,
          })),
        },
        true,
      );
    };
    await sell(
      [
        ['AGUA-500', '3'],
        ['FIDEOS-500', '2'],
      ],
      [[cash, '20.00']],
    );
    const mixed = await sell(
      [['ACEITE-1L', '2']],
      [
        [transfer, '10.00'],
        [cash, '14.78'],
      ],
    );
    await sell([['ARROZ-1KG', '2.500']], [[cash, '15.00']]);
    await sell([['GASEOSA-1L', '4']], [[cash, '30.00']]);
    const line = (mixed.lines as Json[])[0]!;
    await call(
      'POST',
      o(`sales/${mixed.id}/returns`),
      owner,
      {
        methodId: cash,
        cashSessionId: shift.id,
        reason: 'Envase dañado',
        lines: [{ lineId: line.id, quantity: '1', restock: false }],
      },
      true,
    );
    await call(
      'POST',
      o('expenses'),
      owner,
      {
        branchId: warehouse.branchId,
        categoryId: expenseCategory.id,
        cashSessionId: shift.id,
        amount: '8.50',
        description: 'Bolsas y cinta',
        occurredAt: new Date().toISOString(),
      },
      true,
    );
    const detail = await call('GET', o(`cash-sessions/${shift.id}`), cashier);
    const counted = (Number(detail.currentExpected) - 0.5).toFixed(2);
    await call(
      'POST',
      o(`cash-sessions/${shift.id}/close`),
      cashier,
      { counted },
      true,
    );

    // Segundo turno abierto, listo para probar el punto de venta.
    const open = await call(
      'POST',
      o('cash-sessions'),
      cashier,
      { cashRegisterId: register.id, opening: '150.00' },
      true,
    );
    await sell(
      [['AGUA-500', '2']],
      [[cash, '5.00']],
      cashier,
      open.id as string,
    );

    // Segunda sucursal con una transferencia en tránsito.
    const branch = await call('POST', o('branches'), owner, {
      name: 'Sucursal Norte',
      code: 'NORTE',
      timeZone: 'America/Lima',
    });
    const target = await prisma.warehouse.findFirstOrThrow({
      where: { organizationId: org, branchId: branch.id as string },
    });
    const move = await call('POST', o('inventory/transfers'), manager, {
      sourceWarehouseId: warehouse.id,
      targetWarehouseId: target.id,
      reason: 'Apertura de la sucursal',
      lines: [{ variantId: variants['AGUA-500'], quantity: '10' }],
    });
    await call(
      'POST',
      o(`inventory/transfers/${move.id}/send`),
      manager,
      {},
      true,
    );

    process.stdout.write(
      [
        '',
        'Datos de demostración cargados.',
        `  Organización: ${org}`,
        `  Propietario:  ${email}`,
        `  Encargado:    ${email.replace('@', '+encargado@')}`,
        `  Cajero:       ${email.replace('@', '+cajero@')}`,
        `  Solo lectura: ${email.replace('@', '+lectura@')}`,
        generated
          ? `  Contraseña (generada, no se guarda en ningún archivo): ${password}`
          : '  Contraseña: la indicada en SEED_PASSWORD',
        '  Estado: un turno cerrado con diferencia de -0.50, un turno abierto y una transferencia en tránsito.',
        '',
      ].join('\n'),
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Error desconocido'}\n`,
  );
  process.exitCode = 1;
});
