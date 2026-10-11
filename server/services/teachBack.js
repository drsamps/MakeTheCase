/**
 * Teach-back: server helpers for audience personas and for grading.
 *
 * Teach-back is one of the Study-Chat activity types (`utils/activityTypes.js`). Whether a
 * case is a teach-back is `cases.activity_type`; nothing here decides that. The grading
 * functions below are wired in as the teach-back entry of `services/activityTypes.js`.
 *
 * See `docs/teach-back-setup.md` for the instructor runbook.
 */
import { pool } from '../db.js';
import { getRubricById } from './rubricService.js';
import { parseTranscript } from '../../utils/transcriptFormat.js';
import { verifyQuote } from './issueAnalytics/common.js';

/**
 * Audience personas are distinguished from case-chat personas by an id prefix rather than
 * by a column. Read in both directions: teach-back offers only `audience-*`, case chat
 * excludes them.
 */
export const AUDIENCE_PREFIX = 'audience-';

export const isAudiencePersonaId = (personaId) =>
  typeof personaId === 'string' && personaId.startsWith(AUDIENCE_PREFIX);

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
