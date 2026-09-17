/**
 * Issue Analytics — read models: the run view (themes, prevalence, position lean, quotes),
 * the staleness check, transcript excerpts and the CSV export.
 *
 * NAMES. Quotes are anonymous unless the caller passes names=true. With names off, a
 * student is "Student N" (stable within a run) and their name is masked inside quote and
 * transcript text. The CSV follows the same switch and then has no student_id or name
 * column at all, because that file leaves the platform.
 */

import { pool } from '../../db.js';
import { FALLBACK_LEANS, maskNames, sha256 } from './common.js';
import { instructorName, parseJsonArray } from './scope.js';
import { parseTranscript } from '../../../utils/transcriptFormat.js';

/**
 * Re-check the analysed transcripts against their current text. Keyed off CONTENT, never
 * transcripts.is_anonymized: that flag is set without touching the text by bulk-anonymize,
 * and real rewrites can arrive through the plain upsert with no flag.
 */
export async function checkStaleness(run) {
  if (run.status !== 'completed') return run.stale_reason || null;
  const [rows] = await pool.execute(
    `SELECT rc.transcript_hash, t.transcript
       FROM issue_analysis_run_chats rc
       LEFT JOIN transcripts t ON t.id = (SELECT t2.id FROM transcripts t2
                                           WHERE t2.case_chat_id = rc.case_chat_id
                                           ORDER BY t2.created_at DESC, t2.id DESC LIMIT 1)
      WHERE rc.run_id = ? AND rc.state = 'done'`,
    [run.id]
  );
  let reason = null;
  if (rows.length < run.chats_done) reason = 'chat_removed';
  else if (rows.some(r => sha256(r.transcript || '') !== r.transcript_hash)) reason = 'transcript_changed';
  if (reason !== (run.stale_reason || null)) {
    await pool.execute('UPDATE issue_analysis_runs SET stale_reason = ? WHERE id = ?', [reason, run.id]);
  }
  return reason;
}

async function studentLabels(runId) {
  const [rows] = await pool.execute(
    `SELECT rc.case_chat_id, rc.student_id, rc.section_id, st.full_name, st.first_name, st.last_name
       FROM issue_analysis_run_chats rc
       JOIN students st ON st.id = rc.student_id
      WHERE rc.run_id = ?
      ORDER BY rc.case_chat_id`,
    [runId]
  );
  const byChat = new Map();
  rows.forEach((r, i) => byChat.set(r.case_chat_id, { ...r, anon: `Student ${i + 1}` }));
  return byChat;
}

export async function runSummary(run) {
  const [[meta]] = await pool.execute(
    `SELECT c.case_title, cs.scenario_name, sem.semester_name, sem.semester_code
       FROM cases c
       LEFT JOIN case_scenarios cs ON cs.id = ?
       LEFT JOIN semesters sem ON sem.id = ?
      WHERE c.case_id = ?`,
    [run.scenario_id, run.semester_id, run.case_id]
  );
  // The run's own sections decide its semester label, so history can be compared across
  // semesters even when the launcher picked sections rather than a semester.
  const sectionIds = parseJsonArray(run.section_ids);
  const [semRows] = sectionIds.length
    ? await pool.execute(
        `SELECT DISTINCT sem.semester_name, sem.start_date
           FROM sections s JOIN semesters sem ON sem.id = s.semester_id
          WHERE s.section_id IN (${sectionIds.map(() => '?').join(',')})
          ORDER BY sem.start_date`,
        sectionIds
      )
    : [[]];
  const [[themeCount]] = await pool.execute(
    'SELECT COUNT(*) AS n FROM issue_analysis_themes WHERE run_id = ?',
    [run.id]
  );
  return {
    id: run.id,
    case_id: run.case_id,
    case_title: meta?.case_title || run.case_id,
    scenario_id: run.scenario_id,
    scenario_name: meta?.scenario_name || null,
    section_ids: sectionIds,
    semester_id: run.semester_id,
    semester_label: semRows.map(r => r.semester_name).join(' + ') || meta?.semester_name || null,
    status: run.status,
    stop_reason: run.stop_reason,
    stale_reason: run.stale_reason,
    model_id: run.model_id,
    theme_target_min: run.theme_target_min,
    theme_target_max: run.theme_target_max,
    chats_completed_in_scope: run.chats_completed_in_scope,
    chats_total: run.chats_total,
    chats_done: run.chats_done,
    chats_skipped: run.chats_skipped,
    chats_failed: run.chats_failed,
    sample_size: run.sample_size ?? null,
    sample_seed: run.sample_seed ?? null,
    sample_pool: run.sample_pool ?? null,
    est_cost_usd: run.est_cost_usd == null ? null : Number(run.est_cost_usd),
    billed_instructor_id: run.billed_instructor_id,
    theme_count: Number(themeCount?.n || 0),
    theme_note: run.theme_note,
    created_by_user_id: run.created_by_user_id,
    created_at: run.created_at,
    completed_at: run.completed_at,
  };
}

