/**
 * What each Study-Chat activity type does on the server: its chat prompt, its opening line and
 * how its chat is graded. The list of types and their static traits is in
 * `utils/activityTypes.js` (shared with the dashboard); this file adds the builders.
 *
 * Every caller asks `activityBehaviour(type)` instead of testing `type === TEACH_BACK`, so a new
 * type is one entry here plus its templates. A missing or unknown type behaves as case chat.
 *
 * The type comes from the case (`cases.activity_type`). `loadCaseData()` returns it, so callers
 * that already hold the case data read `caseData.activity_type` and need no extra query.
 *
 * buildSystemPrompt(studentName, personaId, caseData, options)        -> string
 * buildGreeting(caseData, studentName)                                -> string (turn 0)
 * buildCoachPrompt(chatHistory, studentName, caseData, freeHints, rubric) -> string
 * prepareEvalInputs({ caseChatId, sectionId, caseId, caseData, rubric, rubricChosen })
 *                                                                      -> { caseData, rubric }
 * finishEvaluation(result, transcript, protagonistName)               -> result
 * finalTurnNote                                                       -> string, added to the
 *   student's last message (Maximum Responses) for the model only; never stored or shown
 */

import { CASE_CHAT, TEACH_BACK, normalizeActivityType } from '../../utils/activityTypes.js';
import { buildSystemPrompt, buildTeachBackSystemPrompt } from './chatPromptTemplates.js';
import { buildCoachPrompt } from './promptBuilder.js';
import { buildTeachBackCoachPrompt } from './teachBackCoachPrompt.js';
import { teachBackEvalInputs, verifyEvidence } from './teachBack.js';

function caseChatGreeting(caseData, studentName) {
  const roleDescription = caseData.protagonist_role || 'the protagonist';
  return `Hello ${studentName}, I am ${caseData.protagonist}, ${roleDescription} of the "${caseData.case_title}" case. Thank you for meeting with me today. Our time is limited so let's get straight to my question: **${caseData.chat_question}**`;
}

// An audience's display name, phrased so it reads after "I'm". Audience names are written from
// the STUDENT's side of the picker ("Your grandmother", "A skeptical colleague"), so "I'm Your
// grandmother" would be wrong. Only a known leading article or possessive is lowercased: "Sam, a
// curious beginner" and an instructor-made name like "Professor Kim" keep their capital.
const introduceAudience = (name) =>
  (name || '').trim().replace(/^(your|a|an|the|my|our|someone|somebody)(?=\s)/i, (w) => w.toLowerCase());

function teachBackGreeting(caseData, studentName) {
  return `Hi ${studentName}, I'm ${introduceAudience(caseData.protagonist)}. I'm supposed to understand **${caseData.chat_question}** and honestly I don't get it yet. Could you explain it to me?`;
}

// Sent to the model with the student's last allowed message (chat option max_exchanges), so its
// reply closes the conversation instead of asking another question. Appended to that message,
// not the system prompt, which must stay byte-for-byte stable for prompt caching.
const CASE_CHAT_FINAL_TURN_NOTE = '\n\n(Note for this reply only: this is the student\'s final message in this conversation. Respond to it, then close the meeting warmly in one or two sentences. Do not ask another question.)';
const TEACH_BACK_FINAL_TURN_NOTE = '\n\n(Note for this reply only: this is the student\'s final message in this conversation. Respond to it, say briefly what you now understand, and thank them. Do not ask another question.)';

// Sent with a position the student clicked ("Student selects position"), appended the same way.
// The click posts the instructor's wording as the student's message; in teach-back that is a
// stance, not an explanation, so the audience must ask for one instead of reflecting it back.
// Case chat has none: its protagonist already treats the first message as the recommendation.
const TEACH_BACK_POSITION_PICK_NOTE = '\n\n(Note for this reply only: the student did not write this message. They picked it from a list of positions, so it is where they stand, not an explanation. Do not reflect it back as something you have understood. Acknowledge it briefly and ask them to explain why, from the beginning.)';

const BEHAVIOUR = {
  [CASE_CHAT]: {
    buildSystemPrompt,
    buildGreeting: caseChatGreeting,
    buildCoachPrompt,
    prepareEvalInputs: async ({ caseData, rubric }) => ({ caseData, rubric }),
    finishEvaluation: (result) => result,
    finalTurnNote: CASE_CHAT_FINAL_TURN_NOTE,
    positionPickNote: '',
  },
  // Teach-back is judged against the audience the student chose, and against its own criteria
  // unless the assignment names a rubric. Its "student quotes" are checked against the
  // transcript before they are saved or shown.
  [TEACH_BACK]: {
    buildSystemPrompt: buildTeachBackSystemPrompt,
    buildGreeting: teachBackGreeting,
    buildCoachPrompt: buildTeachBackCoachPrompt,
    prepareEvalInputs: teachBackEvalInputs,
    finishEvaluation: verifyEvidence,
    finalTurnNote: TEACH_BACK_FINAL_TURN_NOTE,
    positionPickNote: TEACH_BACK_POSITION_PICK_NOTE,
  },
};

/** The builders for an activity type (case chat when the type is missing or unknown). */
export function activityBehaviour(activityType) {
  return BEHAVIOUR[normalizeActivityType(activityType)];
}

