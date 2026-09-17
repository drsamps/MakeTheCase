/**
 * Issue Analytics — background execution of runs (passes 1-2) and theme re-scans (pass 3).
 *
 * There is no job queue in this app, so work runs in-process after the HTTP request that
 * created it has returned, and the client polls. Rules that matter:
 *
 * - CONCURRENCY 2. This shares one Node process with live student chat and shares the
 *   billed instructor's provider rate limits, while the chatFallback breaker protects only
 *   the student-chat path. Rate limits are retried with backoff; a sustained one stops the
 *   run ("stop and keep") rather than failing it.
 * - STOP AND KEEP. Pass 1 is cached per transcript, so a run stopped by the weekly cost cap
 *   or a rate limit keeps everything done so far, and Resume only pays for the rest.
 * - HEARTBEAT. heartbeat_at is refreshed every minute while a run is active in this
 *   process. jobs/issueAnalyticsMaintenance.js marks runs with a silent heartbeat
 *   `interrupted` (a PM2 restart otherwise leaves them `running` forever).
 * - LOCK. A MySQL advisory lock per scope stops two runs doing the same work, including
 *   across processes; the route also refuses a second active run for the same scope.
 * - Every status write is conditional on the run still being in the state this worker
 *   expects, so a reaped run that later wakes up cannot overwrite what the reaper wrote.
 */

import crypto from 'node:crypto';
import { pool } from '../../db.js';
import { generateOutlineWithLLM } from '../llmRouter.js';
import { getWeeklyUsage, UsageCostCapExceededError, UnpricedModelBlockedError } from '../usageGuard.js';
import { MissingInstructorKeyError } from '../keyResolver.js';
import {
  extractJsonObject, isRateLimit, loadPrompt, loadRunContext, nameHints,
  prepareTranscript, renderOnce, sha256, THEME_TYPES, verifyQuote,
} from './common.js';
import { parseJsonArray } from './scope.js';

const CONCURRENCY = 2;
const HEARTBEAT_MS = 60_000;
const CALL_TIMEOUT_MS = 3 * 60_000;
const RATE_LIMIT_DELAYS_MS = [5_000, 20_000, 60_000];
const MAX_CONSECUTIVE_FAILURES = 5;
const MAX_ACTIVE_JOBS = 4;

/** jobKey -> { stop: string|null } */
const active = new Map();

export function isRunActive(runId) {
  return active.has(`run:${runId}`);
}
export function isRescanActive(themeId) {
  return active.has(`rescan:${themeId}`);
}
export function hasCapacity() {
  return active.size < MAX_ACTIVE_JOBS;
}
export function requestStop(runId) {
  const job = active.get(`run:${runId}`);
  if (job) job.stop = 'Stopped by the instructor';
  return !!job;
}

class StopRun extends Error {}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function withTimeout(promise, ms) {
  let t;
  return Promise.race([
    promise.finally(() => clearTimeout(t)),
    new Promise((_, reject) => { t = setTimeout(() => reject(new Error(`No response from the model after ${ms / 1000}s`)), ms); }),
  ]);
}

export function scopeLockName(run) {
  const sections = [...parseJsonArray(run.section_ids)].sort().join(',');
  const digest = crypto.createHash('sha1').update(`${run.case_id}|${run.scenario_id ?? ''}|${sections}`).digest('hex');
  return `mtc_ia_${digest}`;
}

/**
 * Call the model with the run's billing identity. Rate limits are retried; errors that
 * would fail every remaining call (cap, missing key, unpriced model) stop the job.
 */
async function callModel({ run, vendor, prompt, sectionId, maxTokens, job }) {
  for (let attempt = 0; ; attempt++) {
    if (job.stop) throw new StopRun(job.stop);
    const usage = await getWeeklyUsage(run.billed_instructor_id);
    if (usage.capActive && usage.costUsed >= usage.cap) {
      throw new StopRun(`Weekly AI cost cap reached ($${usage.costUsed.toFixed(2)} of $${usage.cap.toFixed(2)})`);
    }
    try {
      const { text } = await withTimeout(generateOutlineWithLLM({
        modelId: run.model_id,
        vendor,
        prompt,
        config: {
          maxTokens,
          temperature: 0.2,
          purpose: 'issue_analytics',
          instructorId: run.billed_instructor_id,
          caseId: run.case_id,
          sectionId: sectionId || null,
        },
      }), CALL_TIMEOUT_MS);
      return text;
    } catch (err) {
      if (err instanceof UsageCostCapExceededError) throw new StopRun('Weekly AI cost cap reached');
      if (err instanceof UnpricedModelBlockedError || err instanceof MissingInstructorKeyError) {
        throw new StopRun(err.message);
      }
      if (isRateLimit(err)) {
        if (attempt < RATE_LIMIT_DELAYS_MS.length) {
          await sleep(RATE_LIMIT_DELAYS_MS[attempt]);
          continue;
        }
        throw new StopRun('The AI provider kept rate-limiting requests; resume later');
      }
      throw err;
    }
  }
}

