/**
 * Activity package format 1: names, limits, and the strict check every package must pass
 * before anything is planned or written. Full description: docs/activity-packages.md.
 *
 * A package is a ZIP (`<name>.mtc.zip`) of one or more activities (cases):
 *
 *   manifest.json                     format, format_version, exported_at, exported_from,
 *                                     requires[], activities[{key, uid, title, activity_type,
 *                                     content_hash}], includes_originals, omitted[], note
 *   activities/<key>/activity.json    the case, its documents[], scenarios[] (each with
 *                                     positions[]), settings, and the persona keys it uses
 *   activities/<key>/documents/*.md   the text students and the AI read, and outlines
 *   activities/<key>/originals/*      original files, only when the exporter included them
 *   personas.json                     [{key, suggested_id, kind, name, description, instructions, system}]
 *   rubrics.json                      {rubrics: [...], criteria: [...]}
 *
 * In memory (what export.js builds, zip.js reads and writes, and import.js installs) a
 * package is { manifest, activities, personas, rubrics, criteria, texts, originals } where
 * `texts` is a Map of `${activity.key}/${doc.key}` -> string and `originals` is a Map of the
 * same key -> Buffer (export) or is read on demand with pack.readOriginal() (import).
 *
 * THE CHECK IS STRICT AND FAILS CLOSED (rule 1 of the package rules). A value outside what
 * this server understands is refused, never ignored: an unknown activity type, chat option,
 * document role, persona kind or enum would otherwise install cleanly and then silently not
 * do what its author meant. Unknown extra PROPERTIES are ignored; a newer exporter that adds
 * something an older installer must not ignore adds a `requires` token for it
 * (capabilities.js), and the older installer refuses the token.
 */

import crypto from 'crypto';
import { isKnownActivityType, getActivityType } from '../../../utils/activityTypes.js';
import { KNOWN_CHAT_OPTION_KEYS } from '../chatOptions.js';
import { CAPTURE_METHODS, SELECTION_MODES } from '../activityDefaults.js';

export const PACK_FORMAT = 'makethecase.activity-pack';
export const FORMAT_VERSION = 1;
export const PACK_FILE_EXTENSION = '.mtc.zip';

export const PERSONA_KINDS = ['protagonist', 'audience'];
export const AUDIENCE_ID_PREFIX = 'audience-';

/** Document roles: case_files.file_type. `other:Label` is the instructor's own label. */
export const DOCUMENT_ROLES = ['case', 'teaching_note', 'chapter', 'reading', 'article', 'instructor_notes', 'outline'];
export const isDocumentRole = (role) =>
  typeof role === 'string' && (DOCUMENT_ROLES.includes(role) || (role.startsWith('other:') && role.length > 6 && role.length <= 50));

/** Original files a package may carry: the Case Files upload list (routes/caseFiles.js). */
export const ORIGINAL_EXTENSIONS = ['.pdf', '.docx', '.doc', '.md', '.txt', '.jpg', '.jpeg', '.png'];

const MB = 1024 * 1024;
export const LIMITS = {
  packBytes: 80 * MB,          // the uploaded ZIP
  entries: 3000,               // files in the ZIP
  jsonBytes: 5 * MB,           // manifest.json, activity.json, personas.json, rubrics.json
  textChars: 2_000_000,        // one document's text (MAX_TEXT_CHARS in routes/caseFiles.js)
  textBytes: 8 * MB,
  originalBytes: 10 * MB,      // one original file (the Case Files upload limit)
  totalBytes: 400 * MB,        // everything read out of the ZIP, inflated
  activities: 100,
  documents: 200,              // per activity
  scenarios: 100,              // per activity
  positions: 50,               // per scenario
  personas: 500,
  rubrics: 200,
  criteria: 1000,
};

/** MySQL TEXT holds 65,535 bytes; a longer value would fail the insert inside the install. */
const TEXT_BYTES = 65_535;

