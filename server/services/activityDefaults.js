/**
 * A case's own default settings (migration 085): how the activity is meant to be run when it is
 * not yet assigned anywhere.
 *
 * ONE SHAPE. Every function here reads or writes the same "settings bundle", which is also what
 * an activity package carries (services/activityPack):
 *
 *   { chat_options, selection_mode, require_order, use_scenarios,
 *     position_tracking_enabled, position_capture_method, track_position_change, rubric_id,
 *     scenarios: [{ scenario_id, enabled, sort_order }],     the scenarios offered, in order
 *     positions: [{ position_id, enabled, sort_order }] }    overrides of a position's own default
 *
 * These are the columns a course case version owns (caseVersionSync.js#VERSION_SETTINGS_COLUMNS)
 * plus its scenario and position rows. Scheduling (active, dates) is never part of it.
 *
 * COPIED, NEVER FOLLOWED. Defaults are copied into a new course Main version or a new
 * unattached section assignment at the moment the case is attached. Changing a case's defaults
 * afterwards changes nothing that already exists; versions remain the live, written-through
 * settings (caseVersionSync.js).
 *
 * `chat_options: null` keeps its usual meaning, "follow this server's defaults". A package
 * resolves it before export, because another server's defaults differ.
 */

import { pool } from '../db.js';
import { canAccessResource } from './resourceAccess.js';
import { withoutActivityMode } from './chatOptions.js';

export const SELECTION_MODES = ['student_choice', 'all_required'];
export const CAPTURE_METHODS = ['explicit', 'ai_inferred', 'instructor_manual', 'none'];

export class ActivityDefaultsError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const parseJson = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return null; }
};

const flag = (value, fallback) => (value === null || value === undefined ? fallback : Boolean(Number(value) || value === true));

const rowList = (rows, idKey) =>
  (Array.isArray(rows) ? rows : [])
    .filter((r) => r && Number.isInteger(Number(r[idKey])))
    .map((r, i) => ({
      [idKey]: Number(r[idKey]),
      enabled: flag(r.enabled, true),
      sort_order: Number.isInteger(Number(r.sort_order)) ? Number(r.sort_order) : i,
    }));

/**
 * Coerce a bundle from any source (a version row, a section_cases row, stored JSON, a package)
 * into the one shape. Throws ActivityDefaultsError(400) on a value outside its enum.
 */
export function normalizeSettings(raw = {}) {
  const selectionMode = raw.selection_mode || 'student_choice';
  if (!SELECTION_MODES.includes(selectionMode)) {
    throw new ActivityDefaultsError(400, `selection_mode must be one of: ${SELECTION_MODES.join(', ')}`);
  }
  const captureMethod = raw.position_capture_method || 'explicit';
  if (!CAPTURE_METHODS.includes(captureMethod)) {
    throw new ActivityDefaultsError(400, `position_capture_method must be one of: ${CAPTURE_METHODS.join(', ')}`);
  }
  const chatOptions = parseJson(raw.chat_options);
  if (chatOptions !== null && (typeof chatOptions !== 'object' || Array.isArray(chatOptions))) {
    throw new ActivityDefaultsError(400, 'chat_options must be an object or null');
  }
  const rubricId = raw.rubric_id === null || raw.rubric_id === undefined || raw.rubric_id === '' ? null : Number(raw.rubric_id);
  if (rubricId !== null && !Number.isInteger(rubricId)) {
    throw new ActivityDefaultsError(400, 'rubric_id must be an integer or null');
  }
  return {
    chat_options: withoutActivityMode(chatOptions),
    selection_mode: selectionMode,
    require_order: flag(raw.require_order, false),
    use_scenarios: flag(raw.use_scenarios, false),
    position_tracking_enabled: flag(raw.position_tracking_enabled, false),
    position_capture_method: captureMethod,
    track_position_change: flag(raw.track_position_change, true),
    rubric_id: rubricId,
    scenarios: rowList(raw.scenarios, 'scenario_id'),
    positions: rowList(raw.positions, 'position_id'),
  };
}

const SETTINGS_SELECT = `chat_options, selection_mode, require_order, use_scenarios,
       position_tracking_enabled, position_capture_method, track_position_change, rubric_id`;