function clip(s, n) {
  const t = String(s ?? '').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/** Validate pass-1 output and keep only quotes found verbatim in the student's turns. */
function cleanFacts(raw, text, turns, lean) {
  const items = Array.isArray(raw?.items) ? raw.items : [];
  const out = [];
  let rejectedQuotes = 0;
  for (const it of items.slice(0, 12)) {
    const type = String(it?.type || '').toLowerCase();
    const gist = clip(it?.gist, 300);
    if (!THEME_TYPES.includes(type) || !gist) continue;
    const quotes = [];
    for (const q of (Array.isArray(it.quotes) ? it.quotes : []).slice(0, 2)) {
      const hit = verifyQuote(text, turns, q);
      if (hit && !lean.isPositionText(hit.text)) quotes.push(hit);
      else rejectedQuotes++;
    }
    const resolved = lean.resolve(it.lean);
    out.push({ type, gist, lean: resolved.lean, position_id: resolved.position_id, quotes });
  }
  return { items: out, rejected_quotes: rejectedQuotes };
}

/** Run `worker` over `items` with bounded concurrency; a StopRun halts all workers. */
async function pool2(items, worker, job) {
  let next = 0;
  let stopErr = null;
  const lanes = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (!stopErr && !job.stop && next < items.length) {
      const item = items[next++];
      try {
        await worker(item);
      } catch (err) {
        if (err instanceof StopRun) stopErr = err;
        else throw err;
      }
    }
  });
  await Promise.all(lanes);
  if (stopErr) throw stopErr;
  if (job.stop) throw new StopRun(job.stop);
}

async function refreshCounts(runId) {
  await pool.execute(
    `UPDATE issue_analysis_runs r
        JOIN (SELECT run_id,
                     COUNT(*) AS total,
                     SUM(state = 'done') AS done,
                     SUM(state = 'skipped') AS skipped,
                     SUM(state = 'failed') AS failed
                FROM issue_analysis_run_chats WHERE run_id = ? GROUP BY run_id) c ON c.run_id = r.id
        SET r.chats_total = c.total, r.chats_done = c.done, r.chats_skipped = c.skipped,
            r.chats_failed = c.failed, r.heartbeat_at = NOW()
      WHERE r.id = ?`,
    [runId, runId]
  );
}

async function loadRun(runId) {
  const [[run]] = await pool.execute('SELECT * FROM issue_analysis_runs WHERE id = ?', [runId]);
  return run || null;
}

async function modelVendor(modelId) {
  const [[m]] = await pool.execute('SELECT vendor FROM models WHERE model_id = ?', [modelId]);
  return m?.vendor || null;
}

/** Start (or resume) a run in the background. Returns false if it is already active here. */
export function startRun(runId) {
  const key = `run:${runId}`;
  if (active.has(key)) return false;
  const job = { stop: null };
  active.set(key, job);
  executeRun(runId, job)
    .catch(err => console.error(`[issueAnalytics] run ${runId} crashed:`, err))
    .finally(() => active.delete(key));
  return true;
}

