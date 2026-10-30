/**
 * Resolving a section-case's chat options: the assignment's own section_cases.chat_options,
 * else the section default, else the global default (chat_options_defaults). An assignment
 * that follows the defaults stores NULL, so reading only section_cases.chat_options misses
 * settings made in the defaults. The student app falls back to its own hardcoded defaults
 * when this returns null (App.tsx defaultChatOptions).
 */

import { pool } from '../db.js';
import { activityOptionDefaults } from './activityTypes.js';

// Default chat options - used when section_cases.chat_options is NULL and no default is stored.
// The activity type (case chat, teach-back) is NOT a chat option: it belongs to the case
// (cases.activity_type, utils/activityTypes.js).
export const DEFAULT_CHAT_OPTIONS = {
  min_opening_words: 15,         // Types with an opening floor (Teach-back): words in the first message (0 = off); utils/openingWords.js
  // Hints configuration
  hints_allowed: 3,
  free_hints: 1,
  // Feedback options
  ask_for_feedback: false,
  ask_save_transcript: false,
  auto_save_transcript: true,    // Auto-save transcript after each chat exchange
  // Persona options
  allowed_personas: 'moderate,strict,liberal,leading,sycophantic',
  default_persona: 'moderate',
  // Display and flow options
  show_case: true,
  show_timer: true,              // Show countdown timer during chat
  do_evaluation: true,
  show_evaluation_details: true, // Show full evaluation criteria vs just score
  // Chatbot personality customization
  chatbot_personality: '',
  // Multi-chat options
  chat_repeats: 0,           // 0 = one chat only, 1+ = can repeat N times
  save_dead_transcripts: false,  // Save transcripts for abandoned/canceled/killed chats
  // Chat control options
  allow_repeat: false,
  timeout_chat: false,
  allow_finish_button: false,
  restart_chat: false,
  allow_exit: false,
  require_minimum_exchanges: 0,  // 0 = no minimum, N = require N exchanges before "time is up"
  max_exchanges: 0,              // 0 = no limit, N = the chat wraps up after the AI answers N student messages
  max_exchanges_action: 'end',   // at the limit: 'end' wraps up; 'ask' lets the student finish or keep talking
  max_message_length: 0,         // 0 = unlimited, N = max N characters per message
  // Position tracking override (position config is now per-scenario)
  disable_position_tracking: false  // Override to disable scenario-level position tracking
};

/**
 * Every chat option key this server understands: the defaults above plus
 * `always_save_transcript`, which the dashboard and the grading route read but which has no
 * server default. An activity package may carry only these keys (services/activityPack): the
 * exporter writes no others and the installer refuses any other, because an option this
 * server does not know would be silently ignored at chat time.
 */
// `teach_back_min_words` is the old name of `min_opening_words`, still read (utils/openingWords.js)
// and still accepted in packages made before the rename.
export const KNOWN_CHAT_OPTION_KEYS = new Set([...Object.keys(DEFAULT_CHAT_OPTIONS), 'always_save_transcript', 'teach_back_min_words']);

const parseJson = (value) => {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return null; }
};

/**
 * Chat options without the retired `activity_mode` key. The activity type is the case's
 * (cases.activity_type, migration 084), so every route that stores chat options passes them
 * through here and an old page or an old stored copy cannot put the key back.
 */
export function withoutActivityMode(chatOptions) {
  if (!chatOptions || typeof chatOptions !== 'object' || !('activity_mode' in chatOptions)) return chatOptions;
  const { activity_mode, ...rest } = chatOptions;
  return rest;
}

/**
 * Resolve a section-case's stored chat_options against the defaults. Never throws.
 *
 * Order: the assignment's own options win whole; else the section default, else the global
 * default, with the activity type's partial defaults laid over it (activity type definition,
 * `chat_options.defaults`). The built-ins have none, so for them this is the stored default as it
 * always was. Case default settings are not a layer here: they are copied into the assignment when
 * the case is attached (activityDefaults.js).
 */
export async function resolveChatOptions(sectionId, chatOptions, activityType = null) {
  if (chatOptions !== null && chatOptions !== undefined) {
    return chatOptions;
  }
  const fallback = await resolveDefaultChatOptions(sectionId);
  const typeDefaults = activityType ? activityOptionDefaults(activityType) : null;
  if (!typeDefaults || Object.keys(typeDefaults).length === 0) return fallback;
  return { ...(parseJson(fallback) || DEFAULT_CHAT_OPTIONS), ...typeDefaults };
}

async function resolveDefaultChatOptions(sectionId) {
  try {
    const [sectionDefaults] = await pool.execute(
      'SELECT chat_options FROM chat_options_defaults WHERE section_id = ?',
      [sectionId]
    );
    if (sectionDefaults.length > 0) {
      return sectionDefaults[0].chat_options;
    }
    const [globalDefaults] = await pool.execute(
      'SELECT chat_options FROM chat_options_defaults WHERE section_id IS NULL'
    );
    if (globalDefaults.length > 0) {
      return globalDefaults[0].chat_options;
    }
    return null;
  } catch (error) {
    console.error('Error fetching chat options defaults:', error);
    return null;
  }
}

/** Parsed, resolved chat options for one section-case, or null when none apply. */
export async function getSectionCaseChatOptions(sectionId, caseId) {
  if (!sectionId || !caseId) return null;
  const [rows] = await pool.execute(
    `SELECT sc.chat_options, c.activity_type
       FROM section_cases sc JOIN cases c ON c.case_id = sc.case_id
      WHERE sc.section_id = ? AND sc.case_id = ?`,
    [sectionId, caseId]
  );
  const own = rows.length ? parseJson(rows[0].chat_options) : null;
  return parseJson(await resolveChatOptions(sectionId, own ?? null, rows[0]?.activity_type ?? null));
}
