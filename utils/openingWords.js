/**
 * The word floor on a student's opening message, for activity types with
 * `traits.opening_word_floor` (Teach-back). Shared by the page (refuses first, with no request)
 * and /api/llm/chat (refuses with 400 OPENING_TOO_SHORT), so both count the same way.
 *
 * Chat option `min_opening_words` (StudyChat Phase 1). The old key `teach_back_min_words` is still
 * read when the new one is absent: assignments, course versions, defaults and packages saved before
 * the rename carry it.
 */

export const DEFAULT_MIN_OPENING_WORDS = 15;

/** The floor in words for these chat options (0 = off). */
export function minOpeningWords(chatOptions) {
  const value = chatOptions?.min_opening_words ?? chatOptions?.teach_back_min_words ?? DEFAULT_MIN_OPENING_WORDS;
  return Number(value) || 0;
}

export const countWords = (text) => String(text || '').trim().split(/\s+/).filter(Boolean).length;
