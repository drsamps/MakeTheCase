/**
 * Build a student chat's system prompt on the server, from its case_chats record
 * (Phase 3 of docs/security-student-data-access.md; design in docs/server-side-chat-prompt.md).
 *
 * The browser used to build this prompt, so every AI-only field (teaching note, argument
 * framework, scenario instructions, persona instructions) had to reach the student. Now the
 * browser sends only the chat id, the student's first name and the new message; the server
 * keeps the conversation (services/chatTurns.js).
 *
 * Inputs mirror what App.tsx#startConversation gathered, in the same order:
 *   1. loadCaseData(case_id): case, supplementary materials, teaching note
 *   2. the chat's scenario overrides protagonist, role, question and instructions, and
 *      supplies arguments; the starting position's arguments override the scenario's
 *   3. Teach-back: the audience persona replaces the protagonist (role cleared)
 *   4. persona row (only from the assignment's allowed list), chatbot_personality, free_hints
 *
 * The activity type is the case's (cases.activity_type, returned by loadCaseData); the
 * per-type prompt and greeting builders are in services/activityTypes.js.
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
import { behaviourForChat, previewBehaviour } from './activityTypes.js';
import { readScenarioSettings } from '../../utils/scenarioSettings.js';

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
 * Everything a chat's prompt, greeting and transcript need, from its case_chats row.
 * @param {{ id, case_id, section_id, scenario_id, persona, initial_position_id, activity_type_version? }} chat
 * @param {{ definition?: object }} [opts] - an unpublished definition to preview instead
 * @returns {Promise<{ chat, caseData, chatOptions, mode, behaviour, options }>}
 */
export async function loadChatContext(chat, { definition = null } = {}) {
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
              prompt_instructions, arguments_for, arguments_against, chat_options_override
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
        // Student-visible scenario text (utils/scenarioSettings.js): the audience's situation and
        // each audience's saved opening. Read by the teach-back greeting and system prompt.
        scenario_student: readScenarioSettings(scenario.chat_options_override).student,
      };
    }
  }

  const chatOptions = (await getSectionCaseChatOptions(chat.section_id, chat.case_id)) || {};
  // The behaviour this chat runs on: the type version it recorded at its start (a publish mid-chat
  // changes nothing for it), or the case's current type for a new chat. An admin preview passes
  // an unpublished definition. Throws 409 ACTIVITY_TYPE_UNAVAILABLE for an unknown type.
  const behaviour = definition ? previewBehaviour(definition) : behaviourForChat(chat, loaded.activity_type);
  const traits = behaviour.definition.traits;
  const mode = behaviour.definition.key;
  const personas = await resolveAvailablePersonas(chatOptions.allowed_personas, traits);
  const personaRow = personas.find((p) => p.persona_id === chat.persona);

  if (traits.character === 'persona' && personaRow?.persona_name) {
    caseData = { ...caseData, protagonist: personaRow.persona_name, protagonist_role: undefined };
  }

  const options = {
    freeHints: chatOptions.free_hints ?? 1,
    chatbotPersonality: chatOptions.chatbot_personality || undefined,
    personaData: personaRow ? { instructions: personaRow.instructions || '' } : undefined,
  };
  return { chat, caseData, chatOptions, mode, behaviour, options };
}

/**
 * The system prompt for one turn.
 * @param {Awaited<ReturnType<typeof loadChatContext>>} ctx
 * @param {string} studentName - already sanitized
 */
export function buildChatSystemPrompt(ctx, studentName) {
  const { chat, caseData, behaviour, options } = ctx;
  return behaviour.buildSystemPrompt(studentName, chat.persona, caseData, options);
}

/** The label for the AI's turns in the transcript and the grading copy ("CEO" if unknown). */
export function protagonistLabel(ctx) {
  return ctx.caseData.protagonist || 'CEO';
}

/**
 * The AI's opening line (turn 0), written when the chat is created and shown by the browser.
 * The wording per activity type is in services/activityTypes.js.
 * @param {string} studentName - already sanitized
 */
export function buildGreeting(ctx, studentName) {
  return ctx.behaviour.buildGreeting(ctx.caseData, studentName, ctx.chat.persona);
}