export class PackError extends Error {
  /**
   * @param {number} status HTTP status (400 malformed, 413 too large, 422 not installable here)
   * @param {string} code   stable code for the client
   * @param {string} message one sentence a person can act on
   * @param {object} [details]
   */
  constructor(status, code, message, details = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const invalid = (message) => new PackError(400, 'INVALID_PACK', `This is not a valid activity package: ${message}`);

export const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

/** JSON with object keys sorted, so equal content always hashes the same. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

/**
 * The fingerprint of one activity's content: its activity.json (which names each document's
 * text and original hash) plus the personas, rubric and criteria it uses. Two packages with
 * the same hash for an activity would install the same thing.
 */
export function activityContentHash(activity, personas, rubrics, criteria) {
  const usedPersonas = personas.filter((p) => (activity.personas || []).includes(p.key));
  const rubricKey = activity.settings?.rubric ?? null;
  const usedRubrics = rubrics.filter((r) => r.key === rubricKey);
  const criteriaKeys = new Set(usedRubrics.flatMap((r) => r.criteria));
  const usedCriteria = criteria.filter((c) => criteriaKeys.has(c.key));
  const byKey = (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  return sha256(canonicalJson({
    activity,
    personas: [...usedPersonas].sort(byKey),
    rubrics: [...usedRubrics].sort(byKey),
    criteria: [...usedCriteria].sort(byKey),
  }));
}

// ---------------------------------------------------------------------------
// Field checks
// ---------------------------------------------------------------------------

const KEY_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CASE_ID_RE = /^[a-z0-9][a-z0-9-]{0,29}$/;
const PERSONA_ID_RE = /^[a-z0-9-]{1,30}$/;
const CRITERIA_ID_RE = /^[a-z0-9_]{1,50}$/;
const DOC_FILE_RE = /^[a-z0-9][a-z0-9._-]{0,80}$/;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function str(value, what, { max, required = false, bytes = false } = {}) {
  if (value === null || value === undefined || value === '') {
    if (required) throw invalid(`${what} is missing`);
    return;
  }
  if (typeof value !== 'string') throw invalid(`${what} must be text`);
  const size = bytes ? Buffer.byteLength(value, 'utf8') : value.length;
  if (size > max) throw invalid(`${what} is too long (${size} of ${max} ${bytes ? 'bytes' : 'characters'} allowed)`);
  if (/\u0000/.test(value)) throw invalid(`${what} contains a NUL character`);
}

const text = (value, what, required = false) => str(value, what, { max: TEXT_BYTES, bytes: true, required });

function int(value, what, { min = 0, max = 1_000_000, required = false } = {}) {
  if (value === null || value === undefined) {
    if (required) throw invalid(`${what} is missing`);
    return;
  }
  if (!Number.isInteger(value) || value < min || value > max) throw invalid(`${what} must be a whole number from ${min} to ${max}`);
}

function bool(value, what) {
  if (value !== undefined && value !== null && typeof value !== 'boolean') throw invalid(`${what} must be true or false`);
}

function list(value, what, max) {
  if (!Array.isArray(value)) throw invalid(`${what} must be a list`);
  if (value.length > max) throw invalid(`${what} has ${value.length} entries; at most ${max} are allowed`);
  return value;
}

function uniqueKeys(items, what) {
  const seen = new Set();
  for (const item of items) {
    if (!isObject(item)) throw invalid(`${what} has an entry that is not an object`);
    if (typeof item.key !== 'string' || !KEY_RE.test(item.key)) throw invalid(`${what} has an invalid key`);
    if (seen.has(item.key)) throw invalid(`${what} uses the key "${item.key}" twice`);
    seen.add(item.key);
  }
  return seen;
}

function uid(value, what) {
  if (typeof value !== 'string' || !UUID_RE.test(value)) throw invalid(`${what} is not a valid id`);
}

/** The extension of a file name, lower case, including the dot ('' when there is none). */
export const extensionOf = (name) => {
  const m = /\.[a-z0-9]{1,8}$/i.exec(String(name || ''));
  return m ? m[0].toLowerCase() : '';
};

/**
 * Chat options a package may carry: an object whose keys are all known to this server, or
 * null ("follow the installing server's defaults").
 */
export function assertChatOptions(chatOptions, what) {
  if (chatOptions === null || chatOptions === undefined) return;
  if (!isObject(chatOptions)) throw invalid(`${what} must be an object or null`);
  for (const [key, value] of Object.entries(chatOptions)) {
    if (!KNOWN_CHAT_OPTION_KEYS.has(key)) {
      throw new PackError(422, 'UNKNOWN_CHAT_OPTION',
        `This package uses the chat option "${key}", which this MakeTheCase server does not have. Update this server, then install the package again.`,
        { chat_option: key });
    }
    if (!['string', 'number', 'boolean'].includes(typeof value) && value !== null) {
      throw invalid(`${what}.${key} must be text, a number, or true/false`);
    }
    if (typeof value === 'string') text(value, `${what}.${key}`);
  }
}

/**
 * A scenario's chat_options_override holds chat options plus the scenario's position settings
 * (types.ts ScenarioPositionSettings; routes/evaluations.js reads them). export.js sends only
 * these keys and assertScenarioOverride() refuses any other, as for chat options.
 */
export const SCENARIO_POSITION_KEYS = ['position_tracking_enabled', 'position_capture_method', 'position_options', 'position_labels', 'track_position_change'];
export const isScenarioOverrideKey = (key) => KNOWN_CHAT_OPTION_KEYS.has(key) || SCENARIO_POSITION_KEYS.includes(key);

function assertScenarioOverride(override, what) {
  if (!isObject(override)) throw invalid(`${what} must be an object`);
  if (Buffer.byteLength(JSON.stringify(override), 'utf8') > TEXT_BYTES) throw invalid(`${what} is too large`);
  const { position_tracking_enabled, position_capture_method, position_options, position_labels, track_position_change, ...chatOptions } = override;
  assertChatOptions(chatOptions, what);
  bool(position_tracking_enabled, `${what}.position_tracking_enabled`);
  bool(track_position_change, `${what}.track_position_change`);
  if (position_capture_method !== undefined && position_capture_method !== null && !CAPTURE_METHODS.includes(position_capture_method)) {
    throw new PackError(422, 'UNKNOWN_SETTING', `${what} uses the position capture method "${position_capture_method}", which this MakeTheCase server does not have. Update this server, then install the package again.`);
  }
  if (position_options !== undefined && position_options !== null) {
    for (const option of list(position_options, `${what}.position_options`, LIMITS.positions)) {
      str(option, `${what}.position_options`, { max: 255, required: true });
    }
  }
  if (position_labels !== undefined && position_labels !== null) {
    if (!isObject(position_labels)) throw invalid(`${what}.position_labels must be an object`);
    for (const [option, label] of Object.entries(position_labels)) {
      str(option, `${what}.position_labels`, { max: 255, required: true });
      str(label, `${what}.position_labels`, { max: 255 });
    }
  }
}

function checkPersona(p) {
  if (!PERSONA_KINDS.includes(p.kind)) {
    throw new PackError(422, 'UNKNOWN_PERSONA_KIND',
      `This package has a persona of kind "${p.kind}", which this MakeTheCase server does not have. Update this server, then install the package again.`,
      { persona_kind: p.kind });
  }
  if (typeof p.suggested_id !== 'string' || !PERSONA_ID_RE.test(p.suggested_id)) throw invalid(`persona "${p.key}" has an invalid id`);
  // The id prefix is how the app tells the two kinds apart (services/teachBack.js), so a
  // persona whose id and kind disagree would be offered to the wrong activity.
  if (p.suggested_id.startsWith(AUDIENCE_ID_PREFIX) !== (p.kind === 'audience')) {
    throw invalid(`persona "${p.suggested_id}" is marked ${p.kind}, which does not match its id (audience ids begin "${AUDIENCE_ID_PREFIX}")`);
  }
  str(p.name, `persona "${p.key}" name`, { max: 100, required: true });
  text(p.description, `persona "${p.key}" description`);
  text(p.instructions, `persona "${p.key}" instructions`, true);
  bool(p.system, `persona "${p.key}" system`);
}

function checkCriterion(c) {
  if (typeof c.suggested_id !== 'string' || !CRITERIA_ID_RE.test(c.suggested_id)) throw invalid(`criterion "${c.key}" has an invalid id`);
  str(c.name, `criterion "${c.key}" name`, { max: 100, required: true });
  text(c.question_text, `criterion "${c.key}" question`, true);
  int(c.max_points, `criterion "${c.key}" points`, { min: 1, max: 100, required: true });
  if (c.scoring_guide !== null && c.scoring_guide !== undefined) {
    if (!isObject(c.scoring_guide)) throw invalid(`criterion "${c.key}" scoring guide must be an object`);
    for (const [level, description] of Object.entries(c.scoring_guide)) {
      if (!/^\d{1,3}$/.test(level)) throw invalid(`criterion "${c.key}" scoring guide has an invalid level`);
      text(description, `criterion "${c.key}" scoring guide`);
    }
  }
  text(c.prompt_text, `criterion "${c.key}" prompt text`);
  bool(c.system, `criterion "${c.key}" system`);
}

function checkDocument(doc, activity, pack) {
  const what = `document "${doc.key}" of "${activity.title}"`;
  if (!isDocumentRole(doc.role)) {
    throw new PackError(422, 'UNKNOWN_DOCUMENT_ROLE',
      `This package has a document of type "${doc.role}", which this MakeTheCase server does not have. Update this server, then install the package again.`,
      { document_role: doc.role });
  }
  str(doc.title, `${what} title`, { max: 255, required: true });
  str(doc.format, `${what} format`, { max: 20 });
  str(doc.source, `${what} source`, { max: 30 });
  str(doc.version_label, `${what} version`, { max: 100 });
  if (doc.source_url !== null && doc.source_url !== undefined) {
    str(doc.source_url, `${what} source URL`, { max: 2048 });
    if (!/^https?:\/\//i.test(doc.source_url)) throw invalid(`${what} source URL must begin http:// or https://`);
  }
  bool(doc.include_in_prompt, `${what} include_in_prompt`);
  bool(doc.proprietary, `${what} proprietary`);
  bool(doc.latest_outline, `${what} latest_outline`);
  int(doc.prompt_order, `${what} prompt order`, { min: -100000, max: 100000 });

  const hasText = doc.text !== null && doc.text !== undefined;
  const hasOriginal = doc.original !== null && doc.original !== undefined;
  if (!hasText && !hasOriginal) throw invalid(`${what} has neither text nor an original file`);

  if (hasText) {
    if (typeof doc.text !== 'string' || !/^documents\/[a-z0-9][a-z0-9._-]{0,80}\.md$/.test(doc.text)) throw invalid(`${what} has an invalid text path`);
    const body = pack.texts.get(`${activity.key}/${doc.key}`);
    if (typeof body !== 'string') throw invalid(`${what} is missing its text file`);
    if (body.length > LIMITS.textChars) {
      throw new PackError(413, 'PACK_TOO_LARGE', `The text of ${what} is over the ${LIMITS.textChars.toLocaleString()} character limit.`);
    }
    if (typeof doc.text_sha256 !== 'string' || sha256(body) !== doc.text_sha256) {
      throw invalid(`the text of ${what} does not match its checksum (the file is damaged or was edited)`);
    }
  }
  if (hasOriginal) {
    const o = doc.original;
    if (!isObject(o)) throw invalid(`${what} original must be an object`);
    if (typeof o.path !== 'string' || !/^originals\/[a-z0-9][a-z0-9._-]{0,80}$/.test(o.path)) throw invalid(`${what} has an invalid original path`);
    if (!DOC_FILE_RE.test(o.path.slice('originals/'.length))) throw invalid(`${what} has an invalid original path`);
    str(o.filename, `${what} original filename`, { max: 255, required: true });
    if (!ORIGINAL_EXTENSIONS.includes(extensionOf(o.path)) || extensionOf(o.path) !== extensionOf(o.filename)) {
      throw invalid(`${what} has an original file of a type that is not allowed (${extensionOf(o.filename) || 'no extension'})`);
    }
    int(o.bytes, `${what} original size`, { min: 1, max: LIMITS.originalBytes, required: true });
    if (typeof o.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(o.sha256)) throw invalid(`${what} original has no checksum`);
  }
}

function checkActivity(activity, pack, personaKeys, rubricKeys) {
  const what = `activity "${activity.title || activity.key}"`;
  uid(activity.uid, `${what} uid`);
  if (typeof activity.suggested_id !== 'string' || !CASE_ID_RE.test(activity.suggested_id)) throw invalid(`${what} has an invalid id`);
  str(activity.title, `${what} title`, { max: 100, required: true });
  str(activity.version_label, `${what} version`, { max: 10 });
  if (!isKnownActivityType(activity.activity_type)) {
    throw new PackError(422, 'UNKNOWN_ACTIVITY_TYPE',
      `${what} is a "${activity.activity_type}" activity, which this MakeTheCase server does not have. Update this server, then install the package again.`,
      { activity_type: activity.activity_type });
  }

  // Documents
  const documents = list(activity.documents, `${what} documents`, LIMITS.documents);
  const docKeys = uniqueKeys(documents, `${what} documents`);
  for (const doc of documents) {
    checkDocument(doc, activity, pack);
    const hasParent = doc.outline_of !== null && doc.outline_of !== undefined;
    // An outline takes its place in prompts (case content or teaching note) from its parent, so
    // one without a parent has no defined place. export.js sends such an outline as a plain
    // document of the parent's role instead.
    if ((doc.role === 'outline') !== hasParent) {
      throw invalid(`document "${doc.key}" of ${what} must be an outline with a parent document, or neither`);
    }
    if (hasParent) {
      const parent = documents.find((d) => d.key === doc.outline_of);
      if (!docKeys.has(doc.outline_of) || !parent || parent.role === 'outline') {
        throw invalid(`outline "${doc.key}" of ${what} names a parent document that is not in the package`);
      }
    }
  }

  // Scenarios and positions
  const scenarios = list(activity.scenarios, `${what} scenarios`, LIMITS.scenarios);
  const scenarioKeys = uniqueKeys(scenarios, `${what} scenarios`);
  const positionKeys = new Set();
  for (const s of scenarios) {
    const sw = `scenario "${s.name || s.key}" of ${what}`;
    uid(s.uid, `${sw} uid`);
    str(s.name, `${sw} name`, { max: 100, required: true });
    str(s.protagonist, `${sw} protagonist`, { max: 100, required: true });
    str(s.protagonist_initials, `${sw} initials`, { max: 5, required: true });
    str(s.protagonist_role, `${sw} role`, { max: 200 });
    str(s.chat_topic, `${sw} topic`, { max: 255 });
    text(s.chat_question, `${sw} chat question`, true);
    text(s.prompt_instructions, `${sw} prompt instructions`);
    text(s.arguments_for, `${sw} arguments for`);
    text(s.arguments_against, `${sw} arguments against`);
    int(s.chat_time_limit, `${sw} time limit`, { max: 100000 });
    int(s.chat_time_warning, `${sw} time warning`, { max: 100000 });
    int(s.sort_order, `${sw} order`, { min: -100000, max: 100000 });
    bool(s.enabled, `${sw} enabled`);
    bool(s.is_base, `${sw} is_base`);
    if (s.chat_options_override !== null && s.chat_options_override !== undefined) {
      assertScenarioOverride(s.chat_options_override, `${sw} options override`);
    }
    const positions = list(s.positions ?? [], `${sw} positions`, LIMITS.positions);
    const names = new Set();
    for (const p of positions) {
      if (!isObject(p) || typeof p.key !== 'string' || !KEY_RE.test(p.key)) throw invalid(`${sw} has a position with an invalid key`);
      if (positionKeys.has(p.key)) throw invalid(`${what} uses the position key "${p.key}" twice`);
      positionKeys.add(p.key);
      uid(p.uid, `position "${p.key}" of ${sw} uid`);
      str(p.name, `position "${p.key}" of ${sw} name`, { max: 100, required: true });
      if (names.has(p.name)) throw invalid(`${sw} has two positions named "${p.name}"`);
      names.add(p.name);
      str(p.position, `position "${p.name}" of ${sw}`, { max: 255, required: true });
      text(p.arguments_for, `position "${p.name}" of ${sw} arguments for`);
      text(p.arguments_against, `position "${p.name}" of ${sw} arguments against`);
      int(p.order, `position "${p.name}" of ${sw} order`, { min: -100000, max: 100000 });
      bool(p.enabled, `position "${p.name}" of ${sw} enabled`);
    }
  }
  if (scenarios.filter((s) => s.is_base).length > 1) throw invalid(`${what} marks more than one base scenario`);

  // Settings
  const settings = activity.settings;
  if (settings !== null && settings !== undefined) {
    if (!isObject(settings)) throw invalid(`${what} settings must be an object or null`);
    assertChatOptions(settings.chat_options, `${what} chat options`);
    if (!SELECTION_MODES.includes(settings.selection_mode)) {
      throw new PackError(422, 'UNKNOWN_SETTING', `${what} uses the scenario selection mode "${settings.selection_mode}", which this MakeTheCase server does not have. Update this server, then install the package again.`);
    }
    if (!CAPTURE_METHODS.includes(settings.position_capture_method)) {
      throw new PackError(422, 'UNKNOWN_SETTING', `${what} uses the position capture method "${settings.position_capture_method}", which this MakeTheCase server does not have. Update this server, then install the package again.`);
    }
    for (const key of ['require_order', 'use_scenarios', 'position_tracking_enabled', 'track_position_change']) {
      if (typeof settings[key] !== 'boolean') throw invalid(`${what} setting ${key} must be true or false`);
    }
    if (settings.rubric !== null && settings.rubric !== undefined && !rubricKeys.has(settings.rubric)) {
      throw invalid(`${what} names a rubric that is not in the package`);
    }
    for (const row of list(settings.scenarios ?? [], `${what} assigned scenarios`, LIMITS.scenarios)) {
      if (!isObject(row) || !scenarioKeys.has(row.scenario)) throw invalid(`${what} assigns a scenario that is not in the package`);
      bool(row.enabled, `${what} assigned scenario enabled`);
      int(row.sort_order, `${what} assigned scenario order`, { min: -100000, max: 100000 });
    }
    for (const row of list(settings.positions ?? [], `${what} position overrides`, LIMITS.scenarios * LIMITS.positions)) {
      if (!isObject(row) || !positionKeys.has(row.position)) throw invalid(`${what} overrides a position that is not in the package`);
      bool(row.enabled, `${what} position override enabled`);
      int(row.sort_order, `${what} position override order`, { min: -100000, max: 100000 });
    }
  }

  // Personas this activity uses must be in the package and of the kind its type offers.
  // 'named': the settings list them. 'all_enabled': the settings offer every enabled persona,
  // and these are the ones that meant on the exporting server (import.js creates them only
  // when the installing server has none of that kind).
  if (!['named', 'all_enabled'].includes(activity.persona_selection)) throw invalid(`${what} has an invalid persona selection`);
  const kind = getActivityType(activity.activity_type).personaKind;
  for (const key of list(activity.personas ?? [], `${what} personas`, LIMITS.personas)) {
    const persona = personaKeys.get(key);
    if (!persona) throw invalid(`${what} uses a persona that is not in the package`);
    if (persona.kind !== kind) throw invalid(`${what} is a ${activity.activity_type} activity but uses the ${persona.kind} persona "${persona.suggested_id}"`);
  }
}

/**
 * Check a whole package (as read by zip.js#openPack or built by export.js). Throws PackError;
 * returns nothing. Does not check `format_version` or `requires`: capabilities.js does that
 * first, so a package from a newer server is refused for the right reason before a strict
 * field check trips on something that server added.
 */
export function assertValidPack(pack) {
  const { manifest } = pack;
  if (!isObject(manifest)) throw invalid('manifest.json is missing or is not an object');
  str(manifest.note, 'the package note', { max: 2000 });
  if (manifest.omitted !== undefined) list(manifest.omitted, 'the list of omitted documents', LIMITS.activities * LIMITS.documents);
  if (manifest.warnings !== undefined) list(manifest.warnings, 'the list of export warnings', 5000);

  const personas = list(pack.personas, 'personas', LIMITS.personas);
  uniqueKeys(personas, 'personas');
  personas.forEach(checkPersona);
  const personaKeys = new Map(personas.map((p) => [p.key, p]));

  const criteria = list(pack.criteria, 'rubric criteria', LIMITS.criteria);
  const criteriaKeys = uniqueKeys(criteria, 'rubric criteria');
  criteria.forEach(checkCriterion);

  const rubrics = list(pack.rubrics, 'rubrics', LIMITS.rubrics);
  const rubricKeys = uniqueKeys(rubrics, 'rubrics');
  for (const r of rubrics) {
    str(r.name, `rubric "${r.key}" name`, { max: 100, required: true });
    text(r.description, `rubric "${r.key}" description`);
    text(r.additional_prompt, `rubric "${r.key}" additional prompt`);
    const ids = list(r.criteria, `rubric "${r.name}" criteria`, 100);
    if (ids.length === 0) throw invalid(`rubric "${r.name}" has no criteria`);
    if (new Set(ids).size !== ids.length) throw invalid(`rubric "${r.name}" lists a criterion twice`);
    for (const key of ids) if (!criteriaKeys.has(key)) throw invalid(`rubric "${r.name}" names a criterion that is not in the package`);
  }

  const activities = list(pack.activities, 'activities', LIMITS.activities);
  if (activities.length === 0) throw invalid('it contains no activities');
  uniqueKeys(activities, 'activities');
  const listed = list(manifest.activities, 'the manifest activity list', LIMITS.activities);
  if (listed.length !== activities.length) throw invalid('the manifest and the activity folders disagree');
  const uids = new Set();
  for (const activity of activities) {
    checkActivity(activity, pack, personaKeys, rubricKeys);
    if (uids.has(activity.uid)) throw invalid(`two activities share the id ${activity.uid}`);
    uids.add(activity.uid);
    const entry = listed.find((a) => isObject(a) && a.key === activity.key);
    if (!entry || entry.uid !== activity.uid) throw invalid(`the manifest does not list activity "${activity.title}"`);
    if (entry.content_hash !== activityContentHash(activity, personas, rubrics, criteria)) {
      throw invalid(`activity "${activity.title}" does not match its checksum (the file is damaged or was edited)`);
    }
  }
}
