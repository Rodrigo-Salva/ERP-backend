module.exports = {
  ...require('./jest.config'),
  // Se ejecuta explícitamente; requiere la base PostgreSQL de pruebas.
  testMatch: ['<rootDir>/test/**/*.integration.ts'],
  testTimeout: 20000,
};
