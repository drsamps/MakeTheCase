/**
 * Build a student chat's system prompt on the server, from its case_chats record
 * (Phase 3 of docs/security-student-data-access.md; design in docs/server-side-chat-prompt.md).
 *
 * The browser used to build this prompt, so every AI-only field (teaching note, argument
 * framework, scenario instructions, persona instructions) had to reach the student. Now the
 * browser sends only the chat id, the student's first name and the conversation.
 *
 * Inputs mirror what App.tsx#startConversation gathered, in the same order:
 *   1. loadCaseData(case_id): case, supplementary materials, teaching note
 *   2. the chat's scenario overrides protagonist, role, question and instructions, and
 *      supplies arguments; the starting position's arguments override the scenario's
 *   3. Teach-back: the audience persona replaces the protagonist (role cleared)
 *   4. persona row (only from the assignment's allowed list), chatbot_personality, free_hints
 *
 * Two deliberate differences from the browser version:
 *   - scenario-level arguments_for/against are included. The student cases route never
 *     selected them, so the browser silently dropped them.
 *   - the starting position is read from the chat record on every turn, so a position
 *     picked in the chat (explicit capture) now applies. The browser built its prompt
 *     before the student picked and never rebuilt it.
 */

import { pool } from '../db.js';
import { getSectionCaseChatOptions } from './chatOptions.js';
import { resolveAvailablePersonas } from './personaService.js';
import { resolveActivityMode, TEACH_BACK } from './teachBack.js';
import { buildSystemPrompt, buildTeachBackSystemPrompt } from './chatPromptTemplates.js';

const MAX_NAME_LENGTH = 40;

/**
 * The student's first name as typed on the start screen, made safe to splice into the
 * prompt: letters, marks, digits, spaces, apostrophes, periods and hyphens only (no prompt markers,
 * tags or braces), whitespace collapsed, capped at 40 characters. Empty → "Student".
 */
export function sanitizeStudentName(name) {
  const cleaned = String(name ?? '')
    .replace(/[^\p{L}\p{M}\p{N}\s'.-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LENGTH)
    .trim();
  return cleaned || 'Student';
}

/**
 * @param {{ id, case_id, section_id, scenario_id, persona, initial_position_id }} chat - case_chats row
 * @param {string} studentName - already sanitized
 * @returns {Promise<string>} the system prompt
 */
export async function buildChatSystemPrompt(chat, studentName) {
  // Dynamic import: routes/llm.js imports this module (same pattern as evaluations.js).
  const { loadCaseData } = await import('../routes/llm.js');
  const loaded = await loadCaseData(chat.case_id);
  if (!loaded) {
    const err = new Error(`Case "${chat.case_id}" not found`);
    err.status = 404;
    throw err;
  }
  let caseData = { ...loaded };

  if (chat.scenario_id) {
    const [scenarios] = await pool.execute(
      `SELECT protagonist, protagonist_initials, protagonist_role, chat_topic, chat_question,
              prompt_instructions, arguments_for, arguments_against
         FROM case_scenarios WHERE id = ? AND case_id = ?`,
      [chat.scenario_id, chat.case_id]
    );
    const scenario = scenarios[0];
    if (scenario) {
      let argumentsFor = scenario.arguments_for || undefined;
      let argumentsAgainst = scenario.arguments_against || undefined;
      if (chat.initial_position_id) {
        const [positions] = await pool.execute(
          'SELECT arguments_for, arguments_against FROM scenario_positions WHERE position_id = ? AND scenario_id = ?',
          [chat.initial_position_id, chat.scenario_id]
        );
        if (positions[0]?.arguments_for) argumentsFor = positions[0].arguments_for;
        if (positions[0]?.arguments_against) argumentsAgainst = positions[0].arguments_against;
      }
      caseData = {
        ...caseData,
        protagonist: scenario.protagonist,
        protagonist_initials: scenario.protagonist_initials,
        protagonist_role: scenario.protagonist_role || undefined,
        chat_topic: scenario.chat_topic || undefined,
        chat_question: scenario.chat_question,
        prompt_instructions: scenario.prompt_instructions || undefined,
        arguments_for: argumentsFor,
        arguments_against: argumentsAgainst,
      };
    }
  }

  const chatOptions = (await getSectionCaseChatOptions(chat.section_id, chat.case_id)) || {};
  const mode = resolveActivityMode(chatOptions);
  const personas = await resolveAvailablePersonas(chatOptions.allowed_personas, mode);
  const personaRow = personas.find((p) => p.persona_id === chat.persona);

  if (mode === TEACH_BACK && personaRow?.persona_name) {
    caseData = { ...caseData, protagonist: personaRow.persona_name, protagonist_role: undefined };
  }

  const options = {
    freeHints: chatOptions.free_hints ?? 1,
    chatbotPersonality: chatOptions.chatbot_personality || undefined,
    personaData: personaRow ? { instructions: personaRow.instructions || '' } : undefined,
  };
  return mode === TEACH_BACK
    ? buildTeachBackSystemPrompt(studentName, chat.persona, caseData, options)
    : buildSystemPrompt(studentName, chat.persona, caseData, options);
}
