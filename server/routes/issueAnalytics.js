/**
 * /api/issue-analytics — Results > Issue Analytics. Design: docs/issue-analytics.md.
 *
 * Access: admins and instructors (the same gate as the rest of Results), section-scoped via
 * the caller's accessible sections. A run is visible only to callers who can see EVERY
 * section in it (services/issueAnalytics/scope.js#assertCanViewRun).
 */

import express from 'express';
import { pool } from '../db.js';
import { verifyToken } from '../middleware/auth.js';
import { requireAdminOrInstructor } from '../middleware/instructorAccess.js';
import { writeAudit } from '../services/auditLog.js';
import { getActivePrompt } from '../services/promptService.js';
import {
  HttpError, assertCanViewRun, parseJsonArray, planRescan, planRun, resolveScopedSectionIds,
} from '../services/issueAnalytics/scope.js';
import {
  hasCapacity, isRescanActive, isRunActive, requestStop, scopeLockName, startRescan, startRun,
} from '../services/issueAnalytics/runner.js';
import { buildRunView, quotesCsv, runSummary, transcriptView } from '../services/issueAnalytics/view.js';
import { THEME_TYPES } from '../services/issueAnalytics/common.js';

const router = express.Router();
router.use(verifyToken, requireAdminOrInstructor);

const ACTIVE = ['running', 'clustering'];

function send(res, err) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ data: null, error: { message: err.message } });
  }
  console.error('[issueAnalytics]', err);
  return res.status(500).json({ data: null, error: { message: err.message } });
}

const truthy = (v) => v === true || v === 'true' || v === '1' || v === 1;

async function loadRunFor(req, id) {
  const [[run]] = await pool.execute('SELECT * FROM issue_analysis_runs WHERE id = ?', [parseInt(id, 10) || 0]);
  if (!run) throw new HttpError(404, 'Run not found');
  await assertCanViewRun(req, run);
  return run;
}

async function loadThemeFor(run, themeId) {
  const [[theme]] = await pool.execute(
    'SELECT * FROM issue_analysis_themes WHERE id = ? AND run_id = ?',
    [parseInt(themeId, 10) || 0, run.id]
  );
  if (!theme) throw new HttpError(404, 'Theme not found');
  return theme;
}

function parseTargets(body) {
  const min = parseInt(body.theme_target_min ?? 6, 10);
  const max = parseInt(body.theme_target_max ?? 12, 10);
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max > 30 || min > max) {
    throw new HttpError(400, 'Themes to find must be a range between 1 and 30');
  }
  return { min, max };
}

/** GET /estimate?case_id=&scenario_id=&section_ids=&semester_id=&model_id=&sample_size=&sample_seed= */
router.get('/estimate', async (req, res) => {
  try {
    const plan = await planRun(req, req.query);
    res.json({ data: plan.summary, error: null });
  } catch (err) {
    send(res, err);
  }
});

/** GET /prompt-preview — the active pass-1 template (placeholders unfilled). */
router.get('/prompt-preview', async (req, res) => {
  try {
    const row = await getActivePrompt('issue_analytics.extract_facts');
    res.json({ data: { use: row.use, version: row.version, template: row.prompt_template }, error: null });
  } catch (err) {
    send(res, err);
  }
});

/** GET /runs?case_id=&scenario_id= — history the caller can see, newest first. */
router.get('/runs', async (req, res) => {
  try {
    const params = [];
    let sql = 'SELECT * FROM issue_analysis_runs WHERE 1=1';
    if (req.query.case_id) {
      sql += ' AND case_id = ?';
      params.push(String(req.query.case_id));
    }
    if (req.query.scenario_id) {
      sql += ' AND scenario_id = ?';
      params.push(parseInt(req.query.scenario_id, 10) || 0);
    }
    sql += ' ORDER BY created_at DESC LIMIT 200';
    const [rows] = await pool.execute(sql, params);
    const scoped = await resolveScopedSectionIds(req);
    const allowed = scoped === null ? null : new Set(scoped);
    const visible = rows.filter(r => allowed === null || parseJsonArray(r.section_ids).every(id => allowed.has(id)));
    const data = [];
    for (const r of visible) data.push({ ...(await runSummary(r)), active_here: isRunActive(r.id) });
    res.json({ data, error: null });
  } catch (err) {
    send(res, err);
  }
});

