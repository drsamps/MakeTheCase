/**
 * Issue Analytics housekeeping. Two timers, started by server/index.js at boot:
 *
 * 1. REAPER (every 2 minutes). Runs are executed in-process (services/issueAnalytics/
 *    runner.js). If the process dies mid-run, the row would stay `running` forever, so any
 *    run whose heartbeat has been silent for 10 minutes, and that this process is not
 *    running, becomes `interrupted` and the screen offers Resume (cheap: pass 1 is cached).
 *    Stuck theme re-scans become `failed` the same way.
 *
 * 2. RETENTION (daily, first run 60 s after boot). Runs keep student quotes and gists
 *    outside the transcript, so runs older than the `issue_analytics_retention_days` setting
 *    (default 730) are deleted with their themes and quotes (FK cascade). Pass-1 facts that
 *    no remaining run references are deleted too. Batched like pruneModelFailures.js.
 */

import { pool } from '../db.js';
import { getSetting } from '../services/promptService.js';
import { reapStaleWork } from '../services/issueAnalytics/runner.js';

const REAP_INTERVAL_MS = 2 * 60 * 1000;
const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RETENTION_INITIAL_DELAY_MS = 60 * 1000;
const DEFAULT_RETENTION_DAYS = 730;
const BATCH_LIMIT = 500;

let reapTimer = null;
let retentionTimer = null;
let lastRetentionRun = null;

export function getIssueAnalyticsCleanupStatus() {
  return { lastRetentionRun };
}

export async function runIssueAnalyticsRetention() {
  let days = DEFAULT_RETENTION_DAYS;
  try {
    const raw = await getSetting('issue_analytics_retention_days');
    const n = parseInt(raw, 10);
    if (Number.isInteger(n) && n > 0) days = n;
  } catch { /* keep default */ }

  const cutoff = new Date(Date.now() - days * 86_400_000);
  let runs = 0;
  let facts = 0;
  try {
    while (true) {
      // LIMIT inlined: mysql2 prepared statements reject a placeholder there.
      const [r] = await pool.execute(
        `DELETE FROM issue_analysis_runs
          WHERE created_at < ? AND status NOT IN ('running','clustering') LIMIT ${BATCH_LIMIT}`,
        [cutoff]
      );
      runs += r.affectedRows || 0;
      if ((r.affectedRows || 0) < BATCH_LIMIT) break;
    }
    // Multi-table DELETE takes no LIMIT; the orphaned-and-expired set is small.
    const [f] = await pool.execute(
      `DELETE f FROM issue_analysis_chat_facts f
         LEFT JOIN issue_analysis_run_chats rc ON rc.facts_id = f.id
        WHERE rc.facts_id IS NULL AND f.created_at < ?`,
      [cutoff]
    );
    facts = f.affectedRows || 0;
    lastRetentionRun = { at: new Date().toISOString(), days, runs, facts, error: null };
    if (runs || facts) {
      console.log(`[issueAnalytics] retention: deleted ${runs} run(s) and ${facts} cached extraction(s) older than ${days} days`);
    }
  } catch (err) {
    lastRetentionRun = { at: new Date().toISOString(), days, runs, facts, error: err.message };
    console.error('[issueAnalytics] retention failed:', err.message);
  }
  return lastRetentionRun;
}

export function startIssueAnalyticsMaintenance() {
  if (!reapTimer) {
    reapTimer = setInterval(() => {
      reapStaleWork().catch(err => console.error('[issueAnalytics] reaper failed:', err.message));
    }, REAP_INTERVAL_MS);
  }
  if (!retentionTimer) {
    retentionTimer = setTimeout(function tick() {
      runIssueAnalyticsRetention().finally(() => {
        retentionTimer = setTimeout(tick, RETENTION_INTERVAL_MS);
      });
    }, RETENTION_INITIAL_DELAY_MS);
  }
}

export function stopIssueAnalyticsMaintenance() {
  if (reapTimer) clearInterval(reapTimer);
  if (retentionTimer) clearTimeout(retentionTimer);
  reapTimer = null;
  retentionTimer = null;
}
