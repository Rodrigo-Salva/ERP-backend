import 'reflect-metadata';
import { ConsoleLogger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Environment } from './config/environment';
import { configureApp } from './configure-app';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: new ConsoleLogger({ json: true }),
    abortOnError: false,
  });
  configureApp(app);
  app.enableShutdownHooks();
  const config = app.get(ConfigService<Environment, true>);
  try {
    await app.listen(
      config.get('PORT', { infer: true }),
      config.get('HOST', { infer: true }),
    );
  } catch (error) {
    await app.close();
    throw error;
  }
}

void bootstrap().catch(() => {
  // No imprimir excepciones de conexión que puedan contener credenciales.
  process.stderr.write(
    'No se pudo iniciar la API. Revisa la configuración y PostgreSQL.\n',
  );
  process.exitCode = 1;
});