/** The full run view. */
export async function buildRunView(run, { names = false } = {}) {
  const summary = await runSummary(run);
  summary.stale_reason = await checkStaleness(run);
  summary.billed_instructor_name = await instructorName(run.billed_instructor_id);

  const [positions] = run.scenario_id
    ? await pool.execute(
        `SELECT position_id, position_name, position FROM scenario_positions
          WHERE scenario_id = ? AND position_enabled = TRUE ORDER BY position_order, position_id`,
        [run.scenario_id]
      )
    : [[]];
  const axis = positions.length > 0
    ? { mode: 'positions', leans: positions.map(p => ({ key: p.position_name, label: p.position_name, detail: p.position })) }
    : { mode: 'fallback', leans: FALLBACK_LEANS.map(k => ({ key: k, label: `leans ${k === 'mixed' ? 'mixed' : k}`, detail: null })) };

  const students = await studentLabels(run.id);
  const [themes] = await pool.execute(
    'SELECT * FROM issue_analysis_themes WHERE run_id = ? ORDER BY sort_order, id',
    [run.id]
  );
  const [mentions] = await pool.execute(
    `SELECT id, theme_id, case_chat_id, student_id, lean, stance_summary, quote, quote_start, quote_end
       FROM issue_analysis_theme_mentions WHERE run_id = ? ORDER BY theme_id, case_chat_id, id`,
    [run.id]
  );
  const [skips] = await pool.execute(
    `SELECT state, skip_reason, COUNT(*) AS n FROM issue_analysis_run_chats
      WHERE run_id = ? AND state IN ('skipped','failed') GROUP BY state, skip_reason`,
    [run.id]
  );

  const analyzed = run.chats_done || 0;
  const themeViews = themes.map(th => {
    const own = mentions.filter(m => m.theme_id === th.id);
    // One lean per student: the first mention that has one.
    const leanByChat = new Map();
    for (const m of own) {
      if (!leanByChat.has(m.case_chat_id)) leanByChat.set(m.case_chat_id, null);
      if (m.lean && leanByChat.get(m.case_chat_id) === null) leanByChat.set(m.case_chat_id, m.lean);
    }
    const studentCount = leanByChat.size;
    const lean = {};
    for (const l of axis.leans) lean[l.key] = 0;
    let noLean = 0;
    for (const v of leanByChat.values()) {
      if (v && Object.prototype.hasOwnProperty.call(lean, v)) lean[v]++;
      else noLean++;
    }

    const quotes = own.filter(m => m.quote).map(m => {
      const s = students.get(m.case_chat_id);
      return {
        mention_id: m.id,
        case_chat_id: m.case_chat_id,
        student: names ? (s?.full_name || s?.anon) : s?.anon,
        section_id: s?.section_id || null,
        lean: m.lean,
        gist: names ? m.stance_summary : maskNames(m.stance_summary, s),
        quote: names ? m.quote : maskNames(m.quote, s),
        quote_start: m.quote_start,
        quote_end: m.quote_end,
      };
    });

    return {
      id: th.id,
      label: th.label,
      description: th.description,
      theme_type: th.theme_type,
      origin: th.origin,
      selected: !!th.selected,
      sort_order: th.sort_order,
      rescan_status: th.rescan_status,
      rescan_done: th.rescan_done,
      rescan_error: th.rescan_error,
      students: studentCount,
      prevalence_pct: analyzed > 0 ? Number((studentCount / analyzed * 100).toFixed(1)) : null,
      lean,
      no_lean: noLean,
      quotes,
    };
  });

  return {
    run: summary,
    axis,
    themes: themeViews,
    skipped: skips.map(r => ({ state: r.state, reason: r.skip_reason, count: Number(r.n) })),
    names,
  };
}

