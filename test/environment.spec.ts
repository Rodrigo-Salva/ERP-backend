import { validateEnvironment } from '../src/config/environment';

describe('Configuración de entorno', () => {
  const valid = {
    DATABASE_URL: 'postgresql://erp:local@localhost:5432/erp_dev',
  };

  it('convierte puerto, booleanos y lista de orígenes explícitamente', () => {
    expect(
      validateEnvironment({
        ...valid,
        PORT: '3100',
        SWAGGER_ENABLED: 'false',
        CORS_ORIGINS: 'http://localhost:5173,https://erp.example.com',
      }),
    ).toMatchObject({
      PORT: 3100,
      SWAGGER_ENABLED: false,
      CORS_ORIGINS: ['http://localhost:5173', 'https://erp.example.com'],
    });
  });

  it.each([
    { PORT: '0' },
    { PORT: '65536' },
    { PORT: 'abc' },
    { DATABASE_URL: 'https://example.com/db' },
    { DATABASE_URL: 'postgresql://localhost' },
    { CORS_ORIGINS: '*' },
    { CORS_ORIGINS: 'https://example.com/path' },
    { SWAGGER_ENABLED: 'yes' },
  ])('rechaza configuración inválida: %j', (invalid) => {
    expect(() => validateEnvironment({ ...valid, ...invalid })).toThrow(
      'Configuración inválida',
    );
  });

  it('acepta proxies de confianza concretos y rechaza confiar en todos', () => {
    expect(validateEnvironment({ ...valid, TRUST_PROXY: '1' })).toMatchObject({
      TRUST_PROXY: 1,
    });
    expect(
      validateEnvironment({ ...valid, TRUST_PROXY: 'loopback' }),
    ).toMatchObject({ TRUST_PROXY: 'loopback' });
    expect(() =>
      validateEnvironment({ ...valid, TRUST_PROXY: 'true' }),
    ).toThrow('Configuración inválida');
  });

  it('no incluye valores secretos en el error', () => {
    expect(() =>
      validateEnvironment({ DATABASE_URL: 'contraseña-privada' }),
    ).toThrow('Configuración inválida. Revisa: DATABASE_URL');
  });
});
