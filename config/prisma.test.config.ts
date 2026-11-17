import { config } from 'dotenv';
import { resolve } from 'node:path';
import { defineConfig, env } from 'prisma/config';

config({ path: resolve(__dirname, '../.env'), quiet: true });
const url = env('TEST_DATABASE_URL');
if (!new URL(url).pathname.endsWith('_test')) {
  throw new Error(
    'TEST_DATABASE_URL debe apuntar a una base cuyo nombre termine en _test.',
  );
}

export default defineConfig({
  schema: '../prisma/schema.prisma',
  migrations: { path: '../prisma/migrations' },
  datasource: { url },
});