/** The settings of a course case version, or null when there is no such version. */
export async function settingsFromVersion(executor, versionId) {
  const [rows] = await executor.execute(
    `SELECT ${SETTINGS_SELECT} FROM course_case_versions WHERE version_id = ?`,
    [versionId]
  );
  if (rows.length === 0) return null;
  const [scenarios] = await executor.execute(
    'SELECT scenario_id, enabled, sort_order FROM course_case_version_scenarios WHERE version_id = ? ORDER BY sort_order, id',
    [versionId]
  );
  const [positions] = await executor.execute(
    'SELECT position_id, enabled, sort_order FROM course_case_version_positions WHERE version_id = ? ORDER BY sort_order, id',
    [versionId]
  );
  return normalizeSettings({ ...rows[0], scenarios, positions });
}

/** The settings of a section assignment (section_cases.id), or null when there is none. */
export async function settingsFromSectionCase(executor, sectionCaseId) {
  const [rows] = await executor.execute(
    `SELECT ${SETTINGS_SELECT} FROM section_cases WHERE id = ?`,
    [sectionCaseId]
  );
  if (rows.length === 0) return null;
  const [scenarios] = await executor.execute(
    'SELECT scenario_id, enabled, sort_order FROM section_case_scenarios WHERE section_case_id = ? ORDER BY sort_order, id',
    [sectionCaseId]
  );
  const [positions] = await executor.execute(
    'SELECT position_id, enabled, sort_order FROM section_case_positions WHERE section_case_id = ? ORDER BY sort_order, id',
    [sectionCaseId]
  );
  return normalizeSettings({ ...rows[0], scenarios, positions });
}

/**
 * A case's stored defaults as a bundle plus { saved_at, source }, or null when it has none.
 * Scenario and position ids that no longer belong to the case are dropped (the JSON is not
 * covered by a foreign key, so a deleted scenario would otherwise linger).
 */
export async function readCaseDefaults(executor, caseId) {
  const [rows] = await executor.execute(
    'SELECT default_settings, default_rubric_id FROM cases WHERE case_id = ?',
    [caseId]
  );
  const stored = parseJson(rows[0]?.default_settings);
  if (!stored) return null;

  const [scenarioRows] = await executor.execute('SELECT id FROM case_scenarios WHERE case_id = ?', [caseId]);
  const [positionRows] = await executor.execute(
    `SELECT sp.position_id FROM scenario_positions sp
       JOIN case_scenarios cs ON cs.id = sp.scenario_id WHERE cs.case_id = ?`,
    [caseId]
  );
  const scenarioIds = new Set(scenarioRows.map((r) => r.id));
  const positionIds = new Set(positionRows.map((r) => r.position_id));

  const bundle = normalizeSettings({ ...stored, rubric_id: rows[0].default_rubric_id });
  return {
    ...bundle,
    scenarios: bundle.scenarios.filter((s) => scenarioIds.has(s.scenario_id)),
    positions: bundle.positions.filter((p) => positionIds.has(p.position_id)),
    saved_at: stored.saved_at || null,
    source: stored.source || null,
  };
}

/**
 * Replace a case's defaults with `bundle`. `source` is a short label for the dashboard
 * ("GSCM 401 - Main", "Installed package").
 */
export async function writeCaseDefaults(executor, caseId, bundle, source = null) {
  const { rubric_id, ...settings } = normalizeSettings(bundle);
  // `source` is left out rather than stored as null: the case list reads it with JSON_EXTRACT,
  // which returns the text "null" for a JSON null.
  const stored = { ...settings, saved_at: new Date().toISOString(), ...(source ? { source: String(source).slice(0, 200) } : {}) };
  await executor.execute(
    'UPDATE cases SET default_settings = ?, default_rubric_id = ? WHERE case_id = ?',
    [JSON.stringify(stored), rubric_id, caseId]
  );
}

export async function clearCaseDefaults(executor, caseId) {
  await executor.execute(
    'UPDATE cases SET default_settings = NULL, default_rubric_id = NULL WHERE case_id = ?',
    [caseId]
  );
}

/**
 * A case's defaults as the caller may use them: the rubric is dropped (system default) when it
 * is disabled or the caller cannot see it, so attaching someone else's public case never hands
 * out their private rubric. Null when the case has no defaults.
 */
export async function caseDefaultsForCaller(req, caseId, executor = pool) {
  const defaults = await readCaseDefaults(executor, caseId);
  if (!defaults || defaults.rubric_id === null) return defaults;
  const [rubrics] = await executor.execute('SELECT rubric_id FROM rubrics WHERE rubric_id = ? AND enabled = 1', [defaults.rubric_id]);
  const isAdmin = Boolean(req.user?.superuser || req.user?.role === 'admin');
  const usable = rubrics.length > 0
    && (isAdmin || (await canAccessResource(req, 'rubric', defaults.rubric_id, 'view')).allowed);
  return usable ? defaults : { ...defaults, rubric_id: null };
}

