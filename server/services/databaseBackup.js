/**
 * Database backup: a gzipped mysqldump written into backups/ (Admin > Backup).
 * Ported from Quizzer's routes/admin_backup.py. Full notes: docs/database-backup.md.
 *
 * WHY THIS EXISTS. Rollover and semester work create and rewrite many rows at once -- cheap to
 * run, expensive to undo. A backup taken seconds before is what makes those buttons reasonable
 * to press, and it is equally the answer to "I deleted the wrong section".
 *
 * BE HONEST ABOUT WHAT THIS IS. Same disk, same machine, same failure domain as the database it
 * copies. It is a safety net and an undo button, NOT disaster recovery, and the UI says so.
 *
 * FOUR THINGS HERE ARE LOAD-BEARING:
 *
 * 1. THE PASSWORD NEVER TOUCHES THE COMMAND LINE. `mysqldump -p<secret>` is visible in `ps` to
 *    every user on the box for as long as the dump runs. Credentials go into a temporary option
 *    file (os.tmpdir(), mode 0600, values quoted and escaped by cnfEscape()), passed as the FIRST
 *    argument `--defaults-extra-file=<path>` (mysqldump ignores it anywhere else), and deleted
 *    in a `finally`.
 *
 * 2. backups/ IS OUTSIDE THE WEB-SERVED TREE AND GITIGNORED, exactly like logs/. A dump holds
 *    every student record and transcript. Production Apache serves only dist/, and the dev
 *    express.static serves only dist/. The directory is created 0700 and files are chmod 0600.
 *
 * 3. FILENAMES ARE MATCHED AGAINST A LIST, NEVER JOINED INTO A PATH. listBackups() enumerates
 *    the directory; resolveBackup()/deleteBackup() require the request value to EQUAL a listed
 *    name before any path is built. NAME_RE is a sanity check on the listing, not the boundary.
 *
 * 4. PATHS RESOLVE FROM THIS MODULE'S LOCATION, NEVER THE PROCESS CWD. pm2's working directory
 *    is not guaranteed to be the project root (same PROJECT_ROOT idiom as promptLogger.js).
 */

import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { pipeline } from 'stream/promises';
import { fileURLToPath } from 'url';
import zlib from 'zlib';
import { pool } from '../db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, '..', '..');
export const BACKUP_DIR = path.join(PROJECT_ROOT, 'backups');

// How many dumps to keep. A constant, not a setting: nobody has wanted a number other than
// "enough to cover the last few risky operations". Promote it when someone asks.
export const KEEP_BACKUPS = 10;

// Every name this module writes: makethecase_YYYY-MM-DD_HHMMSS[_tag].sql.gz. Seconds are
// included because minute-precision names (Quizzer's) can collide.
const NAME_RE = /^makethecase_(\d{4}-\d{2}-\d{2}_\d{6})(?:_([a-z0-9-]+))?\.sql\.gz$/;
const TAG_RE = /^[a-z0-9-]{1,40}$/;

// mysqldump's progress chatter and the password warning arrive on stderr but are not errors.
const STDERR_NOISE_RE = /^\s*--\s|^\s*$|Using a password on the command line/;
const STDERR_CAP = 8000;

export class BackupError extends Error {
  constructor(code, message, status = 500) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// In-process lock. One dump at a time: a second request gets 409 rather than a second
// full-database read competing with the first.
let running = false;

/**
 * Quote a value for a MySQL option file. Option files process backslash escapes inside double
 * quotes, so both backslash and quote must be escaped -- otherwise a password containing either
 * silently becomes a different password and presents as "access denied".
 */
function cnfEscape(value) {
  return '"' + String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

async function ensureDir() {
  try {
    await fsp.mkdir(BACKUP_DIR, { recursive: true, mode: 0o700 });
    try { await fsp.chmod(BACKUP_DIR, 0o700); } catch (_) { /* Windows: advisory only */ }
  } catch (err) {
    throw new BackupError('backup_dir_unwritable', `Could not create ${BACKUP_DIR}: ${err.message}`);
  }
}

/** The mysqldump to run: MYSQLDUMP_PATH if set, else `mysqldump` from PATH. */
function mysqldumpCommand() {
  return process.env.MYSQLDUMP_PATH || 'mysqldump';
}

/** True if the configured mysqldump exists (MYSQLDUMP_PATH) or is found on PATH. */
export async function mysqldumpAvailable() {
  const configured = process.env.MYSQLDUMP_PATH;
  const exists = async (p) => {
    try { return (await fsp.stat(p)).isFile(); } catch (_) { return false; }
  };
  if (configured) return exists(configured);
  const exts = process.platform === 'win32'
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').filter(Boolean)
    : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) {
      if (await exists(path.join(dir, 'mysqldump' + ext.toLowerCase()))) return true;
    }
  }
  return false;
}

