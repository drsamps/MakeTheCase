import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { jsonrepair } from 'jsonrepair';
import { pool } from '../db.js';
import { verifyToken } from '../middleware/auth.js';
import { requireAdminOrInstructor } from '../middleware/instructorAccess.js';
import { getActivePrompt, renderPrompt } from '../services/promptService.js';
import { generateOutlineWithLLM } from '../services/llmRouter.js';
import { logCaseWriterPrompt } from '../services/promptLogger.js';
import { getEffectiveInstructorId, buildVisibilityScope, canAccessResource, hasAdminVision } from '../services/resourceAccess.js';
import { setVisibility } from '../services/visibilityWrites.js';
import { markdownToDocxBuffer, markdownToPdfBuffer } from '../services/markdownExport.js';
import { convertFile } from '../services/fileConverter.js';
import { fetchUrlAsText } from '../services/urlFetcher.js';
import { detectOutline, mergeRanges } from '../services/referenceOutline.js';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CASE_FILES_DIR = path.join(__dirname, '..', '..', 'case_files');

const router = express.Router();

// ----------------------------------------------------------------------------
// LLM helpers
// ----------------------------------------------------------------------------

// Wrap generateOutlineWithLLM so every case-writer call threads the caller's
// instructor identity (so per-instructor API keys actually fire) plus the
// project context that model_usage tracking writes to the row.
async function callOutline(req, params) {
  const instructorId = getEffectiveInstructorId(req);
  // All case-writer LLM call sites are scoped to /projects/:id; lift the
  // project id off the route so model_usage rows carry it automatically.
  const projectId = (params.config && params.config.projectId) || params.projectId || req.params?.id || null;
  return generateOutlineWithLLM({
    ...params,
    config: {
      ...(params.config || {}),
      instructorId,
      purpose: (params.config && params.config.purpose) || 'case_writer',
      projectId,
    }
  });
}

async function resolveModel(requestedModelId, projectDefaultModelId) {
  const candidate = requestedModelId || projectDefaultModelId || null;
  if (candidate) {
    const [rows] = await pool.execute(
      'SELECT model_id, vendor, temperature, reasoning_effort FROM models WHERE model_id = ? AND enabled = 1',
      [candidate]
    );
    if (rows.length === 0) {
      throw new Error(`Model not found or disabled: ${candidate}`);
    }
    return rows[0];
  }
  const [rows] = await pool.execute(
    'SELECT model_id, vendor, temperature, reasoning_effort FROM models WHERE enabled = 1 ORDER BY model_id LIMIT 1'
  );
  if (rows.length === 0) {
    throw new Error('No enabled model available');
  }
  return rows[0];
}

function extractJsonObject(text) {
  if (!text) throw new Error('LLM returned empty response');
  let candidate = text.trim();
  const fence = candidate.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) candidate = fence[1].trim();
  const first = candidate.indexOf('{');
  const last = candidate.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    candidate = candidate.slice(first, last + 1);
  }
  try {
    return JSON.parse(candidate);
  } catch (strictErr) {
    try {
      return JSON.parse(jsonrepair(candidate));
    } catch (_repairErr) {
      throw strictErr;
    }
  }
}

// Strip an optional surrounding ```markdown / ``` fence the model sometimes adds
// despite being told not to. Leaves internal code blocks alone.
function stripMarkdownFence(text) {
  if (!text) return '';
  const trimmed = text.trim();
  const fence = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  return fence ? fence[1].trim() : trimmed;
}

// Optional per-Generate-call log. The admin opts in via a checkbox in the
// PromptInfoButton modal ("Log this prompt with data"); the client sends
// `log_this_prompt: true` in the body. We swallow logger errors so a logging
// failure never breaks the Generate response.
async function maybeLogCaseWriterPrompt(req, params) {
  try {
    if (req.body?.log_this_prompt !== true) return;
    if (req.user?.role !== 'admin') return;
    const projectId = req.params?.id || null;
    let projectTitle = null;
    try {
      const [rows] = await pool.execute(
        'SELECT title FROM case_writer_projects WHERE project_id = ?',
        [projectId]
      );
      if (rows.length > 0) projectTitle = rows[0].title || null;
    } catch { /* non-fatal */ }
    await logCaseWriterPrompt({ projectId, projectTitle, ...params });
  } catch (err) {
    console.warn('[caseWriter] log this prompt failed:', err?.message);
  }
}

async function recordRevision(projectId, step, snapshot, userId) {
  await pool.execute(
    `INSERT INTO case_writer_revisions (project_id, step, snapshot, created_by) VALUES (?, ?, ?, ?)`,
    [projectId, step, JSON.stringify(snapshot), userId || null]
  );
}

// Caps on how much reference text reaches the model. A single 1.5 MB PDF can
// extract to several hundred thousand characters, and {source_materials} is
// rebuilt on every one of the six generate calls, so an uncapped build would
// blow past provider context windows mid-generation.
const REFERENCE_TEXT_CHAR_CAP = 60000;
const SOURCE_MATERIALS_TOTAL_CHAR_CAP = 150000;

// Mirrors the ENUM on case_writer_references.use_mode (migration 067).
const REFERENCE_USE_MODES = ['full_text', 'summary', 'summary_and_full_text'];

function formatCount(n) {
  return Number(n).toLocaleString('en-US');
}

// Trim `text` to whatever is left of the shared budget, appending a visible
// marker when anything was dropped. Returns the trimmed text and the number of
// characters consumed so the caller can decrement the running budget.
function capReferenceText(text, remainingBudget) {
  const full = String(text || '');
  const limit = Math.max(0, Math.min(REFERENCE_TEXT_CHAR_CAP, remainingBudget));
  if (full.length <= limit) return { text: full, used: full.length };
  if (limit === 0) {
    // The shared budget is spent. Say the material exists but was dropped —
    // "showing first 0 of N characters" reads as a bug, and silence would hide
    // from the instructor that an approved reference contributed nothing.
    return {
      text: `[omitted — ${formatCount(full.length)} characters, exceeds the source material budget]`,
      used: 0
    };
  }
  const kept = full.slice(0, limit);
  return {
    text: `${kept}\n\n[truncated — showing first ${formatCount(limit)} of ${formatCount(full.length)} characters]`,
    used: limit
  };
}

// Shape-check a client-supplied `selection` before it reaches the JSON column.
// Offsets drive slicing of stored document text, so they must be sane integers;
// resolveSelectionRanges() additionally verifies them against the content hash
// at read time. Returns an error string, or null when the value is acceptable.
function validateSelection(value) {
  if (value == null) return null;                       // explicit clear
  if (typeof value !== 'object' || Array.isArray(value)) {
    return 'selection must be an object like {sections:[], excerpts:[]}';
  }
  const { sections, excerpts } = value;
  if (sections !== undefined) {
    if (!Array.isArray(sections) || sections.some(s => typeof s !== 'string')) {
      return 'selection.sections must be an array of section ids';
    }
    if (sections.length > 5000) return 'selection.sections is too large';
  }
  if (excerpts !== undefined) {
    if (!Array.isArray(excerpts)) return 'selection.excerpts must be an array';
    if (excerpts.length > 500) return 'selection.excerpts is too large';
    for (const e of excerpts) {
      if (!e || typeof e !== 'object') return 'each excerpt must be an object';
      if (!Number.isInteger(e.start) || !Number.isInteger(e.end)) {
        return 'excerpt start/end must be integers';
      }
      if (e.start < 0 || e.end <= e.start) return 'excerpt range is invalid';
      if (e.label !== undefined && typeof e.label !== 'string') {
        return 'excerpt label must be a string';
      }
    }
  }
  return null;
}

// Steps that can carry their own source-material selection. Mirrors the
// generate routes; 'scenarios' is included here even though TWEAK_STEPS omits
// it, because /generate/scenarios also consumes {source_materials}.
const SELECTION_STEPS = ['brief', 'scenarios', 'blueprint', 'student_case', 'teaching_note'];

// {step: selection} — each value follows the same shape as `selection`.
function validateSelectionOverrides(value) {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    return 'selection_overrides must be an object keyed by step';
  }
  for (const [step, sel] of Object.entries(value)) {
    if (!SELECTION_STEPS.includes(step)) {
      return `unknown step "${step}"; expected one of: ${SELECTION_STEPS.join(', ')}`;
    }
    const err = validateSelection(sel);
    if (err) return `${step}: ${err}`;
  }
  return null;
}

function contentHash(text) {
  return crypto.createHash('md5').update(String(text || ''), 'utf8').digest('hex');
}

/**
 * Replace the bulky `outline` / `selection` JSON on a reference row with a few
 * scalars the Source Material list actually needs. A chunked 400k-char document
 * has a large outline; multiplied by every reference on a project it is not
 * something to ship on every list call.
 */
function withSelectionSummary(row) {
  const outline = parseJsonColumn(row.outline);
  const selection = parseJsonColumn(row.selection);
  const sections = outline?.sections || [];
  const selectedIds = new Set(Array.isArray(selection?.sections) ? selection.sections : []);
  const excerpts = Array.isArray(selection?.excerpts) ? selection.excerpts : [];

  const selectedChars =
    sections.filter(s => selectedIds.has(s.id)).reduce((n, s) => n + (s.chars || 0), 0)
    + excerpts.reduce((n, e) => n + Math.max(0, (e.end || 0) - (e.start || 0)), 0);

  const overrides = parseJsonColumn(row.selection_overrides) || {};

  // Internal bookkeeping columns stay server-side; the client gets the derived
  // booleans and counts below instead.
  const {
    outline: _outline, selection: _selection, selection_overrides: _ov,
    summary_scope_hash: _ssh, outline_hash: _oh,
    ...rest
  } = row;
  return {
    ...rest,
    // True when a summary exists but was built from a different portion of the
    // document than the current selection — it will not be sent until
    // re-summarized, and the UI says so rather than dropping it silently.
    summary_stale: !!row.content_summary && !summaryMatchesScope(row, null),
    outline_strategy: outline?.strategy || null,
    section_count: sections.length,
    selected_section_count: selectedIds.size,
    excerpt_count: excerpts.length,
    // 0 with no selection means "whole document"; the client checks the counts.
    selected_chars: selectedChars,
    // Which steps deviate from the default selection, so the UI can flag them
    // at the point of generation rather than burying them in a modal.
    override_steps: Object.keys(overrides)
  };
}

// The column list every route that returns a reference row selects. `content` is
// deliberately absent — the list routes send CHAR_LENGTH instead, and the body goes
// to the browser from exactly one route (GET .../references/:refId/content).
const REFERENCE_ROW_COLUMNS = `
  reference_id, project_id, type, title, content_summary, summary_scope_hash, use_mode,
  CHAR_LENGTH(content) AS content_length, outline, outline_hash, selection, selection_overrides,
  approved_by_user, source_notes, link_url,
  fetched_at, fetched_content_type, fetched_final_url,
  upload_original_name,
  case_file_id, created_at, updated_at`;

function parseJsonColumn(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;   // mysql2 already parsed the JSON column
  try { return JSON.parse(value); } catch { return null; }
}

// Build (or rebuild) the cached outline for a reference. Called on every write
// that changes `content`, because the offsets in `selection` are only valid for
// the exact text they were computed against.
async function refreshReferenceOutline(referenceId, text, format) {
  const src = String(text || '');
  // Per-step overrides hold the same kind of offsets as `selection`, so they
  // are cleared alongside it — leaving one behind would silently apply stale
  // ranges to a single step, which is far harder to notice than a full reset.
  if (!src.trim()) {
    await pool.execute(
      `UPDATE case_writer_references
          SET outline = NULL, outline_hash = NULL, selection = NULL, selection_overrides = NULL
       WHERE reference_id = ?`,
      [referenceId]
    );
    return null;
  }
  const outline = detectOutline(src, format);
  await pool.execute(
    `UPDATE case_writer_references
        SET outline = ?, outline_hash = ?, selection = NULL, selection_overrides = NULL
     WHERE reference_id = ?`,
    [JSON.stringify(outline), contentHash(src), referenceId]
  );
  return outline;
}

/**
 * Resolve a reference's stored selection into concrete character ranges.
 *
 * Returns null when the whole document should be used — which covers "nothing
 * selected yet" and, deliberately, "the document changed since the selection
 * was made". Slicing at offsets that no longer line up with the text would feed
 * the model confident-looking garbage, so a hash mismatch degrades to the
 * migration-067 behavior instead.
 */
// The selection in effect for a step: a per-step override wins over the
// reference's default, and an absent override key means "no opinion for this
// step", not "select nothing".
function effectiveSelection(row, step) {
  const overrides = parseJsonColumn(row.selection_overrides);
  if (step && overrides && Object.prototype.hasOwnProperty.call(overrides, step)) {
    return overrides[step];
  }
  return parseJsonColumn(row.selection);
}

/**
 * Stable key identifying WHICH portion of a reference a given step will use.
 *
 * Stored on the row when a summary is generated (`summary_scope_hash`) and
 * recomputed at read time, so a summary is only used when it describes the same
 * text the selection would send. Deliberately derived from the selection and
 * `outline_hash` rather than from the document body, so it can be computed on
 * the list routes, which never load `content`.
 *
 * Must stay in sync with the backfill in migration 071.
 */
function selectionScopeKey(row, step) {
  const sel = effectiveSelection(row, step);
  const ids = Array.isArray(sel?.sections) ? [...sel.sections].sort() : [];
  const ex = Array.isArray(sel?.excerpts)
    ? sel.excerpts.map(e => `${e.start}-${e.end}`).sort()
    : [];
  if (ids.length === 0 && ex.length === 0) {
    return contentHash(`whole:${row.outline_hash || ''}`);
  }
  return contentHash(JSON.stringify({ h: row.outline_hash || '', ids, ex }));
}

/** True when the stored summary describes the text this step would send. */
function summaryMatchesScope(row, step) {
  if (!row.content_summary) return false;
  if (!row.summary_scope_hash) return false;
  return row.summary_scope_hash === selectionScopeKey(row, step);
}

function resolveSelectionRanges(row, fullText, step) {
  const selection = effectiveSelection(row, step);
  if (!selection) return null;

  const sectionIds = Array.isArray(selection.sections) ? selection.sections : [];
  const excerpts = Array.isArray(selection.excerpts) ? selection.excerpts : [];
  if (sectionIds.length === 0 && excerpts.length === 0) return null;

  if (!row.outline_hash || row.outline_hash !== contentHash(fullText)) return null;

  const outline = parseJsonColumn(row.outline);
  const byId = new Map((outline?.sections || []).map(s => [s.id, s]));

  const ranges = [];
  for (const id of sectionIds) {
    const s = byId.get(id);
    if (s) ranges.push({ start: s.start, end: s.end, title: s.title });
  }
  for (const e of excerpts) {
    ranges.push({ start: e.start, end: e.end, title: e.label || 'excerpt' });
  }

  const merged = mergeRanges(ranges);
  return merged.length > 0 ? merged : null;
}

// Stitch selected ranges into one body, marking the gaps so the model knows it
// is reading excerpts rather than a continuous document.
function assembleSelectedText(fullText, ranges) {
  const parts = [];
  let prevEnd = null;
  for (const r of ranges) {
    if (prevEnd !== null && r.start > prevEnd) parts.push('[…]');
    parts.push(fullText.slice(r.start, r.end).trim());
    prevEnd = r.end;
  }
  if (prevEnd !== null && prevEnd < fullText.length) parts.push('[…]');
  return parts.filter(Boolean).join('\n\n');
}

