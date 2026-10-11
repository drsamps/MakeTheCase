/**
 * Installing an activity package on this server. Format: format.js. Reading the ZIP: zip.js.
 *
 * TWO STEPS, like course rollover (services/courseRollover.js):
 *   planInstall()     writes nothing. Says, for every activity, persona, criterion and rubric
 *                     in the package, what installing would do here, and returns a plan hash.
 *   executeInstall()  plans again and refuses unless the hash matches the one the person
 *                     confirmed (rule 6), then writes everything in ONE transaction.
 *
 * WHAT INSTALLING MAY AND MAY NOT DO
 *   - It only CREATES rows, or reuses a row whose content is identical. It never updates or
 *     overwrites an existing case, persona, criterion or rubric (rule 4). A built-in (system
 *     default) persona or criterion is never copied over: the activity uses this server's.
 *   - Everything created is private and owned by the installer. Nothing in a package sets an
 *     owner, visibility, an id, a system-default flag or a proprietary confirmation (rule 3).
 *     Ids come from this server: a suggested id is used only when it is free here.
 *   - It never assigns anything to a section and never makes anything active. The package's
 *     settings become the case's default settings (services/activityDefaults.js). Adding the
 *     case to a course is a separate, optional choice that needs course ownership.
 *   - A document flagged proprietary arrives unconfirmed, so routes/llm.js#loadCaseData keeps
 *     it out of prompts until someone confirms it in Case Files on this server.
 *
 * PACKAGE TEXT IS UNTRUSTED (rule 7). Persona instructions, scenario instructions, arguments,
 * chatbot personality and rubric prompts go into AI prompts as written. The plan returns all
 * of it under `review` so it can be read before anything is installed.
 *
 * FILES. Original files are written under names made here (never a name from the package)
 * inside case_files/<new case id>/uploads/. The case id is new, so on any failure the whole
 * folder is removed along with the rolled-back transaction.
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../../db.js';
import { canAccessResource } from '../resourceAccess.js';
import { isCourseOwner } from '../../middleware/instructorAccess.js';
import { calculateTotalPoints, generateCriteriaPrompt } from '../rubricService.js';
import { createCourseCase } from '../caseVersionSync.js';
import { writeCaseDefaults } from '../activityDefaults.js';
import { generateUniqueCaseId } from '../caseIds.js';
import { getActivityType } from '../../../utils/activityTypes.js';
import { AUDIENCE_ID_PREFIX, PackError, assertValidPack, canonicalJson, extensionOf, sha256 } from './format.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASE_FILES_DIR = path.join(__dirname, '..', '..', '..', 'case_files');

const isAdminUser = (req) => Boolean(req.user?.superuser || req.user?.role === 'admin');
const canView = async (req, resourceType, id) => isAdminUser(req) || (await canAccessResource(req, resourceType, id, 'view')).allowed;
const parseJson = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return null; }
};
const same = (a, b) => (a ?? '') === (b ?? '');

/** The installer as the owner of what is created (same rule as POST /api/cases). */
function ownerOf(req) {
  return {
    id: req.effectiveInstructorId || req.user?.id || null,
    type: req.user?.role === 'admin' && !req.effectiveInstructorId ? 'admin' : 'instructor',
  };
}

/**
 * `wanted` if it is free, else `wanted` with the first free numeric suffix, within `maxLength`.
 * The stem is shortened from the right, so an `audience-` prefix always survives.
 */
