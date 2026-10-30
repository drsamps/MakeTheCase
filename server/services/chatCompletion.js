/**
 * How a chat may end, on the server (StudyChat Phase 4). Until now the minimum exchanges rule lived
 * only in the page, so a direct request could be graded after one message.
 *
 * Reasons:
 *   student        the student finished: needs the minimum
 *   goal           the AI signalled the goal and the student accepted: needs the signal AND the minimum
 *   max_exchanges  Maximum Responses reached: needs that many exchanges
 *   time           the timer ran out: needs a time limit that has really passed (slack for clocks)
 * `instructor` and `canceled` are written by their own routes. The first reason recorded stands.
 */

import { pool } from '../db.js';

const TIME_SLACK_MS = 120 * 1000;

/** The minimum as the page applies it: never above the maximum, which could then never be met. */
export function effectiveMinExchanges(chatOptions) {
  const min = Number(chatOptions?.require_minimum_exchanges) || 0;
  const max = Number(chatOptions?.max_exchanges) || 0;
  return max > 0 ? Math.min(min, max) : min;
}

export class CompletionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.status = 409;
    this.code = code;
    this.details = details;
  }
}

const minimumNotMet = (required, used) => new CompletionError(
  'MIN_EXCHANGES_NOT_MET',
  `This chat needs at least ${required} exchange${required === 1 ? '' : 's'} before it can finish.`,
  { required, used }
);

/** Is this reason true of this chat? Throws CompletionError when not. */
export function assertCanComplete(chat, reason, chatOptions, exchangesUsed, now = Date.now()) {
  const min = effectiveMinExchanges(chatOptions);
  if (reason === 'student') {
    if (exchangesUsed < min) throw minimumNotMet(min, exchangesUsed);
    return;
  }
  if (reason === 'goal') {
    if (!chat.goal_reached_at) throw new CompletionError('GOAL_NOT_REACHED', 'The goal of this chat has not been reached.');
    if (exchangesUsed < min) throw minimumNotMet(min, exchangesUsed);
    return;
  }
  if (reason === 'max_exchanges') {
    const max = Number(chatOptions?.max_exchanges) || 0;
    if (!(max > 0) || exchangesUsed < max) throw new CompletionError('NOT_AT_LIMIT', 'This chat has not reached its message limit.');
    return;
  }
  if (reason === 'time') {
    const limit = Number(chat.time_limit_minutes) || 0;
    const started = chat.time_started ? new Date(chat.time_started).getTime() : null;
    if (!(limit > 0) || !started || started + limit * 60000 > now + TIME_SLACK_MS) {
      throw new CompletionError('TIME_NOT_UP', 'The time for this chat has not run out.');
    }
    return;
  }
  throw new CompletionError('INVALID_REASON', 'Unknown reason for ending the chat.');
}

/** Record how the chat ended, unless a reason is already recorded. */
export async function recordCompletionReason(chatId, reason, db = pool) {
  await db.execute('UPDATE case_chats SET completion_reason = COALESCE(completion_reason, ?) WHERE id = ?', [reason, chatId]);
}

/**
 * The gate at grading: a chat with no recorded reason (a stale page, a direct request) must have
 * met the minimum. Throws CompletionError when not.
 */
export function assertGradable(chat, chatOptions, exchangesUsed) {
  if (chat.completion_reason) return;
  const min = effectiveMinExchanges(chatOptions);
  if (exchangesUsed < min) throw minimumNotMet(min, exchangesUsed);
}
