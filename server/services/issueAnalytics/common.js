/**
 * Issue Analytics — shared helpers: prompt rendering, transcript preparation, quote
 * verification, lean mapping and name masking. See docs/issue-analytics.md.
 */

import crypto from 'node:crypto';
import { jsonrepair } from 'jsonrepair';
import { pool } from '../../db.js';
import { getActivePrompt } from '../promptService.js';
import { parseTranscript } from '../../../utils/transcriptFormat.js';

export const FALLBACK_LEANS = ['for', 'against', 'mixed'];
export const THEME_TYPES = ['topic', 'argument', 'friction'];

export function sha256(text) {
  return crypto.createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex');
}

/**
 * Load the active prompt for `use` plus a version tag that changes whenever its text does,
 * so editing a prompt in Admin > Prompts invalidates the pass-1 cache.
 */
export async function loadPrompt(use) {
  const row = await getActivePrompt(use);
  const tag = `${row.version}@${sha256(row.prompt_template).slice(0, 12)}`;
  return { template: row.prompt_template, versionTag: tag };
}

/**
 * Render {placeholders} in ONE pass. promptService.renderPrompt() substitutes variables one
 * after another, so a transcript containing "{position_list}" would itself be expanded by a
 * later substitution; here each placeholder is resolved against the template only.
 */
export function renderOnce(template, vars) {
  return template.replace(/\{([a-z_]+)\}/g, (whole, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key] ?? '') : whole);
}

/** Parse the JSON object a model returned, tolerating fences and minor syntax damage. */
export function extractJsonObject(text) {
  if (!text) throw new Error('The model returned an empty response');
  let candidate = String(text).trim();
  const fence = candidate.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) candidate = fence[1].trim();
  const first = candidate.indexOf('{');
  const last = candidate.lastIndexOf('}');
  if (first !== -1 && last > first) candidate = candidate.slice(first, last + 1);
  try {
    return JSON.parse(candidate);
  } catch (strictErr) {
    try {
      return JSON.parse(jsonrepair(candidate));
    } catch {
      throw new Error(`The model did not return valid JSON (${strictErr.message})`);
    }
  }
}

// Tag names the transcript is wrapped in. Content that tries to open or close one is
// defanged so a student cannot end their turn early and write "instructions".
const TAG_RE = /<(\/?)\s*(student_turn|protagonist_turn|transcript)\b/gi;
function defangTags(s) {
  return s.replace(TAG_RE, '‹$1$2');
}

/** Candidate names for legacy transcripts ("Jane Doe: ...", "Sylvia Cooper: ..."). */
export function nameHints(chat) {
  const studentNames = [chat.full_name, chat.first_name].filter(Boolean);
  const protagonistNames = [chat.scenario_protagonist].filter(Boolean);
  return { studentNames, protagonistNames };
}

/**
 * Split a transcript into turns and render it for a prompt. Returns null when student
 * turns cannot be told apart from the character's, or when the student said nothing.
 */
export function prepareTranscript(text, hints) {
  const parsed = parseTranscript(text, hints);
  if (parsed.format === 'unknown') {
    return { error: 'Could not tell the student turns apart from the character turns' };
  }
  const studentChars = parsed.turns
    .filter(t => t.role === 'student')
    .reduce((n, t) => n + (t.end - t.start), 0);
  if (studentChars < 20) return { error: 'The student wrote almost nothing' };

  const xml = parsed.turns.map(t => {
    const tag = t.role === 'student' ? 'student_turn' : 'protagonist_turn';
    return `<${tag}>\n${defangTags(text.slice(t.start, t.end))}\n</${tag}>`;
  }).join('\n');
  return { turns: parsed.turns, xml };
}

/**
 * Normalise for quote matching: collapse whitespace, straighten quotes and dashes,
 * lower-case. Returns the normalised string and, for each of its characters, the index
 * of the source character it came from.
 */
function normalizeWithMap(src) {
  let out = '';
  const map = [];
  let prevSpace = false;
  for (let i = 0; i < src.length; i++) {
    let ch = src[i];
    if (/\s/.test(ch)) {
      if (prevSpace) continue;
      ch = ' ';
      prevSpace = true;
    } else {
      prevSpace = false;
      if (ch === '‘' || ch === '’') ch = "'";
      else if (ch === '“' || ch === '”') ch = '"';
      else if (ch === '–' || ch === '—') ch = '-';
      ch = ch.toLowerCase();
    }
    out += ch;
    map.push(i);
  }
  return { out, map };
}

/**
 * Find `quote` verbatim (modulo whitespace, quote style and case) inside a STUDENT turn of
 * `text`. Returns the exact source slice and its offsets, or null. A quote that is not in
 * the student's own words is rejected; this also catches fabricated quotes.
 */