/**
 * [{name, bytes, created, tag}] newest first. THIS IS THE DOWNLOAD/DELETE ALLOW-LIST.
 */
export async function listBackups() {
  let names;
  try {
    names = (await fsp.readdir(BACKUP_DIR)).filter((n) => NAME_RE.test(n));
  } catch (_) {
    return [];
  }
  const out = [];
  for (const name of names) {
    try {
      const stat = await fsp.stat(path.join(BACKUP_DIR, name));
      out.push({
        name,
        bytes: stat.size,
        created: stat.mtime.toISOString(),
        tag: NAME_RE.exec(name)[2] || null,
      });
    } catch (_) {
      // Vanished between readdir and stat; skip it rather than fail the listing.
    }
  }
  out.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
  return out;
}

/**
 * The full path for `name`, or null if it is not an existing backup. The request value is
 * compared against enumerated names and only joined into a path once it has matched one.
 */
export async function resolveBackup(name) {
  if (typeof name !== 'string') return null;
  const match = (await listBackups()).find((b) => b.name === name);
  return match ? path.join(BACKUP_DIR, match.name) : null;
}

/** Delete one backup. Returns false if `name` is not a listed backup. */
export async function deleteBackup(name) {
  const target = await resolveBackup(name);
  if (!target) return false;
  try {
    await fsp.unlink(target);
  } catch (err) {
    throw new BackupError('delete_failed', `Could not delete ${name}: ${err.message}`);
  }
  return true;
}

/**
 * Delete all but the newest KEEP_BACKUPS of each kind. A failure is logged, never fatal.
 * `pre-rollover` dumps and everything else are counted separately, so a run of rollovers can't
 * push out someone's manual backup (and vice versa).
 */
async function pruneBackups() {
  const removed = [];
  const all = await listBackups(); // newest first
  const isRollover = (b) => b.tag === 'pre-rollover';
  const excess = [
    ...all.filter(isRollover).slice(KEEP_BACKUPS),
    ...all.filter((b) => !isRollover(b)).slice(KEEP_BACKUPS),
  ];
  for (const entry of excess) {
    try {
      await fsp.unlink(path.join(BACKUP_DIR, entry.name));
      removed.push(entry.name);
    } catch (err) {
      // Housekeeping: failing here would report a successful dump as a failure.
      console.warn(`[backup] could not prune ${entry.name}: ${err.message}`);
    }
  }
  return removed;
}

function timestamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Write the [client] option file at 0600 under a random name; returns its path. */
async function writeCredentialFile() {
  const cnfPath = path.join(os.tmpdir(), `mtc-backup-${crypto.randomBytes(12).toString('hex')}.cnf`);
  const lines = [
    '[client]',
    `user=${cnfEscape(process.env.MYSQL_USER)}`,
    `password=${cnfEscape(process.env.MYSQL_PASSWORD)}`,
    `host=${cnfEscape(process.env.MYSQL_HOST || 'localhost')}`,
    `port=${parseInt(process.env.MYSQL_PORT || '3306', 10)}`,
    '',
  ];
  // 'wx' refuses to follow or reuse an existing path.
  const handle = await fsp.open(cnfPath, 'wx', 0o600);
  try {
    await handle.writeFile(lines.join('\n'), 'utf8');
  } finally {
    await handle.close();
  }
  return cnfPath;
}

/**
 * Take a gzipped mysqldump, then prune to KEEP_BACKUPS.
 * @param {{ tag?: string | null, userId?: string | null }} opts
 * @returns {Promise<{ name: string, bytes: number, pruned: string[], backups: object[] }>}
 * @throws {BackupError} backup_in_progress (409), mysqldump_missing, dump_failed, backup_dir_unwritable
 */
