import { z } from 'zod';

const httpOrigin = z
  .string()
  .url()
  .refine((value) => {
    const url = URL.parse(value);
    return (
      url !== null &&
      ['http:', 'https:'].includes(url.protocol) &&
      url.origin === value &&
      !url.username &&
      !url.password
    );
  }, 'Debe ser un origen HTTP/HTTPS sin ruta');

const environmentSchema = z.object({
  APP_URL: z.string().url().default('http://localhost:5173'),
  MAIL_TRANSPORT: z.enum(['local', 'smtp']).default('local'),
  MAIL_FROM: z.email().default('erp@example.test'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z
    .string()
    .url()
    .refine((value) => {
      const url = URL.parse(value);
      return (
        url !== null &&
        ['postgres:', 'postgresql:'].includes(url.protocol) &&
        url.pathname.length > 1
      );
    }, 'Debe indicar una base de datos PostgreSQL'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((value) => value.split(',').map((origin) => origin.trim()))
    .pipe(z.array(httpOrigin).min(1)),
  SWAGGER_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  /**
   * Proxies de confianza para leer la IP real del cliente en X-Forwarded-For: número de
   * saltos, `loopback`, o direcciones/CIDR separados por comas. Sin definir, se ignora la
   * cabecera. `true` se rechaza a propósito: confiaría en cualquier origen y permitiría
   * suplantar la IP para saltarse los límites de peticiones.
   */
  TRUST_PROXY: z
    .string()
    .trim()
    .min(1)
    .refine(
      (value) => value.toLowerCase() !== 'true',
      'No se permite confiar en todos los proxies',
    )
    .transform((value): string | number =>
      /^\d+$/.test(value) ? Number(value) : value,
    )
    .optional(),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24).default(8),
});

export type Environment = z.infer<typeof environmentSchema>;

export function validateEnvironment(
  input: Record<string, unknown>,
): Environment {
  const result = environmentSchema.safeParse(input);
  if (!result.success) {
    // Solo nombres de campos; los valores podrían contener credenciales.
    const fields = [
      ...new Set(result.error.issues.map((issue) => issue.path.join('.'))),
    ];
    throw new Error(`Configuración inválida. Revisa: ${fields.join(', ')}`);
  }
  return result.data;
}
