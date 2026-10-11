/**
 * Building an activity package from cases on this server. Format: format.js.
 *
 * WHAT GOES IN, for each case the caller may view:
 *   - the case (title, version label, activity type) and its stable ids
 *   - documents: the text students and the AI read, and each document's latest AI outline.
 *     Original files only when `includeOriginals` is set.
 *   - every scenario and its positions
 *   - one settings bundle, taken from where the caller chose: the case's saved defaults, a
 *     course case version, or a section assignment (services/activityDefaults.js)
 *   - the personas those settings offer, and the rubric they name with its criteria
 *
 * WHAT NEVER GOES IN (rule 3): numeric ids, owner, visibility and team shares, sections,
 * dates, models, students, chats, transcripts, grades, API keys, proprietary confirmation.
 *
 * ACCESS (rule 5). The caller needs view access to each case, to the course of a version or
 * the section of an assignment used as the settings source, and to each persona and rubric
 * bundled. A persona or rubric the caller cannot see is left out and reported, never bundled:
 * "all enabled personas" resolves to every enabled persona on the server, including other
 * instructors' private ones.
 *
 * PROPRIETARY DOCUMENTS are left out (text and original) unless `includeProprietary` is set,
 * and are listed in manifest.omitted so the installer knows a document must be added by hand.
 *
 * OUTLINES. An outline travels as an outline only when its parent document travels. When the
 * parent is left out, the outline is sent as a plain document of the PARENT'S role. The role
 * is what decides whether text is shown to students: an outline with no parent row is treated
 * as case content (routes/llm.js#loadCaseData), so a teaching-note outline that lost its
 * parent would otherwise be shown to students on the installing server.
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import { pool } from '../../db.js';
import { canAccessResource } from '../resourceAccess.js';
import { canAccessCourse, canViewSection } from '../../middleware/instructorAccess.js';
import { KNOWN_CHAT_OPTION_KEYS, resolveChatOptions } from '../chatOptions.js';
import { parseAllowedPersonaIds, resolveAvailablePersonas } from '../personaService.js';
import { getCriteriaForRubric, getRubricById } from '../rubricService.js';
import { loadVersion } from '../caseVersionSync.js';
import { readCaseDefaults, settingsFromSectionCase, settingsFromVersion } from '../activityDefaults.js';
import { slugifyTitle } from '../caseIds.js';
import { getAppVersion, getSchemaLevel } from '../appVersion.js';
import { getActivityType } from '../../../utils/activityTypes.js';
import { requirementsFor } from './capabilities.js';
import {
  AUDIENCE_ID_PREFIX,
  FORMAT_VERSION,
  LIMITS,
  ORIGINAL_EXTENSIONS,
  PACK_FILE_EXTENSION,
  PACK_FORMAT,
  PackError,
  activityContentHash,
  assertValidPack,
  extensionOf,
  isDocumentRole,
  isScenarioOverrideKey,
  sha256,
} from './format.js';
import { zipPack } from './zip.js';

const isAdminUser = (req) => Boolean(req.user?.superuser || req.user?.role === 'admin');
const canView = async (req, resourceType, id) => isAdminUser(req) || (await canAccessResource(req, resourceType, id, 'view')).allowed;

const parseJson = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return null; }
};
const orNull = (value) => (value === undefined || value === '' ? null : value);

/** A scenario's chat_options_override as it travels: only the keys an installer accepts (format.js). */
function scenarioOverride(value) {
  const override = parseJson(value);
  if (!override || typeof override !== 'object' || Array.isArray(override)) return null;
  const kept = Object.fromEntries(Object.entries(override).filter(([key]) => isScenarioOverrideKey(key)));
  return Object.keys(kept).length > 0 ? kept : null;
}

const KEY_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const CASE_ID_RE = /^[a-z0-9][a-z0-9-]{0,29}$/;
const personaKind = (personaId) => (String(personaId).startsWith(AUDIENCE_ID_PREFIX) ? 'audience' : 'protagonist');

/** A key that is free in `used`: `wanted` if it fits the key pattern, else `${prefix}${n}`. */
function uniqueKey(wanted, used, prefix) {
  let key = typeof wanted === 'string' && KEY_RE.test(wanted) && !used.has(wanted) ? wanted : null;
  for (let n = 1; key === null; n++) {
    if (!used.has(`${prefix}${n}`)) key = `${prefix}${n}`;
  }
  used.add(key);
  return key;
}

