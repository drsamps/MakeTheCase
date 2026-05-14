#!/usr/bin/env node
/**
 * Run all pending SQL migrations in server/migrations/ in order.
 *
 * Tracks applied files in a `schema_migrations` table so re-runs are idempotent.
 *
 * Usage:
 *   node server/scripts/run-pending-migrations.js                 # apply pending
 *   node server/scripts/run-pending-migrations.js --dry-run       # list pending, do not apply
 *   node server/scripts/run-pending-migrations.js --only 038      # apply just files starting with "038"
 *   node server/scripts/run-pending-migrations.js --force         # re-apply even if recorded as applied
 *   node server/scripts/run-pending-migrations.js --mark-applied  # mark every existing migration as applied
 *                                                                 # without running it (use on first install
 *                                                                 # against an existing DB)
 *
 * Reads MYSQL_* env vars from server/.env.local via db.js.
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// .env.local lives at the project root (two levels up from server/scripts/).
dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local') });

const args = new Set(process.argv.slice(2));
const argValue = (flag) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : null;
};
const DRY_RUN = args.has('--dry-run');
const FORCE = args.has('--force');
const MARK_APPLIED = args.has('--mark-applied');
const ONLY = argValue('--only');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

const c = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m'
};
const isTTY = process.stdout.isTTY;
const paint = (color, s) => (isTTY ? `${c[color]}${s}${c.reset}` : s);

async function listMigrations() {
  const entries = await fs.readdir(MIGRATIONS_DIR);
  return entries
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => /^\d{3}_/.test(f))
    .sort();
}

async function ensureTrackingTable(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      duration_ms INT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function getAppliedSet(connection) {
  const [rows] = await connection.query('SELECT filename FROM schema_migrations');
  return new Set(rows.map((r) => r.filename));
}

async function backfillApplied(connection) {
  // First-time setup: assume any migration whose number is below the lowest
  // file currently sitting in the directory is already applied if the table
  // is empty. We do NOT auto-backfill — operator must run --mark-applied to
  // do that. By default, empty table means "nothing applied yet".
  // (left as a no-op stub for clarity)
}

async function applyOne(connection, filename) {
  const fullPath = path.join(MIGRATIONS_DIR, filename);
  const sql = await fs.readFile(fullPath, 'utf-8');
  const started = Date.now();
  // mysql2 with multipleStatements:true runs all statements in the file.
  await connection.query(sql);
  const duration_ms = Date.now() - started;
  await connection.query(
    'INSERT INTO schema_migrations (filename, duration_ms) VALUES (?, ?) ON DUPLICATE KEY UPDATE applied_at = CURRENT_TIMESTAMP, duration_ms = VALUES(duration_ms)',
    [filename, duration_ms]
  );
  return duration_ms;
}

async function main() {
  const dbName = process.env.MYSQL_DATABASE || 'ceochat';
  const user = process.env.MYSQL_USER;
  if (!user) {
    console.error(paint('red', 'MYSQL_USER is not set. Check server/.env.local.'));
    process.exit(1);
  }

  console.log(paint('bold', `\nMigrations · database=${dbName} · user=${user}`));
  console.log(paint('dim', `(${MIGRATIONS_DIR})`));

  // Per-connection multipleStatements so we can run multi-statement .sql files.
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT || '3306'),
    user,
    password: process.env.MYSQL_PASSWORD,
    database: dbName,
    multipleStatements: true
  });

  await ensureTrackingTable(connection);
  await backfillApplied(connection);

  const all = await listMigrations();

  if (MARK_APPLIED) {
    console.log(paint('yellow', `\n--mark-applied: recording ${all.length} files as applied without running them.\n`));
    let marked = 0;
    for (const f of all) {
      const filter = ONLY && !f.startsWith(ONLY);
      if (filter) continue;
      const [r] = await connection.query(
        'INSERT IGNORE INTO schema_migrations (filename, duration_ms) VALUES (?, 0)',
        [f]
      );
      if (r.affectedRows > 0) { console.log(`  ${paint('green', '+ marked:')} ${f}`); marked++; }
      else console.log(`  ${paint('dim', '· already recorded:')} ${f}`);
    }
    console.log(paint('bold', `\nRecorded ${marked} new entries.\n`));
    await connection.end();
    return;
  }

  const applied = FORCE ? new Set() : await getAppliedSet(connection);
  const pending = all.filter((f) => {
    if (applied.has(f)) return false;
    if (ONLY && !f.startsWith(ONLY)) return false;
    return true;
  });

  if (pending.length === 0) {
    console.log(paint('green', '\n✓ Nothing to apply. Database is up-to-date.\n'));
    await connection.end();
    return;
  }

  console.log(paint('bold', `\nFound ${all.length} migration files. ${applied.size} applied, ${pending.length} pending.`));
  if (DRY_RUN) {
    console.log(paint('yellow', '\nDRY RUN — the following would be applied:\n'));
    pending.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
    console.log('');
    await connection.end();
    return;
  }

  console.log(paint('cyan', '\nApplying:\n'));
  let successes = 0;
  const failures = [];

  for (let i = 0; i < pending.length; i++) {
    const file = pending[i];
    const label = `[${i + 1}/${pending.length}] ${file}`;
    process.stdout.write(`  ${paint('blue', label)} … `);
    try {
      const ms = await applyOne(connection, file);
      console.log(paint('green', `ok (${ms} ms)`));
      successes++;
    } catch (err) {
      console.log(paint('red', `FAILED`));
      console.log(paint('red', `      ${err.message}`));
      failures.push({ file, error: err });
      // Stop on first failure — later migrations may depend on this one.
      break;
    }
  }

  console.log('');
  console.log(paint('bold', 'Summary:'));
  console.log(`  ${paint('green', '✓ applied:')} ${successes}`);
  if (failures.length) {
    console.log(`  ${paint('red', '✗ failed:')}  ${failures.length}`);
    for (const f of failures) {
      console.log(`      ${f.file} — ${f.error.message}`);
    }
  }
  const skipped = pending.length - successes - failures.length;
  if (skipped > 0) console.log(`  ${paint('yellow', '↷ skipped:')} ${skipped} (stopped after first failure)`);
  console.log('');

  await connection.end();
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error(paint('red', '\nUnhandled error:'), err);
  process.exit(1);
});
