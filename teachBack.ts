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
 */

import { parseAllowedPersonaIds } from './utils/personas';
import { CASE_CHAT, TEACH_BACK } from './utils/activityTypes.js';
import { introduceAudience } from './utils/scenarioSettings.js';

export { CASE_CHAT, TEACH_BACK };

/**
 * Audience personas are distinguished from case-chat personas by an id prefix rather than
 * by a column. The prefix is read in BOTH directions: teach-back offers only `audience-*`,
 * and case chat excludes them (so a CEO is never played by your grandmother).
 */
export const AUDIENCE_PREFIX = 'audience-';

export const isAudiencePersonaId = (personaId?: string | null): boolean =>
  typeof personaId === 'string' && personaId.startsWith(AUDIENCE_PREFIX);

/** True for a teach-back case. A missing type is case chat, as it was before types existed. */
export const isTeachBackType = (activityType?: string | null): boolean => activityType === TEACH_BACK;

/** Ids in `allowed_personas` that belong to the OTHER activity, which this one ignores. */
export const crossModePersonaIds = (chatOptions?: { allowed_personas?: string | null } | null, activityType?: string | null): string[] =>
  (parseAllowedPersonaIds(chatOptions?.allowed_personas) || [])
    .filter((id) => isAudiencePersonaId(id) !== isTeachBackType(activityType));

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
  return isTeachBackType(activityType)
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
 * Teach-Back student-facing copy.
 *
 * The case chat's own strings are protagonist-voiced ("I am glad you were able to study
 * this case"), which is wrong coming from someone who was just taught. Keeping the
 * replacements here rather than inline in App.tsx means removing the mode is deleting a
 * file plus a few ternaries.
 */
export const TEACH_BACK_COPY = {
  // The opening greeting is written by the server when the chat is created
  // (server/services/chatPrompt.js#buildGreeting), as turn 0 of its copy of the conversation.

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

  // Position tracking: the prompt above the position buttons, the reply shown if the AI call
  // after a position pick fails, and the end-of-chat question (the case chat's names the
  // protagonist; here that is the audience).
  positionPrompt: () =>
    `Before you explain it, where do you stand? Pick the position closest to yours, then tell me why.`,

  positionReplyFallback: () =>
    `Okay — so that's where you stand. Could you explain to me why?`,

  finalPositionQuestion: () =>
    `Has explaining it changed your mind?`,

  openingTooShort: (minWords: number) =>
    `I'm not following yet — could you start by explaining it properly, in at least ${minWords} words? Take it from the beginning, as if I know nothing about it.`,
};

/** What the intro bar above a teach-back chat says, from the assignment's settings. */
export interface TeachBackIntroFacts {
  caseTitle: string;
  scenarioName?: string;
  /** The audience's display name as the student picked it ("Your grandmother"). */
  audienceName: string;
  /** The playful line saved for this audience in this scenario (scenario settings, student subtree). */
  intro?: string;
  topic: string;
  /** Maximum Responses (0 = none); the server counts the student's answered messages. */
  maxMessages: number;
  /** "Keep talking" is offered at the limit (max_exchanges_action 'ask'). */
  canKeepGoing: boolean;
  /** Require Minimum Exchanges (already capped at the maximum). */
  minMessages: number;
  /** The scenario's time limit in minutes (0 = none). */
  timeLimitMinutes: number;
  /** Auto-End on Timeout. */
  autoEnd: boolean;
  allowFinish: boolean;
  /** The student picks a position first ("Student selects position"); that click counts as a message and starts the clock. */
  positionFirst: boolean;
  /** Show Case Content is on; `readingWhere` is where the reading pane sits. */
  showReading: boolean;
  readingWhere: 'left' | 'above';
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The intro bar's text. Strings may contain **bold** spans (rendered by TeachBackIntro).
 * Students never see the words "teach-back": the heading names the case and scenario.
 */
export function teachBackIntroText(f: TeachBackIntroFacts): {
  heading: string; teachLine: string; topic: string; about: string; instructions: string[];
} {
  const audience = introduceAudience(f.audienceName) || 'your listener';
  // "Messages" are the student's own: what they send, never the audience's replies.
  const instructions: string[] = [];

  instructions.push(f.showReading
    ? `You should review the reading ${f.readingWhere === 'left' ? 'on the left' : 'above'} before you start, and refer to it throughout the conversation.`
    : 'Draw on the reading you studied for this activity.');

  const pickNote = f.positionFirst ? ' (the position you pick counts as your first message)' : '';
  let pickNoted = false;
  if (f.maxMessages > 0) {
    pickNoted = true;
    const keepGoing = f.canKeepGoing ? ', and you can choose to keep going after that' : '';
    if (f.timeLimitMinutes > 0 && f.autoEnd) {
      instructions.push(`You can send them up to **${plural(f.maxMessages, 'message')}** or use **${plural(f.timeLimitMinutes, 'minute')}**, whichever comes first${pickNote}${keepGoing}.`);
    } else {
      instructions.push(`You can send them up to **${plural(f.maxMessages, 'message')}**${pickNote}${keepGoing}.`);
      if (f.timeLimitMinutes > 0) instructions.push(`Aim to finish in about **${plural(f.timeLimitMinutes, 'minute')}**.`);
    }
  } else if (f.timeLimitMinutes > 0) {
    instructions.push(f.autoEnd
      ? `You can take up to **${plural(f.timeLimitMinutes, 'minute')}**.`
      : `Aim to finish in about **${plural(f.timeLimitMinutes, 'minute')}**.`);
  }
  if (f.timeLimitMinutes > 0) {
    instructions.push(`The clock starts when you ${f.positionFirst ? 'pick your position' : 'send your first message'}.`);
  }
  if (f.minMessages > 0) {
    instructions.push(`Send at least **${plural(f.minMessages, 'message')}** before you finish${pickNoted ? '' : pickNote}.`);
  }

  instructions.push(f.allowFinish
    ? 'When you think they\'ve got it, click **Finish Chat** (or type "time is up").'
    : 'When you think they\'ve got it, type "time is up".');

  return {
    heading: `Welcome to this "${f.caseTitle}" activity${f.scenarioName ? ` on: ${f.scenarioName}` : ''}!`,
    teachLine: `You'll teach ${audience} about:`,
    topic: f.topic,
    about: `${f.intro?.trim() || `${capitalise(audience)} is new to this topic.`} Underneath it all, they really want to understand it and are eager for you to explain.`,
    instructions,
  };
}
