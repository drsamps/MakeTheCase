/**
 * Daily job: delete model_failures rows older than 90 days.
 *
 * Why: model_failures (migration 079, written by services/chatFallback.js) only feeds the
 * "Chat model failures" table in Monitor > AI Usage, whose longest period is the last 90 days.
 * Older rows are never shown, so they are deleted rather than kept. The table stays in database
 * backups -- with this job it holds at most a few MB.
 *
 * Reporting: the result of the last run is kept in memory and returned by GET /api/usage
 * (modelFailuresCleanup), where the AI Usage panel shows it under the failures table. It resets
 * when the server restarts, but the first run happens 30 seconds after boot.
 *
 * Scheduling and failure mode match truncateOldRawUsage.js: started by server/index.js at boot,
 * every 24h, batched so one DELETE never holds a long lock; errors are logged, recorded in the
 * status, and retried on the next tick.
 */

import { pool } from '../db.js';

export const MODEL_FAILURES_RETENTION_DAYS = 90;
const INTERVAL_MS = 24 * 60 * 60 * 1000;
const INITIAL_DELAY_MS = 30 * 1000;
const BATCH_LIMIT = 5000;

let timer = null;
/** @type {{ at: string, deleted: number, cutoff: string, error: string | null } | null} */
let lastRun = null;

export function getModelFailuresCleanupStatus() {
  return { retentionDays: MODEL_FAILURES_RETENTION_DAYS, lastRun };
}

export async function runPruneModelFailures() {
  const cutoff = new Date(Date.now() - MODEL_FAILURES_RETENTION_DAYS * 86_400_000);
  let deleted = 0;
  try {
    while (true) {
      // LIMIT is inlined: mysql2 prepared statements reject a placeholder there
      // ("Incorrect arguments to mysqld_stmt_execute"). BATCH_LIMIT is a trusted integer constant.
      const [result] = await pool.execute(
        `DELETE FROM model_failures WHERE created_at < ? LIMIT ${BATCH_LIMIT}`,
        [cutoff]
      );
      const affected = result.affectedRows || 0;
      deleted += affected;
      if (affected < BATCH_LIMIT) break;
    }
    lastRun = { at: new Date().toISOString(), deleted, cutoff: cutoff.toISOString(), error: null };
    if (deleted > 0) {
      console.log(`[pruneModelFailures] deleted ${deleted} model_failures rows older than ${cutoff.toISOString()}`);
    }
  } catch (err) {
    lastRun = { at: new Date().toISOString(), deleted, cutoff: cutoff.toISOString(), error: err.message };
    console.error('[pruneModelFailures] failed:', err.message);
  }
  return lastRun;
}

export function startPruneModelFailuresJob() {
  if (timer) return;
  timer = setTimeout(function tick() {
    runPruneModelFailures().finally(() => {
      timer = setTimeout(tick, INTERVAL_MS);
    });
  }, INITIAL_DELAY_MS);
}

export function stopPruneModelFailuresJob() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
