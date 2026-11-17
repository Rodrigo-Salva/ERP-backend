const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const prettier = require('eslint-config-prettier');
const { resolve } = require('node:path');

module.exports = tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      '.tmp/**',
      'src/generated/**',
      '**/*.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: resolve(__dirname, '..'),
      },
    },
    rules: { '@typescript-eslint/no-floating-promises': 'error' },
  },
  {
    // supertest y fetch devuelven JSON como any; las pruebas y los comandos lo consultan directamente.
    files: ['test/**/*.integration.ts', 'src/cli/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  prettier,
);
