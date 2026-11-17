import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { config } from 'dotenv';
import { createHash, randomUUID } from 'node:crypto';
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
if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith('_test')) {
  throw new Error(
    'Configura TEST_DATABASE_URL con una base dedicada cuyo nombre termine en _test.',
  );
}

interface SessionBody {
  accessToken: string;
  expiresAt: string;
  tokenType: string;
}

describe('Acceso y aislamiento con PostgreSQL real', () => {
  let app: INestApplication;
  let server: Server;
  let auth: AuthService;
  let ownerToken: string;
  let cashierToken: string;
  let ownerId: string;
  let cashierId: string;
  let organizationA: string;
  let organizationB: string;
  let cashierMembershipId: string;
  let branchA: string;
  let branchB: string;
  const suffix = randomUUID();
  const email = `owner-${suffix}@example.com`;
  const password = 'integration-password-only-2026';
  const userIds: string[] = [];
  const organizationIds: string[] = [];
  const prisma = new PrismaService(
    new ConfigService<Environment, true>({ DATABASE_URL: databaseUrl }),
  );
  const registration = {
    email,
    password,
    name: 'Propietario',
    organizationName: `Tienda ${suffix}`,
    branchName: 'Principal',
    currency: 'PEN',
    locale: 'es-PE',
    timeZone: 'America/Lima',
  };
  const hashToken = (token: string) =>
    createHash('sha256').update(token).digest('hex');

  beforeAll(async () => {
    process.env.TRUST_PROXY = 'loopback'; // supertest llega desde 127.0.0.1
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = module.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    server = app.getHttpServer() as Server;
    auth = app.get(AuthService);

    const response = await request(server)
      .post('/api/v1/auth/register')
      .send(registration)
      .expect(201);
    const body = response.body as SessionBody;
    expect(body.tokenType).toBe('Bearer');
    expect(body.accessToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    ownerToken = body.accessToken;
    const owner = await prisma.user.findUniqueOrThrow({
      where: { email },
      include: { memberships: true },
    });
    ownerId = owner.id;
    userIds.push(ownerId);
    organizationA = owner.memberships[0]!.organizationId;
    organizationIds.push(organizationA);
    branchA = (
      await prisma.branch.findFirstOrThrow({
        where: { organizationId: organizationA },
      })
    ).id;

    const secondEmail = `other-${suffix}@example.com`;
    await auth.register(
      {
        ...registration,
        email: secondEmail,
        organizationName: `Otra ${suffix}`,
      },
      randomUUID(),
    );
    const other = await prisma.user.findUniqueOrThrow({
      where: { email: secondEmail },
      include: { memberships: true },
    });
    userIds.push(other.id);
    organizationB = other.memberships[0]!.organizationId;
    organizationIds.push(organizationB);
    branchB = (
      await prisma.branch.findFirstOrThrow({
        where: { organizationId: organizationB },
      })
    ).id;

    // Fixture: la invitación de usuarios será un flujo posterior.
    const cashier = await prisma.user.create({
      data: {
        email: `cashier-${suffix}@example.com`,
        name: 'Cajero',
        passwordHash: await app.get(PasswordService).hash(password),
      },
    });
    cashierId = cashier.id;
    userIds.push(cashierId);
    const membership = await prisma.membership.create({
      data: {
        organizationId: organizationA,
        userId: cashierId,
        role: 'CASHIER',
        allBranches: false,
      },
    });
    cashierMembershipId = membership.id;
    await prisma.membershipBranch.create({
      data: {
        organizationId: organizationA,
        membershipId: membership.id,
        branchId: branchA,
      },
    });
    await prisma.branch.create({
      data: {
        organizationId: organizationA,
        name: 'Restringida',
        code: 'RESTRICTED',
        timeZone: 'America/Lima',
      },
    });
    cashierToken = (
      await auth.login({ email: cashier.email, password }, randomUUID())
    ).accessToken;
  });

  afterAll(async () => {
    try {
      await cleanupTestData(prisma, organizationIds, userIds);
    } finally {
      if (app) await app.close();
      await prisma.$disconnect();
    }
  });

  it('registra la tienda completa, protege credenciales y crea auditoría', async () => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: ownerId },
    });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.passwordHash).not.toContain(password);
    const session = await prisma.session.findUniqueOrThrow({
      where: { tokenHash: hashToken(ownerToken) },
    });
    expect(session.tokenHash).not.toBe(ownerToken);
    expect(
      await prisma.warehouse.count({
        where: { organizationId: organizationA },
      }),
    ).toBe(1);
    const event = await prisma.auditEvent.findFirstOrThrow({
      where: {
        organizationId: organizationA,
        action: 'organization.registered',
      },
    });
    expect(event.actorId).toBe(ownerId);
    expect(JSON.stringify(event)).not.toContain(ownerToken);
    expect(JSON.stringify(event)).not.toContain(password);
  });

  it('devuelve únicamente el perfil y las organizaciones del usuario', async () => {
    const response = await request(server)
      .get('/api/v1/me')
      .auth(ownerToken, { type: 'bearer' })
      .expect(200);
    expect(response.body).toMatchObject({
      id: ownerId,
      email,
      memberships: [{ organizationId: organizationA, role: 'OWNER' }],
    });
    expect(response.text).not.toContain('passwordHash');
    expect(response.text).not.toContain('tokenHash');
    expect(response.text).not.toContain(organizationB);
  });

  it('rechaza rutas protegidas sin sesión o con un token inventado', async () => {
    await request(server).get('/api/v1/me').expect(401);
    await request(server)
      .get('/api/v1/me')
      .auth('invalid', { type: 'bearer' })
      .expect(401);
    await request(server)
      .get('/api/v1/me')
      .auth('a'.repeat(43), { type: 'bearer' })
      .expect(401);
    await request(server)
      .get(`/api/v1/organizations/${organizationA}/branches`)
      .expect(401);
  });

  it('impide consultar otra organización aunque se conozca su identificador', async () => {
    await request(server)
      .get(`/api/v1/organizations/${organizationB}/branches`)
      .auth(ownerToken, { type: 'bearer' })
      .expect(404);
    await request(server)
      .get(`/api/v1/organizations/${organizationB}/members`)
      .auth(ownerToken, { type: 'bearer' })
      .expect(404);
  });

  it('filtra sucursales por membresía y restringe datos de usuarios por rol', async () => {
    const response = await request(server)
      .get(`/api/v1/organizations/${organizationA}/branches`)
      .auth(cashierToken, { type: 'bearer' })
      .expect(200);
    expect(response.body).toMatchObject({
      items: [{ id: branchA }],
      page: 1,
      limit: 20,
    });
    const body = response.body as { items: unknown[] };
    expect(body.items).toHaveLength(1);
    await request(server)
      .get(`/api/v1/organizations/${organizationA}/members`)
      .auth(cashierToken, { type: 'bearer' })
      .expect(403);
    const members = await request(server)
      .get(`/api/v1/organizations/${organizationA}/members`)
      .auth(ownerToken, { type: 'bearer' })
      .expect(200);
    expect(members.text).not.toContain('passwordHash');
    expect(members.text).not.toContain('tokenHash');
  });

  it('impide asociar accesos de sucursal a una organización ajena en PostgreSQL', async () => {
    await expect(
      prisma.membershipBranch.create({
        data: {
          organizationId: organizationA,
          membershipId: cashierMembershipId,
          branchId: branchB,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('valida paginación y rechaza organización o rol inyectados', async () => {
    await request(server)
      .get(`/api/v1/organizations/${organizationA}/branches?limit=101`)
      .auth(ownerToken, { type: 'bearer' })
      .expect(400);
    await request(server)
      .post('/api/v1/auth/register')
      .send({ ...registration, role: 'ADMIN', organizationId: organizationB })
      .expect(400);
  });

  it('rechaza registros duplicados sin crear organizaciones adicionales', async () => {
    await request(server)
      .post('/api/v1/auth/register')
      .send({ ...registration, email: email.toUpperCase() })
      .expect(409);
    expect(
      await prisma.organization.count({
        where: { name: registration.organizationName },
      }),
    ).toBe(1);
  });

  it('inicia sesión normalizando correo y devuelve errores genéricos para credenciales inválidas', async () => {
    await request(server)
      .post('/api/v1/auth/login')
      .send({ email: ` ${email.toUpperCase()} `, password })
      .expect(200);
    const wrong = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: 'wrong-password-1234' })
      .expect(401);
    const missing = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: `missing-${suffix}@example.com`, password })
      .expect(401);
    expect(wrong.body).toMatchObject({ message: 'Credenciales incorrectas' });
    expect(missing.body).toMatchObject({ message: 'Credenciales incorrectas' });
  });

  it('rota tokens una sola vez aun con dos solicitudes concurrentes y conserva vencimiento', async () => {
    const original = await auth.login({ email, password }, randomUUID());
    const responses = await Promise.all(
      [1, 2].map(() =>
        request(server)
          .post('/api/v1/auth/refresh')
          .auth(original.accessToken, { type: 'bearer' }),
      ),
    );
    expect(responses.map((res) => res.status).sort()).toEqual([200, 401]);
    const rotated = responses.find((res) => res.status === 200)!
      .body as SessionBody;
    expect(rotated.accessToken).not.toBe(original.accessToken);
    expect(rotated.expiresAt).toBe(original.expiresAt.toISOString());
    await request(server)
      .get('/api/v1/me')
      .auth(original.accessToken, { type: 'bearer' })
      .expect(401);
    await request(server)
      .get('/api/v1/me')
      .auth(rotated.accessToken, { type: 'bearer' })
      .expect(200);
  });

  it('revoca la sesión al cerrar y registra el cierre sin guardar el token', async () => {
    const session = await auth.login({ email, password }, randomUUID());
    await request(server)
      .post('/api/v1/auth/logout')
      .auth(session.accessToken, { type: 'bearer' })
      .expect(204);
    await request(server)
      .get('/api/v1/me')
      .auth(session.accessToken, { type: 'bearer' })
      .expect(401);
    expect(
      await prisma.auditEvent.count({
        where: { organizationId: organizationA, action: 'session.logout' },
      }),
    ).toBeGreaterThan(0);
  });

  it('rechaza sesiones vencidas y usuarios deshabilitados', async () => {
    const session = await auth.login({ email, password }, randomUUID());
    await prisma.session.update({
      where: { tokenHash: hashToken(session.accessToken) },
      data: { expiresAt: new Date(0) },
    });
    await request(server)
      .get('/api/v1/me')
      .auth(session.accessToken, { type: 'bearer' })
      .expect(401);
    await prisma.user.update({
      where: { id: cashierId },
      data: { disabledAt: new Date() },
    });
    try {
      await request(server)
        .get('/api/v1/me')
        .auth(cashierToken, { type: 'bearer' })
        .expect(401);
    } finally {
      await prisma.user.update({
        where: { id: cashierId },
        data: { disabledAt: null },
      });
    }
  });

  it('aplica inmediatamente la revocación de membresías y el archivado de organizaciones', async () => {
    await prisma.membership.update({
      where: { id: cashierMembershipId },
      data: { revokedAt: new Date() },
    });
    await request(server)
      .get(`/api/v1/organizations/${organizationA}/branches`)
      .auth(cashierToken, { type: 'bearer' })
      .expect(404);
    await prisma.organization.update({
      where: { id: organizationA },
      data: { archivedAt: new Date() },
    });
    try {
      await request(server)
        .get(`/api/v1/organizations/${organizationA}/branches`)
        .auth(ownerToken, { type: 'bearer' })
        .expect(404);
      const response = await request(server)
        .get('/api/v1/me')
        .auth(ownerToken, { type: 'bearer' })
        .expect(200);
      expect(response.body).toMatchObject({ memberships: [] });
    } finally {
      await prisma.organization.update({
        where: { id: organizationA },
        data: { archivedAt: null },
      });
    }
  });

  it('da cupos de login independientes según la IP reenviada por el BFF', async () => {
    const attempt = (ip: string) =>
      request(server)
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ email, password: 'wrong-password-1234' });
    const noisy: number[] = [];
    for (let i = 0; i < 12; i++)
      noisy.push((await attempt('203.0.113.10')).status);
    expect(noisy).toContain(429); // esa IP agotó su cupo...
    expect((await attempt('203.0.113.11')).status).toBe(401); // ...otra no
    // Una IP falsa a la izquierda no da cupo nuevo: cuenta la que el proxy añadió.
    expect((await attempt('198.51.100.7, 203.0.113.10')).status).toBe(429);
  });

  it('limita intentos repetidos de inicio de sesión', async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 12; attempt++) {
      const response = await request(server)
        .post('/api/v1/auth/login')
        .send({ email, password: 'wrong-password-1234' });
      statuses.push(response.status);
    }
    expect(statuses).toContain(429);
    expect(statuses.every((status) => status === 401 || status === 429)).toBe(
      true,
    );
  });
});
