import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { readdir, readFile, rm } from 'node:fs/promises';
import { Server } from 'node:http';
import { resolve } from 'node:path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { Environment } from '../src/config/environment';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { cleanupTestData } from './cleanup';

config({ path: resolve(__dirname, '../.env'), quiet: true });
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith('_test'))
  throw new Error(
    'Configura TEST_DATABASE_URL con una base dedicada cuyo nombre termine en _test.',
  );

const mailbox = resolve(__dirname, '../.local-mail');

describe('Recuperación, invitaciones y permisos', () => {
  let app: INestApplication;
  let server: Server;
  let owner: string;
  let ownerEmail: string;
  let organizationId: string;
  let otherOrganizationId: string;
  let mainBranch: string;
  let northBranch: string;
  let foreignBranch: string;
  const userIds: string[] = [];
  const organizationIds: string[] = [];
  const mails: string[] = [];
  const suffix = randomUUID();
  const password = 'integration-identity-only-2026';
  const prisma = new PrismaService(
    new ConfigService<Environment, true>({ DATABASE_URL: databaseUrl }),
  );
  const api = (resource: string) => `/api/v1/${resource}`;
  const org = (resource: string) =>
    api(`organizations/${organizationId}/${resource}`);

  /** Lee el último mensaje del buzón local enviado a un correo y devuelve su token. */
  async function tokenFor(email: string): Promise<string> {
    const files = (await readdir(mailbox)).filter((f) => f.endsWith('.eml'));
    const found: Array<{ file: string; time: number; text: string }> = [];
    for (const file of files) {
      const text = await readFile(resolve(mailbox, file), 'utf8');
      if (text.startsWith(`To: ${email}\n`)) {
        const { mtimeMs } = await import('node:fs/promises').then((fs) =>
          fs.stat(resolve(mailbox, file)),
        );
        found.push({ file, time: mtimeMs, text });
      }
    }
    expect(found.length).toBeGreaterThan(0);
    found.sort((a, b) => b.time - a.time);
    mails.push(...found.map((m) => m.file));
    const token = /#token=([A-Za-z0-9_-]{43})/.exec(found[0]!.text)?.[1];
    expect(token).toBeDefined();
    return token!;
  }
  const mailCount = async (email: string) => {
    try {
      const files = await readdir(mailbox);
      let count = 0;
      for (const file of files)
        if (
          (await readFile(resolve(mailbox, file), 'utf8')).startsWith(
            `To: ${email}\n`,
          )
        )
          count++;
      return count;
    } catch {
      return 0;
    }
  };
  const login = (email: string, pass = password) =>
    request(server).post(api('auth/login')).send({ email, password: pass });

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
      const email = `identity-${label}-${suffix}@example.com`;
      const result = await auth.register(
        {
          email,
          password,
          name: 'Propietario',
          organizationName: `Identidad ${label}`,
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
        ownerEmail = email;
        organizationId = user.memberships[0]!.organizationId;
      } else otherOrganizationId = user.memberships[0]!.organizationId;
    }
    mainBranch = (
      await prisma.branch.findFirstOrThrow({ where: { organizationId } })
    ).id;
    foreignBranch = (
      await prisma.branch.findFirstOrThrow({
        where: { organizationId: otherOrganizationId },
      })
    ).id;
    northBranch = (
      await request(server)
        .post(org('branches'))
        .auth(owner, { type: 'bearer' })
        .send({ name: 'Norte', code: 'NORTE', timeZone: 'America/Lima' })
        .expect(201)
    ).body.id as string;
  });

  afterAll(async () => {
    try {
      await cleanupTestData(prisma, organizationIds, userIds);
    } finally {
      for (const file of mails)
        await rm(resolve(mailbox, file), { force: true });
      if (app) await app.close();
      await prisma.$disconnect();
    }
  });

  it('recupera la contraseña con un enlace de un solo uso y cierra sesiones', async () => {
    const unknown = `nadie-${suffix}@example.com`;
    const generic = await request(server)
      .post(api('auth/forgot-password'))
      .send({ email: unknown })
      .expect(202);
    expect(await mailCount(unknown)).toBe(0);
    const known = await request(server)
      .post(api('auth/forgot-password'))
      .send({ email: ownerEmail })
      .expect(202);
    expect(known.body).toEqual(generic.body); // no revela si la cuenta existe

    const token = await tokenFor(ownerEmail);
    const stored = await prisma.passwordReset.findMany({
      where: { user: { email: ownerEmail } },
    });
    expect(JSON.stringify(stored)).not.toContain(token); // solo se guarda el hash

    const newPassword = 'nueva-clave-segura-2026';
    await request(server)
      .post(api('auth/reset-password'))
      .send({ token, password: newPassword })
      .expect(200);
    await request(server)
      .post(api('auth/reset-password'))
      .send({ token, password: 'otra-clave-segura-2026' })
      .expect(400); // un solo uso
    await request(server)
      .get(api('me'))
      .auth(owner, { type: 'bearer' })
      .expect(401); // sesiones anteriores revocadas
    await login(ownerEmail).expect(401);
    const fresh = await login(ownerEmail, newPassword).expect(200);
    owner = fresh.body.accessToken as string;
  });

  it('rechaza enlaces de recuperación vencidos', async () => {
    await request(server)
      .post(api('auth/forgot-password'))
      .send({ email: ownerEmail })
      .expect(202);
    const token = await tokenFor(ownerEmail);
    await prisma.$executeRawUnsafe(
      `UPDATE "PasswordReset" SET "createdAt" = now() - interval '2 hours', "expiresAt" = now() - interval '1 hour' WHERE "usedAt" IS NULL AND "userId" IN (SELECT id FROM "User" WHERE email = $1)`,
      ownerEmail,
    );
    await request(server)
      .post(api('auth/reset-password'))
      .send({ token, password: 'clave-tardia-segura-2026' })
      .expect(400);
  });

  it('invita a un usuario con acceso limitado a una sucursal', async () => {
    const email = `cajero-${suffix}@example.com`;
    const invite = {
      email: email.toUpperCase(),
      role: 'CASHIER',
      allBranches: false,
      branchIds: [northBranch],
      permissions: ['sales.discount'],
    };
    await request(server)
      .post(org('invitations'))
      .auth(owner, { type: 'bearer' })
      .send({ ...invite, branchIds: [foreignBranch] })
      .expect(400); // sucursal de otra organización
    await request(server)
      .post(org('invitations'))
      .auth(owner, { type: 'bearer' })
      .send({ ...invite, role: 'OWNER' })
      .expect(400); // no se puede invitar como propietario
    await request(server)
      .post(org('invitations'))
      .auth(owner, { type: 'bearer' })
      .send(invite)
      .expect(201);
    const token = await tokenFor(email);

    const accepted = await request(server)
      .post(api('auth/accept-invitation'))
      .send({ token, password, name: 'Cajera Norte' })
      .expect(200);
    expect(accepted.body).toEqual({ accepted: true });
    await request(server)
      .post(api('auth/accept-invitation'))
      .send({ token, password, name: 'Otra' })
      .expect(400); // un solo uso

    const session = await login(email).expect(200);
    const cashier = session.body.accessToken as string;
    userIds.push(
      (await prisma.user.findUniqueOrThrow({ where: { email } })).id,
    );
    const branches = await request(server)
      .get(org('branches'))
      .auth(cashier, { type: 'bearer' })
      .expect(200);
    expect(
      (branches.body.items as Array<{ id: string }>).map((b) => b.id),
    ).toEqual([northBranch]);
    await request(server)
      .get(org(`inventory/balances?branchId=${mainBranch}`))
      .auth(cashier, { type: 'bearer' })
      .expect(404); // sin acceso a la otra sucursal
    await request(server)
      .post(org('invitations'))
      .auth(cashier, { type: 'bearer' })
      .send(invite)
      .expect(403);
    await request(server)
      .get(org('members'))
      .auth(cashier, { type: 'bearer' })
      .expect(403);

    const profile = await request(server)
      .get(api('me'))
      .auth(cashier, { type: 'bearer' })
      .expect(200);
    expect(profile.body.memberships[0].permissions).toEqual(['sales.discount']);
    const members = await request(server)
      .get(org('members'))
      .auth(owner, { type: 'bearer' })
      .expect(200);
    const invited = (
      members.body.items as Array<{
        permissions: string[];
        branches: Array<{ branchId: string }>;
        user: { email: string };
      }>
    ).find((m) => m.user.email === email)!;
    expect(invited.permissions).toEqual(['sales.discount']);
    expect(invited.branches).toEqual([{ branchId: northBranch }]);

    // Editar permisos: el cajero pasa a ver ambas sucursales y luego se revoca.
    const membership = await prisma.membership.findFirstOrThrow({
      where: { organizationId, user: { email } },
    });
    await request(server)
      .patch(org(`members/${membership.id}`))
      .auth(owner, { type: 'bearer' })
      .send({
        role: 'MANAGER',
        allBranches: true,
        branchIds: [],
        permissions: [],
      })
      .expect(200);
    const widened = await request(server)
      .get(org('branches'))
      .auth(cashier, { type: 'bearer' })
      .expect(200);
    expect(widened.body.items).toHaveLength(2);
    await request(server)
      .patch(org(`members/${membership.id}`))
      .auth(owner, { type: 'bearer' })
      .send({
        role: 'MANAGER',
        allBranches: true,
        branchIds: [],
        permissions: [],
        revoked: true,
      })
      .expect(200);
    await request(server)
      .get(org('branches'))
      .auth(cashier, { type: 'bearer' })
      .expect(404); // la membresía revocada deja de dar acceso
    const events = await prisma.auditEvent.findMany({
      where: {
        organizationId,
        action: {
          in: [
            'invitation.created',
            'invitation.accepted',
            'membership.updated',
          ],
        },
      },
    });
    expect(events.map((e) => e.action).sort()).toEqual([
      'invitation.accepted',
      'invitation.created',
      'membership.updated',
      'membership.updated',
    ]);
    expect(JSON.stringify(events)).not.toContain(token);
  });

  it('revoca invitaciones, rechaza las vencidas y protege al propietario', async () => {
    const email = `revocada-${suffix}@example.com`;
    const body = {
      email,
      role: 'VIEWER',
      allBranches: true,
      branchIds: [],
      permissions: [],
    };
    const created = await request(server)
      .post(org('invitations'))
      .auth(owner, { type: 'bearer' })
      .send(body)
      .expect(201);
    const revokedToken = await tokenFor(email);
    await request(server)
      .post(org(`invitations/${created.body.id}/revoke`))
      .auth(owner, { type: 'bearer' })
      .send({})
      .expect(201);
    await request(server)
      .post(api('auth/accept-invitation'))
      .send({ token: revokedToken, password, name: 'Revocada' })
      .expect(400);

    // Una invitación nueva reemplaza a la pendiente anterior.
    await request(server)
      .post(org('invitations'))
      .auth(owner, { type: 'bearer' })
      .send(body)
      .expect(201);
    await request(server)
      .post(org('invitations'))
      .auth(owner, { type: 'bearer' })
      .send(body)
      .expect(201);
    expect(
      await prisma.invitation.count({
        where: { organizationId, email, usedAt: null, revokedAt: null },
      }),
    ).toBe(1);
    const token = await tokenFor(email);
    await prisma.$executeRawUnsafe(
      `UPDATE "Invitation" SET "createdAt" = now() - interval '3 days', "expiresAt" = now() - interval '1 day' WHERE email = $1 AND "revokedAt" IS NULL`,
      email,
    );
    await request(server)
      .post(api('auth/accept-invitation'))
      .send({ token, password, name: 'Tardía' })
      .expect(400);
    const list = await request(server)
      .get(org('invitations'))
      .auth(owner, { type: 'bearer' })
      .expect(200);
    expect(JSON.stringify(list.body)).not.toMatch(/tokenHash/);
    expect(list.body).toMatchObject({ page: 1, limit: 20 });
    expect(Array.isArray(list.body.items)).toBe(true);

    const ownerMembership = await prisma.membership.findFirstOrThrow({
      where: { organizationId, role: 'OWNER' },
    });
    await request(server)
      .patch(org(`members/${ownerMembership.id}`))
      .auth(owner, { type: 'bearer' })
      .send({
        role: 'VIEWER',
        allBranches: true,
        branchIds: [],
        permissions: [],
      })
      .expect(409);
    await request(server)
      .patch(
        `/api/v1/organizations/${otherOrganizationId}/members/${ownerMembership.id}`,
      )
      .auth(owner, { type: 'bearer' })
      .send({
        role: 'VIEWER',
        allBranches: true,
        branchIds: [],
        permissions: [],
      })
      .expect(404);
  });
});