/**
 * A transcript as display segments, with the quoted span highlighted. Names are masked
 * per segment (after offsets are applied, so masking cannot shift the highlight).
 */
export async function transcriptView(run, caseChatId, { names = false, start = null, end = null } = {}) {
  const students = await studentLabels(run.id);
  const s = students.get(caseChatId);
  if (!s) return null;
  const [[row]] = await pool.execute(
    `SELECT t.transcript, cs.protagonist AS scenario_protagonist, rc.transcript_hash
       FROM case_chats cc
       JOIN issue_analysis_run_chats rc ON rc.case_chat_id = cc.id AND rc.run_id = ?
       LEFT JOIN transcripts t ON t.id = (SELECT t2.id FROM transcripts t2
                                           WHERE t2.case_chat_id = cc.id
                                           ORDER BY t2.created_at DESC, t2.id DESC LIMIT 1)
       LEFT JOIN case_scenarios cs ON cs.id = cc.scenario_id
      WHERE cc.id = ?`,
    [run.id, caseChatId]
  );
  const text = row?.transcript || '';
  const parsed = parseTranscript(text, {
    studentNames: [s.full_name, s.first_name].filter(Boolean),
    protagonistNames: [row?.scenario_protagonist].filter(Boolean),
  });
  const hlStart = Number.isInteger(start) ? start : null;
  const hlEnd = Number.isInteger(end) ? end : null;
  const mask = (t) => (names ? t : maskNames(t, s));

  const turns = (parsed.turns.length ? parsed.turns : [{ role: 'unknown', start: 0, end: text.length }]).map(t => {
    const pieces = [];
    const a = hlStart != null && hlEnd != null ? Math.max(t.start, hlStart) : null;
    const b = hlStart != null && hlEnd != null ? Math.min(t.end, hlEnd) : null;
    if (a != null && b != null && a < b) {
      pieces.push({ text: mask(text.slice(t.start, a)), highlight: false });
      pieces.push({ text: mask(text.slice(a, b)), highlight: true });
      pieces.push({ text: mask(text.slice(b, t.end)), highlight: false });
    } else {
      pieces.push({ text: mask(text.slice(t.start, t.end)), highlight: false });
    }
    return {
      role: t.role,
      speaker: t.role === 'student' ? (names ? s.full_name : s.anon) : t.role === 'protagonist' ? (row?.scenario_protagonist || 'Protagonist') : '',
      pieces: pieces.filter(p => p.text),
    };
  });
  return {
    student: names ? s.full_name : s.anon,
    // Offsets point into the text that was analysed; a rewrite makes the highlight unreliable.
    changed_since_analysis: !!row?.transcript_hash && sha256(text) !== row.transcript_hash,
    turns,
  };
}

function csvCell(v) {
  if (v == null) return '';
  // Quotes and gists are student-authored and this file is meant to leave the platform. Excel and
  // Sheets evaluate a cell starting with = + - @ (or a control char) *after* unquoting it, so the
  // RFC-4180 quoting below is no defence; prefix an apostrophe to keep it text.
  const raw = String(v);
  const s = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV of quotes for the selected themes. Names off = no identifying columns at all. */
export async function quotesCsv(run, { names = false } = {}) {
  const view = await buildRunView(run, { names });
  const header = names
    ? ['theme', 'theme_type', 'student_id', 'student_name', 'section_id', 'lean', 'point', 'quote']
    : ['theme', 'theme_type', 'student', 'section_id', 'lean', 'point', 'quote'];
  const students = names ? await studentLabels(run.id) : null;
  const lines = [header.join(',')];
  for (const th of view.themes.filter(t => t.selected)) {
    for (const q of th.quotes) {
      const row = names
        ? [th.label, th.theme_type, students.get(q.case_chat_id)?.student_id, q.student, q.section_id, q.lean, q.gist, q.quote]
        : [th.label, th.theme_type, q.student, q.section_id, q.lean, q.gist, q.quote];
      lines.push(row.map(csvCell).join(','));
    }
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}