/**
 * A normalized bundle with the scenario rows it assigns filled in: the ones it names, else
 * (scenarios on, none named) every enabled scenario of the case in its own order.
 * `use_scenarios` ends up true only when there is at least one row, so a student is never
 * shown an empty scenario picker.
 */
async function withScenarioRows(executor, caseId, bundle) {
  const settings = normalizeSettings(bundle);
  let scenarios = [];
  if (settings.use_scenarios) {
    scenarios = settings.scenarios;
    if (scenarios.length === 0) {
      const [rows] = await executor.execute(
        'SELECT id FROM case_scenarios WHERE case_id = ? AND enabled = 1 ORDER BY sort_order, id',
        [caseId]
      );
      scenarios = rows.map((r, i) => ({ scenario_id: r.id, enabled: true, sort_order: i }));
    }
  }
  return { ...settings, scenarios, use_scenarios: scenarios.length > 0 };
}

const settingsParams = (bundle) => [
  bundle.chat_options ? JSON.stringify(bundle.chat_options) : null,
  bundle.selection_mode,
  bundle.require_order ? 1 : 0,
  bundle.use_scenarios ? 1 : 0,
  bundle.position_tracking_enabled ? 1 : 0,
  bundle.position_capture_method,
  bundle.track_position_change ? 1 : 0,
  bundle.rubric_id,
];

const SETTINGS_SET = `chat_options = ?, selection_mode = ?, require_order = ?, use_scenarios = ?,
       position_tracking_enabled = ?, position_capture_method = ?, track_position_change = ?, rubric_id = ?`;

/**
 * Write a bundle into a course case version, replacing its scenario and position rows. The
 * caller owns the transaction and runs applyVersion() if sections already follow the version.
 */
export async function applySettingsToVersion(conn, versionId, caseId, bundle) {
  const settings = await withScenarioRows(conn, caseId, bundle);
  await conn.execute(
    `UPDATE course_case_versions SET ${SETTINGS_SET} WHERE version_id = ?`,
    [...settingsParams(settings), versionId]
  );
  await conn.execute('DELETE FROM course_case_version_scenarios WHERE version_id = ?', [versionId]);
  for (const s of settings.scenarios) {
    await conn.execute(
      'INSERT INTO course_case_version_scenarios (version_id, scenario_id, enabled, sort_order) VALUES (?, ?, ?, ?)',
      [versionId, s.scenario_id, s.enabled ? 1 : 0, s.sort_order]
    );
  }
  await conn.execute('DELETE FROM course_case_version_positions WHERE version_id = ?', [versionId]);
  for (const p of settings.positions) {
    await conn.execute(
      'INSERT INTO course_case_version_positions (version_id, position_id, enabled, sort_order) VALUES (?, ?, ?, ?)',
      [versionId, p.position_id, p.enabled ? 1 : 0, p.sort_order]
    );
  }
}

/**
 * Write a bundle into a section assignment that follows no version (section_cases.id),
 * replacing its scenario and position rows. Never call this for a row with a version_id: its
 * settings are written through from the version and would be overwritten.
 */
export async function applySettingsToSectionCase(executor, sectionCaseId, caseId, bundle) {
  const settings = await withScenarioRows(executor, caseId, bundle);
  await executor.execute(
    `UPDATE section_cases SET ${SETTINGS_SET} WHERE id = ? AND version_id IS NULL`,
    [...settingsParams(settings), sectionCaseId]
  );
  await executor.execute('DELETE FROM section_case_scenarios WHERE section_case_id = ?', [sectionCaseId]);
  for (const s of settings.scenarios) {
    await executor.execute(
      'INSERT INTO section_case_scenarios (section_case_id, scenario_id, enabled, sort_order) VALUES (?, ?, ?, ?)',
      [sectionCaseId, s.scenario_id, s.enabled ? 1 : 0, s.sort_order]
    );
  }
  await executor.execute('DELETE FROM section_case_positions WHERE section_case_id = ?', [sectionCaseId]);
  for (const p of settings.positions) {
    await executor.execute(
      'INSERT INTO section_case_positions (section_case_id, position_id, enabled, sort_order) VALUES (?, ?, ?, ?)',
      [sectionCaseId, p.position_id, p.enabled ? 1 : 0, p.sort_order]
    );
  }
}