async function uniqueId(wanted, { table, column, separator, maxLength, taken }) {
  const isFree = async (candidate) => {
    if (taken.has(candidate)) return false;
    const [rows] = await pool.execute(`SELECT 1 FROM ${table} WHERE ${column} = ? LIMIT 1`, [candidate]);
    return rows.length === 0;
  };
  if (await isFree(wanted)) return wanted;
  for (let n = 2; n < 10000; n++) {
    const suffix = `${separator}${n}`;
    const candidate = `${wanted.slice(0, maxLength - suffix.length)}${suffix}`;
    if (await isFree(candidate)) return candidate;
  }
  throw new PackError(409, 'NO_FREE_ID', `Could not find a free id based on "${wanted}".`);
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

async function planPersona(req, persona, { named, choice, taken }) {
  const base = { key: persona.key, suggested_id: persona.suggested_id, name: persona.name, kind: persona.kind, choices: null, note: null };
  const [rows] = await pool.execute(
    'SELECT persona_id, persona_name, description, instructions, is_system_default, enabled FROM personas WHERE persona_id = ?',
    [persona.suggested_id]
  );
  const row = rows[0];

  if (!named) {
    // Bundled only because the settings offer "all enabled" personas. This server's own are
    // what that means here; the package's are a fallback for a server that has none.
    if (row) return { ...base, action: 'not_needed', target_id: persona.suggested_id, note: 'This server already has this persona.' };
    const [[{ n }]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM personas WHERE enabled = 1 AND persona_id ${persona.kind === 'audience' ? '' : 'NOT '}LIKE ?`,
      [`${AUDIENCE_ID_PREFIX}%`]
    );
    if (n > 0) {
      return { ...base, action: 'not_needed', target_id: persona.suggested_id, note: 'Not installed: the activity offers every enabled persona, and this server already has some.' };
    }
    taken.add(persona.suggested_id);
    return { ...base, action: 'create', target_id: persona.suggested_id };
  }

  if (!row) {
    taken.add(persona.suggested_id);
    return { ...base, action: 'create', target_id: persona.suggested_id };
  }
  const identical = row.persona_name === persona.name && same(row.description, persona.description) && row.instructions === persona.instructions;
  const viewable = await canView(req, 'persona', row.persona_id);
  if (identical && viewable) {
    return { ...base, action: 'reuse', target_id: row.persona_id, note: row.enabled ? null : 'This persona is disabled on this server, so students will not be offered it until it is enabled.' };
  }
  if (row.is_system_default === 1) {
    return { ...base, action: 'use_server', target_id: row.persona_id, note: `This server's built-in "${row.persona_name}" is worded differently from the package's. The activity will use this server's.` };
  }
  if (viewable && choice === 'use_server') {
    return { ...base, action: 'use_server', target_id: row.persona_id, choices: ['install_copy', 'use_server'], note: `Uses this server's "${row.persona_name}", which is worded differently from the package's.` };
  }
  const targetId = await uniqueId(persona.suggested_id, { table: 'personas', column: 'persona_id', separator: '-', maxLength: 30, taken });
  taken.add(targetId);
  return {
    ...base,
    action: 'install_copy',
    target_id: targetId,
    choices: viewable ? ['install_copy', 'use_server'] : null,
    note: `A persona with the id "${persona.suggested_id}" already exists here with different wording, so the package's is installed as "${targetId}".`,
  };
}

async function planCriterion(req, criterion, taken) {
  const base = { key: criterion.key, suggested_id: criterion.suggested_id, name: criterion.name, note: null };
  const [rows] = await pool.execute(
    `SELECT id, criteria_id, name, question_text, max_points, scoring_guide, prompt_text, enabled
       FROM rubric_criteria WHERE criteria_id = ?`,
    [criterion.suggested_id]
  );
  const row = rows[0];
  if (!row) {
    taken.add(criterion.suggested_id);
    return { ...base, action: 'create', target_id: criterion.suggested_id };
  }
  const identical = row.name === criterion.name
    && row.question_text === criterion.question_text
    && row.max_points === criterion.max_points
    && canonicalJson(parseJson(row.scoring_guide)) === canonicalJson(criterion.scoring_guide ?? null)
    && same(row.prompt_text, criterion.prompt_text);
  if (identical && row.enabled && (await canView(req, 'rubric_criteria', row.id))) {
    return { ...base, action: 'reuse', target_id: row.criteria_id };
  }
  const targetId = await uniqueId(criterion.suggested_id, { table: 'rubric_criteria', column: 'criteria_id', separator: '_', maxLength: 50, taken });
  taken.add(targetId);
  return { ...base, action: 'install_copy', target_id: targetId, note: `A criterion with the id "${criterion.suggested_id}" already exists here and differs, so the package's is installed as "${targetId}".` };
}

async function planRubric(req, rubric, criteriaPlans) {
  const base = { key: rubric.key, name: rubric.name };
  const criteria = rubric.criteria.map((key) => criteriaPlans.get(key));
  const targetIds = criteria.map((c) => c.target_id);
  if (criteria.every((c) => c.action === 'reuse')) {
    const [rows] = await pool.execute(
      'SELECT rubric_id, description, additional_prompt, criteria_ids FROM rubrics WHERE rubric_name = ? AND enabled = 1 ORDER BY rubric_id',
      [rubric.name]
    );
    for (const row of rows) {
      const identical = same(row.description, rubric.description)
        && same(row.additional_prompt, rubric.additional_prompt)
        && canonicalJson(parseJson(row.criteria_ids)) === canonicalJson(targetIds);
      if (identical && (await canView(req, 'rubric', row.rubric_id))) {
        return { ...base, action: 'reuse', target_id: row.rubric_id, criteria_ids: targetIds };
      }
    }
  }
  return { ...base, action: 'create', target_id: null, criteria_ids: targetIds };
}

/** Everything in the installed activities that reaches an AI prompt, for the person to read. */
function reviewText(pack, activities, personaPlans, rubricPlans, criteriaPlans) {
  const items = [];
  const add = (where, kind, name, text) => {
    if (typeof text === 'string' && text.trim()) items.push({ where, kind, name, text });
  };
  for (const activity of activities) {
    for (const s of activity.scenarios) {
      add(activity.title, 'Scenario instructions', s.name, s.prompt_instructions);
      add(activity.title, 'Scenario arguments for', s.name, s.arguments_for);
      add(activity.title, 'Scenario arguments against', s.name, s.arguments_against);
      for (const p of s.positions) {
        add(activity.title, 'Position arguments for', `${s.name}: ${p.name}`, p.arguments_for);
        add(activity.title, 'Position arguments against', `${s.name}: ${p.name}`, p.arguments_against);
      }
    }
    add(activity.title, 'Chatbot personality', 'Chat options', activity.settings?.chat_options?.chatbot_personality);
  }
  for (const persona of pack.personas) {
    const plan = personaPlans.get(persona.key);
    if (plan && (plan.action === 'create' || plan.action === 'install_copy')) add('Personas', 'Persona instructions', persona.name, persona.instructions);
  }
  for (const rubric of pack.rubrics) {
    const plan = rubricPlans.get(rubric.key);
    if (plan?.action === 'create') add('Rubrics', 'Rubric additional prompt', rubric.name, rubric.additional_prompt);
  }
  for (const criterion of pack.criteria) {
    const plan = criteriaPlans.get(criterion.key);
    if (plan && plan.action !== 'reuse') {
      add('Rubrics', 'Criterion question', criterion.name, criterion.question_text);
      add('Rubrics', 'Criterion prompt', criterion.name, criterion.prompt_text);
    }
  }
  return items;
}

/**
 * What installing this package here would do. Writes nothing.
 *
 * @param {object} req
 * @param {object} pack  from zip.js#openPack or export.js#collectPack
 * @param {{ activities?: Record<string, 'install'|'skip'|'copy'>,
 *           personas?: Record<string, 'install_copy'|'use_server'>,
 *           add_to_course_id?: number|null,
 *           titles?: Record<string, string> }} [options]
 *   activities  per activity key. Default: install a new one, skip one already installed.
 *               'copy' installs one that is already here as a separate copy with new ids.
 *   personas    per persona key, only where the plan offers `choices`.
 *   titles      per activity key, a title to use instead of the package's (Duplicate).
 */
export async function planInstall(req, pack, options = {}) {
  assertValidPack(pack);
  const requested = options.activities || {};

  // Activities
  const caseIdsTaken = [];
  const activityPlans = [];
  for (const activity of pack.activities) {
    const listed = pack.manifest.activities.find((a) => a.key === activity.key);
    const [existingRows] = await pool.execute('SELECT case_id, case_title, origin FROM cases WHERE activity_uid = ?', [activity.uid]);
    // An activity someone else has here, that this person cannot see, is not "already
    // installed" for them: say nothing about it and give their copy its own ids.
    const existing = existingRows[0] && (await canView(req, 'case', existingRows[0].case_id)) ? existingRows[0] : null;
    const hidden = Boolean(existingRows[0]) && !existing;
    // Only a case installed from a package records the content it arrived with. One made here
    // (the exporting server, with the package installed back) has no hash to compare: say it is
    // here without claiming it differs.
    const installedHash = existing ? parseJson(existing.origin)?.content_hash : null;
    const status = !existing ? 'new'
      : !installedHash ? 'installed'
      : installedHash === listed.content_hash ? 'installed_same' : 'installed_different';
    const want = requested[activity.key];
    const action = status === 'new' ? (want === 'skip' ? 'skip' : 'install') : (want === 'copy' ? 'copy' : 'skip');

    let caseId = null;
    let title = activity.title;
    if (action !== 'skip') {
      caseId = await generateUniqueCaseId(activity.suggested_id, { alsoTaken: caseIdsTaken });
      caseIdsTaken.push(caseId);
      const override = options.titles?.[activity.key];
      if (typeof override === 'string' && override.trim()) title = override.trim().slice(0, 100);
      else if (action === 'copy') title = `${activity.title.slice(0, 93)} (copy)`;
    }
    const type = getActivityType(activity.activity_type);
    activityPlans.push({
      key: activity.key,
      uid: activity.uid,
      title,
      package_title: activity.title,
      activity_type: type.id,
      activity_type_label: type.label,
      status,
      existing: existing ? { case_id: existing.case_id, case_title: existing.case_title } : null,
      action,
      can_copy: status !== 'new',
      case_id: caseId,
      new_uids: action === 'copy' || hidden,
      content_hash: listed.content_hash,
      has_settings: Boolean(activity.settings),
      counts: {
        documents: activity.documents.length,
        originals: activity.documents.filter((d) => d.original).length,
        scenarios: activity.scenarios.length,
        positions: activity.scenarios.reduce((n, s) => n + s.positions.length, 0),
      },
      documents: activity.documents.map((d) => ({
        title: d.title,
        role: d.role,
        chars: d.text_chars || 0,
        original_bytes: d.original?.bytes || 0,
        proprietary: Boolean(d.proprietary),
        include_in_prompt: d.include_in_prompt !== false,
      })),
      omitted: (pack.manifest.omitted || []).filter((o) => o && o.activity === activity.key),
      has_reading: activity.documents.some((d) => d.role !== 'teaching_note' && d.role !== 'instructor_notes' && d.include_in_prompt !== false),
    });
  }
  const installing = pack.activities.filter((a) => activityPlans.find((p) => p.key === a.key).action !== 'skip');

  // Personas, criteria and rubrics the installed activities use
  const namedPersonaKeys = new Set(installing.filter((a) => a.persona_selection === 'named').flatMap((a) => a.personas));
  const usedPersonaKeys = new Set(installing.flatMap((a) => a.personas));
  const personaIdsTaken = new Set();
  const personaPlans = new Map();
  for (const persona of pack.personas) {
    if (!usedPersonaKeys.has(persona.key)) continue;
    personaPlans.set(persona.key, await planPersona(req, persona, {
      named: namedPersonaKeys.has(persona.key),
      choice: options.personas?.[persona.key],
      taken: personaIdsTaken,
    }));
  }

  const usedRubricKeys = new Set(installing.map((a) => a.settings?.rubric).filter(Boolean));
  const usedRubrics = pack.rubrics.filter((r) => usedRubricKeys.has(r.key));
  const usedCriteriaKeys = new Set(usedRubrics.flatMap((r) => r.criteria));
  const criteriaIdsTaken = new Set();
  const criteriaPlans = new Map();
  for (const criterion of pack.criteria) {
    if (usedCriteriaKeys.has(criterion.key)) criteriaPlans.set(criterion.key, await planCriterion(req, criterion, criteriaIdsTaken));
  }
  const rubricPlans = new Map();
  for (const rubric of usedRubrics) rubricPlans.set(rubric.key, await planRubric(req, rubric, criteriaPlans));

  // Optional: also add the installed cases to a course (its Main version starts from the defaults)
  let course = null;
  if (options.add_to_course_id !== null && options.add_to_course_id !== undefined && options.add_to_course_id !== '') {
    const courseId = Number(options.add_to_course_id);
    const [rows] = Number.isInteger(courseId)
      ? await pool.execute('SELECT id, course_code, course_name FROM courses WHERE id = ?', [courseId])
      : [[]];
    if (rows.length === 0) throw new PackError(404, 'COURSE_NOT_FOUND', 'That course was not found.');
    if (!isAdminUser(req) && !(await isCourseOwner(req.user.id, courseId))) {
      throw new PackError(403, 'ACCESS_DENIED', 'Only admins or the course owner can add cases to that course.');
    }
    course = { course_id: rows[0].id, course_code: rows[0].course_code, course_name: rows[0].course_name };
  }

  const personas = [...personaPlans.values()];
  const criteria = [...criteriaPlans.values()];
  const rubrics = [...rubricPlans.values()];
  const planHash = sha256(canonicalJson({
    activities: activityPlans.map((a) => ({ key: a.key, uid: a.uid, action: a.action, case_id: a.case_id, new_uids: a.new_uids, title: a.title, content_hash: a.content_hash })),
    personas: personas.map((p) => ({ key: p.key, action: p.action, target_id: p.target_id })),
    criteria: criteria.map((c) => ({ key: c.key, action: c.action, target_id: c.target_id })),
    rubrics: rubrics.map((r) => ({ key: r.key, action: r.action, target_id: r.target_id, criteria_ids: r.criteria_ids })),
    course_id: course?.course_id ?? null,
  }));

  return {
    package: {
      exported_at: pack.manifest.exported_at || null,
      exported_from: pack.manifest.exported_from || null,
      note: pack.manifest.note || null,
      includes_originals: Boolean(pack.manifest.includes_originals),
      warnings: (pack.manifest.warnings || []).filter((w) => w && typeof w.message === 'string').slice(0, 200),
    },
    activities: activityPlans,
    personas,
    criteria,
    rubrics,
    course,
    review: reviewText(pack, installing, personaPlans, rubricPlans, criteriaPlans),
    plan_hash: planHash,
  };
}

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

/** A stored file name made here from a display name: no path parts, no control characters. */
function storedFilename(displayName, ext, used) {
  const stem = path.basename(String(displayName), path.extname(String(displayName)))
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
    .replace(/^\.+/, '')
    .slice(0, 120) || 'file';
  let name = `${stem}-${Date.now()}${ext}`;
  for (let n = 2; used.has(name); n++) name = `${stem}-${Date.now()}-${n}${ext}`;
  used.add(name);
  return name;
}

/** Persona ids in chat options, moved to the ids the personas have on this server. */
function withTargetPersonaIds(chatOptions, personaIdMap) {
  if (!chatOptions || typeof chatOptions !== 'object') return chatOptions;
  const next = { ...chatOptions };
  if (typeof next.allowed_personas === 'string' && next.allowed_personas.trim()) {
    next.allowed_personas = next.allowed_personas
      .split(',')
      .map((id) => id.trim().toLowerCase())
      .filter(Boolean)
      .map((id) => personaIdMap.get(id) || id)
      .join(',');
  }
  if (typeof next.default_persona === 'string' && personaIdMap.has(next.default_persona)) {
    next.default_persona = personaIdMap.get(next.default_persona);
  }
  return next;
}

async function installActivity(conn, req, pack, activity, plan, { personaIdMap, rubricIdByKey, origin, defaultsSource, createdDirs }) {
  const owner = ownerOf(req);
  const caseId = plan.case_id;
  const fresh = plan.new_uids;

  await conn.execute(
    `INSERT INTO cases (case_id, case_title, case_version, activity_type, enabled, created_by_type, created_by,
                        is_shared, visibility, activity_uid, origin)
     VALUES (?, ?, ?, ?, 1, ?, ?, 0, 'private', ?, ?)`,
    [caseId, plan.title, activity.version_label ?? null, activity.activity_type, owner.type, owner.id,
     fresh ? crypto.randomUUID() : activity.uid, JSON.stringify(origin)]
  );

  // Scenarios and positions
  const scenarioIdByKey = new Map();
  const positionIdByKey = new Map();
  let baseScenarioId = null;
  for (const s of activity.scenarios) {
    const override = s.chat_options_override ? withTargetPersonaIds(s.chat_options_override, personaIdMap) : null;
    const [result] = await conn.execute(
      `INSERT INTO case_scenarios
         (case_id, scenario_uid, scenario_name, protagonist, protagonist_initials, protagonist_role, chat_topic,
          chat_question, prompt_instructions, chat_time_limit, chat_time_warning, arguments_for, arguments_against,
          chat_options_override, sort_order, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [caseId, fresh ? crypto.randomUUID() : s.uid, s.name, s.protagonist, s.protagonist_initials, s.protagonist_role ?? null,
       s.chat_topic ?? null, s.chat_question, s.prompt_instructions ?? null, s.chat_time_limit ?? 0, s.chat_time_warning ?? 5,
       s.arguments_for ?? null, s.arguments_against ?? null, override ? JSON.stringify(override) : null,
       s.sort_order ?? 0, s.enabled === false ? 0 : 1]
    );
    scenarioIdByKey.set(s.key, result.insertId);
    if (s.is_base) baseScenarioId = result.insertId;
    for (const p of s.positions) {
      const [positionResult] = await conn.execute(
        `INSERT INTO scenario_positions
           (scenario_id, position_uid, position_name, position, position_order, arguments_for, arguments_against, position_enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [result.insertId, fresh ? crypto.randomUUID() : p.uid, p.name, p.position, p.order ?? 0,
         p.arguments_for ?? null, p.arguments_against ?? null, p.enabled === false ? 0 : 1]
      );
      positionIdByKey.set(p.key, positionResult.insertId);
    }
  }
  if (baseScenarioId !== null) {
    await conn.execute('UPDATE cases SET base_scenario_id = ? WHERE case_id = ?', [baseScenarioId, caseId]);
  }

  // Documents: parents before their outlines.
  const caseDir = path.join(CASE_FILES_DIR, caseId);
  const uploadsDir = path.join(caseDir, 'uploads');
  await fs.mkdir(uploadsDir, { recursive: true });
  createdDirs.push(caseDir);
  const fileIdByKey = new Map();
  const usedNames = new Set();
  const ordered = [...activity.documents.filter((d) => !d.outline_of), ...activity.documents.filter((d) => d.outline_of)];
  for (const doc of ordered) {
    const text = pack.texts.get(`${activity.key}/${doc.key}`) ?? null;
    let filename;
    let fileFormat;
    let fileSource;
    let fileSize;
    if (doc.original) {
      const data = await pack.readOriginal(activity.key, doc);
      if (!Buffer.isBuffer(data)) throw new PackError(400, 'INVALID_PACK', `This is not a valid activity package: the original file of "${doc.title}" is missing.`);
      const ext = extensionOf(doc.original.filename);
      filename = storedFilename(doc.original.filename, ext, usedNames);
      await fs.writeFile(path.join(uploadsDir, filename), data);
      fileFormat = ext.slice(1);
      fileSource = 'imported';
      fileSize = data.length;
    } else {
      // Text only: the same shape as a web page or pasted text (routes/caseFiles.js), a
      // placeholder name that never exists on disk.
      filename = `imported-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.md`;
      fileFormat = 'md';
      fileSource = 'imported_text';
      fileSize = Buffer.byteLength(text, 'utf8');
    }
    const isOutline = Boolean(doc.outline_of);
    const [result] = await conn.execute(
      `INSERT INTO case_files
         (case_id, parent_file_id, filename, file_type, is_outline, is_latest_outline, processing_status,
          outline_content, converted_text, converted_text_original, converted_at,
          file_format, file_source, source_url, proprietary, include_in_chat_prompt, prompt_order,
          file_version, original_filename, file_size)
       VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ${text === null ? 'NULL' : 'NOW()'}, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [caseId, isOutline ? fileIdByKey.get(doc.outline_of) : null, filename, doc.role, isOutline ? 1 : 0,
       isOutline && doc.latest_outline ? 1 : 0, isOutline ? text : null, text, text,
       fileFormat, fileSource, doc.source_url ?? null, doc.proprietary ? 1 : 0, doc.include_in_prompt === false ? 0 : 1,
       doc.prompt_order ?? 0, doc.version_label ?? null, doc.title, fileSize]
    );
    fileIdByKey.set(doc.key, result.insertId);
  }

  // The package's settings become the case's default settings.
  let bundle = null;
  if (activity.settings) {
    const s = activity.settings;
    bundle = {
      chat_options: withTargetPersonaIds(s.chat_options ?? null, personaIdMap),
      selection_mode: s.selection_mode,
      require_order: s.require_order,
      use_scenarios: s.use_scenarios,
      position_tracking_enabled: s.position_tracking_enabled,
      position_capture_method: s.position_capture_method,
      track_position_change: s.track_position_change,
      rubric_id: s.rubric ? rubricIdByKey.get(s.rubric) ?? null : null,
      scenarios: (s.scenarios || []).map((row) => ({ scenario_id: scenarioIdByKey.get(row.scenario), enabled: row.enabled !== false, sort_order: row.sort_order ?? 0 })),
      positions: (s.positions || []).map((row) => ({ position_id: positionIdByKey.get(row.position), enabled: row.enabled !== false, sort_order: row.sort_order ?? 0 })),
    };
    await writeCaseDefaults(conn, caseId, bundle, defaultsSource);
  }
  return { case_id: caseId, case_title: plan.title, key: activity.key, defaults: bundle };
}

/**
 * Install a package. Plans again, checks the confirmed hash, then writes in one transaction.
 *
 * @param {object} options  the same options given to planInstall(), plus:
 *   plan_hash   the hash from the plan the person confirmed. Required unless `internal`.
 *   internal    true for a same-server copy (Duplicate), which has no separate preview.
 *   origin      extra fields for cases.origin (Duplicate records the case it copied).
 *   defaults_source  label stored with the case's default settings (default "Activity package").
 * @returns {Promise<{ installed: Array<{key, case_id, case_title}>, personas_created: string[],
 *                     criteria_created: string[], rubrics_created: Array<{rubric_id, rubric_name}>,
 *                     course: object|null }>}
 */
export async function executeInstall(req, pack, options = {}) {
  const plan = await planInstall(req, pack, options);
  if (!options.internal) {
    if (typeof options.plan_hash !== 'string' || !options.plan_hash) {
      throw new PackError(400, 'INVALID_REQUEST', 'Review the package before installing it.');
    }
    if (options.plan_hash !== plan.plan_hash) {
      throw new PackError(409, 'PLAN_CHANGED', 'This server changed since you reviewed the package, so what would be installed is different now. Review it again, then install.');
    }
  }
  const toInstall = plan.activities.filter((a) => a.action !== 'skip');
  if (toInstall.length === 0) throw new PackError(400, 'NOTHING_TO_INSTALL', 'Nothing is selected to install.');

  const owner = ownerOf(req);
  const conn = await pool.getConnection();
  const createdDirs = [];
  try {
    await conn.beginTransaction();

    // Personas
    const personaIdMap = new Map();
    const personasCreated = [];
    for (const persona of pack.personas) {
      const p = plan.personas.find((x) => x.key === persona.key);
      if (!p) continue;
      personaIdMap.set(persona.suggested_id, p.target_id);
      if (p.action !== 'create' && p.action !== 'install_copy') continue;
      await conn.execute(
        `INSERT INTO personas (persona_id, persona_name, description, instructions, enabled, sort_order,
                               is_system_default, created_by, created_by_type, visibility)
         VALUES (?, ?, ?, ?, 1, 0, 0, ?, ?, 'private')`,
        [p.target_id, persona.name, persona.description ?? null, persona.instructions, owner.id, owner.type]
      );
      personasCreated.push(p.target_id);
    }

    // Criteria
    const criteriaCreated = [];
    for (const criterion of pack.criteria) {
      const c = plan.criteria.find((x) => x.key === criterion.key);
      if (!c || c.action === 'reuse') continue;
      await conn.execute(
        `INSERT INTO rubric_criteria (criteria_id, name, question_text, max_points, scoring_guide, prompt_text,
                                      is_system_default, created_by, created_by_type, visibility, enabled)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 'private', 1)`,
        [c.target_id, criterion.name, criterion.question_text, criterion.max_points,
         criterion.scoring_guide ? JSON.stringify(criterion.scoring_guide) : null, criterion.prompt_text ?? null, owner.id, owner.type]
      );
      criteriaCreated.push(c.target_id);
    }

    // Rubrics. The grading prompt is built here from the criteria, never taken from the package.
    const rubricIdByKey = new Map();
    const rubricsCreated = [];
    for (const rubric of pack.rubrics) {
      const r = plan.rubrics.find((x) => x.key === rubric.key);
      if (!r) continue;
      if (r.action === 'reuse') {
        rubricIdByKey.set(rubric.key, r.target_id);
        continue;
      }
      const criteria = rubric.criteria.map((key) => pack.criteria.find((c) => c.key === key));
      const [result] = await conn.execute(
        `INSERT INTO rubrics (rubric_name, description, criteria_ids, total_points, criteria_prompt, additional_prompt,
                              created_by, created_by_type, visibility)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'private')`,
        [rubric.name, rubric.description ?? null, JSON.stringify(r.criteria_ids), calculateTotalPoints(criteria),
         generateCriteriaPrompt(criteria), rubric.additional_prompt ?? null, owner.id, owner.type]
      );
      rubricIdByKey.set(rubric.key, result.insertId);
      rubricsCreated.push({ rubric_id: result.insertId, rubric_name: rubric.name });
    }

    // Activities
    const installed = [];
    for (const activityPlan of toInstall) {
      const activity = pack.activities.find((a) => a.key === activityPlan.key);
      const origin = {
        activity_uid: activity.uid,
        content_hash: activityPlan.content_hash,
        exported_at: pack.manifest.exported_at || null,
        exported_from: pack.manifest.exported_from || null,
        installed_at: new Date().toISOString(),
        copy: activityPlan.new_uids,
        ...(options.origin || {}),
      };
      const result = await installActivity(conn, req, pack, activity, activityPlan, {
        personaIdMap, rubricIdByKey, origin, createdDirs,
        defaultsSource: options.defaults_source || 'Activity package',
      });
      if (plan.course) {
        await createCourseCase(conn, { courseId: plan.course.course_id, caseId: result.case_id, defaults: result.defaults, createdBy: req.user.id });
      }
      installed.push({ key: result.key, case_id: result.case_id, case_title: result.case_title });
    }

    await conn.commit();
    return { installed, personas_created: personasCreated, criteria_created: criteriaCreated, rubrics_created: rubricsCreated, course: plan.course };
  } catch (error) {
    try { await conn.rollback(); } catch { /* the connection is gone; nothing was committed */ }
    for (const dir of createdDirs) {
      try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* best effort */ }
    }
    if (error?.code === 'ER_DUP_ENTRY') {
      throw new PackError(409, 'PLAN_CHANGED', 'This server changed while the package was being installed, so nothing was installed. Review it again, then install.');
    }
    throw error;
  } finally {
    conn.release();
  }
}
