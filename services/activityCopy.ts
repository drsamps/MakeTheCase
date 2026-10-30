/**
 * Student-facing wording for the activity a student is doing, from its STUDENT VIEW: the
 * whitelist the server puts on each case row (`activity` on GET /sections/:id/cases) and pins in
 * the POST /case-chats response, so the words cannot change mid-chat. Templates never reach the
 * page; see utils/activityEngine/view.js.
 *
 * Every sentence that differs by activity type comes through `copyFor()`. Do not test a type key
 * in the page: add a copy key (utils/activityEngine/validate.js#COPY_KEYS) or use a trait.
 */

import { copyFor as copyForView, activityIntroText as introTextForView } from '../utils/activityEngine/copy.js';

export interface StudentActivityView {
  type: string;
  version: string;
  label: string;
  traits: {
    character: 'scenario' | 'persona';
    persona_kind: 'protagonist' | 'audience';
    positions: 'off' | 'optional' | 'required';
    opening_word_floor: boolean;
    evidence: boolean;
  };
  labels: { document: string; ai_character: string; question: string; ai_fallback: string };
  copy: Record<string, unknown> & { summary_headings?: string[] };
}

/** The copy keys (utils/activityEngine/validate.js#COPY_KEYS) and the variables each takes. */
export interface CopyVars {
  start_row: { ai_name: string; ai_role_suffix: string; topic: string; topic_or_question: string };
  persona_picker_title: Record<string, never>;
  persona_picker_help: Record<string, never>;
  persona_picker_empty: Record<string, never>;
  start_no_persona: Record<string, never>;
  feedback_permission: { first_name: string };
  transcript_permission: { first_name: string };
  farewell: { first_name: string };
  min_exchanges_warning: Record<string, never>;
  opening_too_short: { min_words: number };
  hints_disabled: Record<string, never>;
  hints_exhausted: { n: number };
  helpful_score_question: Record<string, never>;
  transcript_permission_after_feedback: Record<string, never>;
  farewell_after_decline: Record<string, never>;
  liked_question: Record<string, never>;
  improve_question: Record<string, never>;
  farewell_after_feedback: Record<string, never>;
  goodbye: { first_name: string };
  position_prompt: Record<string, never>;
  position_reply_fallback: Record<string, never>;
  final_position_context: { ai_name: string; question: string };
  final_position_question: { ai_name: string };
  counter_used: { used: number; max: number };
  counter_past_limit: { used: number; max: number };
  limit_reached: { max: number };
  avatar_tooltip: { ai_name: string; persona_name: string; case_title: string; model: string };
  coverage_heading: Record<string, never>;
  coverage_count: { met: number; total: number };
  status_met: Record<string, never>;
  status_partial: Record<string, never>;
  status_not_met: Record<string, never>;
}
export type CopyKey = keyof CopyVars;

/** The text for `key`, slots filled once. '' when the view is missing. May contain **bold**. */
export function copyFor<K extends CopyKey>(
  view: StudentActivityView | null | undefined,
  key: K,
  ...vars: CopyVars[K] extends Record<string, never> ? [] : [CopyVars[K]]
): string {
  return copyForView(view, key, (vars[0] ?? {}) as Record<string, string | number>);
}

/** What the page knows about this chat's settings, for the intro bar. */
export interface ActivityIntroFacts {
  caseTitle: string;
  scenarioName?: string;
  /** The AI's display name as the student picked it ("Your grandmother"). */
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
  /** The student picks a position first; that click counts as a message and starts the clock. */
  positionFirst: boolean;
  /** Show Case Content is on; `readingWhere` is where the reading pane sits. */
  showReading: boolean;
  readingWhere: 'left' | 'above';
}

export interface ActivityIntroText {
  heading: string;
  teachLine: string;
  topic: string;
  about: string;
  instructions: string[];
  instructionsLabel: string;
  signOff: string;
}

/** The intro bar's text, or null for a type without one (case chat). Strings may contain **bold**. */
export function activityIntroText(view: StudentActivityView | null | undefined, facts: ActivityIntroFacts): ActivityIntroText | null {
  return introTextForView(view, facts) as ActivityIntroText | null;
}