/** Give the case, its scenarios and their positions the UUIDs that travel, where they have none. */
async function ensureUids(caseId) {
  await pool.execute('UPDATE cases SET activity_uid = ? WHERE case_id = ? AND activity_uid IS NULL', [crypto.randomUUID(), caseId]);
  const [scenarios] = await pool.execute('SELECT id FROM case_scenarios WHERE case_id = ? AND scenario_uid IS NULL', [caseId]);
  for (const s of scenarios) {
    await pool.execute('UPDATE case_scenarios SET scenario_uid = ? WHERE id = ? AND scenario_uid IS NULL', [crypto.randomUUID(), s.id]);
  }
  const [positions] = await pool.execute(
    `SELECT sp.position_id FROM scenario_positions sp JOIN case_scenarios cs ON cs.id = sp.scenario_id
      WHERE cs.case_id = ? AND sp.position_uid IS NULL`,
    [caseId]
  );
  for (const p of positions) {
    await pool.execute('UPDATE scenario_positions SET position_uid = ? WHERE position_id = ? AND position_uid IS NULL', [crypto.randomUUID(), p.position_id]);
  }
}

/**
 * The settings bundle the caller chose, with the caller's right to read it checked, or null.
 * Also used by PUT /api/cases/:id/defaults (routes/cases.js), so the access checks live here once.
 * @param {{source?: 'none'|'defaults'|'version'|'section', id?: number|string}} choice
 * @returns {Promise<{bundle: object, sectionId: string|null, label: string|null}|null>}
 *   `label` names where the settings came from ("GSCM401 - Main", "Section f26-gscm401-1").
 */
export async function loadSettingsChoice(req, caseId, choice = {}) {
  const source = choice.source || 'defaults';
  if (source === 'none') return null;
  if (source === 'defaults') {
    const bundle = await readCaseDefaults(pool, caseId);
    return bundle ? { bundle, sectionId: null, label: null } : null;
  }
  if (source === 'version') {
    const version = await loadVersion(pool, choice.id);
    if (!version || version.case_id !== caseId) throw new PackError(404, 'SETTINGS_NOT_FOUND', 'That course version is not a version of this case.');
    if (!isAdminUser(req) && !(await canAccessCourse(req.user.id, version.course_id))) {
      throw new PackError(403, 'ACCESS_DENIED', 'You do not have access to the course those settings belong to.');
    }
    const [[course]] = await pool.execute('SELECT course_code, course_name FROM courses WHERE id = ?', [version.course_id]);
    return {
      bundle: await settingsFromVersion(pool, version.version_id),
      sectionId: null,
      label: `${course?.course_code || course?.course_name || 'Course'} - ${version.label}`,
    };
  }
  if (source === 'section') {
    if (!(await canViewSection(req, choice.id))) throw new PackError(403, 'ACCESS_DENIED', 'You do not have access to that section.');
    const [rows] = await pool.execute('SELECT id FROM section_cases WHERE section_id = ? AND case_id = ?', [choice.id, caseId]);
    if (rows.length === 0) throw new PackError(404, 'SETTINGS_NOT_FOUND', 'That section does not have this case.');
    return { bundle: await settingsFromSectionCase(pool, rows[0].id), sectionId: String(choice.id), label: `Section ${choice.id}` };
  }
  throw new PackError(400, 'INVALID_REQUEST', `Unknown settings source: ${source}`);
}

/** A persona as it travels, added to the shared list once. Null when the caller cannot see it. */
async function bundlePersona(req, personaId, shared) {
  if (shared.personaById.has(personaId)) return shared.personaById.get(personaId);
  const [rows] = await pool.execute(
    'SELECT persona_id, persona_name, description, instructions, is_system_default FROM personas WHERE persona_id = ?',
    [personaId]
  );
  const row = rows[0];
  if (!row || !(await canView(req, 'persona', personaId))) {
    shared.personaById.set(personaId, null);
    return null;
  }
  const entry = {
    key: uniqueKey(row.persona_id, shared.personaKeys, 'persona'),
    suggested_id: row.persona_id,
    kind: personaKind(row.persona_id),
    name: row.persona_name,
    description: orNull(row.description),
    instructions: row.instructions,
    system: row.is_system_default === 1,
  };
  shared.personaById.set(personaId, entry);
  shared.personas.push(entry);
  return entry;
}