async function executeRun(runId, job) {
  const run = await loadRun(runId);
  if (!run || run.status !== 'running') return;

  const conn = await pool.getConnection();
  const lockName = scopeLockName(run);
  let locked = false;
  const heartbeat = setInterval(() => {
    pool.execute(
      "UPDATE issue_analysis_runs SET heartbeat_at = NOW() WHERE id = ? AND status IN ('running','clustering')",
      [runId]
    ).catch(() => {});
  }, HEARTBEAT_MS);

  const finish = async (status, reason) => {
    await refreshCounts(runId);
    await pool.execute(
      `UPDATE issue_analysis_runs
          SET status = ?, stop_reason = ?, completed_at = IF(? = 'completed', NOW(), completed_at)
        WHERE id = ? AND status IN ('running','clustering')`,
      [status, reason ? clip(reason, 255) : null, status, runId]
    );
  };

  try {
    const [[lock]] = await conn.query('SELECT GET_LOCK(?, 0) AS got', [lockName]);
    locked = Number(lock?.got) === 1;
    if (!locked) {
      await finish('stopped', 'Another run for the same case and sections is in progress');
      return;
    }

    const ctx = await loadRunContext(run);
    const extract = await loadPrompt('issue_analytics.extract_facts');
    const vendor = await modelVendor(run.model_id);
    // The prompt may have been edited since launch; the cache key follows the text used.
    await pool.execute('UPDATE issue_analysis_runs SET prompt_version = ?, heartbeat_at = NOW() WHERE id = ?',
      [extract.versionTag, runId]);

    const [pending] = await pool.execute(
      `SELECT rc.case_chat_id, rc.section_id, st.full_name, st.first_name, st.last_name,
              cs.protagonist AS scenario_protagonist, t.transcript
         FROM issue_analysis_run_chats rc
         JOIN case_chats cc ON cc.id = rc.case_chat_id
         JOIN students st ON st.id = rc.student_id
         LEFT JOIN case_scenarios cs ON cs.id = cc.scenario_id
         -- Newest transcript only; a duplicate row would analyse (and bill) one chat twice.
         LEFT JOIN transcripts t ON t.id = (SELECT t2.id FROM transcripts t2
                                             WHERE t2.case_chat_id = rc.case_chat_id
                                             ORDER BY t2.created_at DESC, t2.id DESC LIMIT 1)
        WHERE rc.run_id = ? AND rc.state = 'pending'
        ORDER BY rc.case_chat_id`,
      [runId]
    );

    let consecutiveFailures = 0;
    let lastError = null;
    await pool2(pending, async (chat) => {
      const setState = (state, extra = {}) => pool.execute(
        `UPDATE issue_analysis_run_chats
            SET state = ?, skip_reason = ?, transcript_hash = ?, facts_id = ?
          WHERE run_id = ? AND case_chat_id = ?`,
        [state, extra.reason ? clip(extra.reason, 255) : null, extra.hash ?? null, extra.factsId ?? null, runId, chat.case_chat_id]
      );

      const text = chat.transcript || '';
      if (!text.trim()) {
        await setState('skipped', { reason: 'No saved transcript' });
        return;
      }
      const hash = sha256(text);
      const prepared = prepareTranscript(text, nameHints(chat));
      if (prepared.error) {
        await setState('skipped', { reason: prepared.error, hash });
        return;
      }

      const [[hit]] = await pool.execute(
        `SELECT id FROM issue_analysis_chat_facts
          WHERE case_chat_id = ? AND transcript_hash = ? AND model_id = ? AND prompt_version = ?`,
        [chat.case_chat_id, hash, run.model_id, extract.versionTag]
      );
      if (hit) {
        await setState('done', { hash, factsId: hit.id });
        await refreshCounts(runId);
        return;
      }

      try {
        const prompt = renderOnce(extract.template, { ...ctx.promptVars, transcript: prepared.xml });
        const text2 = await callModel({ run, vendor, prompt, sectionId: chat.section_id, maxTokens: 8000, job });
        const facts = cleanFacts(extractJsonObject(text2), text, prepared.turns, ctx.lean);
        const [ins] = await pool.execute(
          `INSERT INTO issue_analysis_chat_facts (case_chat_id, transcript_hash, model_id, prompt_version, facts)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), facts = VALUES(facts)`,
          [chat.case_chat_id, hash, run.model_id, extract.versionTag, JSON.stringify(facts)]
        );
        await setState('done', { hash, factsId: ins.insertId });
        consecutiveFailures = 0;
      } catch (err) {
        if (err instanceof StopRun) throw err;
        consecutiveFailures++;
        lastError = err.message;
        await setState('failed', { reason: err.message, hash });
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          throw new StopRun(`${consecutiveFailures} transcripts in a row failed; last error: ${lastError}`);
        }
      }
      await refreshCounts(runId);
    }, job);

    await refreshCounts(runId);
    await cluster(run, ctx, vendor, job);
    await finish('completed', null);
  } catch (err) {
    if (err instanceof StopRun) {
      await finish('stopped', err.message);
    } else {
      console.error(`[issueAnalytics] run ${runId} failed:`, err);
      await finish('failed', err.message);
    }
  } finally {
    clearInterval(heartbeat);
    if (locked) await conn.query('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => {});
    conn.release();
  }
}

