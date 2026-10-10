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
 * Everything a chat's prompt, greeting and transcript need, from its case_chats row.
 * @param {{ id, case_id, section_id, scenario_id, persona, initial_position_id }} chat
 * @returns {Promise<{ chat, caseData, chatOptions, mode, options }>}
 */
export async function loadChatContext(chat) {
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
  return { chat, caseData, chatOptions, mode, options };
}

/**
 * The system prompt for one turn.
 * @param {Awaited<ReturnType<typeof loadChatContext>>} ctx
 * @param {string} studentName - already sanitized
 */
export function buildChatSystemPrompt(ctx, studentName) {
  const { chat, caseData, mode, options } = ctx;
  return mode === TEACH_BACK
    ? buildTeachBackSystemPrompt(studentName, chat.persona, caseData, options)
    : buildSystemPrompt(studentName, chat.persona, caseData, options);
}

/** The label for the AI's turns in the transcript and the grading copy ("CEO" if unknown). */
export function protagonistLabel(ctx) {
  return ctx.caseData.protagonist || 'CEO';
}

// An audience's display name, phrased so it reads after "I'm". Audience names are written from
// the STUDENT's side of the picker ("Your grandmother", "A skeptical colleague"), so "I'm Your
// grandmother" would be wrong. Only a known leading article or possessive is lowercased: "Sam, a
// curious beginner" and an instructor-made name like "Professor Kim" keep their capital.
const introduceAudience = (name) =>
  (name || '').trim().replace(/^(your|a|an|the|my|our|someone|somebody)(?=\s)/i, (w) => w.toLowerCase());

/**
 * The AI's opening line (turn 0), written when the chat is created and shown by the browser.
 * Moved from App.tsx#startConversation and teachBack.ts TEACH_BACK_COPY.greeting.
 * @param {string} studentName - already sanitized
 */
export function buildGreeting(ctx, studentName) {
  const { caseData, mode } = ctx;
  if (mode === TEACH_BACK) {
    return `Hi ${studentName}, I'm ${introduceAudience(caseData.protagonist)}. I'm supposed to understand **${caseData.chat_question}** and honestly I don't get it yet. Could you explain it to me?`;
  }
  const roleDescription = caseData.protagonist_role || 'the protagonist';
  return `Hello ${studentName}, I am ${caseData.protagonist}, ${roleDescription} of the "${caseData.case_title}" case. Thank you for meeting with me today. Our time is limited so let's get straight to my question: **${caseData.chat_question}**`;
}