/** A rubric and its criteria as they travel, added once. Null when the caller cannot use it. */
async function bundleRubric(req, rubricId, shared) {
  if (shared.rubricById.has(rubricId)) return shared.rubricById.get(rubricId);
  const rubric = await getRubricById(rubricId);
  if (!rubric || !(await canView(req, 'rubric', rubricId))) {
    shared.rubricById.set(rubricId, null);
    return null;
  }
  // The enabled criteria in rubric order, which is what grading uses (rubricService.js).
  const enabledIds = (await getCriteriaForRubric(rubric.criteria_ids)).map((c) => c.criteria_id);
  if (enabledIds.length === 0) {
    shared.rubricById.set(rubricId, null);
    return null;
  }
  const [criteriaRows] = await pool.execute(
    `SELECT criteria_id, name, question_text, max_points, scoring_guide, prompt_text, is_system_default
       FROM rubric_criteria WHERE criteria_id IN (${enabledIds.map(() => '?').join(',')})`,
    enabledIds
  );
  const criteria = enabledIds.map((id) => criteriaRows.find((c) => c.criteria_id === id));
  const criteriaKeys = [];
  for (const c of criteria) {
    if (!shared.criterionById.has(c.criteria_id)) {
      const entry = {
        key: uniqueKey(c.criteria_id, shared.criterionKeys, 'criterion'),
        suggested_id: c.criteria_id,
        name: c.name,
        question_text: c.question_text,
        max_points: c.max_points,
        scoring_guide: parseJson(c.scoring_guide),
        prompt_text: orNull(c.prompt_text),
        system: c.is_system_default === 1,
      };
      shared.criterionById.set(c.criteria_id, entry);
      shared.criteria.push(entry);
    }
    criteriaKeys.push(shared.criterionById.get(c.criteria_id).key);
  }
  const entry = {
    key: uniqueKey(null, shared.rubricKeys, 'rubric'),
    name: rubric.rubric_name,
    description: orNull(rubric.description),
    additional_prompt: orNull(rubric.additional_prompt),
    criteria: criteriaKeys,
  };
  shared.rubricById.set(rubricId, entry);
  shared.rubrics.push(entry);
  return entry;
}

