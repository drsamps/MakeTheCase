/**
 * Teach-Back mode — shared client constants and helpers.
 *
 * Teach-Back inverts the case chat: instead of arguing a position with a knowledgeable
 * protagonist, the student EXPLAINS the reading to an AI audience that does not understand
 * it (your grandmother, a classmate who skipped the reading, a skeptical colleague...).
 *
 * The mode is stored in `section_cases.chat_options.activity_mode`, so it needs no schema
 * change and rides case-version write-through for free. A missing key always means the
 * existing case-chat behaviour — every read site goes through `resolveActivityMode()`.
 *
 * Ported from Quizzer's EXPLAIN activity (`../quizzer/explain/`). See
 * `docs/teach-back-setup.md` for the instructor runbook.
 */

import { parseAllowedPersonaIds } from './utils/personas';

export const CASE_CHAT = 'case_chat';
export const TEACH_BACK = 'teach_back';

export type ActivityMode = typeof CASE_CHAT | typeof TEACH_BACK;

/**
 * Audience personas are distinguished from case-chat personas by an id prefix rather than
 * by a column, because this pilot ships without a migration. The prefix is read in BOTH
 * directions: Teach-Back offers only `audience-*`, and case chat now excludes them (so a
 * CEO is never played by your grandmother).
 */
export const AUDIENCE_PREFIX = 'audience-';

export const isAudiencePersonaId = (personaId?: string | null): boolean =>
  typeof personaId === 'string' && personaId.startsWith(AUDIENCE_PREFIX);

/** The stored mode, defaulting to case chat for any assignment that has never set it. */
export const resolveActivityMode = (chatOptions?: { activity_mode?: string } | null): ActivityMode =>
  chatOptions?.activity_mode === TEACH_BACK ? TEACH_BACK : CASE_CHAT;

export const isTeachBack = (chatOptions?: { activity_mode?: string } | null): boolean =>
  resolveActivityMode(chatOptions) === TEACH_BACK;

/** `chat_options` as a list endpoint returns it: already parsed, or still a JSON string. */
export const parseChatOptions = (chatOptions: unknown): any => {
  if (typeof chatOptions !== 'string') return chatOptions ?? null;
  try { return JSON.parse(chatOptions); } catch { return null; }
};

/** Ids in `allowed_personas` that belong to the OTHER activity, which this one ignores. */
export const crossModePersonaIds = (chatOptions?: { activity_mode?: string; allowed_personas?: string | null } | null): string[] =>
  (parseAllowedPersonaIds(chatOptions?.allowed_personas) || [])
    .filter((id) => isAudiencePersonaId(id) !== isTeachBack(chatOptions));

/**
 * An explicit `allowed_personas` list must name at least one persona its activity can use.
 * Blocking at configuration time is deliberate: the alternative is a student meeting an
 * empty picker, or a "falls back to every persona" rule that would hand them Sycophantic as
 * a grandmother. Shared by every chat-options editor (section, defaults, course version) so
 * none of them can save what the others refuse. Returns an error message, or null when the
 * options are fine to save.
 */
export const validateChatOptionsForSave = (chatOptions?: { activity_mode?: string; allowed_personas?: string | null } | null): string | null => {
  const allowed = parseAllowedPersonaIds(chatOptions?.allowed_personas);
  if (allowed === null) return null;  // "all enabled" resolves per activity server-side
  if (allowed.length > crossModePersonaIds(chatOptions).length) return null;
  return isTeachBack(chatOptions)
    ? 'Teach-back needs at least one audience. Tick an audience under Allowed Audiences, or tick "All enabled".'
    : 'Case chat needs at least one personality. Tick a persona under Allowed Personas, or tick "All enabled".';
};

/** Default floor on the opening explanation. Quizzer uses the same 15 words. */
export const DEFAULT_TEACH_BACK_MIN_WORDS = 15;

export const countWords = (text: string): number =>
  (text || '').trim().split(/\s+/).filter(Boolean).length;

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

/**
 * An audience's display name, phrased so it reads after "I'm". Audience names are written
 * from the STUDENT's side of the picker ("Your grandmother", "A skeptical colleague"), so
 * "I'm Your grandmother" is wrong in the greeting. Only a known leading article or
 * possessive is lowercased: "Sam, a curious beginner" and any instructor-made name like
 * "Professor Kim" keep their capital.
 */
export const introduceAudience = (name: string): string =>
  (name || '').trim().replace(/^(your|a|an|the|my|our|someone|somebody)(?=\s)/i, (w) => w.toLowerCase());

/**
 * Teach-Back student-facing copy.
 *
 * The case chat's own strings are protagonist-voiced ("I am glad you were able to study
 * this case"), which is wrong coming from someone who was just taught. Keeping the
 * replacements here rather than inline in App.tsx means removing the mode is deleting a
 * file plus a few ternaries.
 */
export const TEACH_BACK_COPY = {
  // No role clause: a persona's description is an instructor-facing blurb ("Warm and sharp,
  // but has never studied this subject"), not something a listener says about themself.
  greeting: (studentName: string, audience: string, question: string) =>
    `Hi ${studentName}, I'm ${introduceAudience(audience)}. I'm supposed to understand **${question}** and honestly I don't get it yet. Could you explain it to me?`,

  minExchangesWarning: () =>
    `I don't want to hold you up, but I'm not there yet — could we stay with it a little longer? A couple more explanations and I think it will click.`,

  feedbackPermission: (firstName: string) =>
    `Thank you, ${firstName} — you explained that far better than the reading did. **Would you be willing to answer a few questions about how this conversation went?**`,

  transcriptPermission: (firstName: string) =>
    `Thank you, ${firstName} — I understand this much better than when we started. **Would you be willing to let me pass this conversation transcript to the developers to help improve these conversations for future students?**`,

  farewell: (firstName: string) =>
    `Thank you, ${firstName} — I understand this much better than when we started, and I appreciate you taking the time to walk me through it. Click the button below to proceed to the evaluation.`,

  hintsDisabled: () =>
    `I wish I could help, but I'm the one who doesn't understand this yet — I really don't know the material. Could you try explaining that part a different way?`,

  hintsExhausted: (hintsAllowed: number) =>
    `I've already asked you to rephrase ${hintsAllowed} time${hintsAllowed === 1 ? '' : 's'}, and I don't know the material myself. Let's keep going with what you can tell me.`,

  openingTooShort: (minWords: number) =>
    `I'm not following yet — could you start by explaining it properly, in at least ${minWords} words? Take it from the beginning, as if I know nothing about it.`,
};
