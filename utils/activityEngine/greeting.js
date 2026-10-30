/**
 * The AI's opening line (turn 0), written by the server when the chat is created.
 *
 * `greeting.resolver` decides how the slots are filled; the wording is the definition's:
 *   plain            {student_name} {ai_name} {ai_role} {case_title} {question}, as stored;
 *                    `fallbacks.ai_role` when the role is empty
 *   audience_opening the instructor's saved opening for the picked persona when
 *                    `saved_openings` is on and one exists (utils/scenarioSettings.js), else
 *                    `template` / `template_situation` with {hello} (named or anonymous, by the
 *                    no-name rule) {ai_intro} (introduceAudience) {question} {situation}, trimmed
 */

import { renderOnce } from './render.js';
import { NO_NAME, introduceAudience, fillOpening, withoutFinalStop } from './resolvers.js';

export const GREETING_RESOLVERS = ['plain', 'audience_opening'];

function audienceOpening(g, caseData, studentName, personaId) {
  const student = caseData.scenario_student;
  const saved = g.saved_openings && personaId ? student?.personas?.[personaId]?.opening : null;
  if (saved) return fillOpening(saved, studentName);

  const name = (studentName || '').trim();
  const named = Boolean(name && name !== NO_NAME);
  const situation = student?.situation;
  const values = {
    hello: named ? renderOnce(g.hello_named, { student_name: name }) : renderOnce(g.hello_anonymous, {}),
    ai_intro: introduceAudience(caseData.protagonist) || g.fallbacks?.ai_intro || '',
    question: (caseData.chat_question || '').trim(),
    situation: situation && situation.trim() ? withoutFinalStop(situation) : '',
  };
  return renderOnce(values.situation ? g.template_situation : g.template, values);
}

/**
 * @param {object} def - a validated definition
 * @param {object} caseData - as loadChatContext builds it
 * @param {string} studentName - already sanitized
 * @param {string|null} personaId
 */
export function buildGreeting(def, caseData, studentName, personaId) {
  const g = def.greeting;
  if (g.resolver === 'audience_opening') return audienceOpening(g, caseData, studentName, personaId);
  return renderOnce(g.template, {
    student_name: `${studentName}`,
    ai_name: `${caseData.protagonist}`,
    ai_role: caseData.protagonist_role || g.fallbacks?.ai_role || '',
    case_title: `${caseData.case_title}`,
    question: `${caseData.chat_question}`,
  });
}