/** The documents of one case as they travel, with their text and (optionally) originals. */
async function collectDocuments(caseRow, activityKey, opts, shared) {
  const { loadFileContent } = await import('../../routes/llm.js');
  const { findOriginalPath } = await import('../../routes/caseFiles.js');

  const [rows] = await pool.execute(
    `SELECT id, case_id, parent_file_id, filename, original_filename, file_type, file_format, file_source,
            source_url, proprietary, include_in_chat_prompt, prompt_order, file_version,
            is_outline, is_latest_outline, outline_content, converted_text
       FROM case_files WHERE case_id = ? ORDER BY prompt_order ASC, created_at ASC, id ASC`,
    [caseRow.case_id]
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  const omit = (row, reason) => shared.omitted.push({
    activity: activityKey,
    title: row.original_filename || row.filename,
    role: row.file_type,
    reason,
  });

  const documents = [];
  const keyByFileId = new Map();
  const usedKeys = new Set();

  // Base documents first, so an outline can name its parent's key.
  const ordered = [...rows.filter((r) => !r.is_outline), ...rows.filter((r) => r.is_outline)];
  for (const row of ordered) {
    if (row.is_outline && !row.is_latest_outline) continue; // superseded outlines are history
    if (row.proprietary && !opts.includeProprietary) { omit(row, 'proprietary'); continue; }

    const parent = row.is_outline ? byId.get(row.parent_file_id) : null;
    const parentKey = parent ? keyByFileId.get(parent.id) : undefined;
    // An outline whose parent is not in the package travels as a document of the parent's role
    // (see the header). With no parent row at all it was already being read as case content.
    const role = row.is_outline && !parentKey ? (parent?.file_type || 'case') : row.file_type;
    if (!isDocumentRole(role)) { omit(row, 'unknown_type'); continue; }

    let text = row.is_outline ? (row.converted_text || row.outline_content) : row.converted_text;
    if (!text) {
      try {
        text = await loadFileContent(row.case_id, row.filename, row.file_type, null, row.id);
      } catch {
        text = null;
      }
    }
    if (text && text.length > LIMITS.textChars) { omit(row, 'text_too_large'); continue; }

    let original = null;
    let originalData = null;
    if (opts.includeOriginals) {
      const originalPath = await findOriginalPath(row);
      const filename = row.original_filename || row.filename;
      const ext = extensionOf(originalPath || '');
      if (originalPath && ORIGINAL_EXTENSIONS.includes(ext)) {
        const data = await fs.readFile(originalPath);
        if (data.length > 0 && data.length <= LIMITS.originalBytes) {
          originalData = data;
          // The package states the name with the stored file's extension, so the installer can
          // check the two agree.
          const stated = extensionOf(filename) === ext ? filename : `${filename}${ext}`;
          original = { path: null, filename: stated.slice(-255), bytes: data.length, sha256: sha256(data) };
        }
      }
    }
    if (!text && !original) { omit(row, 'no_text'); continue; }

    const key = uniqueKey(null, usedKeys, 'd');
    keyByFileId.set(row.id, key);
    if (original) original.path = `originals/${key}${extensionOf(original.filename)}`;
    const title = row.is_outline && !parentKey
      ? `Outline of ${parent?.original_filename || parent?.filename || row.original_filename || row.filename}`
      : (row.original_filename || row.filename);
    const doc = {
      key,
      role,
      title: String(title).slice(0, 255),
      format: orNull(row.file_format),
      source: orNull(row.file_source),
      source_url: /^https?:\/\//i.test(row.source_url || '') ? row.source_url : null,
      include_in_prompt: Boolean(row.include_in_chat_prompt),
      prompt_order: Number.isInteger(row.prompt_order) ? row.prompt_order : 0,
      version_label: orNull(row.file_version),
      proprietary: Boolean(row.proprietary),
      outline_of: row.is_outline && parentKey ? parentKey : null,
      latest_outline: Boolean(row.is_outline && parentKey && row.is_latest_outline),
      text: text ? `documents/${key}.md` : null,
      text_sha256: text ? sha256(text) : null,
      text_chars: text ? text.length : 0,
      original,
    };
    documents.push(doc);
    if (text) shared.texts.set(`${activityKey}/${key}`, text);
    if (originalData) shared.originals.set(`${activityKey}/${key}`, originalData);
  }
  return documents;
}

/** One case as an activity entry. Adds what it shares (personas, rubric, texts) to `shared`. */
async function collectActivity(req, item, opts, shared) {
  const caseId = item.case_id;
  // A case the caller cannot see answers exactly like one that does not exist, as every other
  // view route does (middleware/instructorAccess.js#requireResourceAccess).
  const notFound = () => new PackError(404, 'CASE_NOT_FOUND', `Case "${String(caseId).slice(0, 60)}" was not found.`);
  if (typeof caseId !== 'string' || !(await canView(req, 'case', caseId))) throw notFound();
  await ensureUids(caseId);
  const [caseRows] = await pool.execute(
    'SELECT case_id, case_title, case_version, activity_type, base_scenario_id, activity_uid FROM cases WHERE case_id = ?',
    [caseId]
  );
  const caseRow = caseRows[0];
  if (!caseRow) throw notFound();
  const type = getActivityType(caseRow.activity_type);
  const warn = (message) => shared.warnings.push({ activity: caseRow.case_title, message });

  const key = uniqueKey(slugifyTitle(caseRow.case_id), shared.activityKeys, 'activity');
  const documents = await collectDocuments(caseRow, key, opts, shared);

  // Scenarios and positions
  const [scenarioRows] = await pool.execute(
    `SELECT id, scenario_uid, scenario_name, protagonist, protagonist_initials, protagonist_role, chat_topic,
            chat_question, prompt_instructions, chat_time_limit, chat_time_warning, arguments_for,
            arguments_against, chat_options_override, sort_order, enabled
       FROM case_scenarios WHERE case_id = ? ORDER BY sort_order ASC, id ASC`,
    [caseId]
  );
  const [positionRows] = await pool.execute(
    `SELECT sp.position_id, sp.scenario_id, sp.position_uid, sp.position_name, sp.position, sp.position_order,
            sp.arguments_for, sp.arguments_against, sp.position_enabled
       FROM scenario_positions sp JOIN case_scenarios cs ON cs.id = sp.scenario_id
      WHERE cs.case_id = ? ORDER BY sp.scenario_id, sp.position_order ASC, sp.position_id ASC`,
    [caseId]
  );
  const scenarioKeyById = new Map();
  const positionKeyById = new Map();
  let positionCount = 0;
  const scenarios = scenarioRows.map((s, i) => {
    const scenarioKey = `s${i + 1}`;
    scenarioKeyById.set(s.id, scenarioKey);
    return {
      key: scenarioKey,
      uid: s.scenario_uid,
      name: s.scenario_name,
      protagonist: s.protagonist,
      protagonist_initials: s.protagonist_initials,
      protagonist_role: orNull(s.protagonist_role),
      chat_topic: orNull(s.chat_topic),
      chat_question: s.chat_question,
      prompt_instructions: orNull(s.prompt_instructions),
      chat_time_limit: s.chat_time_limit ?? 0,
      chat_time_warning: s.chat_time_warning ?? 5,
      arguments_for: orNull(s.arguments_for),
      arguments_against: orNull(s.arguments_against),
      chat_options_override: scenarioOverride(s.chat_options_override),
      enabled: Boolean(s.enabled),
      sort_order: s.sort_order ?? i,
      is_base: s.id === caseRow.base_scenario_id,
      positions: positionRows.filter((p) => p.scenario_id === s.id).map((p) => {
        const positionKey = `p${++positionCount}`;
        positionKeyById.set(p.position_id, positionKey);
        return {
          key: positionKey,
          uid: p.position_uid,
          name: p.position_name,
          position: p.position,
          order: p.position_order ?? 0,
          arguments_for: orNull(p.arguments_for),
          arguments_against: orNull(p.arguments_against),
          enabled: Boolean(p.position_enabled),
        };
      }),
    };
  });

  // Settings, resolved so they mean the same thing on another server.
  const chosen = await loadSettingsChoice(req, caseId, item.settings);
  let settings = null;
  let chatOptions = null;
  if (chosen) {
    const { bundle, sectionId } = chosen;
    // NULL means "follow this server's defaults", which another server does not have.
    const effective = parseJson(bundle.chat_options ?? (await resolveChatOptions(sectionId, null)));
    if (effective && typeof effective === 'object') {
      chatOptions = Object.fromEntries(Object.entries(effective).filter(([k]) => KNOWN_CHAT_OPTION_KEYS.has(k)));
    }
    let rubricKey = null;
    if (bundle.rubric_id !== null) {
      const rubric = await bundleRubric(req, bundle.rubric_id, shared);
      if (rubric) rubricKey = rubric.key;
      else warn('The rubric in these settings could not be included (it no longer exists or you cannot see it), so the package uses the installing server\'s default rubric.');
    }
    settings = {
      chat_options: chatOptions,
      selection_mode: bundle.selection_mode,
      require_order: bundle.require_order,
      use_scenarios: bundle.use_scenarios,
      position_tracking_enabled: bundle.position_tracking_enabled,
      position_capture_method: bundle.position_capture_method,
      track_position_change: bundle.track_position_change,
      rubric: rubricKey,
      scenarios: bundle.scenarios
        .filter((row) => scenarioKeyById.has(row.scenario_id))
        .map((row) => ({ scenario: scenarioKeyById.get(row.scenario_id), enabled: row.enabled, sort_order: row.sort_order })),
      positions: bundle.positions
        .filter((row) => positionKeyById.has(row.position_id))
        .map((row) => ({ position: positionKeyById.get(row.position_id), enabled: row.enabled, sort_order: row.sort_order })),
    };
  }

  // Personas: the ones the settings offer. "All enabled" (and a package with no settings)
  // bundles what that resolves to here, so a teach-back never arrives with no audience; the
  // installer creates those only when its server has none of that kind (persona_selection).
  const named = parseAllowedPersonaIds(chatOptions?.allowed_personas);
  let personaSelection = named === null ? 'all_enabled' : 'named';
  const offered = named === null
    ? (await resolveAvailablePersonas(null, type.id)).map((p) => p.persona_id)
    : named;
  const wanted = [...new Set([...offered, chatOptions?.default_persona].filter(Boolean))];
  const personaKeys = [];
  const keptIds = new Set();
  for (const personaId of wanted) {
    if (personaKind(personaId) !== type.personaKind) continue; // the other activity's; ignored at chat time too
    const persona = await bundlePersona(req, personaId, shared);
    if (!persona) {
      warn(`The persona "${personaId}" could not be included (it no longer exists or you cannot see it).`);
      continue;
    }
    keptIds.add(personaId);
    personaKeys.push(persona.key);
  }
  if (chatOptions) {
    // The list in the package names exactly the personas that travel with it.
    if (named !== null) {
      const kept = named.filter((id) => keptIds.has(id));
      chatOptions.allowed_personas = kept.join(',');
      if (kept.length === 0) {
        warn('None of the personas these settings name could be included, so the package offers every enabled persona on the installing server.');
        personaSelection = 'all_enabled';
        for (const p of await resolveAvailablePersonas(null, type.id)) {
          const persona = await bundlePersona(req, p.persona_id, shared);
          if (persona && !personaKeys.includes(persona.key)) personaKeys.push(persona.key);
        }
      }
    }
    if (chatOptions.default_persona && !keptIds.has(chatOptions.default_persona)) delete chatOptions.default_persona;
  }

  return {
    key,
    uid: caseRow.activity_uid,
    suggested_id: CASE_ID_RE.test(caseRow.case_id) ? caseRow.case_id : slugifyTitle(caseRow.case_id),
    title: caseRow.case_title,
    version_label: orNull(caseRow.case_version),
    activity_type: type.id,
    documents,
    scenarios,
    settings,
    persona_selection: personaSelection,
    personas: personaKeys,
  };
}

/**
 * Build a package in memory.
 * @param {object} req
 * @param {{ items: Array<{case_id: string, settings?: {source: string, id?: any}}>,
 *           includeOriginals?: boolean, includeProprietary?: boolean, note?: string }} options
 * @returns {Promise<object>} the package (format.js), plus `warnings` for the caller to show
 */
export async function collectPack(req, { items, includeOriginals = false, includeProprietary = false, note = null }) {
  if (!Array.isArray(items) || items.length === 0) throw new PackError(400, 'INVALID_REQUEST', 'Choose at least one case to download.');
  if (items.length > LIMITS.activities) throw new PackError(400, 'INVALID_REQUEST', `At most ${LIMITS.activities} cases can go in one package.`);
  if (new Set(items.map((i) => i.case_id)).size !== items.length) throw new PackError(400, 'INVALID_REQUEST', 'A case is listed twice.');

  const shared = {
    activityKeys: new Set(),
    personas: [], personaById: new Map(), personaKeys: new Set(),
    rubrics: [], rubricById: new Map(), rubricKeys: new Set(),
    criteria: [], criterionById: new Map(), criterionKeys: new Set(),
    texts: new Map(),
    originals: new Map(),
    omitted: [],
    warnings: [],
  };
  const activities = [];
  for (const item of items) {
    activities.push(await collectActivity(req, item, { includeOriginals, includeProprietary }, shared));
  }

  const pack = {
    manifest: {
      format: PACK_FORMAT,
      format_version: FORMAT_VERSION,
      exported_at: new Date().toISOString(),
      exported_from: { app_version: getAppVersion(), schema: await getSchemaLevel() },
      requires: [],
      activities: [],
      includes_originals: Boolean(includeOriginals),
      omitted: shared.omitted,
      warnings: shared.warnings,
      note: typeof note === 'string' && note.trim() ? note.trim().slice(0, 2000) : null,
    },
    activities,
    personas: shared.personas,
    rubrics: shared.rubrics,
    criteria: shared.criteria,
    texts: shared.texts,
    originals: shared.originals,
    readOriginal: async (activityKey, doc) => shared.originals.get(`${activityKey}/${doc.key}`),
  };
  sealPack(pack);
  // What leaves this server must be something this server would accept back.
  assertValidPack(pack);
  return pack;
}

/**
 * Write the parts of the manifest that are derived from the activities: what the package
 * requires of an installer, and each activity's entry with its content hash. Call it again
 * after changing an activity in a package held in memory (Duplicate does).
 */
export function sealPack(pack) {
  pack.manifest.requires = requirementsFor(pack.activities);
  pack.manifest.activities = pack.activities.map((a) => ({
    key: a.key,
    uid: a.uid,
    title: a.title,
    activity_type: a.activity_type,
    content_hash: activityContentHash(a, pack.personas, pack.rubrics, pack.criteria),
  }));
  return pack;
}

/** Build a package and zip it. @returns {Promise<{buffer: Buffer, filename: string, pack: object}>} */
export async function buildPackFile(req, options) {
  const pack = await collectPack(req, options);
  const buffer = await zipPack(pack);
  const name = pack.activities.length === 1
    ? pack.activities[0].suggested_id
    : `makethecase-activities-${new Date().toISOString().slice(0, 10)}`;
  return { buffer, filename: `${name}${PACK_FILE_EXTENSION}`, pack };
}

/**
 * What the download dialog needs for each case: its documents (so proprietary ones and missing
 * text are visible before downloading) and the settings sources the caller may choose from.
 */
export async function exportOptions(req, caseIds) {
  const { findOriginalPath } = await import('../../routes/caseFiles.js');
  const result = [];
  for (const caseId of caseIds) {
    if (!(await canView(req, 'case', caseId))) continue;
    const [caseRows] = await pool.execute(
      'SELECT case_id, case_title, activity_type, default_settings IS NOT NULL AS has_defaults FROM cases WHERE case_id = ?',
      [caseId]
    );
    if (caseRows.length === 0) continue;
    const caseRow = caseRows[0];

    const [files] = await pool.execute(
      `SELECT id, case_id, filename, original_filename, file_type, file_source, file_size, proprietary, is_outline, is_latest_outline,
              (converted_text IS NOT NULL OR outline_content IS NOT NULL) AS has_text
         FROM case_files WHERE case_id = ? ORDER BY prompt_order ASC, created_at ASC, id ASC`,
      [caseId]
    );
    const documents = [];
    for (const f of files) {
      if (f.is_outline && !f.is_latest_outline) continue;
      documents.push({
        title: f.original_filename || f.filename,
        role: f.file_type,
        bytes: f.file_size,
        proprietary: Boolean(f.proprietary),
        is_outline: Boolean(f.is_outline),
        has_text: Boolean(f.has_text),
        has_original: (await findOriginalPath(f)) !== null,
      });
    }

    const sources = [];
    if (caseRow.has_defaults) sources.push({ source: 'defaults', id: null, label: "The case's default settings" });
    const [versions] = await pool.execute(
      `SELECT v.version_id, v.label, v.is_main, c.id AS course_id, c.course_code, c.course_name
         FROM course_case_versions v
         JOIN course_cases cc ON cc.id = v.course_case_id
         JOIN courses c ON c.id = cc.course_id
        WHERE cc.case_id = ?
        ORDER BY c.course_name, v.is_main DESC, v.label`,
      [caseId]
    );
    for (const v of versions) {
      if (!isAdminUser(req) && !(await canAccessCourse(req.user.id, v.course_id))) continue;
      sources.push({ source: 'version', id: v.version_id, label: `${v.course_code || v.course_name}: ${v.label}` });
    }
    const [sections] = await pool.execute(
      `SELECT sc.section_id, s.section_title FROM section_cases sc JOIN sections s ON s.section_id = sc.section_id
        WHERE sc.case_id = ? AND sc.version_id IS NULL ORDER BY sc.section_id`,
      [caseId]
    );
    for (const s of sections) {
      if (!(await canViewSection(req, s.section_id))) continue;
      sources.push({ source: 'section', id: s.section_id, label: `Section ${s.section_id} (its own settings)` });
    }
    sources.push({ source: 'none', id: null, label: 'No settings (the installing server\'s defaults)' });

    result.push({
      case_id: caseRow.case_id,
      case_title: caseRow.case_title,
      activity_type: caseRow.activity_type,
      documents,
      settings_sources: sources,
    });
  }
  return result;
}
