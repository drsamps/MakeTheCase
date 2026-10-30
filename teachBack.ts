/**
 * Teach-back — client constants and helpers.
 *
 * Teach-back inverts the case chat: instead of arguing a position with a knowledgeable
 * protagonist, the student EXPLAINS the reading to an AI audience that does not understand
 * it (your grandmother, a classmate who skipped the reading, a skeptical colleague...).
 *
 * It is one of the Study-Chat activity types (`utils/activityTypes.js`). The type belongs to
 * the CASE (`cases.activity_type`), and every endpoint that lists cases, assignments or
 * course versions returns it as `activity_type`. It is no longer a chat option: nothing reads
 * `chat_options.activity_mode`, and the helpers below take the case's type instead.
 *
 * Ported from Quizzer's EXPLAIN activity (`../quizzer/explain/`). See
 * `docs/teach-back-setup.md` for the instructor runbook.
 *
 * Student-facing wording is no longer here: every activity type's copy is in its definition
 * (utils/activityEngine/builtins/*.json), read through services/activityCopy.ts. The opening
 * word floor is utils/openingWords.js.
 */

import { parseAllowedPersonaIds } from './utils/personas';
import { CASE_CHAT, TEACH_BACK } from './utils/activityTypes.js';
import { usesAudiencePersonas } from './services/activityTypeList';

export { CASE_CHAT, TEACH_BACK, usesAudiencePersonas };

/**
 * Audience personas are distinguished from case-chat personas by an id prefix rather than
 * by a column. The prefix is read in BOTH directions: teach-back offers only `audience-*`,
 * and case chat excludes them (so a CEO is never played by your grandmother).
 */
export const AUDIENCE_PREFIX = 'audience-';

export const isAudiencePersonaId = (personaId?: string | null): boolean =>
  typeof personaId === 'string' && personaId.startsWith(AUDIENCE_PREFIX);

/** Ids in `allowed_personas` that belong to the OTHER activity, which this one ignores. */
export const crossModePersonaIds = (chatOptions?: { allowed_personas?: string | null } | null, activityType?: string | null): string[] =>
  (parseAllowedPersonaIds(chatOptions?.allowed_personas) || [])
    .filter((id) => isAudiencePersonaId(id) !== usesAudiencePersonas(activityType));

/**
 * An explicit `allowed_personas` list must name at least one persona its activity can use.
 * Blocking at configuration time is deliberate: the alternative is a student meeting an
 * empty picker, or a "falls back to every persona" rule that would hand them Sycophantic as
 * a grandmother. Shared by every chat-options editor (section, defaults, course version) so
 * none of them can save what the others refuse. `activityType` is the case's; a default,
 * which is shared by cases of every type, is checked as case chat. Returns an error message,
 * or null when the options are fine to save.
 */
export const validateChatOptionsForSave = (chatOptions?: { allowed_personas?: string | null } | null, activityType?: string | null): string | null => {
  const allowed = parseAllowedPersonaIds(chatOptions?.allowed_personas);
  if (allowed === null) return null;  // "all enabled" resolves per activity server-side
  if (allowed.length > crossModePersonaIds(chatOptions, activityType).length) return null;
  return usesAudiencePersonas(activityType)
    ? 'This activity needs at least one audience. Tick an audience under Allowed Audiences, or tick "All enabled".'
    : 'This activity needs at least one personality. Tick a persona under Allowed Personas, or tick "All enabled".';
};

/**
 * Initials for the chat avatar, derived from the audience's display name because in
 * Teach-Back the character comes from the persona rather than the scenario. Up to two
 * letters, matching the `protagonist_initials` convention.
 */
export const initialsOf = (name: string): string => {
  const words = (name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
};