// Render the instructor-approved AI summary for a reference. Handles both the
// {summary, key_facts} JSON shape written by the summarize route and legacy
// plain-string values. Returns '' when there is no summary yet.
function formatReferenceSummary(contentSummary) {
  if (!contentSummary) return '';
  try {
    const parsed = JSON.parse(contentSummary);
    const facts = Array.isArray(parsed?.key_facts) ? parsed.key_facts : [];
    return [
      parsed?.summary || '',
      facts.length ? '\nKey facts:\n' + facts.map(f => `- ${f}`).join('\n') : ''
    ].filter(Boolean).join('\n');
  } catch {
    return String(contentSummary);
  }
}

// Build the {source_materials} variable from approved references on this project.
// Returns an empty string if there are no approved references, so prompts can
// gracefully handle the "no source material" case.
//
// Each reference contributes according to its `use_mode`. The one invariant
// that must not be broken: a reference never emits a header with no body. That
// is precisely the bug this function used to have — it read only
// `content_summary`, so an approved reference that had never been summarized
// reached the model as a title line and nothing else.
export async function loadSourceMaterials(projectId, step) {
  const [rows] = await pool.execute(
    `SELECT r.reference_id, r.type, r.title, r.content, r.content_summary, r.summary_scope_hash,
            r.use_mode, r.outline, r.outline_hash, r.selection, r.selection_overrides,
            r.source_notes, r.link_url
     FROM case_writer_references r
     WHERE r.project_id = ? AND r.approved_by_user = 1
     ORDER BY r.created_at ASC`,
    [projectId]
  );
  if (rows.length === 0) return '';

  let remaining = SOURCE_MATERIALS_TOTAL_CHAR_CAP;
  const blocks = [];

  for (const r of rows) {
    const storedText = String(r.content || '');
    // Honour the instructor's section/excerpt picks. Falls back to the whole
    // document when nothing is selected or the text has changed underneath the
    // stored offsets.
    const ranges = resolveSelectionRanges(r, storedText, step);
    const fullText = (ranges ? assembleSelectedText(storedText, ranges) : storedText).trim();
    const mode = r.use_mode || 'full_text';

    // The summary is only usable when it was built from the same portion of the
    // document this step is about to send. Otherwise it describes text we are
    // not using — a whole-document summary sitting above three selected
    // chapters is two scopes presented as one source.
    const scopeOk = summaryMatchesScope(r, step);
    const summaryText = scopeOk ? formatReferenceSummary(r.content_summary) : '';

    const parts = [];
    let wantsFullText = mode === 'full_text' || mode === 'summary_and_full_text';

    if (mode === 'summary' || mode === 'summary_and_full_text') {
      if (summaryText) {
        parts.push(summaryText);
      } else if (mode === 'summary') {
        // No usable summary. Send the selected text rather than an empty block,
        // and say which case this is so the output is self-explanatory.
        parts.push(r.content_summary
          ? '_(summary is out of date with the current selection — using the selected text)_'
          : '_(not summarized yet — using the selected text)_');
        wantsFullText = true;
      }
    }

    if (wantsFullText && fullText) {
      const { text, used } = capReferenceText(fullText, remaining);
      remaining -= used;
      if (text) parts.push(parts.length ? `--- Full text ---\n${text}` : text);
    }

    // Links carry no body of their own; the URL is the content.
    if (parts.length === 0 && r.link_url) parts.push(`URL: ${r.link_url}`);
    if (parts.length === 0) continue;

    // A link added without a title stores NULL so that a later fetch can adopt
    // the page's own <title>. Until that happens the URL is the only name this
    // source has — mirrors displayTitle() in components/caseWriter/referenceDisplay.tsx.
    const heading = r.title?.trim()
      || (r.type === 'link' && r.link_url ? `URL: ${r.link_url}` : '(untitled)');

    blocks.push(
      `### Source: ${heading} (${r.type})`
      + (r.source_notes ? `\nNotes: ${r.source_notes}` : '')
      + `\n\n${parts.join('\n\n')}`
    );
  }

  return blocks.join('\n\n---\n\n');
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

const PROJECT_COLUMNS = [
  'project_id', 'owner_id', 'owner_type', 'title', 'status',
  'visibility', 'created_by_type',
  'teaching_principle', 'audience', 'course_context', 'difficulty', 'case_type',
  'industries_preference', 'industry',
  'learning_brief', 'scenario_options', 'selected_scenario', 'case_blueprint',
  'student_case', 'teaching_note',
  'publish_protagonist', 'publish_chat_question',
  'publish_arguments_for', 'publish_arguments_against',
  'default_model_id',
  'published_case_id', 'created_at', 'updated_at'
];

const PATCHABLE_FIELDS = new Set([
  'title', 'status', 'teaching_principle', 'audience', 'course_context',
  'difficulty', 'case_type', 'industries_preference',
  'learning_brief', 'scenario_options',
  'selected_scenario', 'case_blueprint', 'student_case', 'teaching_note',
  'publish_protagonist', 'publish_chat_question',
  'publish_arguments_for', 'publish_arguments_against',
  'default_model_id'
]);

// Step outputs that are stored as JSON (the scenarios picker and the single
// selected scenario object). Everything else is stored as a markdown string,
// which mysql2 still requires us to JSON.stringify into the JSON column.
const JSON_VALUED_FIELDS = new Set(['scenario_options', 'selected_scenario']);
const MARKDOWN_VALUED_FIELDS = new Set([
  'learning_brief', 'case_blueprint', 'student_case', 'teaching_note'
]);

function ok(res, data) {
  res.json({ data, error: null });
}

function fail(res, status, message) {
  res.status(status).json({ data: null, error: { message } });
}

/**
 * Whether this server is allowed to make outbound requests to instructor-supplied
 * URLs. Ships off (migration 074) — turning it on lets any instructor point this
 * host at any public address, so it is an admin decision, not a per-project one.
 */
async function isUrlFetchEnabled() {
  const [rows] = await pool.execute(
    'SELECT setting_value FROM settings WHERE setting_key = ?',
    ['case_writer_url_fetch_enabled']
  );
  return rows.length > 0 && String(rows[0].setting_value).trim() === '1';
}

function ownerScopeWhere(req) {
  // Visibility-aware list scope (owner + team-shared + public, with admin
  // vision when not impersonating).
  const scope = buildVisibilityScope(req, 'case_writer_project', 'case_writer_projects');
  return { sql: ' WHERE ' + scope.whereSql, params: scope.params };
}

async function loadProject(projectId, req, action) {
  // Infer action from the HTTP method when the caller doesn't pass one:
  //   GET     -> 'view'   (read-only access is enough)
  //   DELETE  -> 'delete' (owner-only)
  //   POST/PATCH/PUT -> 'edit' (owner or team:edit)
  // canAccessResource handles admin (no-impersonation) bypass internally.
  if (!action) {
    const m = (req.method || '').toUpperCase();
    if (m === 'GET') action = 'view';
    else if (m === 'DELETE') action = 'delete';
    else action = 'edit';
  }
  const access = await canAccessResource(req, 'case_writer_project', projectId, action);
  if (!access.allowed) {
    if (access.reason === 'not_found') return { project: null, forbidden: false };
    return { project: null, forbidden: true, reason: access.reason, ownerLabel: access.ownerLabel || null };
  }
  const [rows] = await pool.execute(
    `SELECT ${PROJECT_COLUMNS.join(', ')} FROM case_writer_projects WHERE project_id = ?`,
    [projectId]
  );
  if (rows.length === 0) return { project: null, forbidden: false };
  return { project: rows[0], forbidden: false };
}

// After migration 043, the markdown columns (learning_brief, case_blueprint,
// student_case, teaching_note) are LONGTEXT and store plain markdown directly.
// Read them via `project.<field> || ''`. asJson() below is still used for the
// JSON columns (scenario_options, selected_scenario) and for the revise handler.
function asJson(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return null; }
  }
  return value;
}

// The scenario_generation prompt emits structured fields per scenario but no
// `markdown` body. The picker UI and the blueprint generator both consume
// `card.markdown`, so we assemble a deterministic markdown rendering from the
// structured fields here. If the LLM happens to return markdown, we keep it.
function assembleScenarioMarkdown(s) {
  if (!s || typeof s !== 'object') return '';
  if (typeof s.markdown === 'string' && s.markdown.trim()) return s.markdown;
  const lines = [];
  if (s.protagonist) lines.push(`**Protagonist:** ${s.protagonist}`);
  if (s.company_context) lines.push(`**Company context:** ${s.company_context}`);
  if (s.central_tension) lines.push(`**Central tension:** ${s.central_tension}`);
  if (s.decision_point) lines.push(`**Decision point:** ${s.decision_point}`);
  if (Array.isArray(s.stakeholders) && s.stakeholders.length) {
    lines.push('**Stakeholders:**');
    for (const sh of s.stakeholders) lines.push(`- ${sh}`);
  }
  if (Array.isArray(s.possible_exhibits) && s.possible_exhibits.length) {
    lines.push('**Possible exhibits:**');
    for (const ex of s.possible_exhibits) lines.push(`- ${ex}`);
  }
  if (s.why_it_teaches_the_principle) {
    lines.push(`**Why it teaches the principle:** ${s.why_it_teaches_the_principle}`);
  }
  if (s.estimated_difficulty) lines.push(`**Estimated difficulty:** ${s.estimated_difficulty}`);
  return lines.join('\n\n');
}

// All Case Writer endpoints require an authenticated admin or instructor.
router.use(verifyToken, requireAdminOrInstructor);

// Server-side switches the Case Writer UI needs to know about before it can render
// the right controls. Kept off the reference list payload deliberately — that route
// is about references, and this is one small read the client makes once.
router.get('/config', async (_req, res) => {
  try {
    ok(res, { url_fetch_enabled: await isUrlFetchEnabled() });
  } catch (err) {
    console.error('[caseWriter] config error:', err);
    fail(res, 500, err.message);
  }
});

// ----------------------------------------------------------------------------
// Project CRUD
// ----------------------------------------------------------------------------

router.get('/projects', async (req, res) => {
  try {
    const { status } = req.query;
    // buildVisibilityScope() qualifies columns with `case_writer_projects.` —
    // re-alias the table so its predicates still match after we add JOINs.
    const scope = buildVisibilityScope(req, 'case_writer_project', 'case_writer_projects');
    const adminVision = hasAdminVision(req);
    const effectiveId = getEffectiveInstructorId(req);
    // can_edit per row: admins always; otherwise owner OR team:edit share.
    let canEditExpr;
    const canEditParams = [];
    if (adminVision) {
      canEditExpr = '1';
    } else if (!effectiveId) {
      canEditExpr = '0';
    } else {
      canEditExpr = `
        (CASE
           WHEN case_writer_projects.owner_id = ? AND case_writer_projects.owner_type = 'instructor' THEN 1
           WHEN EXISTS (
             SELECT 1 FROM resource_team_shares rts
             JOIN instructor_team_members itm ON itm.team_id = rts.team_id
             WHERE rts.resource_type = 'case_writer_project'
               AND rts.resource_id = case_writer_projects.project_id
               AND itm.instructor_id = ?
               AND rts.access_level = 'edit'
           ) THEN 1
           ELSE 0
         END)`;
      canEditParams.push(effectiveId, effectiveId);
    }
    let sql =
      `SELECT case_writer_projects.project_id, case_writer_projects.owner_id, case_writer_projects.owner_type,
              case_writer_projects.title, case_writer_projects.status, case_writer_projects.teaching_principle,
              case_writer_projects.audience, case_writer_projects.course_context, case_writer_projects.difficulty,
              case_writer_projects.case_type, case_writer_projects.industries_preference, case_writer_projects.industry,
              case_writer_projects.published_case_id, case_writer_projects.default_model_id,
              case_writer_projects.created_at, case_writer_projects.updated_at,
              COALESCE(i.full_name, a.who, a.email, i.email) AS owner_name,
              ${canEditExpr} AS can_edit
       FROM case_writer_projects
       LEFT JOIN instructors i
         ON case_writer_projects.owner_type = 'instructor' AND case_writer_projects.owner_id = i.id
       LEFT JOIN admins a
         ON case_writer_projects.owner_type = 'admin' AND case_writer_projects.owner_id = a.id
       WHERE ${scope.whereSql}`;
    const params = [...canEditParams, ...scope.params];
    if (status) {
      sql += ' AND case_writer_projects.status = ?';
      params.push(status);
    }
    sql += ' ORDER BY case_writer_projects.updated_at DESC';
    const [rows] = await pool.execute(sql, params);
    // Coerce can_edit from MySQL bit/int to a real boolean for the client.
    for (const r of rows) r.can_edit = r.can_edit === 1 || r.can_edit === '1' || r.can_edit === true;
    ok(res, rows);
  } catch (err) {
    console.error('[caseWriter] list projects error:', err);
    fail(res, 500, err.message);
  }
});

router.get('/projects/:id', async (req, res) => {
  try {
    const { project, forbidden } = await loadProject(req.params.id, req);
    if (forbidden) return fail(res, 403, 'Not authorized to access this project');
    if (!project) return fail(res, 404, 'Project not found');
    // Backfill scenario markdown on read for projects generated before the
    // assembleScenarioMarkdown enrichment was added. No DB write — just makes
    // the UI's preview/edit and the blueprint route's selected.markdown lookup
    // work for legacy rows.
    try {
      const opts = asJson(project.scenario_options);
      if (Array.isArray(opts)) {
        project.scenario_options = opts.map(sc => ({ ...sc, markdown: assembleScenarioMarkdown(sc) }));
      }
      const sel = asJson(project.selected_scenario);
      if (sel && typeof sel === 'object') {
        project.selected_scenario = { ...sel, markdown: assembleScenarioMarkdown(sel) };
      }
    } catch { /* non-fatal */ }
    // Compute can_edit so the client can render read-only UI for non-owners.
    const editAccess = await canAccessResource(req, 'case_writer_project', req.params.id, 'edit');
    project.can_edit = editAccess.allowed;
    project.owner_label = editAccess.ownerLabel || null;
    // Resolve the owner's display name for the read-only banner.
    if (!project.owner_label) {
      try {
        if (project.owner_type === 'instructor') {
          const [r] = await pool.execute('SELECT full_name, email FROM instructors WHERE id = ? LIMIT 1', [project.owner_id]);
          if (r[0]) project.owner_label = r[0].full_name || r[0].email || null;
        } else if (project.owner_type === 'admin') {
          const [r] = await pool.execute('SELECT email FROM admins WHERE id = ? LIMIT 1', [project.owner_id]);
          if (r[0]) project.owner_label = r[0].email || null;
        }
      } catch { /* non-fatal */ }
    }
    ok(res, project);
  } catch (err) {
    console.error('[caseWriter] get project error:', err);
    fail(res, 500, err.message);
  }
});

