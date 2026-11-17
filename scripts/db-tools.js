#!/usr/bin/env node
/* Respaldo, restauración y verificación de PostgreSQL con pg_dump/pg_restore.
 *
 *   node scripts/db-tools.js backup              # crea backups/erp-<base>-<fecha>.dump
 *   node scripts/db-tools.js restore <archivo>   # restaura en RESTORE_DATABASE_URL
 *   node scripts/db-tools.js verify              # respalda, restaura en una base temporal y compara
 *
 * Variables: DATABASE_URL (origen), RESTORE_DATABASE_URL (destino explícito de restore),
 * BACKUP_DIR (por defecto backups/), BACKUP_RETENTION (copias a conservar; 14),
 * PG_BIN (carpeta de pg_dump/pg_restore/psql si no están en PATH).
 * Las contraseñas se pasan por PGPASSWORD, nunca en la línea de comandos. */
const { spawnSync } = require('node:child_process');
const { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } = require('node:fs');
const { join, resolve } = require('node:path');

try {
  require('dotenv').config({ path: resolve(__dirname, '../.env'), quiet: true });
} catch {
  /* dotenv es opcional si las variables ya están definidas */
}

const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};
const bin = (name) => (process.env.PG_BIN ? join(process.env.PG_BIN, name) : name);

function parse(url, label) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return fail(`${label} no es una URL válida.`);
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) fail(`${label} debe ser PostgreSQL.`);
  return {
    host: parsed.hostname || 'localhost',
    port: parsed.port || '5432',
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: decodeURIComponent(parsed.pathname.slice(1)),
  };
}
const run = (command, args, db, { capture = false } = {}) => {
  const result = spawnSync(bin(command), args, {
    env: { ...process.env, PGPASSWORD: db.password },
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'],
  });
  if (result.error) fail(`No se pudo ejecutar ${command}: ${result.error.message}. Define PG_BIN.`);
  if (result.status !== 0) fail(`${command} terminó con error.\n${result.stderr ?? ''}`.trim());
  return result.stdout ?? '';
};
const conn = (db, database = db.database) => [
  '--host', db.host, '--port', db.port, '--username', db.user, '--dbname', database,
];
const sql = (db, database, statement) =>
  run('psql', [...conn(db, database), '--no-psqlrc', '--tuples-only', '--no-align', '-c', statement], db, { capture: true }).trim();

function backup(db) {
  const directory = resolve(process.env.BACKUP_DIR ?? join(__dirname, '../backups'));
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, 'Z');
  const file = join(directory, `erp-${db.database}-${stamp}.dump`);
  run('pg_dump', [...conn(db), '--format=custom', '--no-owner', '--file', file], db);
  const retention = Number(process.env.BACKUP_RETENTION ?? 14);
  const copies = readdirSync(directory)
    .filter((name) => name.startsWith(`erp-${db.database}-`) && name.endsWith('.dump'))
    .map((name) => ({ name, time: statSync(join(directory, name)).mtimeMs }))
    .sort((a, b) => b.time - a.time);
  for (const old of copies.slice(retention)) unlinkSync(join(directory, old.name));
  process.stdout.write(`Respaldo creado: ${file}\nCopias conservadas: ${Math.min(copies.length, retention)} (retención ${retention})\n`);
  return file;
}

function restore(file, target) {
  if (!existsSync(file)) fail(`No existe el archivo ${file}.`);
  run('pg_restore', [...conn(target), '--clean', '--if-exists', '--no-owner', '--exit-on-error', file], target);
}

const TABLES = ['Organization', 'User', 'Product', 'ProductVariant', 'InventoryBalance', 'InventoryMovement', 'PurchaseOrder', 'Sale', 'SaleLine', 'Payment', 'SaleReturn', 'CashSession', 'CashMovement', 'AuditEvent', '_prisma_migrations'];
const counts = (db, database) =>
  Object.fromEntries(TABLES.map((table) => [table, sql(db, database, `SELECT count(*) FROM "${table}"`)]));

function verify(source) {
  const file = backup(source);
  const scratch = `${source.database}_restore_check`;
  if (!/^[A-Za-z0-9_]+$/.test(scratch)) fail('Nombre de base no válido para la verificación.');
  sql(source, 'postgres', `DROP DATABASE IF EXISTS "${scratch}"`);
  sql(source, 'postgres', `CREATE DATABASE "${scratch}"`);
  try {
    restore(file, { ...source, database: scratch });
    const before = counts(source, source.database);
    const after = counts(source, scratch);
    const differences = TABLES.filter((table) => before[table] !== after[table]);
    if (differences.length)
      fail(`La restauración no coincide en: ${differences.map((t) => `${t} (${before[t]} ≠ ${after[t]})`).join(', ')}`);
    process.stdout.write(`Restauración verificada en "${scratch}". Filas por tabla:\n`);
    for (const table of TABLES) process.stdout.write(`  ${table}: ${after[table]}\n`);
  } finally {
    sql(source, 'postgres', `DROP DATABASE IF EXISTS "${scratch}"`);
  }
}

const [command, argument] = process.argv.slice(2);
if (!process.env.DATABASE_URL) fail('Define DATABASE_URL.');
const source = parse(process.env.DATABASE_URL, 'DATABASE_URL');
if (command === 'backup') backup(source);
else if (command === 'verify') verify(source);
else if (command === 'restore') {
  if (!argument) fail('Indica el archivo .dump a restaurar.');
  if (!process.env.RESTORE_DATABASE_URL)
    fail('Define RESTORE_DATABASE_URL con la base de destino. No se restaura sobre DATABASE_URL por omisión.');
  const target = parse(process.env.RESTORE_DATABASE_URL, 'RESTORE_DATABASE_URL');
  if (target.host === source.host && target.port === source.port && target.database === source.database && process.env.CONFIRM_OVERWRITE !== 'yes')
    fail('El destino es la base de origen. Define CONFIRM_OVERWRITE=yes para sobrescribirla.');
  restore(resolve(argument), target);
  process.stdout.write(`Restaurado en ${target.database}.\n`);
} else fail('Uso: node scripts/db-tools.js backup | restore <archivo> | verify');
