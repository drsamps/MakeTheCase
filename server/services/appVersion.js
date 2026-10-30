/**
 * This server's version, for people and for activity packages.
 *
 * app version    `version` in package.json. Bump it on each production deploy
 *                (deployment/HOW_TO_DEPLOY.md). It is written into packages as
 *                `exported_from.app_version` and is used only to word messages; whether a
 *                package can be installed is decided by services/activityPack/capabilities.js.
 * schema level   the highest numbered migration recorded in schema_migrations (86 for
 *                086_...). Null when the tracking table does not exist.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../db.js';

const PROJECT_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let appVersion = null;

export function getAppVersion() {
  if (appVersion === null) {
    try {
      appVersion = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8')).version || 'unknown';
    } catch {
      appVersion = 'unknown';
    }
  }
  return appVersion;
}

export async function getSchemaLevel(executor = pool) {
  try {
    const [rows] = await executor.execute('SELECT filename FROM schema_migrations');
    const levels = rows
      .map((r) => /^(\d{3})_/.exec(r.filename))
      .filter(Boolean)
      .map((m) => Number(m[1]));
    return levels.length > 0 ? Math.max(...levels) : null;
  } catch {
    return null;
  }
}
