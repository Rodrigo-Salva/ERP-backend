import { Body, Controller, Get, INestApplication, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import { z } from 'zod';
import { Public } from '../src/common/auth/authenticated-request';
import { InputPipe } from '../src/common/domain/input';

const exampleSchema = z.object({ name: z.string().min(2) }).strict();
type Example = z.infer<typeof exampleSchema>;

// Rutas exclusivas del entorno de pruebas, no forman parte de la API publicada.
@Controller('test')
@Public()
class TestController {
  @Post()
  create(@Body(new InputPipe(exampleSchema)) body: Example): Example {
    return body;
  }

  @Get('error')
  error(): never {
    throw new Error('postgresql://user:secret@internal/db');
  }
}

describe('Contrato HTTP', () => {
  let app: INestApplication;
  let server: Server;
  const query = jest.fn();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [TestController],
    })
      .overrideProvider(PrismaService)
      .useValue({ $queryRaw: query })
      .compile();
    app = module.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    server = app.getHttpServer() as Server;
  });
  afterAll(async () => {
    await app.close();
  });

  it('comprueba proceso y cabeceras de seguridad sin consultar PostgreSQL', async () => {
    const response = await request(server)
      .get('/api/v1/health/live')
      .expect(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(query).not.toHaveBeenCalled();
  });

  it('devuelve disponibilidad cuando PostgreSQL responde', async () => {
    query.mockResolvedValueOnce([{ '?column?': 1 }]);
    await request(server)
      .get('/api/v1/health')
      .expect(200, { status: 'ok', database: 'up' });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('devuelve 503 sin filtrar detalles del servidor de base de datos', async () => {
    query.mockRejectedValueOnce(new Error('private-db-password'));
    const response = await request(server).get('/api/v1/health').expect(503);
    expect(response.body).toMatchObject({
      statusCode: 503,
      message: 'Servicio temporalmente no disponible',
      requestId: response.headers['x-request-id'],
    });
    expect(response.text).not.toContain('private-db-password');
  });

  it('rechaza campos adicionales y errores de validación', async () => {
    const response = await request(server)
      .post('/api/v1/test')
      .send({ name: '', organizationId: 'otra-organizacion' })
      .expect(400);
    expect(response.body).toMatchObject({
      statusCode: 400,
      message: expect.any(Array) as unknown,
      requestId: response.headers['x-request-id'],
    });
    await request(server)
      .post('/api/v1/test')
      .send({ name: 'Tienda' })
      .expect(201, { name: 'Tienda' });
  });

  it('normaliza errores inesperados y rutas inexistentes', async () => {
    const response = await request(server)
      .get('/api/v1/test/error')
      .expect(500);
    expect(response.text).not.toContain('secret');
    expect(response.body).toMatchObject({
      message: 'Error interno del servidor',
    });
    const missing = await request(server)
      .get('/api/v1/missing?token=private')
      .expect(404);
    expect(missing.body).toMatchObject({
      message: 'Recurso no encontrado',
      requestId: missing.headers['x-request-id'],
    });
    expect(missing.text).not.toContain('private');
  });

  it('no reutiliza identificadores de petición enviados por el cliente', async () => {
    const response = await request(server)
      .get('/api/v1/health/live')
      .set('X-Request-Id', 'client-controlled')
      .expect(200);
    expect(response.headers['x-request-id']).not.toBe('client-controlled');
  });

  it('solo concede CORS al origen configurado', async () => {
    const allowed = await request(server)
      .get('/api/v1/health/live')
      .set('Origin', 'http://localhost:5173')
      .expect(200);
    expect(allowed.headers['access-control-allow-origin']).toBe(
      'http://localhost:5173',
    );
    const denied = await request(server)
      .get('/api/v1/health/live')
      .set('Origin', 'https://untrusted.example')
      .expect(200);
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});
