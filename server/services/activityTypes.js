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
 * buildGreeting(caseData, studentName, personaId)                     -> string (turn 0)
 * buildCoachPrompt(chatHistory, studentName, caseData, freeHints, rubric) -> string
 * prepareEvalInputs({ caseChatId, sectionId, caseId, caseData, rubric, rubricChosen })
 *                                                                      -> { caseData, rubric }
 * finishEvaluation(result, transcript, protagonistName)               -> result
 * finalTurnNote                                                       -> string, added to the
 *   student's last message (Maximum Responses) for the model only; never stored or shown
 * openingWordFloor                                                    -> boolean: the student's
 *   first explanation must reach chat option teach_back_min_words (enforced in /api/llm/chat)
 * savedOpenings                                                       -> boolean: buildGreeting
 *   uses the opening the instructor saved per persona (scenario settings, `student.personas`),
 *   so the scenario editor offers "Draft with AI" for them (POST /cases/:id/scenario-drafts)
 */

import { CASE_CHAT, TEACH_BACK, normalizeActivityType, listActivityTypes } from '../../utils/activityTypes.js';
import { buildSystemPrompt, buildTeachBackSystemPrompt } from './chatPromptTemplates.js';
import { buildCoachPrompt } from './promptBuilder.js';
import { buildTeachBackCoachPrompt } from './teachBackCoachPrompt.js';
import { teachBackEvalInputs, verifyEvidence } from './teachBack.js';
import { fillOpening, templateOpening } from '../../utils/scenarioSettings.js';

function caseChatGreeting(caseData, studentName) {
  const roleDescription = caseData.protagonist_role || 'the protagonist';
  return `Hello ${studentName}, I am ${caseData.protagonist}, ${roleDescription} of the "${caseData.case_title}" case. Thank you for meeting with me today. Our time is limited so let's get straight to my question: **${caseData.chat_question}**`;
}

// The opening the instructor saved for this audience in this scenario (drafted with AI in the
// scenario editor, then edited), so every student who picks it reads the same words. Without one,
// a fixed template. Both are in utils/scenarioSettings.js.
function teachBackGreeting(caseData, studentName, personaId) {
  const student = caseData.scenario_student;
  const saved = personaId ? student?.personas?.[personaId]?.opening : null;
  if (saved) return fillOpening(saved, studentName);
  return templateOpening({
    audienceName: caseData.protagonist,
    studentName,
    topic: caseData.chat_question,
    situation: student?.situation,
  });
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
    openingWordFloor: false,
    savedOpenings: false,
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
    openingWordFloor: true,
    savedOpenings: true,
  },
};

/** The builders for an activity type (case chat when the type is missing or unknown). */
export function activityBehaviour(activityType) {
  return BEHAVIOUR[normalizeActivityType(activityType)];
}

// Types whose AI character is the persona the student picked (Teach-back's audience), not the
// scenario's protagonist. Keys are code constants (utils/activityTypes.js), checked before use.
const PERSONA_CHARACTER_TYPES = listActivityTypes()
  .filter((t) => t.characterFrom === 'persona')
  .map((t) => t.id)
  .filter((id) => /^[a-z_]+$/.test(id));

/**
 * SQL for the name the AI went by in a chat, which is the name its transcript turns carry: the
 * picked persona's name for persona-character types, else the scenario's protagonist (as
 * services/chatPrompt.js#loadChatContext does). Needs the joins from aiSpeakerJoinsSql() and the
 * scenario joined as `scenario`.
 */
export function aiSpeakerNameSql({ kase = 'ai_case', persona = 'ai_persona', scenario = 'cs' } = {}) {
  if (PERSONA_CHARACTER_TYPES.length === 0) return `${scenario}.protagonist`;
  const types = PERSONA_CHARACTER_TYPES.map((id) => `'${id}'`).join(', ');
  return `CASE WHEN ${kase}.activity_type IN (${types}) THEN COALESCE(${persona}.persona_name, ${scenario}.protagonist) ELSE ${scenario}.protagonist END`;
}

/** The joins aiSpeakerNameSql() reads, for a query with case_chats as `chat`. */
export function aiSpeakerJoinsSql({ chat = 'cc', kase = 'ai_case', persona = 'ai_persona' } = {}) {
  return `LEFT JOIN cases ${kase} ON ${kase}.case_id = ${chat}.case_id
         LEFT JOIN personas ${persona} ON ${persona}.persona_id = ${chat}.persona`;
}

