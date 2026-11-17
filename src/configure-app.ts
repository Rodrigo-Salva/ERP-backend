import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { HttpExceptionFilter } from './common/http/http-exception.filter';
import { Environment } from './config/environment';

export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService<Environment, true>);
  app.setGlobalPrefix('api/v1');
  // Con proxies de confianza declarados, `request.ip` (y los límites de peticiones por IP)
  // usa la dirección real del cliente que reenvía el BFF; sin ellos, X-Forwarded-For se ignora.
  const trustProxy = config.get('TRUST_PROXY', { infer: true });
  if (trustProxy !== undefined)
    (
      app.getHttpAdapter().getInstance() as {
        set: (name: string, value: unknown) => void;
      }
    ).set('trust proxy', trustProxy);
  app.use(helmet());
  // Evita que navegadores o intermediarios almacenen respuestas con sesiones o perfiles.
  app.use(
    (
      _request: unknown,
      response: import('express').Response,
      next: import('express').NextFunction,
    ) => {
      response.setHeader('Cache-Control', 'no-store');
      next();
    },
  );
  app.enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }),
    exposedHeaders: ['X-Request-Id'],
  });
  app.useGlobalFilters(new HttpExceptionFilter());

  if (config.get('SWAGGER_ENABLED', { infer: true })) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Tendio API')
        .setDescription(
          'Acceso, organizaciones y catálogo de productos, categorías y unidades. Inventario y operaciones pendientes.',
        )
        .setVersion('0.1.0')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('api/docs', app, document);
  }
}
