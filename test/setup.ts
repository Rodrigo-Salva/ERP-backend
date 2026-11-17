import 'reflect-metadata';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/erp_test';
process.env.SWAGGER_ENABLED = 'false';
