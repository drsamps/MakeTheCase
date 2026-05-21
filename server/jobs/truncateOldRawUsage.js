/**
 * Daily job: truncate raw_usage JSON blobs older than 90 days.
 *
 * Why: the raw provider usage payload is kept verbatim so we can recompute
 * costs if pricing changes and so we can inspect prompt/output token splits
 * during debugging. After 90 days it has no further analytical value but the
 * JSON column is large (often several KB per row). Setting it to NULL keeps
 * the row (and its est_cost_usd) intact for historical reporting while
 * reclaiming the bulk of the storage.
 *
 * Scheduling: started by server/index.js at boot. Runs every 24h, with the
 * first run kicked off 30 seconds after boot so it doesn't compete with
 * startup work but still catches up if the server has been down for days.
 *
 * Failure mode: errors are logged and swallowed. The job retries on the next
 * tick — there's no urgency since the column simply stays populated until
 * the next successful run.
 */

import { pool } from '../db.js';

const RETENTION_DAYS = 90;
const INTERVAL_MS = 24 * 60 * 60 * 1000;
const INITIAL_DELAY_MS = 30 * 1000;
const BATCH_LIMIT = 5000;

let timer = null;

export async function runTruncateOldRawUsage() {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000);
  let totalCleared = 0;
  try {
    // Loop in batches to avoid a single huge UPDATE locking the table.
    while (true) {
      const [result] = await pool.execute(
        `UPDATE model_usage
            SET raw_usage = NULL
          WHERE raw_usage IS NOT NULL
            AND created_at < ?
          LIMIT ?`,
        [cutoff, BATCH_LIMIT]
      );
      const affected = result.affectedRows || 0;
      totalCleared += affected;
      if (affected < BATCH_LIMIT) break;
    }
    if (totalCleared > 0) {
      console.log(`[truncateOldRawUsage] cleared raw_usage on ${totalCleared} rows older than ${cutoff.toISOString()}`);
    }
  } catch (err) {
    console.error('[truncateOldRawUsage] failed:', err.message);
  }
}

export function startTruncateOldRawUsageJob() {
  if (timer) return;
  timer = setTimeout(function tick() {
    runTruncateOldRawUsage().finally(() => {
      timer = setTimeout(tick, INTERVAL_MS);
    });
  }, INITIAL_DELAY_MS);
}

export function stopTruncateOldRawUsageJob() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
