/**
 * A scenario's settings document: the one registry of what may be stored in
 * `case_scenarios.chat_options_override` (JSON) beyond the chat options and legacy position keys
 * it has always held. Shared by the server, the dashboard and the activity packages.
 *
 * The column is on its way to being the scenario's general settings document (a later rename
 * to `settings`), so new scenario settings go here instead of into new columns. Four rules:
 *
 *   1. NEST BY VISIBILITY. Everything under `student` may be shown to students; nothing else is
 *      sent to them (`server/routes/sectionCases.js#forStudent` sends only `student`). Text only
 *      the AI may see must go in a separate subtree (e.g. `ai`), never under `student`.
 *   2. ONE WRITER. Servers write a subtree with `server/services/scenarioSettings.js#
 *      writeScenarioSettings`, a JSON_SET merge, so saving one subtree never drops another (the
 *      legacy position keys that routes/evaluations.js still reads, for one).
 *   3. VALIDATE HERE. The scenario route and the package installer both use
 *      validateStudentSettings(); a key it does not know is refused, not stored.
 *   4. Anything joined, filtered, indexed or permissioned on stays a real column.
 *
 * The `student` subtree (activity-neutral; teach-back is the first activity to use it):
 *   situation  why the audience needs the topic, written to follow "I ..." ("am about to take
 *              over the store's ordering"). Also given to the AI so it stays in character.
 *   personas   { [persona_id]: { intro, opening } }
 *     intro    one playful line about this audience, shown in the intro bar above the chat
 *     opening  the AI's first message, the same for every student; `{studentName}` is replaced
 *              with the student's first name when the chat starts
 */

export const STUDENT_NAME_TOKEN = '{studentName}';

export const STUDENT_SETTINGS_LIMITS = { situation: 500, intro: 300, opening: 1200, personas: 50 };

const PERSONA_ID_RE = /^[A-Za-z0-9_-]{1,30}$/;
const PERSONA_TEXT_KEYS = ['intro', 'opening'];
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const cleanText = (v) => (typeof v === 'string' ? v.trim() : '');

