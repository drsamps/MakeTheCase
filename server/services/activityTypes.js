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

const BEHAVIOUR = {
  [CASE_CHAT]: {
    buildSystemPrompt,
    buildGreeting: caseChatGreeting,
    buildCoachPrompt,
    prepareEvalInputs: async ({ caseData, rubric }) => ({ caseData, rubric }),
    finishEvaluation: (result) => result,
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
  },
};

/** The builders for an activity type (case chat when the type is missing or unknown). */
export function activityBehaviour(activityType) {
  return BEHAVIOUR[normalizeActivityType(activityType)];
}