/** POST /runs — plan, pre-flight the cost, create the run and start it in the background. */
router.post('/runs', async (req, res) => {
  try {
    const targets = parseTargets(req.body);
    const plan = await planRun(req, req.body);
    const s = plan.summary;

    if (s.chats_total - s.chats_skipped === 0) {
      throw new HttpError(400, 'No completed chat in this scope has a usable transcript');
    }
    // Pre-flight: refuse when the estimate would push the billed instructor past the cap.
    if (s.exceeds_cap) {
      throw new HttpError(409,
        `Estimated cost $${s.est_cost_usd.toFixed(2)} exceeds the $${s.cap_remaining_usd.toFixed(2)} left this week on ${s.billed_instructor_name || 'the billed instructor'}'s AI budget`);
    }
    if (!truthy(req.body.confirmed)) {
      throw new HttpError(400, 'Confirm the estimate before starting a run');
    }
    if (!hasCapacity()) {
      throw new HttpError(429, 'The server is busy with other analyses; try again in a few minutes');
    }

    const lockProbe = { case_id: s.case_id, scenario_id: s.scenario_id, section_ids: s.section_ids };
    const [activeRuns] = await pool.execute(
      `SELECT id, case_id, section_ids, scenario_id FROM issue_analysis_runs
        WHERE case_id = ? AND status IN ('running','clustering')`,
      [s.case_id]
    );
    if (activeRuns.some(r => scopeLockName(r) === scopeLockName(lockProbe))) {
      throw new HttpError(409, 'A run for this case and these sections is already in progress');
    }

    const conn = await pool.getConnection();
    let runId;
    try {
      await conn.beginTransaction();
      const [ins] = await conn.execute(
        `INSERT INTO issue_analysis_runs
           (case_id, scenario_id, section_ids, semester_id, statuses, theme_target_min, theme_target_max,
            model_id, prompt_version, status, chats_completed_in_scope, chats_total, chats_skipped,
            sample_size, sample_seed, sample_pool,
            est_cost_usd, billed_instructor_id, heartbeat_at, created_by_user_id, created_by_role)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)`,
        [s.case_id, s.scenario_id, JSON.stringify(s.section_ids), plan.scope.semesterId,
         JSON.stringify(plan.scope.statuses), targets.min, targets.max,
         plan.model.model_id, plan.extractVersion,
         s.chats_completed, s.chats_total, s.chats_skipped,
         plan.sample.size, plan.sample.seed, plan.sample.pool,
         s.est_cost_usd, plan.billedInstructorId, req.user.id, req.user.role]
      );
      runId = ins.insertId;
      for (const p of plan.planned) {
        await conn.execute(
          `INSERT INTO issue_analysis_run_chats (run_id, case_chat_id, student_id, section_id, state, skip_reason, transcript_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [runId, p.chat.case_chat_id, p.chat.student_id, p.chat.section_id, p.state, p.skip_reason, p.hash]
        );
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    writeAudit(req, {
      action: 'issue_analytics.run_start', resourceType: 'issue_analysis_run', resourceId: String(runId),
      details: {
        case_id: s.case_id, sections: s.section_ids.length, est_cost_usd: s.est_cost_usd,
        billed: plan.billedInstructorId, sample_size: plan.sample.size,
      },
    });
    startRun(runId);
    const [[run]] = await pool.execute('SELECT * FROM issue_analysis_runs WHERE id = ?', [runId]);
    res.status(201).json({ data: await runSummary(run), error: null });
  } catch (err) {
    send(res, err);
  }
});

/** GET /runs/:id/status — lightweight, for polling. */
router.get('/runs/:id/status', async (req, res) => {
  try {
    const run = await loadRunFor(req, req.params.id);
    const [themes] = await pool.execute(
      'SELECT id, rescan_status, rescan_done, rescan_error FROM issue_analysis_themes WHERE run_id = ? AND rescan_status <> \'none\'',
      [run.id]
    );
    res.json({
      data: {
        id: run.id, status: run.status, stop_reason: run.stop_reason,
        chats_total: run.chats_total, chats_done: run.chats_done,
        chats_skipped: run.chats_skipped, chats_failed: run.chats_failed,
        heartbeat_at: run.heartbeat_at, rescans: themes,
      },
      error: null,
    });
  } catch (err) {
    send(res, err);
  }
});

/** GET /runs/:id?names=1 */
router.get('/runs/:id', async (req, res) => {
  try {
    const run = await loadRunFor(req, req.params.id);
    res.json({ data: await buildRunView(run, { names: truthy(req.query.names) }), error: null });
  } catch (err) {
    send(res, err);
  }
});

/** POST /runs/:id/resume — retry pending and failed transcripts; cached ones cost nothing. */
router.post('/runs/:id/resume', async (req, res) => {
  try {
    const run = await loadRunFor(req, req.params.id);
    if (!['stopped', 'interrupted', 'failed'].includes(run.status)) {
      throw new HttpError(400, `A ${run.status} run cannot be resumed`);
    }
    if (isRunActive(run.id)) throw new HttpError(409, 'This run is still finishing; try again shortly');
    if (!hasCapacity()) throw new HttpError(429, 'The server is busy with other analyses; try again in a few minutes');
    await pool.execute(
      "UPDATE issue_analysis_run_chats SET state = 'pending', skip_reason = NULL WHERE run_id = ? AND state = 'failed'",
      [run.id]
    );
    await pool.execute(
      "UPDATE issue_analysis_runs SET status = 'running', stop_reason = NULL, heartbeat_at = NOW() WHERE id = ?",
      [run.id]
    );
    writeAudit(req, { action: 'issue_analytics.run_resume', resourceType: 'issue_analysis_run', resourceId: String(run.id) });
    startRun(run.id);
    res.json({ data: { id: run.id, status: 'running' }, error: null });
  } catch (err) {
    send(res, err);
  }
});

/** POST /runs/:id/stop — stop after the calls in flight; progress is kept. */
router.post('/runs/:id/stop', async (req, res) => {
  try {
    const run = await loadRunFor(req, req.params.id);
    if (!ACTIVE.includes(run.status)) throw new HttpError(400, 'This run is not running');
    if (!requestStop(run.id)) {
      // Not running in this process (e.g. after a restart): mark it so Resume is offered.
      await pool.execute(
        "UPDATE issue_analysis_runs SET status = 'interrupted', stop_reason = 'Stopped by the instructor' WHERE id = ? AND status IN ('running','clustering')",
        [run.id]
      );
    }
    res.json({ data: { id: run.id }, error: null });
  } catch (err) {
    send(res, err);
  }
});

/** DELETE /runs/:id — the launcher or an admin. Removes its themes and quotes. */
router.delete('/runs/:id', async (req, res) => {
  try {
    const run = await loadRunFor(req, req.params.id);
    if (req.user.role !== 'admin' && run.created_by_user_id !== req.user.id) {
      throw new HttpError(403, 'Only the instructor who started this run (or an admin) can delete it');
    }
    if (isRunActive(run.id)) throw new HttpError(409, 'Stop the run before deleting it');
    await pool.execute('DELETE FROM issue_analysis_runs WHERE id = ?', [run.id]);
    writeAudit(req, { action: 'issue_analytics.run_delete', resourceType: 'issue_analysis_run', resourceId: String(run.id) });
    res.json({ data: { id: run.id }, error: null });
  } catch (err) {
    send(res, err);
  }
});

/** GET /runs/:id/transcript/:caseChatId?names=&start=&end= */
router.get('/runs/:id/transcript/:caseChatId', async (req, res) => {
  try {
    const run = await loadRunFor(req, req.params.id);
    const start = req.query.start != null ? parseInt(req.query.start, 10) : null;
    const end = req.query.end != null ? parseInt(req.query.end, 10) : null;
    const view = await transcriptView(run, req.params.caseChatId, { names: truthy(req.query.names), start, end });
    if (!view) throw new HttpError(404, 'That chat is not part of this run');
    res.json({ data: view, error: null });
  } catch (err) {
    send(res, err);
  }
});

/** GET /runs/:id/quotes.csv?names= — selected themes only. */
router.get('/runs/:id/quotes.csv', async (req, res) => {
  try {
    const run = await loadRunFor(req, req.params.id);
    const names = truthy(req.query.names);
    const csv = await quotesCsv(run, { names });
    writeAudit(req, {
      action: 'issue_analytics.export_csv', resourceType: 'issue_analysis_run', resourceId: String(run.id),
      details: { names },
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="issue-analytics-${run.case_id}-run${run.id}${run.sample_size ? `-sample${run.sample_size}` : ''}${names ? '-named' : ''}.csv"`);
    res.send(csv);
  } catch (err) {
    send(res, err);
  }
});

// ---- Curation -----------------------------------------------------------------------

function assertCurable(run) {
  if (run.status !== 'completed') throw new HttpError(400, 'Themes can be edited once the run has completed');
}

/** PATCH /runs/:id/themes/:themeId  { label?, description?, selected?, theme_type? } */
router.patch('/runs/:id/themes/:themeId', async (req, res) => {
  try {
    const run = await loadRunFor(req, req.params.id);
    assertCurable(run);
    const theme = await loadThemeFor(run, req.params.themeId);
    const sets = [];
    const params = [];
    if (req.body.label !== undefined) {
      const label = String(req.body.label).trim().slice(0, 200);
      if (!label) throw new HttpError(400, 'A theme needs a name');
      sets.push('label = ?');
      params.push(label);
    }
    if (req.body.description !== undefined) {
      sets.push('description = ?');
      params.push(String(req.body.description ?? '').slice(0, 2000) || null);
    }
    if (req.body.selected !== undefined) {
      sets.push('selected = ?');
      params.push(truthy(req.body.selected) ? 1 : 0);
    }
    if (req.body.theme_type !== undefined) {
      if (!THEME_TYPES.includes(req.body.theme_type)) throw new HttpError(400, 'Unknown theme type');
      sets.push('theme_type = ?');
      params.push(req.body.theme_type);
    }
    if (sets.length === 0) throw new HttpError(400, 'Nothing to change');
    await pool.execute(`UPDATE issue_analysis_themes SET ${sets.join(', ')} WHERE id = ?`, [...params, theme.id]);
    res.json({ data: { id: theme.id }, error: null });
  } catch (err) {
    send(res, err);
  }
});

/** PUT /runs/:id/themes/order  { ids: [..] } */
router.put('/runs/:id/themes/order', async (req, res) => {
  try {
    const run = await loadRunFor(req, req.params.id);
    assertCurable(run);
    const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(n => parseInt(n, 10)).filter(Number.isInteger);
    for (let i = 0; i < ids.length; i++) {
      await pool.execute('UPDATE issue_analysis_themes SET sort_order = ? WHERE id = ? AND run_id = ?', [i, ids[i], run.id]);
    }
    res.json({ data: { count: ids.length }, error: null });
  } catch (err) {
    send(res, err);
  }
});

/** POST /runs/:id/themes/merge  { target_id, source_ids: [..], label? } */
router.post('/runs/:id/themes/merge', async (req, res) => {
  try {
    const run = await loadRunFor(req, req.params.id);
    assertCurable(run);
    const target = await loadThemeFor(run, req.body.target_id);
    const sources = [];
    for (const sid of Array.isArray(req.body.source_ids) ? req.body.source_ids : []) {
      const t = await loadThemeFor(run, sid);
      if (t.id !== target.id) sources.push(t);
    }
    if (sources.length === 0) throw new HttpError(400, 'Pick at least one other theme to merge');
    if ([target, ...sources].some(t => isRescanActive(t.id))) {
      throw new HttpError(409, 'Wait for the re-scan to finish before merging');
    }
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const ids = sources.map(t => t.id);
      await conn.execute(
        `UPDATE issue_analysis_theme_mentions SET theme_id = ? WHERE theme_id IN (${ids.map(() => '?').join(',')})`,
        [target.id, ...ids]
      );
      await conn.execute(`DELETE FROM issue_analysis_themes WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
      if (req.body.label) {
        await conn.execute('UPDATE issue_analysis_themes SET label = ? WHERE id = ?',
          [String(req.body.label).trim().slice(0, 200), target.id]);
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
    res.json({ data: { id: target.id, merged: sources.length }, error: null });
  } catch (err) {
    send(res, err);
  }
});

/** DELETE /runs/:id/themes/:themeId */
router.delete('/runs/:id/themes/:themeId', async (req, res) => {
  try {
    const run = await loadRunFor(req, req.params.id);
    assertCurable(run);
    const theme = await loadThemeFor(run, req.params.themeId);
    if (isRescanActive(theme.id)) throw new HttpError(409, 'Wait for the re-scan to finish');
    await pool.execute('DELETE FROM issue_analysis_themes WHERE id = ?', [theme.id]);
    res.json({ data: { id: theme.id }, error: null });
  } catch (err) {
    send(res, err);
  }
});

/**
 * POST /runs/:id/themes  { label, description?, theme_type }
 * Adds an instructor theme (no students yet) and returns what re-scanning for it would cost.
 */
router.post('/runs/:id/themes', async (req, res) => {
  try {
    const run = await loadRunFor(req, req.params.id);
    assertCurable(run);
    const label = String(req.body.label || '').trim().slice(0, 200);
    if (!label) throw new HttpError(400, 'A theme needs a name');
    const type = THEME_TYPES.includes(req.body.theme_type) ? req.body.theme_type : 'topic';
    const [[max]] = await pool.execute('SELECT COALESCE(MAX(sort_order), -1) AS m FROM issue_analysis_themes WHERE run_id = ?', [run.id]);
    const [ins] = await pool.execute(
      `INSERT INTO issue_analysis_themes (run_id, label, description, theme_type, origin, selected, sort_order)
       VALUES (?, ?, ?, ?, 'instructor', 1, ?)`,
      [run.id, label, String(req.body.description || '').slice(0, 2000) || null, type, Number(max.m) + 1]
    );
    res.status(201).json({ data: { id: ins.insertId, rescan_estimate: await planRescan(run) }, error: null });
  } catch (err) {
    send(res, err);
  }
});

/** GET /runs/:id/themes/:themeId/rescan-estimate */
router.get('/runs/:id/themes/:themeId/rescan-estimate', async (req, res) => {
  try {
    const run = await loadRunFor(req, req.params.id);
    await loadThemeFor(run, req.params.themeId);
    res.json({ data: await planRescan(run), error: null });
  } catch (err) {
    send(res, err);
  }
});

/** POST /runs/:id/themes/:themeId/rescan  { confirmed: true } */
router.post('/runs/:id/themes/:themeId/rescan', async (req, res) => {
  try {
    const run = await loadRunFor(req, req.params.id);
    assertCurable(run);
    const theme = await loadThemeFor(run, req.params.themeId);
    if (theme.origin !== 'instructor') {
      throw new HttpError(400, 'Only themes you added are re-scanned; AI themes already have their students');
    }
    if (isRescanActive(theme.id)) throw new HttpError(409, 'This theme is already being re-scanned');
    const estimate = await planRescan(run);
    if (estimate.exceeds_cap) {
      throw new HttpError(409, `Estimated cost $${estimate.est_cost_usd.toFixed(2)} exceeds what is left of this week's AI budget`);
    }
    if (!truthy(req.body.confirmed)) throw new HttpError(400, 'Confirm the estimate before re-scanning');
    if (!hasCapacity()) throw new HttpError(429, 'The server is busy with other analyses; try again in a few minutes');
    await pool.execute("UPDATE issue_analysis_themes SET rescan_status = 'pending', rescan_done = 0 WHERE id = ?", [theme.id]);
    writeAudit(req, {
      action: 'issue_analytics.theme_rescan', resourceType: 'issue_analysis_run', resourceId: String(run.id),
      details: { theme_id: theme.id, est_cost_usd: estimate.est_cost_usd },
    });
    startRescan(theme.id);
    res.json({ data: { id: theme.id, chats: estimate.chats }, error: null });
  } catch (err) {
    send(res, err);
  }
});

export default router;
