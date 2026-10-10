/**
 * Resolving a section-case's chat options: the assignment's own section_cases.chat_options,
 * else the section default, else the global default (chat_options_defaults). An assignment
 * that follows the defaults stores NULL, so reading only section_cases.chat_options misses
 * settings made in the defaults. The student app falls back to its own hardcoded defaults
 * when this returns null (App.tsx defaultChatOptions).
 */

import { pool } from '../db.js';

const parseJson = (value) => {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return null; }
};

/** Resolve a section-case's stored chat_options against the defaults. Never throws. */
export async function resolveChatOptions(sectionId, chatOptions) {
  if (chatOptions !== null && chatOptions !== undefined) {
    return chatOptions;
  }
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
    'SELECT chat_options FROM section_cases WHERE section_id = ? AND case_id = ?',
    [sectionId, caseId]
  );
  const own = rows.length ? parseJson(rows[0].chat_options) : null;
  return parseJson(await resolveChatOptions(sectionId, own ?? null));
}