/** Pass 2: cluster the compact facts of every analysed chat into named themes. */
async function cluster(run, ctx, vendor, job) {
  const [upd] = await pool.execute(
    "UPDATE issue_analysis_runs SET status = 'clustering', heartbeat_at = NOW() WHERE id = ? AND status = 'running'",
    [run.id]
  );
  if (upd.affectedRows === 0) throw new StopRun('The run was interrupted');

  const [rows] = await pool.execute(
    `SELECT rc.case_chat_id, rc.student_id, f.facts
       FROM issue_analysis_run_chats rc
       JOIN issue_analysis_chat_facts f ON f.id = rc.facts_id
      WHERE rc.run_id = ? AND rc.state = 'done'
      ORDER BY rc.case_chat_id`,
    [run.id]
  );

  // Short keys keep the reduce prompt small: c{chat}.i{item}.
  const items = new Map();
  const lines = [];
  rows.forEach((row, ci) => {
    const facts = typeof row.facts === 'string' ? JSON.parse(row.facts) : row.facts;
    (facts?.items || []).forEach((it, ii) => {
      const key = `c${ci + 1}.i${ii + 1}`;
      items.set(key, { ...it, case_chat_id: row.case_chat_id, student_id: row.student_id });
      const gist = String(it.gist).replace(/[\r\n|]+/g, ' ');
      lines.push(`${key} | ${it.type} | ${it.lean || 'none'} | ${gist}`);
    });
  });

  await pool.execute("DELETE FROM issue_analysis_themes WHERE run_id = ? AND origin = 'ai'", [run.id]);
  if (lines.length === 0) {
    await pool.execute('UPDATE issue_analysis_runs SET theme_note = ? WHERE id = ?',
      [rows.length === 0 ? 'No transcripts could be analysed.' : 'Students raised nothing substantive enough to group.', run.id]);
    return;
  }

  const clusterPrompt = await loadPrompt('issue_analytics.cluster_themes');
  const target = run.theme_target_min === run.theme_target_max
    ? `${run.theme_target_min}`
    : `${run.theme_target_min} to ${run.theme_target_max}`;
  const prompt = renderOnce(clusterPrompt.template, {
    case_title: ctx.promptVars.case_title,
    chat_question: ctx.promptVars.chat_question,
    position_list: ctx.promptVars.position_list,
    theme_target: target,
    records: lines.join('\n'),
  });
  const text = await callModel({ run, vendor, prompt, sectionId: null, maxTokens: 16000, job });
  const parsed = extractJsonObject(text);
  const themes = Array.isArray(parsed?.themes) ? parsed.themes : [];

  let note = clip(parsed?.note, 1000) || null;
  const used = new Set();
  let order = 0;
  for (const th of themes) {
    const type = String(th?.type || '').toLowerCase();
    const label = clip(th?.label, 200);
    if (!THEME_TYPES.includes(type) || !label) continue;
    const keys = (Array.isArray(th.keys) ? th.keys : []).map(String).filter(k => items.has(k) && !used.has(k));
    if (keys.length === 0) continue;
    keys.forEach(k => used.add(k));
    const [ins] = await pool.execute(
      `INSERT INTO issue_analysis_themes (run_id, label, description, theme_type, origin, selected, sort_order)
       VALUES (?, ?, ?, ?, 'ai', 1, ?)`,
      [run.id, label, clip(th.description, 2000) || null, type, order++]
    );
    await insertMentions(run.id, ins.insertId, keys.map(k => items.get(k)));
  }
  if (order < run.theme_target_min) {
    const shortfall = `Found ${order} distinct theme${order === 1 ? '' : 's'}, fewer than the ${run.theme_target_min} requested: the transcripts did not support more without near-duplicates.`;
    note = note ? `${shortfall} ${note}` : shortfall;
  }
  await pool.execute('UPDATE issue_analysis_runs SET theme_note = ? WHERE id = ?', [note, run.id]);
}

