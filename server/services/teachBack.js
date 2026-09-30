/**
 * Teach-Back mode — shared server constants and helpers.
 *
 * Mirrors `teachBack.ts` on the client. The mode lives in
 * `section_cases.chat_options.activity_mode`, so there is no column to read and no
 * migration to run; a missing key always means the existing case-chat behaviour.
 *
 * See `docs/teach-back-setup.md` and the plan record for the full design.
 */
import { pool } from '../db.js';
import { getRubricById } from './rubricService.js';
import { parseTranscript } from '../../utils/transcriptFormat.js';
import { verifyQuote } from './issueAnalytics/common.js';

export const CASE_CHAT = 'case_chat';
export const TEACH_BACK = 'teach_back';

/**
 * Audience personas are distinguished from case-chat personas by an id prefix rather than
 * by a column (this pilot ships without a migration). Read in both directions: Teach-Back
 * offers only `audience-*`, case chat excludes them.
 */
export const AUDIENCE_PREFIX = 'audience-';

export const isAudiencePersonaId = (personaId) =>
  typeof personaId === 'string' && personaId.startsWith(AUDIENCE_PREFIX);

/** The stored mode from an already-parsed chat_options object. */
export function resolveActivityMode(chatOptions) {
  return chatOptions && chatOptions.activity_mode === TEACH_BACK ? TEACH_BACK : CASE_CHAT;
}

const parseJson = (value) => (typeof value === 'string' ? JSON.parse(value) : value);

/**
 * The mode for one section-case.
 *
 * (!) Resolves the same way the student side does (`sectionCases.js#resolveChatOptions`):
 * the assignment's own `chat_options`, else the section default, else the global default.
 * Reading only `section_cases.chat_options` graded a teach-back set in the defaults with
 * the case-chat prompt, because an assignment that follows the defaults stores NULL.
 *
 * Kept here rather than in `evaluations.js` so that removing Teach-Back means deleting
 * this file plus a few one-line branches. Never throws: an unreadable or absent row
 * resolves to case chat, which is the pre-Teach-Back behaviour.
 */
export async function getActivityMode(sectionId, caseId) {
  if (!sectionId || !caseId) return CASE_CHAT;
  try {
    const [rows] = await pool.execute(
      'SELECT chat_options FROM section_cases WHERE section_id = ? AND case_id = ?',
      [sectionId, caseId]
    );
    if (!rows.length) return CASE_CHAT;
    if (rows[0].chat_options) return resolveActivityMode(parseJson(rows[0].chat_options));

    const [sectionDefaults] = await pool.execute(
      'SELECT chat_options FROM chat_options_defaults WHERE section_id = ?',
      [sectionId]
    );
    if (sectionDefaults.length) return resolveActivityMode(parseJson(sectionDefaults[0].chat_options));

    const [globalDefaults] = await pool.execute(
      'SELECT chat_options FROM chat_options_defaults WHERE section_id IS NULL'
    );
    if (globalDefaults.length) return resolveActivityMode(parseJson(globalDefaults[0].chat_options));
    return CASE_CHAT;
  } catch (e) {
    console.warn('[teachBack] could not resolve activity mode:', e.message);
    return CASE_CHAT;
  }
}

/**
 * What the Teach-Back judge needs that differs from case chat: who the listener was, and
 * which rubric applies.
 *
 * - Listener: `loadCaseData()` returns the CASE protagonist, but the student explained to
 *   the audience persona they picked (`case_chats.persona`), and the transcript labels the
 *   listener's turns with that persona's name. The judge is told to ignore the listener, so
 *   it must be given the name that actually appears in the transcript.
 * - Rubric: with no rubric on the assignment, the caller has the system default, which is
 *   written for case chat (did the student argue from the case?). Teach-Back then uses its
 *   own built-in criteria instead, so `rubric` comes back null. `rubricChosen` is true only
 *   when an admin named a rubric for this run (Re-evaluate / Preview prompt).
 *
 * @returns {Promise<{ caseData: Object, rubric: Object|null }>}
 */
export async function teachBackEvalInputs({ caseChatId, sectionId, caseId, caseData, rubric, rubricChosen = false }) {
  let listener = null;
  const [chatRows] = await pool.execute('SELECT persona FROM case_chats WHERE id = ?', [caseChatId]);
  const personaId = chatRows[0]?.persona;
  if (isAudiencePersonaId(personaId)) {
    const [personaRows] = await pool.execute(
      'SELECT persona_name FROM personas WHERE persona_id = ?',
      [personaId]
    );
    listener = personaRows[0]?.persona_name || null;
  }

  let evalRubric = rubric;
  if (!rubricChosen) {
    const [scRows] = await pool.execute(
      'SELECT rubric_id FROM section_cases WHERE section_id = ? AND case_id = ?',
      [sectionId, caseId]
    );
    const assignedId = scRows[0]?.rubric_id ?? null;
    if (!assignedId) evalRubric = null;
    else if (rubric?.rubric_id !== assignedId) evalRubric = await getRubricById(assignedId);
  }

  return {
    caseData: listener ? { ...(caseData || {}), protagonist: listener } : caseData,
    rubric: evalRubric,
  };
}

/**
 * Drop any `evidence` that is not verbatim from one of the student's own turns. The
 * evaluation screen shows it in quotation marks as the student's words, so a paraphrase, a
 * fabricated quote or a line lifted from the listener must not get that far. Mutates and
 * returns `result`.
 */
export function verifyEvidence(result, transcript, listenerName) {
  if (!result || !Array.isArray(result.criteria)) return result;
  const text = String(transcript ?? '');
  const { turns } = parseTranscript(text, {
    studentNames: ['Student'],
    protagonistNames: [listenerName].filter(Boolean),
  });
  for (const criterion of result.criteria) {
    if (criterion.evidence && !verifyQuote(text, turns, criterion.evidence)) {
      criterion.evidence = undefined;
    }
  }
  return result;
}