export async function createBackup({ tag = null, userId = null } = {}) {
  if (tag != null && !TAG_RE.test(tag)) {
    throw new BackupError('bad_tag', 'Backup tags may use only lowercase letters, digits and hyphens.', 400);
  }
  if (running) {
    throw new BackupError('backup_in_progress', 'A backup is already running. Try again when it finishes.', 409);
  }
  running = true;

  let cnfPath = null;
  let partial = null;
  try {
    await ensureDir();

    const suffix = tag ? `_${tag}` : '';
    let name = `makethecase_${timestamp()}${suffix}.sql.gz`;
    if (fs.existsSync(path.join(BACKUP_DIR, name))) {
      // Two backups inside one second: wait for the next second rather than overwrite.
      await new Promise((r) => setTimeout(r, 1000));
      name = `makethecase_${timestamp()}${suffix}.sql.gz`;
    }
    const target = path.join(BACKUP_DIR, name);
    // Write to .part and rename on success, so a failed or half-written dump is never listed.
    partial = `${target}.part`;

    cnfPath = await writeCredentialFile();
    const database = process.env.MYSQL_DATABASE || 'ceochat';
    const args = [
      `--defaults-extra-file=${cnfPath}`, // must be first
      '--single-transaction', // consistent InnoDB snapshot without locking writers out
      '--routines',
      '--triggers',
      '--no-tablespaces', // avoids needing the PROCESS privilege (MySQL 8.0.21+)
      '--default-character-set=utf8mb4',
      database,
    ];

    const child = spawn(mysqldumpCommand(), args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      if (stderr.length < STDERR_CAP) stderr += chunk;
    });

    const exited = new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code) => resolve(code));
    });
    // Stream, don't buffer: the dump is the whole database.
    const written = pipeline(child.stdout, zlib.createGzip(), fs.createWriteStream(partial, { mode: 0o600 }));

    const [exitResult, writeResult] = await Promise.allSettled([exited, written]);

    if (exitResult.status === 'rejected') {
      const err = exitResult.reason;
      if (err && err.code === 'ENOENT') {
        throw new BackupError(
          'mysqldump_missing',
          'mysqldump was not found on this server. Install the MySQL client tools, or set MYSQLDUMP_PATH in .env.local to its full path.'
        );
      }
      throw new BackupError('dump_failed', `Backup failed: ${err?.message || err}`);
    }
    if (exitResult.value !== 0) {
      const message = stderr.split(/\r?\n/).filter((l) => !STDERR_NOISE_RE.test(l)).join('\n').trim();
      throw new BackupError('dump_failed', `Backup failed: ${message || `mysqldump exited ${exitResult.value}`}`);
    }
    if (writeResult.status === 'rejected') {
      throw new BackupError('dump_failed', `Backup failed while writing: ${writeResult.reason?.message || writeResult.reason}`);
    }

    await fsp.rename(partial, target);
    partial = null;
    try { await fsp.chmod(target, 0o600); } catch (_) { /* Windows */ }

    const pruned = await pruneBackups();
    const { size } = await fsp.stat(target);
    console.log(`[backup] written ${name} (${size} bytes)${userId ? ` by ${userId}` : ''}`);
    return { name, bytes: size, pruned, backups: await listBackups() };
  } catch (err) {
    if (err instanceof BackupError) throw err;
    throw new BackupError('dump_failed', `Backup failed: ${err.message}`);
  } finally {
    if (cnfPath) {
      try {
        await fsp.unlink(cnfPath);
      } catch (err) {
        console.error(`[backup] could not remove credential file ${cnfPath}: ${err.message}`);
      }
    }
    if (partial) {
      try { await fsp.unlink(partial); } catch (_) { /* never created */ }
    }
    running = false;
  }
}

/**
 * "Back up first" for routes that anyone allowed to roll over can call (course owners included).
 * Takes a `pre-rollover` backup and audits it; on failure returns the refusal to send instead.
 * mysqldump's stderr is shown to admins only -- an instructor gets a generic message.
 * @returns {Promise<{ backup: { name: string, bytes: number } } | { status: number, body: object }>}
 */
export async function backupBeforeRollover(req, writeAudit) {
  try {
    const result = await createBackup({ tag: 'pre-rollover', userId: req.user?.id });
    await writeAudit(req, {
      action: 'backup.create',
      resourceType: 'backup',
      resourceId: result.name,
      details: { bytes: result.bytes, pruned: result.pruned, reason: 'pre-rollover' },
    });
    return { backup: { name: result.name, bytes: result.bytes } };
  } catch (error) {
    const code = error instanceof BackupError ? error.code : 'dump_failed';
    const status = error instanceof BackupError ? error.status : 500;
    const detail = req.user?.role === 'admin' || code === 'backup_in_progress'
      ? error.message
      : 'Ask an administrator to check Admin > Backup, or untick "Take a database backup first".';
    return {
      status,
      body: { data: null, error: { message: `Rollover not started: the database backup failed. ${detail}`, code } },
    };
  }
}

/**
 * What a backup taken now would contain: every base table with its row count and size.
 * Counts come from information_schema, an ESTIMATE for InnoDB, and are labelled as one.
 */
export async function backupContents() {
  const [rows] = await pool.query(
    `SELECT TABLE_NAME AS name, TABLE_ROWS AS table_rows, DATA_LENGTH + INDEX_LENGTH AS bytes
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME`
  );
  const tables = rows.map((r) => ({ name: r.name, rows: Number(r.table_rows || 0), bytes: Number(r.bytes || 0) }));
  return {
    tables,
    table_count: tables.length,
    total_rows: tables.reduce((s, t) => s + t.rows, 0),
    total_bytes: tables.reduce((s, t) => s + t.bytes, 0),
    estimated: true,
  };
}
