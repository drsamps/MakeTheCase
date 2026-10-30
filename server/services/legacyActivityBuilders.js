/**
 * The hand-written builders for the two built-in activity types, kept for ONE release after the
 * activity engine replaced them (utils/activityEngine/, StudyChat plan §3).
 *
 * Nothing at chat time calls these any more. `node server/scripts/check-activity-engine.js`
 * asserts engine output = these builders' output = the golden fixture, so a drift in either is
 * caught. Delete this file, chatPromptTemplates.js, teachBackCoachPrompt.js and the builder in
 * promptBuilder.js in the release after the engine shipped, and drop the "hand" column from the
 * check.
 */

import { buildSystemPrompt, buildTeachBackSystemPrompt } from './chatPromptTemplates.js';
import { buildCoachPrompt } from './promptBuilder.js';
import { buildTeachBackCoachPrompt } from './teachBackCoachPrompt.js';
import { fillOpening, templateOpening } from '../../utils/scenarioSettings.js';

function caseChatGreeting(caseData, studentName) {
  const roleDescription = caseData.protagonist_role || 'the protagonist';
  return `Hello ${studentName}, I am ${caseData.protagonist}, ${roleDescription} of the "${caseData.case_title}" case. Thank you for meeting with me today. Our time is limited so let's get straight to my question: **${caseData.chat_question}**`;
}

// The opening the instructor saved for this audience in this scenario, else a fixed template.
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

const CASE_CHAT_FINAL_TURN_NOTE = '\n\n(Note for this reply only: this is the student\'s final message in this conversation. Respond to it, then close the meeting warmly in one or two sentences. Do not ask another question.)';
const TEACH_BACK_FINAL_TURN_NOTE = '\n\n(Note for this reply only: this is the student\'s final message in this conversation. Respond to it, say briefly what you now understand, and thank them. Do not ask another question.)';
const TEACH_BACK_POSITION_PICK_NOTE = '\n\n(Note for this reply only: the student did not write this message. They picked it from a list of positions, so it is where they stand, not an explanation. Do not reflect it back as something you have understood. Acknowledge it briefly and ask them to explain why, from the beginning.)';

/** The hand builders per built-in type, in the shape the engine adapter produces. */
export const LEGACY_BUILDERS = {
  case_chat: {
    buildSystemPrompt,
    buildGreeting: caseChatGreeting,
    buildCoachPrompt,
    finalTurnNote: CASE_CHAT_FINAL_TURN_NOTE,
    positionPickNote: '',
  },
  teach_back: {
    buildSystemPrompt: buildTeachBackSystemPrompt,
    buildGreeting: teachBackGreeting,
    buildCoachPrompt: buildTeachBackCoachPrompt,
    finalTurnNote: TEACH_BACK_FINAL_TURN_NOTE,
    positionPickNote: TEACH_BACK_POSITION_PICK_NOTE,
  },
};