router.post('/projects', async (req, res) => {
  try {
    const { title, teaching_principle, default_model_id } = req.body || {};
    const projectId = uuidv4();
    await pool.execute(
      `INSERT INTO case_writer_projects
         (project_id, owner_id, owner_type, title, status, teaching_principle, default_model_id)
       VALUES (?, ?, ?, ?, 'draft', ?, ?)`,
      [
        projectId,
        req.user.id,
        req.user.role,
        title || null,
        teaching_principle || null,
        default_model_id || null
      ]
    );
    const [rows] = await pool.execute(
      `SELECT ${PROJECT_COLUMNS.join(', ')} FROM case_writer_projects WHERE project_id = ?`,
      [projectId]
    );
    ok(res, rows[0]);
  } catch (err) {
    console.error('[caseWriter] create project error:', err);
    fail(res, 500, err.message);
  }
});

router.patch('/projects/:id', async (req, res) => {
  try {
    const { project, forbidden } = await loadProject(req.params.id, req);
    if (forbidden) return fail(res, 403, 'Not authorized to access this project');
    if (!project) return fail(res, 404, 'Project not found');

    const sets = [];
    const params = [];
    for (const [key, value] of Object.entries(req.body || {})) {
      if (!PATCHABLE_FIELDS.has(key)) continue;
      sets.push(`${key} = ?`);
      if (JSON_VALUED_FIELDS.has(key) || MARKDOWN_VALUED_FIELDS.has(key)) {
        params.push(JSON.stringify(value));
      } else {
        params.push(value);
      }
      // When a scenario is selected, mirror its industry onto the project as
      // case metadata for the home list. Clearing the scenario clears industry.
      if (key === 'selected_scenario') {
        sets.push('industry = ?');
        const ind = (value && typeof value === 'object' && typeof value.industry === 'string')
          ? value.industry.trim() || null
          : null;
        params.push(ind);
      }
    }
    if (sets.length === 0) return fail(res, 400, 'No patchable fields provided');

    params.push(req.params.id);
    await pool.execute(
      `UPDATE case_writer_projects SET ${sets.join(', ')} WHERE project_id = ?`,
      params
    );

    const [rows] = await pool.execute(
      `SELECT ${PROJECT_COLUMNS.join(', ')} FROM case_writer_projects WHERE project_id = ?`,
      [req.params.id]
    );
    ok(res, rows[0]);
  } catch (err) {
    console.error('[caseWriter] update project error:', err);
    fail(res, 500, err.message);
  }
});

// PATCH /api/case-writer/projects/:id/visibility — Set Private/Team/Public + team_ids.
router.patch('/projects/:id/visibility', async (req, res) => {
  try {
    const access = await canAccessResource(req, 'case_writer_project', req.params.id, 'share');
    if (!access.allowed) {
      return res.status(access.reason === 'not_found' ? 404 : 403).json({
        data: null, error: { message: access.reason }
      });
    }
    const result = await setVisibility(req, 'case_writer_project', req.params.id, req.body || {});
    if (!result.ok) {
      return res.status(result.status || 400).json({ data: null, error: { message: result.error } });
    }
    res.json({ data: { project_id: req.params.id, visibility: req.body?.visibility }, error: null });
  } catch (err) {
    console.error('[caseWriter] visibility error:', err);
    fail(res, 500, err.message);
  }
});

router.delete('/projects/:id', async (req, res) => {
  try {
    const { project, forbidden } = await loadProject(req.params.id, req);
    if (forbidden) return fail(res, 403, 'Not authorized to delete this project');
    if (!project) return fail(res, 404, 'Project not found');
    await pool.execute('DELETE FROM case_writer_projects WHERE project_id = ?', [req.params.id]);
    ok(res, { project_id: req.params.id, deleted: true });
  } catch (err) {
    console.error('[caseWriter] delete project error:', err);
    fail(res, 500, err.message);
  }
});

