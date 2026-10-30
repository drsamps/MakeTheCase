/**
 * The student chat system prompt for any activity type definition.
 *
 * Two parts, in this order, for provider prompt caching:
 *   1. STATIC: the documents, wrapped by platform code (not editable). Which documents a type
 *      shows the AI is its `traits.ai_sees`; the definition supplies only headings and intro lines.
 *   2. DYNAMIC: the definition's `prompt.role` template, rendered once with the chat's values.
 *
 * The wrapping below is byte-for-byte what the hand builders produced (chatPromptTemplates.js),
 * odd blank lines included: the built-in goldens depend on it, and the cached prefix of every
 * live chat is this text. Do not tidy it.
 */

import { renderOnce, withWrappers } from './render.js';
import { personaText, situationText, hintForm } from './resolvers.js';
import { signalInstructions, submissionBlock, touchpointGuide } from './signals.js';

function documentsBlock(def, caseData) {
  const docs = def.prompt.documents;
  const sees = def.traits.ai_sees;

  let supplementary = '';
  if (sees.supplementary && caseData.supplementary_content?.trim()) {
    const d = docs.supplementary;
    supplementary = `

=== ${d.heading} ===
<context type="supplementary" file="supplementary.md">
${d.intro}
${caseData.supplementary_content}
</context>
=== ${d.end} ===
`;
  }

  let teachingNote = '';
  if (sees.teaching_note && caseData.teaching_note?.trim()) {
    const d = docs.teaching_note;
    teachingNote = `

=== ${d.heading} ===
<context type="teaching_note" file="teaching_note.md">
${d.intro}
${caseData.teaching_note}
</context>
=== ${d.end} ===`;
  }

  let args = '';
  if (sees.arguments && (caseData.arguments_for || caseData.arguments_against)) {
    const d = docs.arguments;
    let content = `${d.intro}\n\n`;
    if (caseData.arguments_for) content += `${d.for_label}\n${caseData.arguments_for}\n\n`;
    if (caseData.arguments_against) content += `${d.against_label}\n${caseData.arguments_against}\n`;
    args = `\n\n=== ${d.heading} ===
<context type="arguments">
${content}</context>
=== ${d.end} ===\n`;
  }

  const c = docs.case;
  return `
=== ${c.heading} ===
<context type="case" file="case.md">
${caseData.case_content}
</context>
=== ${c.end} ===${supplementary}${teachingNote}${args}${sees.touchpoints ? touchpointGuide(caseData.touchpoints) : ''}
`;
}

/**
 * The AI's name in the prompt: the character (scenario protagonist, or the picked persona that
 * loadChatContext already put in `protagonist`). With no fallback the value is written as JS
 * template text would ("undefined" when missing), which is what case chat always did.
 */
export const aiNameFor = (def, caseData) =>
  def.prompt.ai_name_fallback ? (caseData.protagonist || def.prompt.ai_name_fallback) : `${caseData.protagonist}`;

/** The slot values every system template can use, plus which optional wrappers apply. */
function roleValues(def, studentName, personaId, caseData, options) {
  const freeHints = options.freeHints ?? 1;
  const hints = def.prompt.hints;
  const persona = personaText(def.prompt.persona_text, {
    personaId, studentName, caseTitle: caseData.case_title, personaData: options.personaData,
  });
  const additional = options.chatbotPersonality?.trim() || '';
  const situation = situationText(caseData);
  const values = {
    student_name: `${studentName}`,
    ai_name: aiNameFor(def, caseData),
    ai_role: `${caseData.protagonist_role ?? ''}`,
    case_title: `${caseData.case_title}`,
    question: `${caseData.chat_question}`,
    topic: `${caseData.chat_topic ?? ''}`,
    scenario_instructions: `${caseData.prompt_instructions ?? ''}`,
    persona_instructions: persona,
    additional_instructions: additional,
    situation,
    hint_rule: renderOnce(hints[hintForm(freeHints)], { free_hints: `${freeHints}` }),
    goal: `${caseData.goal ?? ''}`,
    position: `${caseData.position ?? ''}`,
    opposing_position: `${caseData.opposing_position ?? ''}`,
  };
  // Presence rules, exactly as before: scenario instructions and role are tested as written
  // (whitespace-only counts), the personality and situation after trimming.
  const present = {
    ai_role: Boolean(caseData.protagonist_role),
    scenario_instructions: Boolean(caseData.prompt_instructions),
    persona_instructions: Boolean(persona),
    additional_instructions: Boolean(additional),
    situation: Boolean(situation),
    goal: Boolean(caseData.goal?.trim()),
    position: Boolean(caseData.position),
    opposing_position: Boolean(caseData.opposing_position),
  };
  return withWrappers(values, def.prompt.optional, present);
}

/**
 * @param {object} def - a validated activity type definition
 * @param {string} studentName - already sanitized
 * @param {string|null} personaId
 * @param {object} caseData - as services/chatPrompt.js#loadChatContext builds it
 * @param {{ personaData?: { instructions }, chatbotPersonality?, freeHints? }} options
 */
export function buildSystemPrompt(def, studentName, personaId, caseData, options = {}) {
  return documentsBlock(def, caseData) + renderOnce(def.prompt.role, roleValues(def, studentName, personaId, caseData, options))
    + (def.traits.material === 'student_submission' ? submissionBlock(caseData.submission_text) : '')
    + signalInstructions(def.traits.signals, def.traits.ai_sees.touchpoints ? caseData.touchpoints : []);
}
