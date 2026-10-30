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
import { verifyQuote, positionTextMatcher } from './issueAnalytics/common.js';

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
  const [chatRows] = await pool.execute('SELECT persona, scenario_id, initial_position_id FROM case_chats WHERE id = ?', [caseChatId]);
  const personaId = chatRows[0]?.persona;

  // The position the student started from. With "Student selects position" its full wording
  // was posted as their first message; that text is the instructor's, so the judge is told
  // not to credit it (buildTeachBackCoachPrompt) and verifyEvidence never quotes it.
  let pickedPosition = null;
  if (chatRows[0]?.initial_position_id) {
    const [posRows] = await pool.execute(
      'SELECT position FROM scenario_positions WHERE position_id = ? AND scenario_id = ?',
      [chatRows[0].initial_position_id, chatRows[0].scenario_id]
    );
    pickedPosition = posRows[0]?.position || null;
  }
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

  let evalCaseData = listener ? { ...(caseData || {}), protagonist: listener } : caseData;
  if (pickedPosition) evalCaseData = { ...(evalCaseData || {}), picked_position: pickedPosition };
  return {
    caseData: evalCaseData,
    rubric: evalRubric,
  };
}

/**
 * Grading inputs for a type with its own criteria and no chosen listener (eval_inputs
 * `type_criteria`): the rubric the assignment names, else null so the type's criteria apply.
 * `rubricChosen` as above. caseData.position is the wording of the student's side.
 */
export async function typeCriteriaInputs({ sectionId, caseId, caseData, rubric, rubricChosen = false }) {
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
    caseData: caseData?.position ? { ...caseData, picked_position: caseData.position } : caseData,
    rubric: evalRubric,
  };
}

/**
 * Drop any `evidence` that is not verbatim from one of the student's own turns. The
 * evaluation screen shows it in quotation marks as the student's words, so a paraphrase, a
 * fabricated quote, a line lifted from the listener or the wording of a clicked position
 * (`caseData.picked_position`) must not get that far. Mutates and returns `result`.
 */
export function verifyEvidence(result, transcript, caseData = {}) {
  if (!result || !Array.isArray(result.criteria)) return result;
  const text = String(transcript ?? '');
  const { turns } = parseTranscript(text, {
    studentNames: ['Student'],
    protagonistNames: [caseData?.protagonist].filter(Boolean),
  });
  const isPositionText = positionTextMatcher([caseData?.picked_position]);
  for (const criterion of result.criteria) {
    if (criterion.evidence && (!verifyQuote(text, turns, criterion.evidence) || isPositionText(criterion.evidence))) {
      criterion.evidence = undefined;
    }
  }
  return result;
}