/** The stored JSON as an object (mysql2 may hand back a string), or null. */
export function parseScenarioOverride(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return isObject(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return isObject(value) ? value : null;
}

/**
 * The situation is written to follow "I ..." (the editor shows that prefix, and the prompt and
 * template opening put it back), so a leading "I" or "I'm" the instructor typed is dropped:
 * otherwise students read "I I am about to ...".
 */
const withoutLeadingI = (s) => s.replace(/^I['’]m\s+/i, 'am ').replace(/^I\s+/i, '');

/** The `student` subtree, normalised: trimmed strings, unknown keys and bad ids dropped. */
function normaliseStudent(raw) {
  const student = { situation: '', personas: {} };
  if (!isObject(raw)) return student;
  student.situation = withoutLeadingI(cleanText(raw.situation));
  if (isObject(raw.personas)) {
    for (const [id, entry] of Object.entries(raw.personas)) {
      if (!PERSONA_ID_RE.test(id) || !isObject(entry)) continue;
      const kept = {};
      for (const key of PERSONA_TEXT_KEYS) {
        const text = cleanText(entry[key]);
        if (text) kept[key] = text;
      }
      if (Object.keys(kept).length > 0) student.personas[id] = kept;
    }
  }
  return student;
}

/**
 * A scenario's settings, read leniently (what is stored was validated on the way in).
 * @returns {{ student: { situation: string, personas: Record<string, { intro?: string, opening?: string }> } }}
 */
export function readScenarioSettings(override) {
  const parsed = parseScenarioOverride(override);
  return { student: normaliseStudent(parsed?.student) };
}

/** The part of a scenario's settings a student may see (sectionCases.js#forStudent). */
export function studentScenarioSettings(override) {
  const { student } = readScenarioSettings(override);
  return student.situation || Object.keys(student.personas).length > 0 ? { student } : null;
}

/**
 * Check a `student` subtree before it is stored. Returns { value, error }: `value` is the
 * normalised subtree, or null when it is empty (the caller removes the key); `error` is a
 * message for the instructor, or null.
 */
export function validateStudentSettings(raw) {
  if (raw === null || raw === undefined) return { value: null, error: null };
  if (!isObject(raw)) return { value: null, error: 'Student settings must be an object.' };
  const unknown = Object.keys(raw).filter((k) => k !== 'situation' && k !== 'personas');
  if (unknown.length > 0) return { value: null, error: `Unknown student setting: ${unknown.join(', ')}.` };
  if (raw.situation !== undefined && raw.situation !== null && typeof raw.situation !== 'string') {
    return { value: null, error: 'The situation must be text.' };
  }
  if (cleanText(raw.situation).length > STUDENT_SETTINGS_LIMITS.situation) {
    return { value: null, error: `The situation is longer than ${STUDENT_SETTINGS_LIMITS.situation} characters.` };
  }
  if (raw.personas !== undefined && raw.personas !== null) {
    if (!isObject(raw.personas)) return { value: null, error: 'Persona openings must be an object.' };
    const entries = Object.entries(raw.personas);
    if (entries.length > STUDENT_SETTINGS_LIMITS.personas) {
      return { value: null, error: `At most ${STUDENT_SETTINGS_LIMITS.personas} personas can have openings.` };
    }
    for (const [id, entry] of entries) {
      if (!PERSONA_ID_RE.test(id)) return { value: null, error: `"${String(id).slice(0, 40)}" is not a persona id.` };
      if (!isObject(entry)) return { value: null, error: `The entry for ${id} must be an object.` };
      const extra = Object.keys(entry).filter((k) => !PERSONA_TEXT_KEYS.includes(k));
      if (extra.length > 0) return { value: null, error: `Unknown setting for ${id}: ${extra.join(', ')}.` };
      for (const key of PERSONA_TEXT_KEYS) {
        if (entry[key] !== undefined && entry[key] !== null && typeof entry[key] !== 'string') {
          return { value: null, error: `The ${key} for ${id} must be text.` };
        }
        if (cleanText(entry[key]).length > STUDENT_SETTINGS_LIMITS[key]) {
          return { value: null, error: `The ${key} for ${id} is longer than ${STUDENT_SETTINGS_LIMITS[key]} characters.` };
        }
      }
      const opening = cleanText(entry.opening);
      if (opening && !opening.includes(STUDENT_NAME_TOKEN)) {
        return { value: null, error: `The opening for ${id} must include ${STUDENT_NAME_TOKEN}, where the student's name goes.` };
      }
    }
  }
  const student = normaliseStudent(raw);
  const empty = !student.situation && Object.keys(student.personas).length === 0;
  return { value: empty ? null : student, error: null };
}

/**
 * An audience's display name, phrased so it reads mid-sentence ("I'm your grandmother", "teach
 * a skeptical colleague"). Audience names are written from the STUDENT's side of the picker
 * ("Your grandmother", "A skeptical colleague"); only a known leading article or possessive is
 * lowercased, so "Sam, a curious beginner" and "Professor Kim" keep their capital.
 */
export const introduceAudience = (name) =>
  (name || '').trim().replace(/^(your|a|an|the|my|our|someone|somebody)(?=\s)/i, (w) => w.toLowerCase());

/** The name the server falls back to when the student gave none (chatPrompt.js#sanitizeStudentName). */
const NO_NAME = 'Student';

/**
 * A stored opening with the student's name put in. With no name, the token and the comma or
 * space before it are dropped ("Hi, {studentName}!" -> "Hi!").
 */
export function fillOpening(text, studentName) {
  const name = (studentName || '').trim();
  if (!name || name === NO_NAME) return text.replace(/,?\s*\{studentName\}/g, '');
  return text.split(STUDENT_NAME_TOKEN).join(name);
}

const withoutFinalStop = (s) => s.trim().replace(/[.!\s]+$/, '');

/**
 * The opening used when an audience has no saved one. Deterministic, so every student who picks
 * this audience in this scenario reads the same words (apart from their name).
 */
export function templateOpening({ audienceName, studentName, topic, situation }) {
  const name = (studentName || '').trim();
  const hello = name && name !== NO_NAME ? `Hi, ${name}!` : 'Hi!';
  const who = introduceAudience(audienceName) || 'someone new to this';
  const what = (topic || '').trim();
  if (situation && situation.trim()) {
    return `${hello} I'm ${who}, and I ${withoutFinalStop(situation)}. To do that, I need to understand **${what}**, and honestly I don't get it yet. Will you help me understand it?`;
  }
  return `${hello} I'm ${who}. I'm supposed to understand **${what}**, and honestly I don't get it yet. Will you help me understand it?`;
}