/** One mention row per quote (or one quote-less row), per item. */
async function insertMentions(runId, themeId, list) {
  for (const it of list) {
    const quotes = it.quotes?.length ? it.quotes : [null];
    for (const q of quotes) {
      await pool.execute(
        `INSERT INTO issue_analysis_theme_mentions
           (theme_id, run_id, case_chat_id, student_id, position_id, lean, stance_summary, quote, quote_start, quote_end)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [themeId, runId, it.case_chat_id, it.student_id, it.position_id ?? null, it.lean ?? null,
         it.gist ?? null, q?.text ?? null, q?.start ?? null, q?.end ?? null]
      );
    }
  }
}

/** Pass 3: re-scan every analysed transcript for one instructor-added theme. */
export function startRescan(themeId) {
  const key = `rescan:${themeId}`;
  if (active.has(key)) return false;
  const job = { stop: null };
  active.set(key, job);
  executeRescan(themeId, job)
    .catch(err => console.error(`[issueAnalytics] rescan ${themeId} crashed:`, err))
    .finally(() => active.delete(key));
  return true;
}

async function executeRescan(themeId, job) {
  const [[theme]] = await pool.execute('SELECT * FROM issue_analysis_themes WHERE id = ?', [themeId]);
  if (!theme) return;
  const run = await loadRun(theme.run_id);
  const setTheme = (status, error = null) => pool.execute(
    'UPDATE issue_analysis_themes SET rescan_status = ?, rescan_error = ? WHERE id = ?',
    [status, error ? clip(error, 255) : null, themeId]
  );
  try {
    await pool.execute(
      "UPDATE issue_analysis_themes SET rescan_status = 'running', rescan_done = 0, rescan_error = NULL WHERE id = ?",
      [themeId]
    );
    await pool.execute('DELETE FROM issue_analysis_theme_mentions WHERE theme_id = ?', [themeId]);

    const ctx = await loadRunContext(run);
    const prompt = await loadPrompt('issue_analytics.theme_rescan');
    const vendor = await modelVendor(run.model_id);
    const [chats] = await pool.execute(
      `SELECT rc.case_chat_id, rc.student_id, rc.section_id, st.full_name, st.first_name,
              cs.protagonist AS scenario_protagonist, t.transcript
         FROM issue_analysis_run_chats rc
         JOIN case_chats cc ON cc.id = rc.case_chat_id
         JOIN students st ON st.id = rc.student_id
         LEFT JOIN case_scenarios cs ON cs.id = cc.scenario_id
         -- Newest transcript only; duplicates would re-scan one chat twice (see loadScopeChats).
         LEFT JOIN transcripts t ON t.id = (SELECT t2.id FROM transcripts t2
                                             WHERE t2.case_chat_id = rc.case_chat_id
                                             ORDER BY t2.created_at DESC, t2.id DESC LIMIT 1)
        WHERE rc.run_id = ? AND rc.state = 'done'`,
      [run.id]
    );

    let failures = 0;
    await pool2(chats, async (chat) => {
      const text = chat.transcript || '';
      const prepared = prepareTranscript(text, nameHints(chat));
      if (!prepared.error) {
        try {
          const out = await callModel({
            run, vendor, sectionId: chat.section_id, maxTokens: 4000, job,
            prompt: renderOnce(prompt.template, {
              ...ctx.promptVars,
              theme_label: theme.label,
              theme_description: theme.description || '',
              transcript: prepared.xml,
            }),
          });
          const parsed = extractJsonObject(out);
          if (parsed?.raised === true) {
            const facts = cleanFacts({ items: [{ ...parsed, type: theme.theme_type }] }, text, prepared.turns, ctx.lean);
            const item = facts.items[0];
            if (item) {
              await insertMentions(run.id, themeId, [{ ...item, case_chat_id: chat.case_chat_id, student_id: chat.student_id }]);
            }
          }
        } catch (err) {
          if (err instanceof StopRun) throw err;
          failures++;
          if (failures >= MAX_CONSECUTIVE_FAILURES) throw new StopRun(`Re-scan failed repeatedly: ${err.message}`);
        }
      }
      await pool.execute('UPDATE issue_analysis_themes SET rescan_done = rescan_done + 1 WHERE id = ?', [themeId]);
    }, job);
    await setTheme('done', failures ? `${failures} transcript(s) could not be checked` : null);
  } catch (err) {
    await setTheme('failed', err.message);
  }
}

/**
 * Mark silent work as interrupted. Called by the maintenance job; skips anything this
 * process is still running (its heartbeat timer keeps it fresh anyway).
 */
export async function reapStaleWork(silentMinutes = 10) {
  const [runs] = await pool.execute(
    `SELECT id FROM issue_analysis_runs
      WHERE status IN ('running','clustering')
        AND COALESCE(heartbeat_at, created_at) < NOW() - INTERVAL ${Number(silentMinutes)} MINUTE`
  );
  let reaped = 0;
  for (const { id } of runs) {
    if (isRunActive(id)) continue;
    const [r] = await pool.execute(
      `UPDATE issue_analysis_runs
          SET status = 'interrupted', stop_reason = 'The server stopped while this run was in progress'
        WHERE id = ? AND status IN ('running','clustering')`,
      [id]
    );
    reaped += r.affectedRows;
  }
  const [themes] = await pool.execute(
    `SELECT id FROM issue_analysis_themes
      WHERE rescan_status IN ('pending','running')
        AND updated_at < NOW() - INTERVAL ${Number(silentMinutes)} MINUTE`
  );
  for (const { id } of themes) {
    if (isRescanActive(id)) continue;
    await pool.execute(
      "UPDATE issue_analysis_themes SET rescan_status = 'failed', rescan_error = 'Interrupted; start the re-scan again' WHERE id = ?",
      [id]
    );
  }
  return reaped;
}
