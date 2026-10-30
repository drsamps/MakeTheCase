/**
 * Named resolvers: logic a definition names but cannot express, because the template language is
 * deliberately logic-free (no if/else for an admin to get wrong). A definition says WHICH resolver
 * to use; the wording it fills stays in the definition. Changing what a resolver does changes
 * every type that names it, so the built-in goldens (check-activity-engine.js) guard each one.
 */

import { introduceAudience, fillOpening } from '../scenarioSettings.js';

export { introduceAudience, fillOpening };

/** The name the server uses when the student gave none (chatPrompt.js#sanitizeStudentName). */
export const NO_NAME = 'Student';

// ---------------------------------------------------------------------------------------------
// Persona text. `numbered_legacy` (case chat): a persona's database instructions as rule "1.",
// or one of the five built-in personalities when it has none. `plain` (Teach-back): the
// database instructions as written, or nothing.
// ---------------------------------------------------------------------------------------------

// The five built-in personalities, used when a persona has no database instructions. Code, not
// definition text: they predate definitions and every case-chat golden depends on them.
function legacyPersonaText(personaId, studentName, caseTitle) {
  const legacyInstructions = {
    strict: `1.  **Encourage Grounding in Case Facts:** The case facts are defined by the "${caseTitle}" case provided below. You should avoid fabricating other information. If ${studentName} mentions information not present in the case (e.g., suggestions not grounded in the reading), you must challenge them by asking, "How is that justified based on info from the case?" or "That's an interesting recommendation, but where in the case does it support that?" The burden of providing specific evidence is always on the student.`,
    moderate: `1.  **Encourage Grounding in Case Facts:** Your goal is to test the student's understanding of the case. They should try to use facts from the case to support their ideas. If they make a good point that is generally consistent with the case, acknowledge it before probing for deeper justification (e.g., "That's a reasonable idea. What facts from the case led you to that conclusion?"). Don't immediately shut down ideas that aren't explicitly in the text if they are logical extensions.`,
    liberal: `1.  **Encourage Brainstorming from Case Facts:** You are a supportive and encouraging mentor. Your goal is to have a creative brainstorming session based on the case. If the student suggests an idea not explicitly in the case, your job is to help them connect it back. Your goal is to build on their ideas, not just test their recall.`,
    leading: `1.  **Praise Liberally & Find Value:** Your primary goal is to build the student's confidence. Praise every comment they make, even if it's not well-supported. Find some way to connect their idea, however tenuously, back to the case.
2.  **Provide Overt Hints:** You are not testing the student; you are guiding them to the right answer. Instead of asking challenging questions, lead them with obvious hints.
3.  **Avoid Counter-Arguments:** Do not challenge the student or provide counter-arguments. Your role is to agree, expand, and gently guide. Always be positive and encouraging. If they make a weak point, your job is to reframe it as a strong one.`,
    sycophantic: `1.  **Praise Absurdly:** Your goal is to be a sycophant. Agree with and praise every single idea ${studentName} has, no matter how illogical, impractical, or disconnected from the case it is. Your praise should be effusive and over-the-top.
2.  **Ignore All Case Facts:** The business case is irrelevant to you. Do not reference it, do not challenge the student to use it, and do not base any of your responses on it. Your reality is whatever the student says it is.
3.  **Never Challenge or Question:** You must never push back, ask for justification, or present a counter-argument. Your only role is to agree enthusiastically and shower the student with compliments on their "brilliant" and "game-changing" ideas.`,
  };
  return legacyInstructions[personaId] || legacyInstructions.moderate;
}

// The persona's own `{studentName}` / `{caseTitle}` placeholders (camelCase: persona text predates
// definitions). Plain String.replace on purpose, with string replacements, exactly as the hand
// builders did, so `$&` in a case title behaves as it always has.
const fillPersonaText = (instructions, studentName, caseTitle) =>
  instructions.replace(/\{studentName\}/g, studentName).replace(/\{caseTitle\}/g, caseTitle);

export const PERSONA_TEXT_RESOLVERS = ['numbered_legacy', 'plain'];

/** @returns {string} persona instructions for the prompt ('' = none, for `plain`) */
export function personaText(resolver, { personaId, studentName, caseTitle, personaData }) {
  if (resolver === 'numbered_legacy') {
    if (personaData?.instructions) return `1.  ${fillPersonaText(personaData.instructions, studentName, caseTitle)}`;
    return legacyPersonaText(personaId, studentName, caseTitle);
  }
  return personaData?.instructions ? fillPersonaText(personaData.instructions, studentName, caseTitle) : '';
}

// ---------------------------------------------------------------------------------------------
// Small text rules
// ---------------------------------------------------------------------------------------------

/** "is starting a business!! ." -> "is starting a business" (so a template can add its own stop). */
export const withoutFinalStop = (s) => String(s ?? '').trim().replace(/[.!\s]+$/, '');

/** The scenario's student-visible situation, trimmed and cut for "I {situation}, so…", or ''. */
export const situationText = (caseData) =>
  caseData?.scenario_student?.situation?.trim().replace(/[.!\s]+$/, '') || '';

/** zero / one / many, by strict equality on the stored number (as the hand builders did). */
export const hintForm = (freeHints) => (freeHints === 0 ? 'zero' : freeHints === 1 ? 'one' : 'many');

/** Criteria count a coach prompt asks for: the rubric's "Qn." markers, else 3. */
export const numCriteria = (rubric, criteriaPrompt) =>
  rubric ? (criteriaPrompt.match(/Q\d+\./g) || []).length || 3 : 3;

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
export const numberWord = (n) => NUMBER_WORDS[n] ?? String(n);

export const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** A copy entry may be `{ one, other }`, picked by the count `n`. */
export const pluralForm = (entry, n) =>
  entry && typeof entry === 'object' && !Array.isArray(entry) ? (Number(n) === 1 ? entry.one : entry.other) : entry;