export function verifyQuote(text, turns, quote) {
  const q = normalizeWithMap(String(quote ?? '').trim()).out.trim();
  if (q.length < 8) return null;
  for (const turn of turns) {
    if (turn.role !== 'student') continue;
    const { out, map } = normalizeWithMap(text.slice(turn.start, turn.end));
    const at = out.indexOf(q);
    if (at === -1) continue;
    const start = turn.start + map[at];
    const end = turn.start + map[at + q.length - 1] + 1;
    return { text: text.slice(start, end), start, end };
  }
  return null;
}

/**
 * The position axis for a scenario. With positions, a lean is one of their names; without,
 * the fallback for / against / mixed relative to the question.
 */
export function leanContext(positions, scenario = null) {
  // Picking a position posts its full wording as the student's message. That text is the
  // instructor's, not the student's, so it is never kept as a quote.
  const positionTexts = positions
    .map(p => normalizeWithMap(p.position || '').out.trim())
    .filter(t => t.length >= 8);
  const isPositionText = (quote) => {
    const q = normalizeWithMap(String(quote ?? '')).out.trim();
    return q.length > 0 && positionTexts.some(t => t.includes(q) || q.includes(t));
  };
  if (positions.length > 0) {
    return {
      mode: 'positions',
      isPositionText,
      position_list: positions
        .map(p => `- ${p.position_name}: ${p.position}`)
        .join('\n'),
      lean_instructions:
        'the name (before the colon) of the position in <positions> this point pushes toward, or "none" if it does not favour one',
      resolve(lean) {
        const v = String(lean ?? '').trim().toLowerCase();
        const hit = positions.find(p => p.position_name.toLowerCase() === v);
        return hit ? { lean: hit.position_name, position_id: hit.position_id } : { lean: null, position_id: null };
      },
    };
  }
  return {
    mode: 'fallback',
    isPositionText,
    position_list: [
      '(This scenario defines no positions. Judge lean relative to the question the students answered.)',
      scenario?.arguments_for ? `Arguments for taking the action:\n${scenario.arguments_for}` : '',
      scenario?.arguments_against ? `Arguments against taking the action:\n${scenario.arguments_against}` : '',
    ].filter(Boolean).join('\n\n'),
    lean_instructions:
      '"for" if the point supports taking the action the question asks about, "against" if it opposes it, "mixed" if it cuts both ways, or "none"',
    resolve(lean) {
      const v = String(lean ?? '').trim().toLowerCase();
      return FALLBACK_LEANS.includes(v) ? { lean: v, position_id: null } : { lean: null, position_id: null };
    },
  };
}

/** Case, scenario and positions for a run, in the shape the prompts need. */
export async function loadRunContext(run) {
  const [[caseRow]] = await pool.execute(
    'SELECT case_id, case_title FROM cases WHERE case_id = ?',
    [run.case_id]
  );
  let scenario = null;
  if (run.scenario_id) {
    const [[row]] = await pool.execute(
      `SELECT id, scenario_name, protagonist, protagonist_role, chat_question, arguments_for, arguments_against
         FROM case_scenarios WHERE id = ?`,
      [run.scenario_id]
    );
    scenario = row || null;
  }
  const [positions] = scenario
    ? await pool.execute(
        `SELECT position_id, position_name, position FROM scenario_positions
          WHERE scenario_id = ? AND position_enabled = TRUE ORDER BY position_order, position_id`,
        [scenario.id]
      )
    : [[]];
  const lean = leanContext(positions, scenario);
  const scenarioText = scenario
    ? `${scenario.scenario_name || 'Scenario'}. The AI played ${scenario.protagonist || 'the protagonist'}${scenario.protagonist_role ? `, ${scenario.protagonist_role}` : ''}.`
    : 'The AI played the case protagonist.';
  return {
    caseRow,
    scenario,
    positions,
    lean,
    promptVars: {
      case_title: caseRow?.case_title || run.case_id,
      scenario: scenarioText,
      chat_question: scenario?.chat_question || '(not recorded)',
      position_list: lean.position_list,
      lean_instructions: lean.lean_instructions,
    },
  };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Hide a student's name inside text. Used whenever "Show names" is off, including in the
 * CSV, which leaves the platform.
 */
export function maskNames(text, student) {
  if (!text) return text;
  const parts = new Set();
  for (const n of [student?.full_name, student?.first_name, student?.last_name]) {
    if (!n) continue;
    const s = String(n).trim();
    if (s.length >= 2) parts.add(s);
    for (const w of s.split(/\s+/)) if (w.length >= 3) parts.add(w);
  }
  if (parts.size === 0) return text;
  const re = new RegExp(`\\b(?:${[...parts].sort((a, b) => b.length - a.length).map(escapeRe).join('|')})\\b`, 'gi');
  return String(text).replace(re, '[name]');
}

/** A provider rate limit, by status or message (mirrors chatFallback.classifyError). */
export function isRateLimit(err) {
  const status = err?.status ?? err?.statusCode ?? err?.response?.status;
  if (status === 429) return true;
  return /\b429\b|rate.?limit|too many requests|RESOURCE_EXHAUSTED/i.test(err?.message || '');
}