// POST /api/case-writer/projects/:id/clone — Duplicate a project into the
// caller's account. Requires only 'view' access to the source. The clone is
// always private, owned by the caller, status='draft', published_case_id NULL.
// Approved references are copied too so the new project has the same source
// material starting point.
router.post('/projects/:id/clone', async (req, res) => {
  // Source-project access: 'view' is enough — anyone who can see it can clone.
  try {
    const sourceId = req.params.id;
    const access = await canAccessResource(req, 'case_writer_project', sourceId, 'view');
    if (!access.allowed) {
      return fail(res, access.reason === 'not_found' ? 404 : 403, 'Not authorized to clone this project');
    }
    const [srcRows] = await pool.execute(
      `SELECT ${PROJECT_COLUMNS.join(', ')} FROM case_writer_projects WHERE project_id = ?`,
      [sourceId]
    );
    if (srcRows.length === 0) return fail(res, 404, 'Project not found');
    const src = srcRows[0];

    const newId = uuidv4();
    const newTitle = `Copy of ${src.title || 'Untitled'}`;
    await pool.execute(
      `INSERT INTO case_writer_projects (
         project_id, owner_id, owner_type, title, status, visibility,
         teaching_principle, audience, course_context, difficulty, case_type,
         industries_preference, industry,
         learning_brief, scenario_options, selected_scenario,
         case_blueprint, student_case, teaching_note,
         publish_protagonist, publish_chat_question,
         publish_arguments_for, publish_arguments_against,
         default_model_id
       ) VALUES (?, ?, ?, ?, 'draft', 'private',
                 ?, ?, ?, ?, ?,
                 ?, ?,
                 ?, ?, ?,
                 ?, ?, ?,
                 ?, ?,
                 ?, ?,
                 ?)`,
      [
        newId, req.user.id, req.user.role, newTitle,
        src.teaching_principle, src.audience, src.course_context, src.difficulty, src.case_type,
        src.industries_preference, src.industry,
        src.learning_brief, src.scenario_options, src.selected_scenario,
        src.case_blueprint, src.student_case, src.teaching_note,
        src.publish_protagonist, src.publish_chat_question,
        src.publish_arguments_for, src.publish_arguments_against,
        src.default_model_id
      ]
    );

    // Copy references (with new ids) so the source materials carry over.
    const [refRows] = await pool.execute(
      `SELECT type, title, content, content_summary, summary_scope_hash, use_mode,
              outline, outline_hash, selection, selection_overrides, approved_by_user,
              source_notes, link_url,
              fetched_at, fetched_content_type, fetched_final_url,
              upload_original_name, upload_stored_path, case_file_id
       FROM case_writer_references WHERE project_id = ?`,
      [sourceId]
    );
    for (const r of refRows) {
      // The clone shares the source's `content` verbatim, so its outline and
      // selection offsets stay valid — copy them rather than making the
      // instructor redo the section picking.
      await pool.execute(
        `INSERT INTO case_writer_references
           (reference_id, project_id, type, title, content, content_summary, summary_scope_hash, use_mode,
            outline, outline_hash, selection, selection_overrides,
            approved_by_user, source_notes, link_url,
            fetched_at, fetched_content_type, fetched_final_url,
            upload_original_name, upload_stored_path, case_file_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(), newId, r.type, r.title, r.content, r.content_summary, r.summary_scope_hash, r.use_mode,
          r.outline ? JSON.stringify(parseJsonColumn(r.outline)) : null,
          r.outline_hash,
          r.selection ? JSON.stringify(parseJsonColumn(r.selection)) : null,
          r.selection_overrides ? JSON.stringify(parseJsonColumn(r.selection_overrides)) : null,
          r.approved_by_user, r.source_notes, r.link_url,
          // Fetch and upload provenance used to be dropped here, so a cloned
          // link looked never-fetched and a cloned upload lost its original file.
          r.fetched_at, r.fetched_content_type, r.fetched_final_url,
          r.upload_original_name, r.upload_stored_path, r.case_file_id
        ]
      );
    }

    const [newRows] = await pool.execute(
      `SELECT ${PROJECT_COLUMNS.join(', ')} FROM case_writer_projects WHERE project_id = ?`,
      [newId]
    );
    ok(res, newRows[0]);
  } catch (err) {
    console.error('[caseWriter] clone project error:', err);
    fail(res, 500, err.message);
  }
});

// ----------------------------------------------------------------------------
// Reference library — source material on OTHER projects this instructor can see
// ----------------------------------------------------------------------------

/**
 * Every reference on every project in the caller's visibility scope, so a
 * curated document can be reused instead of re-uploaded and re-sectioned.
 *
 * This exposes nothing new: `GET /projects/:id/references` already requires only
 * 'view', so these rows were reachable to this caller before — they were just not
 * browsable. Because the picker makes that concrete, the visibility control now
 * spells out what team/public sharing publishes (VISIBILITY_DISCLOSURES).
 *
 * `content` is deliberately absent: the browser still gets a reference body from
 * exactly one route, and the picker's Preview reuses it.
 */
router.get('/reference-library', async (req, res) => {
  try {
    const scope = buildVisibilityScope(req, 'case_writer_project', 'p');
    const excludeId = req.query.exclude_project_id || '';
    const q = String(req.query.q || '').trim();

    // "Mine" follows the impersonated identity when an admin is acting as an
    // instructor, and falls back to the caller's own id — getEffectiveInstructorId
    // returns null for a plain admin, which would label their own projects as
    // someone else's.
    const meId = getEffectiveInstructorId(req) || req.user?.id || '';
    const params = [meId, ...scope.params];
    let sql =
      `SELECT r.reference_id, r.project_id, r.type, r.title, r.link_url,
              CHAR_LENGTH(r.content) AS content_length,
              (r.content_summary IS NOT NULL) AS has_summary,
              r.use_mode, r.updated_at,
              p.title AS project_title, p.visibility,
              (p.owner_id = ?) AS is_own,
              COALESCE(i.full_name, a.who, a.email, i.email) AS owner_name
       FROM case_writer_references r
       JOIN case_writer_projects p ON p.project_id = r.project_id
       LEFT JOIN instructors i ON p.owner_type = 'instructor' AND p.owner_id = i.id
       LEFT JOIN admins      a ON p.owner_type = 'admin'      AND p.owner_id = a.id
       WHERE ${scope.whereSql}`;

    if (excludeId) { sql += ' AND r.project_id <> ?'; params.push(excludeId); }
    if (q) {
      // Must cover the same four fields the picker filters on client-side.
      // owner_name is repeated as its COALESCE rather than its alias: MySQL does
      // not accept a SELECT alias in WHERE.
      sql +=
        ` AND (r.title LIKE ? OR p.title LIKE ? OR r.link_url LIKE ?
               OR COALESCE(i.full_name, a.who, a.email, i.email) LIKE ?)`;
      const like = `%${q}%`;
      params.push(like, like, like, like);
    }
    sql += ' ORDER BY p.updated_at DESC, r.created_at ASC LIMIT 500';

    const [rows] = await pool.execute(sql, params);
    ok(res, rows.map(r => ({
      ...r,
      has_summary: !!r.has_summary,
      is_own: !!r.is_own
    })));
  } catch (err) {
    console.error('[caseWriter] reference library error:', err);
    fail(res, 500, err.message);
  }
});

// ----------------------------------------------------------------------------
// References
// ----------------------------------------------------------------------------

router.get('/projects/:id/references', async (req, res) => {
  try {
    const { project, forbidden } = await loadProject(req.params.id, req);
    if (forbidden) return fail(res, 403, 'Not authorized to access this project');
    if (!project) return fail(res, 404, 'Project not found');
    const [rows] = await pool.execute(
      `SELECT ${REFERENCE_ROW_COLUMNS}
       FROM case_writer_references WHERE project_id = ? ORDER BY created_at ASC`,
      [req.params.id]
    );
    ok(res, rows.map(withSelectionSummary));
  } catch (err) {
    console.error('[caseWriter] list references error:', err);
    fail(res, 500, err.message);
  }
});

// Full document text + outline for the section/excerpt picker. This is the only
// route that sends a reference's `content` to the browser — the list routes
// deliberately return CHAR_LENGTH(content) instead, so opening a project does
// not ship several hundred KB of textbook per reference.
router.get('/projects/:id/references/:refId/content', async (req, res) => {
  try {
    const { project, forbidden } = await loadProject(req.params.id, req);
    if (forbidden) return fail(res, 403, 'Not authorized to access this project');
    if (!project) return fail(res, 404, 'Project not found');

    const [rows] = await pool.execute(
      `SELECT reference_id, type, title, content, content_summary, summary_scope_hash,
              outline, outline_hash, selection, selection_overrides
       FROM case_writer_references WHERE reference_id = ? AND project_id = ?`,
      [req.params.refId, req.params.id]
    );
    if (rows.length === 0) return fail(res, 404, 'Reference not found');
    const r = rows[0];
    const content = r.content || '';

    // Legacy rows (and anything written before migration 068) have no outline
    // yet. Build it on first access rather than making the instructor click a
    // button to make the feature work at all.
    let outline = parseJsonColumn(r.outline);
    if (!outline && content.trim()) {
      outline = await refreshReferenceOutline(r.reference_id, content, r.type === 'uploaded_file' ? 'pdf' : 'text');
    }

    ok(res, {
      reference_id: r.reference_id,
      title: r.title,
      type: r.type,
      content,
      content_length: content.length,
      outline,
      // Tells the client whether the stored selection still lines up with the
      // text it is about to render.
      outline_stale: !!r.outline_hash && r.outline_hash !== contentHash(content),
      selection: parseJsonColumn(r.selection),
      selection_overrides: parseJsonColumn(r.selection_overrides),
      has_summary: !!r.content_summary,
      summary_stale: !!r.content_summary && !summaryMatchesScope(r, null)
    });
  } catch (err) {
    console.error('[caseWriter] reference content error:', err);
    fail(res, 500, err.message);
  }
});

/**
 * Stream back the file an `uploaded_file` reference was created from.
 *
 * Only works for uploads made after migration 075 — earlier rows recorded the
 * extracted text but never the path, so there is nothing to serve and the UI
 * hides the option (`upload_original_name` is NULL).
 *
 * Requires 'edit', not 'view' — the one reference route that does. Everything
 * else about a shared project is text this platform generated or extracted, and
 * the visibility disclosure says so; the original PDF/DOCX is the instructor's
 * unaltered file, which may be licensed material they can read but not
 * redistribute. Costs nothing in the UI: view-only callers get the read-only
 * document view (`can_edit === false` in CaseWriterProject) and never see the
 * Source Material pane this button lives in. `/references/import` deliberately
 * drops the file linkage for the same reason — see there.
 */
router.get('/projects/:id/references/:refId/download-original', async (req, res) => {
  try {
    const { project, forbidden } = await loadProject(req.params.id, req, 'edit');
    if (forbidden) return fail(res, 403, 'Not authorized to access this project');
    if (!project) return fail(res, 404, 'Project not found');

    const [rows] = await pool.execute(
      `SELECT upload_original_name, upload_stored_path FROM case_writer_references
       WHERE reference_id = ? AND project_id = ?`,
      [req.params.refId, req.params.id]
    );
    if (rows.length === 0) return fail(res, 404, 'Reference not found');
    const { upload_original_name: name, upload_stored_path: stored } = rows[0];
    if (!stored) {
      return fail(res, 404, 'No original file was recorded for this reference. Only files uploaded after this feature shipped can be downloaded.');
    }

    // `upload_stored_path` is written by the upload route, but treat it as
    // untrusted anyway: resolve it and refuse anything that climbs out of
    // case_files/, so a tampered row cannot become an arbitrary file read.
    const absolute = path.resolve(CASE_FILES_DIR, stored);
    const root = path.resolve(CASE_FILES_DIR);
    if (absolute !== root && !absolute.startsWith(root + path.sep)) {
      console.error('[caseWriter] download-original path escaped case_files:', stored);
      return fail(res, 400, 'Stored file path is not valid');
    }

    try {
      await fs.access(absolute);
    } catch {
      return fail(res, 404, 'The original file is no longer on the server.');
    }

    res.download(absolute, name || path.basename(absolute), (err) => {
      // Headers are already sent by the time res.download can fail, so all that
      // is left is to log it.
      if (err) console.error('[caseWriter] download-original send error:', err.message);
    });
  } catch (err) {
    console.error('[caseWriter] download original error:', err);
    fail(res, 500, err.message);
  }
});

// Force re-detection, e.g. after the heuristics improve or a bad outline is
// cached. Clears any selection, since section ids are positional.
router.post('/projects/:id/references/:refId/rebuild-outline', async (req, res) => {
  try {
    const { project, forbidden } = await loadProject(req.params.id, req);
    if (forbidden) return fail(res, 403, 'Not authorized to access this project');
    if (!project) return fail(res, 404, 'Project not found');

    const [rows] = await pool.execute(
      `SELECT reference_id, type, content FROM case_writer_references
       WHERE reference_id = ? AND project_id = ?`,
      [req.params.refId, req.params.id]
    );
    if (rows.length === 0) return fail(res, 404, 'Reference not found');

    const outline = await refreshReferenceOutline(
      rows[0].reference_id,
      rows[0].content,
      rows[0].type === 'uploaded_file' ? 'pdf' : 'text'
    );
    ok(res, { reference_id: rows[0].reference_id, outline });
  } catch (err) {
    console.error('[caseWriter] rebuild outline error:', err);
    fail(res, 500, err.message);
  }
});

/**
 * Download a `link` reference's page and store its text in `content`.
 *
 * After this runs the link is an ordinary reference: outline detection, section and
 * excerpt selection, per-step overrides, `use_mode`, and summarization all work
 * against the fetched text with no special-casing anywhere downstream.
 *
 * Re-fetching is this same route called again. It overwrites `content`, and
 * refreshReferenceOutline() clears the selection because the stored character
 * offsets no longer point at the same words. Nothing auto-refetches — `fetched_at`
 * is surfaced in the UI so staleness is the instructor's call.
 */
router.post('/projects/:id/references/:refId/fetch', async (req, res) => {
  try {
    if (!(await isUrlFetchEnabled())) {
      return fail(res, 403, 'URL fetching is disabled. An admin can enable it in Settings.');
    }

    // POST → loadProject requires edit permission, same as every other mutation here.
    const { project, forbidden } = await loadProject(req.params.id, req);
    if (forbidden) return fail(res, 403, 'Not authorized to access this project');
    if (!project) return fail(res, 404, 'Project not found');

    const [rows] = await pool.execute(
      `SELECT reference_id, type, title, link_url FROM case_writer_references
       WHERE reference_id = ? AND project_id = ?`,
      [req.params.refId, req.params.id]
    );
    if (rows.length === 0) return fail(res, 404, 'Reference not found');
    const ref = rows[0];
    if (ref.type !== 'link') {
      return fail(res, 400, 'Only link references can be fetched');
    }
    if (!ref.link_url) {
      return fail(res, 400, 'This reference has no URL to fetch');
    }

    let fetched;
    try {
      fetched = await fetchUrlAsText(ref.link_url);
    } catch (err) {
      // Paywalls, bot blocks, and JS-rendered pages all land here and none of them
      // are fixable server-side, so the thrown message is the whole answer.
      console.warn('[caseWriter] url fetch failed:', ref.link_url, err.message);
      return fail(res, 422, err.message);
    }

    await pool.execute(
      `UPDATE case_writer_references
          SET content = ?, fetched_at = NOW(), fetched_content_type = ?, fetched_final_url = ?,
              title = COALESCE(NULLIF(title, ''), ?),
              approved_by_user = 0
        WHERE reference_id = ? AND project_id = ?`,
      [
        fetched.text,
        fetched.contentType,
        fetched.finalUrl,
        // Adopt the page's own title only when the instructor never gave one.
        fetched.title || ref.link_url,
        req.params.refId,
        req.params.id
      ]
    );

    // Mandatory on every write to `content` — see refreshReferenceOutline().
    await refreshReferenceOutline(req.params.refId, fetched.text, fetched.format);

    const [after] = await pool.execute(
      `SELECT ${REFERENCE_ROW_COLUMNS}
       FROM case_writer_references WHERE reference_id = ?`,
      [req.params.refId]
    );
    ok(res, {
      ...withSelectionSummary(after[0]),
      // Readability found little or nothing and we stored raw body text instead.
      // Almost always a JS-rendered page; the instructor needs to look at it.
      fetch_degraded: fetched.degraded
    });
  } catch (err) {
    console.error('[caseWriter] fetch reference url error:', err);
    fail(res, 500, err.message);
  }
});

router.post('/projects/:id/references', async (req, res) => {
  try {
    const { project, forbidden } = await loadProject(req.params.id, req);
    if (forbidden) return fail(res, 403, 'Not authorized to access this project');
    if (!project) return fail(res, 404, 'Project not found');

    const { type, title, content, link_url, source_notes } = req.body || {};
    if (!['pasted_text', 'link', 'saved_framework'].includes(type)) {
      return fail(res, 400, 'type must be pasted_text, link, or saved_framework (file uploads use a separate endpoint)');
    }

    const referenceId = uuidv4();
    await pool.execute(
      `INSERT INTO case_writer_references
         (reference_id, project_id, type, title, content, link_url, source_notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        referenceId,
        req.params.id,
        type,
        title || null,
        content || null,
        link_url || null,
        source_notes || null
      ]
    );

    if (content) await refreshReferenceOutline(referenceId, content, 'text');

    const [rows] = await pool.execute(
      `SELECT ${REFERENCE_ROW_COLUMNS}
       FROM case_writer_references WHERE reference_id = ?`,
      [referenceId]
    );
    ok(res, withSelectionSummary(rows[0]));
  } catch (err) {
    console.error('[caseWriter] create reference error:', err);
    fail(res, 500, err.message);
  }
});

/**
 * Copy references from other projects into this one.
 *
 * Permission: POST infers 'edit' on the destination via loadProject; each source
 * is separately checked for 'view', the same bar /clone uses for reading a
 * project it is about to duplicate.
 *
 * The copy is byte-identical, which is the whole point — `outline`, `outline_hash`,
 * `selection`, and `selection_overrides` come across untouched and stay valid, so
 * an instructor who picked three chapters out of a textbook keeps that work.
 * `refreshReferenceOutline()` must therefore NOT be called here; it would clear
 * the selection and quietly throw away the curation that motivates copying.
 *
 * One field deliberately does not come across byte-identically: the upload file
 * linkage. See the INSERT below.
 *
 * Inserts run in a transaction. A partial batch is the bad outcome here — the
 * client shows "Copy failed" and does not reload, so already-inserted rows stay
 * invisible until the next refresh and a retry produces duplicates with doubled
 * provenance lines.
 */
router.post('/projects/:id/references/import', async (req, res) => {
  let conn;
  try {
    const { project, forbidden } = await loadProject(req.params.id, req);
    if (forbidden) return fail(res, 403, 'Not authorized to access this project');
    if (!project) return fail(res, 404, 'Project not found');

    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (items.length === 0) return fail(res, 400, 'No references selected');
    if (items.length > 50) return fail(res, 400, 'Copy at most 50 references at a time');

    const imported = [];
    const skipped = [];
    const stamp = new Date().toISOString().slice(0, 10);

    conn = await pool.getConnection();
    await conn.beginTransaction();

    for (const item of items) {
      const sourceProjectId = item?.project_id;
      const sourceRefId = item?.reference_id;
      if (!sourceProjectId || !sourceRefId) {
        skipped.push({ reference_id: sourceRefId || null, reason: 'Malformed request item' });
        continue;
      }
      if (sourceProjectId === req.params.id) {
        skipped.push({ reference_id: sourceRefId, reason: 'Already in this project' });
        continue;
      }

      const access = await canAccessResource(req, 'case_writer_project', sourceProjectId, 'view');
      if (!access.allowed) {
        // One unreadable item should not sink the rest of the batch; report it.
        skipped.push({ reference_id: sourceRefId, reason: 'Not authorized to read the source project' });
        continue;
      }
      // Whether this caller could have downloaded the original file from the
      // source project directly (see /download-original, which requires 'edit').
      const canEditSource =
        (await canAccessResource(req, 'case_writer_project', sourceProjectId, 'edit')).allowed;

      const [srcRows] = await conn.execute(
        `SELECT r.type, r.title, r.content, r.content_summary, r.summary_scope_hash, r.use_mode,
                r.outline, r.outline_hash, r.selection, r.selection_overrides,
                r.source_notes, r.link_url,
                r.fetched_at, r.fetched_content_type, r.fetched_final_url,
                r.upload_original_name, r.upload_stored_path, r.case_file_id,
                p.title AS project_title
         FROM case_writer_references r
         JOIN case_writer_projects p ON p.project_id = r.project_id
         WHERE r.reference_id = ? AND r.project_id = ?`,
        [sourceRefId, sourceProjectId]
      );
      if (srcRows.length === 0) {
        skipped.push({ reference_id: sourceRefId, reason: 'Reference not found' });
        continue;
      }
      const s = srcRows[0];

      const provenance = [s.source_notes, `Copied from project "${s.project_title || 'Untitled'}" on ${stamp}`]
        .filter(Boolean).join('\n');

      const newId = uuidv4();
      await conn.execute(
        `INSERT INTO case_writer_references
           (reference_id, project_id, type, title, content, content_summary, summary_scope_hash, use_mode,
            outline, outline_hash, selection, selection_overrides,
            approved_by_user, source_notes, link_url,
            fetched_at, fetched_content_type, fetched_final_url,
            upload_original_name, upload_stored_path, case_file_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newId, req.params.id, s.type, s.title, s.content, s.content_summary,
          s.summary_scope_hash, s.use_mode,
          // mysql2 hands JSON columns back parsed, so they need re-stringifying.
          s.outline ? JSON.stringify(parseJsonColumn(s.outline)) : null,
          s.outline_hash,
          s.selection ? JSON.stringify(parseJsonColumn(s.selection)) : null,
          s.selection_overrides ? JSON.stringify(parseJsonColumn(s.selection_overrides)) : null,
          // approved_by_user is 0 above, deliberately: copied material would
          // otherwise enter {source_materials} for five generators unreviewed,
          // which is the same reason /fetch and /summarize reset it.
          provenance, s.link_url,
          s.fetched_at, s.fetched_content_type, s.fetched_final_url,
          // Copying a reference out of a project you can only *view* must not
          // hand you the original upload: you would own the copy, and
          // /download-original on your own project would then serve the file
          // that route just refused you. The extracted text still comes across —
          // that is what generation uses and what the visibility disclosure
          // promises. `case_file_id` is left alone: it is a legacy pointer into
          // `case_files`, which /download-original never reads, and the
          // summarize route falls back to its converted_text.
          canEditSource ? s.upload_original_name : null,
          canEditSource ? s.upload_stored_path : null,
          s.case_file_id
        ]
      );
      imported.push(newId);
    }

    if (imported.length === 0) {
      await conn.rollback();
      return fail(res, 400, skipped[0]?.reason || 'Nothing could be copied');
    }

    await conn.commit();

    const placeholders = imported.map(() => '?').join(', ');
    const [rows] = await conn.execute(
      `SELECT ${REFERENCE_ROW_COLUMNS}
       FROM case_writer_references WHERE reference_id IN (${placeholders})`,
      imported
    );
    ok(res, { imported: rows.map(withSelectionSummary), skipped });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    console.error('[caseWriter] import references error:', err);
    fail(res, 500, err.message);
  } finally {
    if (conn) conn.release();
  }
});

router.patch('/projects/:id/references/:refId', async (req, res) => {
  try {
    const { project, forbidden } = await loadProject(req.params.id, req);
    if (forbidden) return fail(res, 403, 'Not authorized to access this project');
    if (!project) return fail(res, 404, 'Project not found');

    const allowed = ['title', 'content', 'content_summary', 'use_mode', 'selection', 'selection_overrides', 'approved_by_user', 'source_notes', 'link_url'];
    const sets = [];
    const params = [];
    for (const [key, value] of Object.entries(req.body || {})) {
      if (!allowed.includes(key)) continue;
      if (key === 'use_mode' && !REFERENCE_USE_MODES.includes(value)) {
        return fail(res, 400, `use_mode must be one of: ${REFERENCE_USE_MODES.join(', ')}`);
      }
      if (key === 'selection') {
        const err = validateSelection(value);
        if (err) return fail(res, 400, err);
        sets.push('selection = ?');
        params.push(value == null ? null : JSON.stringify(value));
        continue;
      }
      if (key === 'selection_overrides') {
        const err = validateSelectionOverrides(value);
        if (err) return fail(res, 400, err);
        sets.push('selection_overrides = ?');
        params.push(value == null ? null : JSON.stringify(value));
        continue;
      }
      sets.push(`${key} = ?`);
      params.push(key === 'approved_by_user' ? (value ? 1 : 0) : value);
    }
    if (sets.length === 0) return fail(res, 400, 'No patchable fields provided');

    params.push(req.params.refId, req.params.id);
    const [result] = await pool.execute(
      `UPDATE case_writer_references SET ${sets.join(', ')}
       WHERE reference_id = ? AND project_id = ?`,
      params
    );
    if (result.affectedRows === 0) return fail(res, 404, 'Reference not found');

    // Rewriting the body invalidates every character offset in `selection`, so
    // the outline is rebuilt and the selection cleared. Doing this after the
    // UPDATE keeps it correct even when content and selection arrive together.
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'content')) {
      await refreshReferenceOutline(req.params.refId, req.body.content, 'text');
    }

    // A hand-edited summary needs its scope recorded, exactly like the one the
    // summarize route writes. Without this the row keeps whatever hash it had —
    // NULL for a summary written by hand, or a stale one after an edit — and
    // summaryMatchesScope() then withholds the summary from every generation step
    // with no visible signal. Runs after the UPDATE so the hash is derived from
    // the selection as it now stands.
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'content_summary')) {
      const [cur] = await pool.execute(
        `SELECT content_summary, outline_hash, selection, selection_overrides
           FROM case_writer_references WHERE reference_id = ?`,
        [req.params.refId]
      );
      if (cur.length > 0) {
        // Clearing the summary clears its scope too, so an empty row never looks
        // like a summary whose scope simply failed to match.
        const scope = cur[0].content_summary ? selectionScopeKey(cur[0], null) : null;
        await pool.execute(
          'UPDATE case_writer_references SET summary_scope_hash = ? WHERE reference_id = ?',
          [scope, req.params.refId]
        );
      }
    }

    const [rows] = await pool.execute(
      `SELECT ${REFERENCE_ROW_COLUMNS}
       FROM case_writer_references WHERE reference_id = ?`,
      [req.params.refId]
    );
    ok(res, withSelectionSummary(rows[0]));
  } catch (err) {
    console.error('[caseWriter] update reference error:', err);
    fail(res, 500, err.message);
  }
});

router.delete('/projects/:id/references/:refId', async (req, res) => {
  try {
    const { project, forbidden } = await loadProject(req.params.id, req);
    if (forbidden) return fail(res, 403, 'Not authorized to access this project');
    if (!project) return fail(res, 404, 'Project not found');
    const [result] = await pool.execute(
      'DELETE FROM case_writer_references WHERE reference_id = ? AND project_id = ?',
      [req.params.refId, req.params.id]
    );
    if (result.affectedRows === 0) return fail(res, 404, 'Reference not found');
    ok(res, { reference_id: req.params.refId, deleted: true });
  } catch (err) {
    console.error('[caseWriter] delete reference error:', err);
    fail(res, 500, err.message);
  }
});

// ----------------------------------------------------------------------------
// Reference file upload (multipart)
// ----------------------------------------------------------------------------

const referenceUploadStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const projectId = req.params.id;
    const dir = path.join(CASE_FILES_DIR, `cw-${projectId}`, 'uploads');
    try {
      await fs.mkdir(dir, { recursive: true });
      cb(null, dir);
    } catch (err) {
      cb(err);
    }
  },
  filename: (_req, file, cb) => {
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    const basename = path.basename(file.originalname, ext);
    cb(null, `${basename}-${timestamp}${ext}`);
  }
});

const referenceUpload = multer({
  storage: referenceUploadStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['.pdf', '.docx', '.doc', '.md', '.txt'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Unsupported file type. Allowed: PDF, DOCX, DOC, MD, TXT'));
  }
});

// Project-less upload for extract-principles: store to a shared temp dir.
const principleUploadStorage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    const dir = path.join(CASE_FILES_DIR, '_cw-tmp');
    try {
      await fs.mkdir(dir, { recursive: true });
      cb(null, dir);
    } catch (err) {
      cb(err);
    }
  },
  filename: (_req, file, cb) => {
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    const basename = path.basename(file.originalname, ext);
    cb(null, `${basename}-${timestamp}${ext}`);
  }
});
const principleUpload = multer({
  storage: principleUploadStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['.pdf', '.docx', '.doc', '.md', '.txt'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Unsupported file type. Allowed: PDF, DOCX, DOC, MD, TXT'));
  }
});

router.post('/projects/:id/references/upload',
  (req, res, next) => {
    referenceUpload.single('file')(req, res, (err) => {
      if (err) return fail(res, 400, err.message);
      next();
    });
  },
  async (req, res) => {
    try {
      const { project, forbidden } = await loadProject(req.params.id, req);
      if (forbidden) return fail(res, 403, 'Not authorized to access this project');
      if (!project) return fail(res, 404, 'Project not found');
      if (!req.file) return fail(res, 400, 'No file uploaded');

      const extWithDot = path.extname(req.file.originalname).toLowerCase();
      let convertedText = '';
      // convertFile reports how the text was produced ('docx-markdown',
      // 'markdown', 'pdf', 'text'). Outline detection prefers the markdown tier
      // only for the two formats that actually carry '#' headings.
      let convertedFormat = 'text';
      try {
        const result = await convertFile(req.file.path, extWithDot);
        convertedText = result?.text || '';
        convertedFormat = result?.format || 'text';
      } catch (err) {
        console.error('[caseWriter] reference upload convertFile failed:', err);
        return fail(res, 422, `Could not extract text from file: ${err.message}`);
      }

      const referenceId = uuidv4();
      const { title, source_notes } = req.body || {};
      const noteParts = [];
      if (source_notes) noteParts.push(source_notes);
      noteParts.push(`Uploaded file: ${req.file.originalname} (${req.file.size} bytes)`);

      // Record where the file actually landed (migration 075) so the instructor
      // can download the original later. Stored relative to CASE_FILES_DIR and
      // with forward slashes, so the value means the same thing on either OS and
      // the download route has a single root to validate against.
      const storedPath = path.relative(CASE_FILES_DIR, req.file.path).split(path.sep).join('/');

      await pool.execute(
        `INSERT INTO case_writer_references
           (reference_id, project_id, type, title, content, source_notes,
            upload_original_name, upload_stored_path)
         VALUES (?, ?, 'uploaded_file', ?, ?, ?, ?, ?)`,
        [
          referenceId,
          req.params.id,
          title || req.file.originalname,
          convertedText,
          noteParts.join('\n'),
          req.file.originalname,
          storedPath
        ]
      );

      await refreshReferenceOutline(referenceId, convertedText, convertedFormat);

      const [rows] = await pool.execute(
        `SELECT ${REFERENCE_ROW_COLUMNS}
         FROM case_writer_references WHERE reference_id = ?`,
        [referenceId]
      );
      ok(res, withSelectionSummary(rows[0]));
    } catch (err) {
      console.error('[caseWriter] reference upload error:', err);
      fail(res, 500, err.message);
    }
  }
);

// ----------------------------------------------------------------------------
// Revisions — read-only listing
// ----------------------------------------------------------------------------

router.get('/projects/:id/revisions', async (req, res) => {
  try {
    const { project, forbidden } = await loadProject(req.params.id, req);
    if (forbidden) return fail(res, 403, 'Not authorized to access this project');
    if (!project) return fail(res, 404, 'Project not found');

    const { step } = req.query;
    let sql =
      `SELECT revision_id, project_id, step, snapshot, created_by, created_at
       FROM case_writer_revisions WHERE project_id = ?`;
    const params = [req.params.id];
    if (step) {
      sql += ' AND step = ?';
      params.push(step);
    }
    sql += ' ORDER BY created_at DESC';
    const [rows] = await pool.execute(sql, params);
    ok(res, rows);
  } catch (err) {
    console.error('[caseWriter] list revisions error:', err);
    fail(res, 500, err.message);
  }
});

// ----------------------------------------------------------------------------
// Case versions — saved snapshots of the student case with size + notes.
// Versioning is additive: case_writer_projects.student_case is the working
// draft, and rows in case_versions are immutable text snapshots a user has
// saved under a name (with their own notes).
// ----------------------------------------------------------------------------

const CASE_SIZE_VALUES = ['story_problem', 'mini', 'abridged', 'regular', 'expanded'];

function countWords(text) {
  if (!text) return 0;
  const trimmed = String(text).trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

router.get('/projects/:id/versions', async (req, res) => {
  try {
    const { project, forbidden } = await loadProject(req.params.id, req);
    if (forbidden) return fail(res, 403, 'Not authorized to access this project');
    if (!project) return fail(res, 404, 'Project not found');

    const [rows] = await pool.execute(
      `SELECT case_version_id, project_id, case_size, version_name, version_notes,
              model_id, word_count, version_created, version_updated
       FROM case_versions WHERE project_id = ?
       ORDER BY version_created DESC`,
      [req.params.id]
    );
    ok(res, rows);
  } catch (err) {
    console.error('[caseWriter] list versions error:', err);
    fail(res, 500, err.message);
  }
});

router.post('/projects/:id/versions', async (req, res) => {
  try {
    const { project, forbidden } = await loadProject(req.params.id, req);
    if (forbidden) return fail(res, 403, 'Not authorized to access this project');
    if (!project) return fail(res, 404, 'Project not found');

    const caseText = project.student_case || '';
    if (!caseText.trim()) {
      return fail(res, 400, 'Cannot save an empty case version. Generate or paste case content first.');
    }

    const { version_name, version_notes, case_size, model_id } = req.body || {};
    if (!version_name || !version_name.trim()) {
      return fail(res, 400, 'version_name is required');
    }
    const size = CASE_SIZE_VALUES.includes(case_size) ? case_size : 'regular';

    const versionId = uuidv4();
    const wordCount = countWords(caseText);

    await pool.execute(
      `INSERT INTO case_versions
         (case_version_id, project_id, case_size, case_text, version_name,
          version_notes, model_id, word_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        versionId,
        req.params.id,
        size,
        caseText,
        version_name.trim(),
        version_notes || null,
        model_id || null,
        wordCount
      ]
    );

    const [rows] = await pool.execute(
      `SELECT case_version_id, project_id, case_size, version_name, version_notes,
              model_id, word_count, version_created, version_updated
       FROM case_versions WHERE case_version_id = ?`,
      [versionId]
    );
    ok(res, rows[0]);
  } catch (err) {
    console.error('[caseWriter] create version error:', err);
    fail(res, 500, err.message);
  }
});

router.patch('/projects/:id/versions/:vid', async (req, res) => {
  try {
    const { project, forbidden } = await loadProject(req.params.id, req);
    if (forbidden) return fail(res, 403, 'Not authorized to access this project');
    if (!project) return fail(res, 404, 'Project not found');

    const updates = [];
    const params = [];
    if (typeof req.body.version_name === 'string') {
      const trimmed = req.body.version_name.trim();
      if (!trimmed) return fail(res, 400, 'version_name cannot be empty');
      updates.push('version_name = ?');
      params.push(trimmed);
    }
    if ('version_notes' in req.body) {
      updates.push('version_notes = ?');
      params.push(req.body.version_notes || null);
    }
    if (typeof req.body.case_size === 'string') {
      if (!CASE_SIZE_VALUES.includes(req.body.case_size)) {
        return fail(res, 400, `case_size must be one of ${CASE_SIZE_VALUES.join(', ')}`);
      }
      updates.push('case_size = ?');
      params.push(req.body.case_size);
    }
    if (updates.length === 0) return fail(res, 400, 'No editable fields supplied');

    params.push(req.params.vid, req.params.id);
    const [result] = await pool.execute(
      `UPDATE case_versions SET ${updates.join(', ')} WHERE case_version_id = ? AND project_id = ?`,
      params
    );
    if (result.affectedRows === 0) return fail(res, 404, 'Version not found');

    const [rows] = await pool.execute(
      `SELECT case_version_id, project_id, case_size, version_name, version_notes,
              model_id, word_count, version_created, version_updated
       FROM case_versions WHERE case_version_id = ?`,
      [req.params.vid]
    );
    ok(res, rows[0]);
  } catch (err) {
    console.error('[caseWriter] patch version error:', err);
    fail(res, 500, err.message);
  }
});

router.delete('/projects/:id/versions/:vid', async (req, res) => {
  try {
    const { project, forbidden } = await loadProject(req.params.id, req);
    if (forbidden) return fail(res, 403, 'Not authorized to access this project');
    if (!project) return fail(res, 404, 'Project not found');

    const [result] = await pool.execute(
      'DELETE FROM case_versions WHERE case_version_id = ? AND project_id = ?',
      [req.params.vid, req.params.id]
    );
    if (result.affectedRows === 0) return fail(res, 404, 'Version not found');
    ok(res, { deleted: true });
  } catch (err) {
    console.error('[caseWriter] delete version error:', err);
    fail(res, 500, err.message);
  }
});

// Copy a saved version's text back into the project's working draft. Snapshots
// whatever was in the working draft first via case_writer_revisions, so the
// user can recover the pre-load text from the existing revisions table.
router.post('/projects/:id/versions/:vid/load', async (req, res) => {
  try {
    const { project, forbidden } = await loadProject(req.params.id, req);
    if (forbidden) return fail(res, 403, 'Not authorized to access this project');
    if (!project) return fail(res, 404, 'Project not found');

    const [rows] = await pool.execute(
      'SELECT case_text FROM case_versions WHERE case_version_id = ? AND project_id = ?',
      [req.params.vid, req.params.id]
    );
    if (rows.length === 0) return fail(res, 404, 'Version not found');

    if (project.student_case) {
      await recordRevision(req.params.id, 'student_case', project.student_case || '', req.user.id);
    }
    await pool.execute(
      'UPDATE case_writer_projects SET student_case = ? WHERE project_id = ?',
      [rows[0].case_text, req.params.id]
    );
    ok(res, { student_case: rows[0].case_text });
  } catch (err) {
    console.error('[caseWriter] load version error:', err);
    fail(res, 500, err.message);
  }
});

// ----------------------------------------------------------------------------
// Generation: teaching brief (markdown)
// ----------------------------------------------------------------------------

router.post('/projects/:id/generate/brief', async (req, res) => {
  try {
    const { project, forbidden } = await loadProject(req.params.id, req);
    if (forbidden) return fail(res, 403, 'Not authorized to access this project');
    if (!project) return fail(res, 404, 'Project not found');

    if (!project.teaching_principle || !project.teaching_principle.trim()) {
      return fail(res, 400, 'Project is missing a teaching_principle');
    }

    const { model_id: requestedModelId, revision_hint } = req.body || {};

    if (project.learning_brief) {
      await recordRevision(req.params.id, 'brief', (project.learning_brief || ''), req.user.id);
    }

    const sourceMaterials = await loadSourceMaterials(req.params.id, 'brief');
    const activePrompt = await getActivePrompt('case_writer.teaching_brief');
    const renderedPrompt = renderPrompt(activePrompt.prompt_template, {
      teaching_principle: project.teaching_principle || '',
      audience: project.audience || '',
      course_context: project.course_context || '',
      difficulty: project.difficulty || '',
      case_type: project.case_type || '',
      source_materials: sourceMaterials,
      revision_hint: revision_hint || ''
    });

    const model = await resolveModel(requestedModelId, project.default_model_id);
    const start = Date.now();
    const { text, meta } = await callOutline(req, {
      modelId: model.model_id,
      vendor: model.vendor,
      prompt: renderedPrompt,
      config: {
        temperature: model.temperature,
        reasoning_effort: model.reasoning_effort,
        maxTokens: 32000
      }
    });
    await maybeLogCaseWriterPrompt(req, {
      step: 'teaching_brief',
      promptUse: 'case_writer.teaching_brief',
      modelId: model.model_id,
      renderedPrompt,
      response: text,
      meta,
      durationMs: Date.now() - start
    });

    const markdown = stripMarkdownFence(text);
    if (!markdown) return fail(res, 502, 'LLM returned an empty response');

    await pool.execute(
      'UPDATE case_writer_projects SET learning_brief = ? WHERE project_id = ?',
      [markdown, req.params.id]
    );

    ok(res, {
      markdown,
      meta: {
        model_id: model.model_id,
        vendor: model.vendor,
        prompt_version: activePrompt.version,
        provider: meta?.provider || null
      }
    });
  } catch (err) {
    console.error('[caseWriter] generate brief error:', err);
    fail(res, 500, err.message);
  }
});

// ----------------------------------------------------------------------------
// Generation: scenario alternatives (JSON wrapper, markdown bodies)
// ----------------------------------------------------------------------------

router.post('/projects/:id/generate/scenarios', async (req, res) => {
  try {
    const { project, forbidden } = await loadProject(req.params.id, req);
    if (forbidden) return fail(res, 403, 'Not authorized to access this project');
    if (!project) return fail(res, 404, 'Project not found');

    if (!project.learning_brief) {
      return fail(res, 400, 'Project must have an approved learning_brief before generating scenarios');
    }

    const {
      model_id: requestedModelId,
      count: requestedCount,
      industry_preference,
      revision_hint
    } = req.body || {};

    let count = Number.parseInt(requestedCount, 10);
    if (!Number.isFinite(count)) count = 3;
    count = Math.max(1, Math.min(5, count));

    if (project.scenario_options) {
      await recordRevision(req.params.id, 'scenarios', asJson(project.scenario_options), req.user.id);
    }

    // Fall back to the project's persisted industries_preference if the
    // request didn't include one. This lets the value the instructor typed
    // in the Scenarios pane survive page reloads.
    const effectiveIndustryPref =
      (typeof industry_preference === 'string' && industry_preference.trim())
        ? industry_preference
        : (project.industries_preference || '');

    const sourceMaterials = await loadSourceMaterials(req.params.id, 'scenarios');
    const activePrompt = await getActivePrompt('case_writer.scenario_generation');
    const renderedPrompt = renderPrompt(activePrompt.prompt_template, {
      learning_brief: (project.learning_brief || ''),
      source_materials: sourceMaterials,
      count: String(count),
      industry_preference: effectiveIndustryPref,
      revision_hint: revision_hint || ''
    });

    const model = await resolveModel(requestedModelId, project.default_model_id);
    const start = Date.now();
    const { text, meta } = await callOutline(req, {
      modelId: model.model_id,
      vendor: model.vendor,
      prompt: renderedPrompt,
      config: {
        temperature: model.temperature,
        reasoning_effort: model.reasoning_effort,
        maxTokens: 32000
      }
    });
    await maybeLogCaseWriterPrompt(req, {
      step: 'scenarios',
      promptUse: 'case_writer.scenario_generation',
      modelId: model.model_id,
      renderedPrompt,
      response: text,
      meta,
      durationMs: Date.now() - start
    });

    let parsed;
    try {
      parsed = extractJsonObject(text);
    } catch (parseErr) {
      console.error('[caseWriter] scenarios JSON parse failed:', parseErr.message, 'raw:', text?.slice(0, 500));
      return fail(res, 502, `LLM returned non-JSON response: ${parseErr.message}`);
    }

    const scenarios = Array.isArray(parsed?.scenarios) ? parsed.scenarios : null;
    if (!scenarios || scenarios.length === 0) {
      return fail(res, 502, 'LLM response missing scenarios array');
    }

    const enriched = scenarios.map(sc => ({
      ...sc,
      markdown: assembleScenarioMarkdown(sc)
    }));

    await pool.execute(
      'UPDATE case_writer_projects SET scenario_options = ? WHERE project_id = ?',
      [JSON.stringify(enriched), req.params.id]
    );

    ok(res, {
      scenarios: enriched,
      meta: {
        model_id: model.model_id,
        vendor: model.vendor,
        prompt_version: activePrompt.version,
        provider: meta?.provider || null,
        requested_count: count,
        returned_count: enriched.length
      }
    });
  } catch (err) {
    console.error('[caseWriter] generate scenarios error:', err);
    fail(res, 500, err.message);
  }
});

// ----------------------------------------------------------------------------
// Generation: case blueprint (markdown)
// ----------------------------------------------------------------------------

router.post('/projects/:id/generate/blueprint', async (req, res) => {
  try {
    const { project, forbidden } = await loadProject(req.params.id, req);
    if (forbidden) return fail(res, 403, 'Not authorized to access this project');
    if (!project) return fail(res, 404, 'Project not found');

    if (!project.learning_brief) {
      return fail(res, 400, 'Project must have an approved learning_brief before generating a blueprint');
    }
    if (!project.selected_scenario) {
      return fail(res, 400, 'Project must have a selected_scenario before generating a blueprint');
    }

    const { model_id: requestedModelId, revision_hint } = req.body || {};

    if (project.case_blueprint) {
      await recordRevision(req.params.id, 'blueprint', (project.case_blueprint || ''), req.user.id);
    }

    const selected = asJson(project.selected_scenario) || {};
    const selectedScenarioText = [
      selected.title ? `Title: ${selected.title}` : '',
      selected.industry ? `Industry: ${selected.industry}` : '',
      selected.markdown || ''
    ].filter(Boolean).join('\n\n');

    const sourceMaterials = await loadSourceMaterials(req.params.id, 'blueprint');
    const activePrompt = await getActivePrompt('case_writer.case_blueprint');
    const renderedPrompt = renderPrompt(activePrompt.prompt_template, {
      learning_brief: (project.learning_brief || ''),
      selected_scenario: selectedScenarioText,
      source_materials: sourceMaterials,
      revision_hint: revision_hint || ''
    });

    const model = await resolveModel(requestedModelId, project.default_model_id);
    const start = Date.now();
    const { text, meta } = await callOutline(req, {
      modelId: model.model_id,
      vendor: model.vendor,
      prompt: renderedPrompt,
      config: {
        temperature: model.temperature,
        reasoning_effort: model.reasoning_effort,
        maxTokens: 32000
      }
    });
    await maybeLogCaseWriterPrompt(req, {
      step: 'blueprint',
      promptUse: 'case_writer.case_blueprint',
      modelId: model.model_id,
      renderedPrompt,
      response: text,
      meta,
      durationMs: Date.now() - start
    });

    const markdown = stripMarkdownFence(text);
    if (!markdown) return fail(res, 502, 'LLM returned an empty response');

    await pool.execute(
      'UPDATE case_writer_projects SET case_blueprint = ? WHERE project_id = ?',
      [markdown, req.params.id]
    );

    ok(res, {
      markdown,
      meta: {
        model_id: model.model_id,
        vendor: model.vendor,
        prompt_version: activePrompt.version,
        provider: meta?.provider || null
      }
    });
  } catch (err) {
    console.error('[caseWriter] generate blueprint error:', err);
    fail(res, 500, err.message);
  }
});

// ----------------------------------------------------------------------------
// Generation: student-facing case draft (markdown)
// ----------------------------------------------------------------------------

const LENGTH_PRESETS = {
  story_problem: 'Story-problem, about 200 to 500 words, no exhibits, a single short scenario',
  mini:          'Mini case, about 500 to 1000 words, 1 to 2 exhibits',
  abridged:      'Abridged case, about 1000 to 2000 words, 1 to 2 exhibits',
  regular:       'Regular case, about 2000 to 4000 words, normal exhibits',
  expanded:      'Expanded case, about 4000 to 7500 words, generous exhibits'
};
// Back-compat aliases — older clients (and any existing API consumers) keep working.
const LENGTH_ALIASES = { standard: 'regular', extended: 'expanded' };

router.post('/projects/:id/generate/student-case', async (req, res) => {
  try {
    const { project, forbidden } = await loadProject(req.params.id, req);
    if (forbidden) return fail(res, 403, 'Not authorized to access this project');
    if (!project) return fail(res, 404, 'Project not found');

    if (!project.learning_brief) {
      return fail(res, 400, 'Project must have an approved learning_brief before generating the student case');
    }
    if (!project.case_blueprint) {
      return fail(res, 400, 'Project must have an approved case_blueprint before generating the student case');
    }

    const { model_id: requestedModelId, length, revision_hint } = req.body || {};
    const aliasedLength = LENGTH_ALIASES[length] || length;
    const lengthKey = LENGTH_PRESETS[aliasedLength] ? aliasedLength : 'regular';
    const lengthTarget = LENGTH_PRESETS[lengthKey];

    if (project.student_case) {
      await recordRevision(req.params.id, 'student_case', (project.student_case || ''), req.user.id);
    }

    const sourceMaterials = await loadSourceMaterials(req.params.id, 'student_case');
    const activePrompt = await getActivePrompt('case_writer.student_case_draft');
    const renderedPrompt = renderPrompt(activePrompt.prompt_template, {
      learning_brief: (project.learning_brief || ''),
      case_blueprint: (project.case_blueprint || ''),
      source_materials: sourceMaterials,
      revision_hint: revision_hint || '',
      length_target: lengthTarget
    });

    const model = await resolveModel(requestedModelId, project.default_model_id);
    const start = Date.now();
    const { text, meta } = await callOutline(req, {
      modelId: model.model_id,
      vendor: model.vendor,
      prompt: renderedPrompt,
      config: {
        temperature: model.temperature,
        reasoning_effort: model.reasoning_effort,
        // Student cases can run thousands of words; default per-provider caps
        // silently truncate (this was the "Student Case Generate returns nothing"
        // bug in V1).
        maxTokens: 32000
      }
    });
    await maybeLogCaseWriterPrompt(req, {
      step: 'student_case',
      promptUse: 'case_writer.student_case_draft',
      modelId: model.model_id,
      renderedPrompt,
      response: text,
      meta,
      durationMs: Date.now() - start
    });

    const markdown = stripMarkdownFence(text);
    if (!markdown) return fail(res, 502, 'LLM returned an empty response');

    await pool.execute(
      'UPDATE case_writer_projects SET student_case = ? WHERE project_id = ?',
      [markdown, req.params.id]
    );

    ok(res, {
      markdown,
      meta: {
        model_id: model.model_id,
        vendor: model.vendor,
        prompt_version: activePrompt.version,
        provider: meta?.provider || null,
        length: lengthKey
      }
    });
  } catch (err) {
    console.error('[caseWriter] generate student case error:', err);
    fail(res, 500, err.message);
  }
});

// ----------------------------------------------------------------------------
// Generation: instructor-only teaching note (markdown)
// ----------------------------------------------------------------------------

const TEACHING_NOTE_FORMATS = {
  brief:    '1 to 2 pages',
  standard: '4 to 6 pages',
  detailed: 'Full instructor guide, 8 or more pages'
};

router.post('/projects/:id/generate/teaching-note', async (req, res) => {
  try {
    const { project, forbidden } = await loadProject(req.params.id, req);
    if (forbidden) return fail(res, 403, 'Not authorized to access this project');
    if (!project) return fail(res, 404, 'Project not found');

    if (!project.learning_brief) return fail(res, 400, 'Project must have an approved learning_brief before generating the teaching note');
    if (!project.case_blueprint) return fail(res, 400, 'Project must have an approved case_blueprint before generating the teaching note');
    if (!project.student_case)   return fail(res, 400, 'Project must have a student_case draft before generating the teaching note');

    const { model_id: requestedModelId, format, revision_hint } = req.body || {};
    const formatKey = TEACHING_NOTE_FORMATS[format] ? format : 'standard';
    const formatTarget = TEACHING_NOTE_FORMATS[formatKey];

    if (project.teaching_note) {
      await recordRevision(req.params.id, 'teaching_note', (project.teaching_note || ''), req.user.id);
    }

    const sourceMaterials = await loadSourceMaterials(req.params.id, 'teaching_note');
    const activePrompt = await getActivePrompt('case_writer.teaching_note');
    const renderedPrompt = renderPrompt(activePrompt.prompt_template, {
      learning_brief: (project.learning_brief || ''),
      case_blueprint: (project.case_blueprint || ''),
      student_case_markdown: (project.student_case || ''),
      source_materials: sourceMaterials,
      format_target: formatTarget,
      revision_hint: revision_hint || ''
    });

    const model = await resolveModel(requestedModelId, project.default_model_id);
    const start = Date.now();
    const { text, meta } = await callOutline(req, {
      modelId: model.model_id,
      vendor: model.vendor,
      prompt: renderedPrompt,
      config: {
        temperature: model.temperature,
        reasoning_effort: model.reasoning_effort,
        maxTokens: 32000
      }
    });
    await maybeLogCaseWriterPrompt(req, {
      step: 'teaching_note',
      promptUse: 'case_writer.teaching_note',
      modelId: model.model_id,
      renderedPrompt,
      response: text,
      meta,
      durationMs: Date.now() - start
    });

    const rawMarkdown = stripMarkdownFence(text);
    if (!rawMarkdown) return fail(res, 502, 'LLM returned an empty response');

    const titleLine = `# Teaching note for: ${project.title || 'Untitled case'}\n\n`;
    const alreadyTitled = /^#\s+Teaching note for:/i.test(rawMarkdown.trimStart());
    const markdown = alreadyTitled ? rawMarkdown : titleLine + rawMarkdown;

    await pool.execute(
      'UPDATE case_writer_projects SET teaching_note = ? WHERE project_id = ?',
      [markdown, req.params.id]
    );

    ok(res, {
      markdown,
      meta: {
        model_id: model.model_id,
        vendor: model.vendor,
        prompt_version: activePrompt.version,
        provider: meta?.provider || null,
        format: formatKey
      }
    });
  } catch (err) {
    console.error('[caseWriter] generate teaching note error:', err);
    fail(res, 500, err.message);
  }
});

// ----------------------------------------------------------------------------
// Boundary validation
// ----------------------------------------------------------------------------

async function runBoundaryValidation(req, project, requestedModelId) {
  const studentCaseMarkdown = (project.student_case || '');

  const activePrompt = await getActivePrompt('case_writer.boundary_validation');
  const renderedPrompt = renderPrompt(activePrompt.prompt_template, {
    student_case_markdown: studentCaseMarkdown
  });

  const model = await resolveModel(requestedModelId, project.default_model_id);
  const { text, meta } = await callOutline(req, {
    modelId: model.model_id,
    vendor: model.vendor,
    prompt: renderedPrompt,
    config: {
      temperature: model.temperature,
      reasoning_effort: model.reasoning_effort
    }
  });

  const parsed = extractJsonObject(text);
  const violations = Array.isArray(parsed?.violations) ? parsed.violations : [];
  const passes = violations.length === 0 && parsed?.passes !== false;
  return {
    passes,
    summary: parsed?.summary || '',
    violations,
    meta: {
      model_id: model.model_id,
      vendor: model.vendor,
      prompt_version: activePrompt.version,
      provider: meta?.provider || null
    }
  };
}

router.post('/projects/:id/validate', async (req, res) => {
  try {
    const { project, forbidden } = await loadProject(req.params.id, req);
    if (forbidden) return fail(res, 403, 'Not authorized to access this project');
    if (!project) return fail(res, 404, 'Project not found');

    if (!project.student_case) {
      return fail(res, 400, 'Project must have a student_case before validation');
    }

    const result = await runBoundaryValidation(req, project, req.body?.model_id);
    ok(res, result);
  } catch (err) {
    console.error('[caseWriter] validate error:', err);
    fail(res, 500, err.message);
  }
});

// ----------------------------------------------------------------------------
// Publish-field extraction (auto-fill the structured publish form)
// ----------------------------------------------------------------------------

router.post('/projects/:id/extract-publish-fields', async (req, res) => {
  try {
    const { project, forbidden } = await loadProject(req.params.id, req);
    if (forbidden) return fail(res, 403, 'Not authorized to access this project');
    if (!project) return fail(res, 404, 'Project not found');

    if (!project.student_case)  return fail(res, 400, 'Project must have a student_case before extracting publish fields');
    if (!project.teaching_note) return fail(res, 400, 'Project must have a teaching_note before extracting publish fields');

    const activePrompt = await getActivePrompt('case_writer.publish_field_extraction');
    const renderedPrompt = renderPrompt(activePrompt.prompt_template, {
      student_case_markdown: (project.student_case || ''),
      teaching_note_markdown: (project.teaching_note || '')
    });

    const model = await resolveModel(req.body?.model_id, project.default_model_id);
    const start = Date.now();
    const { text, meta } = await callOutline(req, {
      modelId: model.model_id,
      vendor: model.vendor,
      prompt: renderedPrompt,
      config: {
        temperature: model.temperature,
        reasoning_effort: model.reasoning_effort,
        maxTokens: 8000
      }
    });
    await maybeLogCaseWriterPrompt(req, {
      step: 'publish_field_extraction',
      promptUse: 'case_writer.publish_field_extraction',
      modelId: model.model_id,
      renderedPrompt,
      response: text,
      meta,
      durationMs: Date.now() - start
    });

    let parsed;
    try {
      parsed = extractJsonObject(text);
    } catch (parseErr) {
      return fail(res, 502, `LLM returned non-JSON response: ${parseErr.message}`);
    }

    ok(res, {
      protagonist: parsed?.protagonist || '',
      chat_question: parsed?.chat_question || '',
      arguments_for: parsed?.arguments_for || '',
      arguments_against: parsed?.arguments_against || '',
      meta: {
        model_id: model.model_id,
        vendor: model.vendor,
        prompt_version: activePrompt.version,
        provider: meta?.provider || null
      }
    });
  } catch (err) {
    console.error('[caseWriter] extract publish fields error:', err);
    fail(res, 500, err.message);
  }
});

// ----------------------------------------------------------------------------
// Principle extraction (project-less; takes raw text or an uploaded file id)
// ----------------------------------------------------------------------------

router.post('/extract-principles',
  (req, res, next) => {
    const ct = req.headers['content-type'] || '';
    if (!ct.includes('multipart/form-data')) return next();
    principleUpload.single('file')(req, res, (err) => {
      if (err) return fail(res, 400, err.message);
      next();
    });
  },
  async (req, res) => {
  try {
    const { title, type, content, case_file_id, model_id } = req.body || {};

    let sourceContent = content || '';
    let sourceTitle = title || '';
    let sourceType = type || 'pasted_text';
    if (req.file) {
      const extWithDot = path.extname(req.file.originalname).toLowerCase();
      try {
        const result = await convertFile(req.file.path, extWithDot);
        sourceContent = result?.text || '';
        sourceTitle = sourceTitle || req.file.originalname;
        sourceType = 'uploaded_file';
      } catch (err) {
        return fail(res, 422, `Could not extract text from file: ${err.message}`);
      } finally {
        // best-effort cleanup of the temp file
        fs.unlink(req.file.path).catch(() => {});
      }
    } else if (!sourceContent && case_file_id) {
      const [rows] = await pool.execute(
        'SELECT converted_text FROM case_files WHERE id = ?',
        [case_file_id]
      );
      if (rows.length === 0) return fail(res, 404, 'case_file not found');
      sourceContent = rows[0].converted_text || '';
    }
    if (!sourceContent.trim()) {
      return fail(res, 400, 'No source content provided (need content, file, or case_file_id)');
    }

    const activePrompt = await getActivePrompt('case_writer.principle_extraction');
    const renderedPrompt = renderPrompt(activePrompt.prompt_template, {
      title: sourceTitle,
      type: sourceType,
      content: sourceContent
    });

    const model = await resolveModel(model_id);
    const { text, meta } = await callOutline(req, {
      modelId: model.model_id,
      vendor: model.vendor,
      prompt: renderedPrompt,
      config: {
        temperature: model.temperature,
        reasoning_effort: model.reasoning_effort,
        maxTokens: 8000
      }
    });

    let parsed;
    try {
      parsed = extractJsonObject(text);
    } catch (parseErr) {
      return fail(res, 502, `LLM returned non-JSON response: ${parseErr.message}`);
    }

    const principles = Array.isArray(parsed?.principles) ? parsed.principles : [];
    ok(res, {
      principles,
      meta: {
        model_id: model.model_id,
        vendor: model.vendor,
        prompt_version: activePrompt.version,
        provider: meta?.provider || null
      }
    });
  } catch (err) {
    console.error('[caseWriter] extract principles error:', err);
    fail(res, 500, err.message);
  }
});

// ----------------------------------------------------------------------------
// Publish: materialize the project into cases / case_scenarios / case_files
// ----------------------------------------------------------------------------

function slugifyTitle(title) {
  return String(title || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'case';
}

async function generateUniqueCaseId(baseSlug) {
  const [existing] = await pool.execute(
    'SELECT case_id FROM cases WHERE case_id = ? OR case_id LIKE ?',
    [baseSlug, `${baseSlug}-%`]
  );
  if (existing.length === 0) return baseSlug;
  const taken = new Set(existing.map(r => r.case_id));
  for (let i = 2; i < 1000; i++) {
    const candidate = `${baseSlug}-${i}`.slice(0, 30);
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(`Could not generate a unique case_id from base '${baseSlug}'`);
}

function deriveInitials(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  const letters = parts.map(p => p[0]?.toUpperCase() || '').join('');
  return letters.slice(0, 5) || '?';
}

// Extract the first H1 heading text from a markdown document, if any.
function extractFirstHeading(markdown) {
  if (!markdown) return '';
  const m = String(markdown).match(/^\s*#\s+(.+?)\s*$/m);
  return m ? m[1].trim() : '';
}

router.post('/projects/:id/publish', async (req, res) => {
  let createdCaseId = null;
  let createdCaseDir = null;
  try {
    const { project, forbidden } = await loadProject(req.params.id, req);
    if (forbidden) return fail(res, 403, 'Not authorized to access this project');
    if (!project) return fail(res, 404, 'Project not found');

    if (project.published_case_id) {
      return fail(res, 409, `Project already published as case '${project.published_case_id}'`);
    }

    if (!project.student_case)  return fail(res, 400, 'student_case is required to publish');
    if (!project.teaching_note) return fail(res, 400, 'teaching_note is required to publish');
    if (!project.publish_protagonist?.trim()) return fail(res, 400, 'publish_protagonist is required (set it in the Publish setup form)');
    if (!project.publish_chat_question?.trim()) return fail(res, 400, 'publish_chat_question is required (set it in the Publish setup form)');

    const caseMarkdown = (project.student_case || '');
    const teachingNoteMarkdown = (project.teaching_note || '');

    const skipValidation = req.body?.skip_validation === true;
    let validation = null;
    if (!skipValidation) {
      validation = await runBoundaryValidation(req, project, req.body?.validation_model_id);
      if (!validation.passes) {
        return res.status(422).json({
          data: null,
          error: { message: 'Boundary validation failed; cannot publish', validation }
        });
      }
    }

    const caseTitle =
      project.title
      || extractFirstHeading(caseMarkdown)
      || 'Untitled Case';
    const baseSlug = slugifyTitle(project.title || caseTitle);
    const caseId = await generateUniqueCaseId(baseSlug);

    await pool.execute(
      `INSERT INTO cases (case_id, case_title, case_version, enabled, created_by_type, created_by)
       VALUES (?, ?, ?, 1, ?, ?)`,
      [caseId, caseTitle.slice(0, 100), 'v1', project.owner_type, project.owner_id]
    );
    createdCaseId = caseId;

    const protagonistName = project.publish_protagonist.trim();
    const chatQuestion = project.publish_chat_question.trim();
    const argsFor = project.publish_arguments_for?.trim() || null;
    const argsAgainst = project.publish_arguments_against?.trim() || null;

    await pool.execute(
      `INSERT INTO case_scenarios
         (case_id, scenario_name, protagonist, protagonist_initials, protagonist_role,
          chat_topic, chat_question, arguments_for, arguments_against, sort_order, enabled)
       VALUES (?, 'Default Scenario', ?, ?, ?, ?, ?, ?, ?, 0, 1)`,
      [
        caseId,
        protagonistName.slice(0, 100),
        deriveInitials(protagonistName),
        '',
        null,
        chatQuestion,
        argsFor,
        argsAgainst
      ]
    );

    const caseDir = path.join(CASE_FILES_DIR, caseId);
    await fs.mkdir(caseDir, { recursive: true });
    createdCaseDir = caseDir;
    const caseFilename = 'case.md';
    const noteFilename = 'teaching_note.md';
    const caseFilePath = path.join(caseDir, caseFilename);
    const noteFilePath = path.join(caseDir, noteFilename);
    await fs.writeFile(caseFilePath, caseMarkdown, 'utf8');
    await fs.writeFile(noteFilePath, teachingNoteMarkdown, 'utf8');

    const caseStats = await fs.stat(caseFilePath);
    const noteStats = await fs.stat(noteFilePath);

    await pool.execute(
      `INSERT INTO case_files
         (case_id, filename, file_type, file_format, file_source, original_filename,
          file_size, processing_status, include_in_chat_prompt, prompt_order,
          converted_text, converted_at)
       VALUES (?, ?, 'case', 'md', 'case_writer', ?, ?, 'completed', 1, 0, ?, NOW())`,
      [caseId, caseFilename, caseFilename, caseStats.size, caseMarkdown]
    );
    await pool.execute(
      `INSERT INTO case_files
         (case_id, filename, file_type, file_format, file_source, original_filename,
          file_size, processing_status, include_in_chat_prompt, prompt_order,
          converted_text, converted_at)
       VALUES (?, ?, 'teaching_note', 'md', 'case_writer', ?, ?, 'completed', 1, 1, ?, NOW())`,
      [caseId, noteFilename, noteFilename, noteStats.size, teachingNoteMarkdown]
    );

    await pool.execute(
      `UPDATE case_writer_projects
         SET status = 'published', published_case_id = ?, title = COALESCE(title, ?)
       WHERE project_id = ?`,
      [caseId, caseTitle, req.params.id]
    );

    ok(res, {
      case_id: caseId,
      case_title: caseTitle,
      validation,
      files: [caseFilename, noteFilename]
    });
  } catch (err) {
    console.error('[caseWriter] publish error:', err);
    if (createdCaseId) {
      try { await pool.execute('DELETE FROM case_files WHERE case_id = ?', [createdCaseId]); } catch {}
      try { await pool.execute('DELETE FROM case_scenarios WHERE case_id = ?', [createdCaseId]); } catch {}
      try { await pool.execute('DELETE FROM cases WHERE case_id = ?', [createdCaseId]); } catch {}
    }
    if (createdCaseDir) {
      try { await fs.rm(createdCaseDir, { recursive: true, force: true }); } catch {}
    }
    fail(res, 500, err.message);
  }
});

// ----------------------------------------------------------------------------
// Reference summarization (unchanged shape; output is still JSON)
// ----------------------------------------------------------------------------

// Suggest which sections of a reference are worth feeding to generation.
//
// Only the OUTLINE is sent to the model — id, title, size, and a short opening
// snippet per section — never the document body. That keeps the call cheap
// enough to click freely on a 110,000-character textbook, and keeps
// adversary-controlled document text out of the prompt beyond the snippets
// (which the prompt wraps in XML and marks as data).
//
// Deliberately does NOT persist: it returns a suggestion, the picker pre-checks
// the boxes, and the instructor saves. The model never silently decides what
// grounds a case.
router.post('/projects/:id/references/:refId/suggest-sections', async (req, res) => {
  try {
    const { project, forbidden } = await loadProject(req.params.id, req);
    if (forbidden) return fail(res, 403, 'Not authorized to access this project');
    if (!project) return fail(res, 404, 'Project not found');

    const { step, model_id: requestedModelId } = req.body || {};
    if (step && !SELECTION_STEPS.includes(step)) {
      return fail(res, 400, `step must be one of: ${SELECTION_STEPS.join(', ')}`);
    }

    const [rows] = await pool.execute(
      `SELECT reference_id, type, title, content, outline, outline_hash
       FROM case_writer_references WHERE reference_id = ? AND project_id = ?`,
      [req.params.refId, req.params.id]
    );
    if (rows.length === 0) return fail(res, 404, 'Reference not found');
    const ref = rows[0];
    const content = ref.content || '';

    let outline = parseJsonColumn(ref.outline);
    if (!outline && content.trim()) {
      outline = await refreshReferenceOutline(ref.reference_id, content, ref.type === 'uploaded_file' ? 'pdf' : 'text');
    }
    const sections = outline?.sections || [];
    if (sections.length === 0) return fail(res, 400, 'This reference has no detected sections to choose from');

    const outlineText = sections
      .map(s => `${s.id} | ${s.chars} | ${s.title} | ${content.slice(s.start, s.start + 120).replace(/\s+/g, ' ').trim()}`)
      .join('\n');

    const caseContext = [
      project.audience ? `Audience: ${project.audience}` : '',
      project.course_context ? `Course: ${project.course_context}` : '',
      project.difficulty ? `Difficulty: ${project.difficulty}` : '',
      project.case_type ? `Case type: ${project.case_type}` : '',
      step ? `Generation step this selection is for: ${step}` : ''
    ].filter(Boolean).join('\n');

    const activePrompt = await getActivePrompt('case_writer.reference_section_select');
    const renderedPrompt = renderPrompt(activePrompt.prompt_template, {
      teaching_principle: project.teaching_principle || '',
      case_context: caseContext,
      document_title: ref.title || '',
      outline: outlineText,
      char_budget: String(REFERENCE_TEXT_CHAR_CAP)
    });

    const model = await resolveModel(requestedModelId, project.default_model_id);
    const { text, meta } = await callOutline(req, {
      modelId: model.model_id,
      vendor: model.vendor,
      prompt: renderedPrompt,
      config: { temperature: model.temperature, reasoning_effort: model.reasoning_effort }
    });

    let suggestion;
    try {
      suggestion = extractJsonObject(text);
    } catch (parseErr) {
      console.error('[caseWriter] suggest-sections JSON parse failed:', parseErr.message, 'raw:', text?.slice(0, 500));
      return fail(res, 502, `LLM returned non-JSON response: ${parseErr.message}`);
    }

    // Drop hallucinated ids rather than handing the client something that
    // silently selects nothing when saved.
    const known = new Set(sections.map(s => s.id));
    const requested = Array.isArray(suggestion?.section_ids) ? suggestion.section_ids : [];
    const sectionIds = requested.filter(id => known.has(id));
    const dropped = requested.length - sectionIds.length;

    ok(res, {
      reference_id: ref.reference_id,
      section_ids: sectionIds,
      estimated_chars: sections.filter(s => sectionIds.includes(s.id)).reduce((n, s) => n + s.chars, 0),
      rationale: typeof suggestion?.rationale === 'string' ? suggestion.rationale : '',
      dropped_unknown_ids: dropped,
      meta: {
        model_id: model.model_id,
        vendor: model.vendor,
        prompt_version: activePrompt.version,
        provider: meta?.provider || null
      }
    });
  } catch (err) {
    console.error('[caseWriter] suggest sections error:', err);
    fail(res, 500, err.message);
  }
});

router.post('/projects/:id/references/:refId/summarize', async (req, res) => {
  try {
    const { project, forbidden } = await loadProject(req.params.id, req);
    if (forbidden) return fail(res, 403, 'Not authorized to access this project');
    if (!project) return fail(res, 404, 'Project not found');

    const [refRows] = await pool.execute(
      `SELECT r.reference_id, r.project_id, r.type, r.title, r.content, r.source_notes,
              r.outline, r.outline_hash, r.selection, r.selection_overrides,
              r.case_file_id, cf.converted_text AS file_text
       FROM case_writer_references r
       LEFT JOIN case_files cf ON cf.id = r.case_file_id
       WHERE r.reference_id = ? AND r.project_id = ?`,
      [req.params.refId, req.params.id]
    );
    if (refRows.length === 0) return fail(res, 404, 'Reference not found');
    const ref = refRows[0];

    let sourceText = '';
    if (ref.type === 'pasted_text') sourceText = ref.content || '';
    else if (ref.type === 'uploaded_file') sourceText = ref.content || ref.file_text || '';
    else if (ref.type === 'saved_framework') sourceText = ref.content || '';
    // A link is summarizable once its page has been fetched into `content`; before
    // that there is nothing but a URL to work with.
    else if (ref.type === 'link') {
      sourceText = ref.content || '';
      if (!sourceText.trim()) {
        return fail(res, 400, 'This link has no page text yet — click "Fetch page text" first.');
      }
    }

    if (!sourceText.trim()) {
      return fail(res, 400, 'Reference has no readable content to summarize');
    }

    // Summarize the instructor's selection, not the whole document, so the
    // summary and the document-text channel always describe the same portion.
    // Uses the reference's default selection — there is one summary per
    // reference, so a per-step override cannot have its own.
    const ranges = resolveSelectionRanges(ref, sourceText, null);
    const outlineSections = parseJsonColumn(ref.outline)?.sections || [];
    const selectedIds = effectiveSelection(ref, null)?.sections || [];
    const excerptCount = effectiveSelection(ref, null)?.excerpts?.length || 0;

    let scopeNote = 'The complete document.';
    if (ranges) {
      sourceText = assembleSelectedText(sourceText, ranges);
      const titles = outlineSections.filter(s => selectedIds.includes(s.id)).map(s => s.title);
      scopeNote = [
        titles.length
          ? `${titles.length} of ${outlineSections.length} sections selected by the instructor: ${titles.join('; ')}.`
          : '',
        excerptCount ? `${excerptCount} hand-picked excerpt(s).` : '',
        'Skipped portions are marked with [...].'
      ].filter(Boolean).join(' ');
    }

    if (!sourceText.trim()) {
      return fail(res, 400, 'The current selection contains no text to summarize');
    }

    const activePrompt = await getActivePrompt('case_writer.reference_summary');
    const renderedPrompt = renderPrompt(activePrompt.prompt_template, {
      title: ref.title || '',
      type: ref.type,
      source_notes: ref.source_notes || '',
      scope_note: scopeNote,
      content: sourceText,
      // The summary editor is a MarkdownStepEditor, so it renders 💡 Hint like
      // the five step generators. Migration 076 added the matching placeholder;
      // all three layers have to be wired or the button does nothing.
      revision_hint: req.body?.revision_hint || ''
    });

    const model = await resolveModel(req.body?.model_id, project.default_model_id);
    const start = Date.now();
    const { text, meta } = await callOutline(req, {
      modelId: model.model_id,
      vendor: model.vendor,
      prompt: renderedPrompt,
      config: {
        temperature: model.temperature,
        reasoning_effort: model.reasoning_effort
      }
    });
    await maybeLogCaseWriterPrompt(req, {
      step: 'reference_summary',
      promptUse: 'case_writer.reference_summary',
      modelId: model.model_id,
      renderedPrompt,
      response: text,
      meta,
      durationMs: Date.now() - start
    });

    let summary;
    try {
      summary = extractJsonObject(text);
    } catch (parseErr) {
      console.error('[caseWriter] summarize JSON parse failed:', parseErr.message, 'raw:', text?.slice(0, 500));
      return fail(res, 502, `LLM returned non-JSON response: ${parseErr.message}`);
    }

    if (!summary?.summary) {
      return fail(res, 502, 'LLM response missing summary field');
    }

    await pool.execute(
      `UPDATE case_writer_references
         SET content_summary = ?, summary_scope_hash = ?, approved_by_user = 0
       WHERE reference_id = ?`,
      [JSON.stringify(summary), selectionScopeKey(ref, null), req.params.refId]
    );

    ok(res, {
      reference_id: req.params.refId,
      summary,
      summarized_scope: scopeNote,
      meta: {
        model_id: model.model_id,
        vendor: model.vendor,
        prompt_version: activePrompt.version,
        provider: meta?.provider || null
      }
    });
  } catch (err) {
    console.error('[caseWriter] summarize reference error:', err);
    fail(res, 500, err.message);
  }
});

// ----------------------------------------------------------------------------
// Section revision
// ----------------------------------------------------------------------------

const REVISE_STEP_TO_FIELD = {
  brief: 'learning_brief',
  scenarios: 'scenario_options',
  selected_scenario: 'selected_scenario',
  blueprint: 'case_blueprint',
  student_case: 'student_case',
  teaching_note: 'teaching_note'
};

// Output format per step. The revise prompt branches on this so the LLM knows
// whether to emit markdown or a specific JSON shape.
const REVISE_OUTPUT_FORMAT = {
  brief: 'markdown',
  scenarios: 'json_scenarios_array',
  selected_scenario: 'json_scenario_object',
  blueprint: 'markdown',
  student_case: 'markdown',
  teaching_note: 'markdown'
};

const REVISE_COMMANDS = new Set([
  'rewrite', 'shorten', 'expand', 'tighten', 'sharpen_decision',
  'add_ambiguity', 'harden_evidence', 'soften_tone', 'preserve_facts'
]);

router.post('/projects/:id/revise', async (req, res) => {
  try {
    const { project, forbidden } = await loadProject(req.params.id, req);
    if (forbidden) return fail(res, 403, 'Not authorized to access this project');
    if (!project) return fail(res, 404, 'Project not found');

    const { step, command, instruction, model_id: requestedModelId } = req.body || {};
    const field = REVISE_STEP_TO_FIELD[step];
    const outputFormat = REVISE_OUTPUT_FORMAT[step];
    if (!field || !outputFormat) {
      return fail(res, 400, `step must be one of: ${Object.keys(REVISE_STEP_TO_FIELD).join(', ')}`);
    }
    if (!command || !REVISE_COMMANDS.has(command)) {
      return fail(res, 400, `command must be one of: ${[...REVISE_COMMANDS].join(', ')}`);
    }

    const currentRaw = project[field];
    if (currentRaw === null || currentRaw === undefined) {
      return fail(res, 400, `Cannot revise ${step}: project has no value for this step yet`);
    }

    const isJsonStep = outputFormat.startsWith('json');
    const currentValueText = isJsonStep
      ? JSON.stringify(asJson(currentRaw), null, 2)
      : (currentRaw || '');

    await recordRevision(req.params.id, step, isJsonStep ? asJson(currentRaw) : (currentRaw || ''), req.user.id);

    const selectedForContext = asJson(project.selected_scenario);
    const selectedScenarioText = selectedForContext
      ? [
          selectedForContext.title ? `Title: ${selectedForContext.title}` : '',
          selectedForContext.industry ? `Industry: ${selectedForContext.industry}` : '',
          selectedForContext.markdown || ''
        ].filter(Boolean).join('\n\n')
      : '';

    const activePrompt = await getActivePrompt('case_writer.section_revision');
    const renderedPrompt = renderPrompt(activePrompt.prompt_template, {
      step,
      output_format: outputFormat,
      command,
      instruction: instruction || '',
      current_value: currentValueText,
      learning_brief: (project.learning_brief || ''),
      selected_scenario: selectedScenarioText,
      case_blueprint: (project.case_blueprint || ''),
      student_case_markdown: (project.student_case || '')
    });

    const model = await resolveModel(requestedModelId, project.default_model_id);
    const { text, meta } = await callOutline(req, {
      modelId: model.model_id,
      vendor: model.vendor,
      prompt: renderedPrompt,
      config: {
        temperature: model.temperature,
        reasoning_effort: model.reasoning_effort,
        maxTokens: 32000
      }
    });

    let revisedValueForStorage;
    let revisedForResponse;
    if (isJsonStep) {
      let parsed;
      try {
        parsed = extractJsonObject(text);
      } catch (parseErr) {
        return fail(res, 502, `LLM returned non-JSON response: ${parseErr.message}`);
      }
      if (outputFormat === 'json_scenarios_array') {
        const arr = Array.isArray(parsed?.scenarios) ? parsed.scenarios : null;
        if (!arr || arr.length === 0) return fail(res, 502, 'LLM response missing scenarios array');
        revisedValueForStorage = arr;
        revisedForResponse = { scenarios: arr };
      } else {
        revisedValueForStorage = parsed;
        revisedForResponse = parsed;
      }
    } else {
      const markdown = stripMarkdownFence(text);
      if (!markdown) return fail(res, 502, 'LLM returned an empty response');
      revisedValueForStorage = markdown;
      revisedForResponse = { markdown };
    }

    // Markdown columns (brief, blueprint, student_case, teaching_note) are
    // LONGTEXT after migration 043 — store the markdown string directly. JSON
    // columns (scenario_options, selected_scenario) still need JSON.stringify.
    const storedValue = isJsonStep
      ? JSON.stringify(revisedValueForStorage)
      : revisedValueForStorage;
    await pool.execute(
      `UPDATE case_writer_projects SET ${field} = ? WHERE project_id = ?`,
      [storedValue, req.params.id]
    );

    ok(res, {
      step,
      command,
      revised: revisedForResponse,
      meta: {
        model_id: model.model_id,
        vendor: model.vendor,
        prompt_version: activePrompt.version,
        provider: meta?.provider || null
      }
    });
  } catch (err) {
    console.error('[caseWriter] revise error:', err);
    fail(res, 500, err.message);
  }
});

// ----------------------------------------------------------------------------
// Tweak (free-form natural-language revision, no persistence)
//
// POST /projects/:id/tweak
// Body: { step, current_value, instruction, model_id? }
//   step:           one of brief | blueprint | student_case | teaching_note
//   current_value:  the markdown the user is looking at (may be unsaved edits)
//   instruction:    free-text instruction from the user
//   model_id:       optional override
// Returns: { revised, meta } — DOES NOT write to the project. The client renders
// a side-by-side diff and only persists if the user clicks Save after applying.
// ----------------------------------------------------------------------------

const TWEAK_STEPS = new Set(['brief', 'blueprint', 'student_case', 'teaching_note']);

router.post('/projects/:id/tweak', async (req, res) => {
  try {
    const { project, forbidden } = await loadProject(req.params.id, req);
    if (forbidden) return fail(res, 403, 'Not authorized to access this project');
    if (!project) return fail(res, 404, 'Project not found');

    const { step, current_value: currentValue, instruction, model_id: requestedModelId } = req.body || {};
    if (!step || !TWEAK_STEPS.has(step)) {
      return fail(res, 400, `step must be one of: ${[...TWEAK_STEPS].join(', ')}`);
    }
    if (typeof currentValue !== 'string' || !currentValue.trim()) {
      return fail(res, 400, 'current_value is required and cannot be empty');
    }
    if (typeof instruction !== 'string' || !instruction.trim()) {
      return fail(res, 400, 'instruction is required');
    }

    const sourceMaterials = await loadSourceMaterials(req.params.id, step);

    // Build a per-step BACKGROUND block. We deliberately omit whichever
    // upstream artifact is being tweaked (its content is already in
    // {current_value}), so the model never sees the same text twice with two
    // different labels — that's what caused the prompt scaffolding to leak
    // into Blueprint tweak output (migration 045 → 046).
    const backgroundBlocks = [];
    if (step !== 'brief' && project.learning_brief) {
      backgroundBlocks.push(`## Learning brief\n${project.learning_brief}`);
    }
    if (step !== 'blueprint' && project.case_blueprint) {
      backgroundBlocks.push(`## Case blueprint\n${project.case_blueprint}`);
    }
    // The student case grounds teaching-note tweaks; everywhere else it's
    // either the section under edit (step='student_case') or downstream from
    // the section under edit (so should not influence the tweak).
    if (step === 'teaching_note' && project.student_case) {
      backgroundBlocks.push(`## Student case\n${project.student_case}`);
    }
    if (sourceMaterials) {
      backgroundBlocks.push(`## Source materials (approved references)\n${sourceMaterials}`);
    }
    const background = backgroundBlocks.length
      ? backgroundBlocks.join('\n\n---\n\n')
      : '(no supporting context available)';

    const activePrompt = await getActivePrompt('case_writer.content_tweak');
    const renderedPrompt = renderPrompt(activePrompt.prompt_template, {
      step,
      instruction,
      current_value: currentValue,
      background,
      // Back-compat: the migration-045 template referenced these slots
      // individually. If somebody downgrades the active prompt, render still
      // works. New template (migration 046) ignores them.
      learning_brief: (project.learning_brief || ''),
      case_blueprint: (project.case_blueprint || ''),
      source_materials: sourceMaterials || '(none)'
    });

    const model = await resolveModel(requestedModelId, project.default_model_id);
    const { text, meta } = await callOutline(req, {
      modelId: model.model_id,
      vendor: model.vendor,
      prompt: renderedPrompt,
      config: {
        temperature: model.temperature,
        reasoning_effort: model.reasoning_effort,
        maxTokens: 32000
      }
    });

    const revised = stripMarkdownFence(text);
    if (!revised) return fail(res, 502, 'LLM returned an empty response');

    ok(res, {
      revised,
      meta: {
        model_id: model.model_id,
        vendor: model.vendor,
        prompt_version: activePrompt.version,
        provider: meta?.provider || null
      }
    });
  } catch (err) {
    console.error('[caseWriter] tweak error:', err);
    fail(res, 500, err.message);
  }
});

// ----------------------------------------------------------------------------
// Export (md / docx / pdf, document = case | teaching_note | combined)
// ----------------------------------------------------------------------------

function sanitizeForFilename(s) {
  return String(s || 'case').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'case';
}

router.get('/projects/:id/export', async (req, res) => {
  try {
    const { project, forbidden } = await loadProject(req.params.id, req);
    if (forbidden) return fail(res, 403, 'Not authorized to access this project');
    if (!project) return fail(res, 404, 'Project not found');

    const format = String(req.query.format || 'md').toLowerCase();
    const docKind = String(req.query.doc || 'combined').toLowerCase();
    if (!['md', 'docx', 'pdf'].includes(format)) {
      return fail(res, 400, "format must be one of: md, docx, pdf");
    }
    if (!['case', 'teaching_note', 'combined'].includes(docKind)) {
      return fail(res, 400, "doc must be one of: case, teaching_note, combined");
    }

    const caseMd = (project.student_case || '');
    const noteMd = (project.teaching_note || '');

    if (docKind === 'case' && !caseMd) return fail(res, 400, 'Project has no student_case to export');
    if (docKind === 'teaching_note' && !noteMd) return fail(res, 400, 'Project has no teaching_note to export');
    if (docKind === 'combined' && !caseMd && !noteMd) return fail(res, 400, 'Project has nothing to export');

    let markdown;
    if (docKind === 'case') markdown = caseMd;
    else if (docKind === 'teaching_note') markdown = noteMd;
    else markdown = [caseMd, noteMd].filter(Boolean).join('\n\n---\n\n');

    const baseName = sanitizeForFilename(project.title || extractFirstHeading(caseMd));
    const suffix = docKind === 'combined' ? 'case-and-note' : (docKind === 'teaching_note' ? 'teaching-note' : 'case');
    const filenameBase = `${baseName}-${suffix}`;

    if (format === 'md') {
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.md"`);
      return res.send(markdown);
    }

    if (format === 'docx') {
      const buf = await markdownToDocxBuffer(markdown);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.docx"`);
      return res.send(buf);
    }

    const buf = await markdownToPdfBuffer(markdown);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.pdf"`);
    return res.send(buf);
  } catch (err) {
    console.error('[caseWriter] export error:', err);
    fail(res, 500, err.message);
  }
});

// ----------------------------------------------------------------------------
// Stubs
// ----------------------------------------------------------------------------

const STUBS = [
  { method: 'post', path: '/projects/:id/generate/exhibit', name: 'generate exhibit' }
];

for (const stub of STUBS) {
  router[stub.method](stub.path, async (req, res) => {
    const { project, forbidden } = await loadProject(req.params.id, req);
    if (forbidden) return fail(res, 403, 'Not authorized to access this project');
    if (!project) return fail(res, 404, 'Project not found');
    return fail(res, 501, `Not implemented yet: ${stub.name}`);
  });
}

export default router;
