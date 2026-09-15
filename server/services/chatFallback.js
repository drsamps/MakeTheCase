// Chat model fallback: answer a student's chat turn from the next working model when the
// section's chat model is rate-limited, overloaded, times out, or returns nothing.
//
// Candidates, in order: the requested (section) chat model, then the ranked default models
// (models.default_model = 1, 2, 3, ...), skipping the one already tried.
//
// Rules that keep this safe (see docs/model-fallback.md):
//   - The whole chain must finish inside Apache's 60s proxy timeout, so every attempt runs
//     under an AbortSignal drawn from TOTAL_BUDGET_MS. A stalled model is abandoned at
//     ATTEMPT_TIMEOUT_MS only when a later candidate can actually run (its key and pricing
//     guards pass); otherwise it gets whatever budget remains. An abandoned call is still
//     written to model_usage as an estimate (trackAbandonedChat), since the provider may bill it.
//   - Circuit breaker, in memory (PM2 runs one instance): FAILURE_THRESHOLD failures of a model
//     within FAILURE_WINDOW_MS move it to the end of the list for COOLDOWN_MS. After the
//     cooldown one more failure re-opens it at once. An open model is tried last, never
//     dropped, so the breaker never refuses a reply another candidate couldn't give.
//   - Only transient failures fall back: 429, 408, 5xx, timeouts, network errors, empty
//     replies, and a 4xx saying the model id is gone. Other 4xx (context too long, bad
//     parameters, bad key, no credit) won't be fixed by another attempt: on the requested
//     model they are rethrown, on a backup they move on; neither counts toward the breaker.
//   - Guard errors are not model failures. A cost cap stops the chain. A backup without a key
//     for the instructor's vendor, or without pricing, is skipped (checked before calling it).
//     On the requested model those errors are rethrown so the route keeps its 409 messages.
//   - Every failed attempt is logged to model_failures (fire-and-forget), with the model that
//     finally answered, if any.
import { pool } from '../db.js';
import { chatWithLLM, detectProvider, trackAbandonedChat } from './llmRouter.js';
import { assertWithinCostCap } from './usageGuard.js';
import { resolveProviderKey } from './keyResolver.js';

const MAX_ATTEMPTS = 3;
const TOTAL_BUDGET_MS = 50_000;
const ATTEMPT_TIMEOUT_MS = Number(process.env.CHAT_FALLBACK_ATTEMPT_TIMEOUT_MS) || 30_000;
const MIN_ATTEMPT_MS = 8_000;
const FAILURE_THRESHOLD = 3;
const FAILURE_WINDOW_MS = 5 * 60_000;
const COOLDOWN_MS = 10 * 60_000;

const STOP_CODES = new Set(['INSTRUCTOR_COST_CAP_EXCEEDED']);
const SKIP_BACKUP_CODES = new Set(['INSTRUCTOR_SETUP_INCOMPLETE', 'MODEL_UNPRICED']);

// A 4xx whose message says the model id itself is unusable (retired, typo): a backup can help.
const MODEL_GONE_RE = /not a valid model|no endpoints found|unknown model|model.{0,60}(not found|does not exist|not exist|not available|unavailable|deprecated|decommissioned)/i;

const MODEL_CONFIG_COLUMNS = 'model_id, vendor, temperature, reasoning_effort';

// ---------------------------------------------------------------------------
// Circuit breaker
// ---------------------------------------------------------------------------

/** key -> { failures: number[] (timestamps), openUntil: number, tripped: boolean } */
const breakers = new Map();

const breakerKey = (modelId, instructorId) => `${modelId}|${instructorId || 'system'}`;

function isBreakerOpen(key, now) {
  const b = breakers.get(key);
  return Boolean(b && b.openUntil > now);
}

function noteFailure(key, now) {
  const b = breakers.get(key) || { failures: [], openUntil: 0, tripped: false };
  // Half-open: a model that already served a cooldown re-opens on its first new failure.
  if (b.tripped) {
    b.failures = [];
    b.openUntil = now + COOLDOWN_MS;
  } else {
    b.failures = b.failures.filter((t) => now - t < FAILURE_WINDOW_MS);
    b.failures.push(now);
    if (b.failures.length >= FAILURE_THRESHOLD) {
      b.failures = [];
      b.openUntil = now + COOLDOWN_MS;
      b.tripped = true;
    }
  }
  breakers.set(key, b);
  if (b.openUntil > now) {
    console.warn(`[ChatFallback] breaker open for ${key} until ${new Date(b.openUntil).toISOString()}`);
  }
}

function noteSuccess(key) {
  breakers.delete(key);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** rate_limit | timeout | server_error | empty_reply | other  (the model_failures.error_kind enum) */
export function classifyError(err) {
  if (err?.code === 'EMPTY_REPLY') return 'empty_reply';
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError' || err?.code === 'ETIMEDOUT') return 'timeout';
  const status = Number(err?.status);
  if (status === 429) return 'rate_limit';
  if (status === 408) return 'timeout';
  if (status >= 500) return 'server_error';
  if (/rate.?limit|too many requests|quota|RESOURCE_EXHAUSTED/i.test(err?.message || '')) return 'rate_limit';
  return 'other';
}

/**
 * True when another attempt won't fix the error: a 4xx (other than 408/429 or a rate-limit
 * message) that doesn't say the model id is gone — context too long, bad parameters, bad key,
 * no credit. Errors without a status (network failures) are retryable.
 */
export function isNonRetryable(err) {
  if (classifyError(err) !== 'other') return false;
  const status = Number(err?.status);
  if (!(status >= 400 && status < 500)) return false;
  return !MODEL_GONE_RE.test(err?.message || '');
}

async function loadCandidates(requestedModelId) {
  const [[requestedRows], [rankedRows]] = await Promise.all([
    pool.execute(`SELECT ${MODEL_CONFIG_COLUMNS} FROM models WHERE model_id = ? LIMIT 1`, [requestedModelId]),
    pool.execute(
      `SELECT ${MODEL_CONFIG_COLUMNS} FROM models
        WHERE enabled = 1 AND default_model > 0
        ORDER BY default_model, model_id`
    ),
  ]);
  const requested = requestedRows[0] || { model_id: requestedModelId, vendor: null };
  return [requested, ...rankedRows.filter((m) => m.model_id !== requestedModelId)];
}

/** The guard error (cost cap, no key, unpriced) a call to this candidate would throw, or null. */
async function guardErrorFor(candidate, instructorId) {
  try {
    await assertWithinCostCap(instructorId, candidate.model_id);
    await resolveProviderKey(detectProvider(candidate.model_id, candidate.vendor), instructorId);
    return null;
  } catch (err) {
    return STOP_CODES.has(err?.code) || SKIP_BACKUP_CODES.has(err?.code) ? err : null;
  }
}

function recordFailures(failures, { servedByModelId, caseChatId, sectionId, instructorId }) {
  if (failures.length === 0) return;
  const placeholders = failures.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
  const params = failures.flatMap((f) => [
    caseChatId || null,
    sectionId || null,
    instructorId || null,
    f.modelId,
    f.errorKind,
    Number.isInteger(f.status) && f.status > 0 && f.status < 1000 ? f.status : null,
    (f.message || '').slice(0, 500),
    servedByModelId || null,
  ]);
  pool
    .execute(
      `INSERT INTO model_failures
         (case_chat_id, section_id, instructor_id, model_id, error_kind, http_status, message, served_by_model_id)
       VALUES ${placeholders}`,
      params
    )
    .catch((e) => console.error('[ChatFallback] failed to record model_failures:', e.message));
}

// ---------------------------------------------------------------------------
// chatWithFallback
// ---------------------------------------------------------------------------

/**
 * Same inputs as chatWithLLM, minus `vendor` (looked up per candidate). `config` carries
 * instructorId, sectionId, caseId, purpose, and optionally caseChatId (for model_failures).
 *
 * @returns {Promise<{ text: string, meta: object, modelIdUsed: string, requestedModelId: string,
 *   backup: boolean, attempts: Array<{modelId: string, errorKind: string, status: number|null, message: string}> }>}
 */
export async function chatWithFallback({ modelId, systemPrompt, history = [], message, config = {} }) {
  const { instructorId, sectionId, caseChatId } = config;
  const startedAt = Date.now();
  const all = await loadCandidates(modelId);
  const isOpen = (m) => isBreakerOpen(breakerKey(m.model_id, instructorId), startedAt);
  const open = all.filter(isOpen);
  if (open.length > 0) {
    console.warn(`[ChatFallback] trying ${open.map((m) => m.model_id).join(', ')} last (breaker open)`);
  }
  const candidates = [...all.filter((m) => !isOpen(m)), ...open];

  // Backups are guard-checked before use (memoized). The requested model is not: its guard
  // errors must come from the real call so the route's 409 messages still apply.
  const guardChecks = new Map();
  const guardError = (c) => {
    if (c.model_id === modelId) return Promise.resolve(null);
    if (!guardChecks.has(c.model_id)) guardChecks.set(c.model_id, guardErrorFor(c, instructorId));
    return guardChecks.get(c.model_id);
  };

  const failures = [];
  const done = (servedByModelId) =>
    recordFailures(failures, { servedByModelId, caseChatId, sectionId, instructorId });
  let lastError = null;
  let attemptsMade = 0;

  for (let i = 0; i < candidates.length && attemptsMade < MAX_ATTEMPTS; i++) {
    const candidate = candidates[i];
    const isRequested = candidate.model_id === modelId;

    const blocked = await guardError(candidate);
    if (blocked) {
      if (STOP_CODES.has(blocked.code)) {
        done(null);
        throw blocked;
      }
      console.warn(`[ChatFallback] backup ${candidate.model_id} unavailable: ${blocked.code}`);
      lastError = lastError || blocked;
      continue;
    }

    const remaining = TOTAL_BUDGET_MS - (Date.now() - startedAt);
    if (attemptsMade > 0 && remaining < MIN_ATTEMPT_MS) break;

    // Cap this attempt at ATTEMPT_TIMEOUT_MS only if some later candidate could take over.
    let hasLaterCandidate = false;
    if (attemptsMade < MAX_ATTEMPTS - 1) {
      for (let j = i + 1; j < candidates.length && !hasLaterCandidate; j++) {
        hasLaterCandidate = !(await guardError(candidates[j]));
      }
    }
    const timeoutMs = Math.max(1, hasLaterCandidate ? Math.min(ATTEMPT_TIMEOUT_MS, remaining) : remaining);
    const signal = AbortSignal.timeout(timeoutMs);
    const key = breakerKey(candidate.model_id, instructorId);
    const { vendor, ...modelConfig } = candidate;

    try {
      const result = await chatWithLLM({
        modelId: candidate.model_id,
        vendor,
        systemPrompt,
        history,
        message,
        config: { ...modelConfig, ...config, signal },
      });
      noteSuccess(key);
      if (!isRequested) {
        console.warn(`[ChatFallback] ${modelId} -> answered by backup ${candidate.model_id} (section ${sectionId || '-'})`);
      }
      done(candidate.model_id);
      return {
        text: result.text,
        meta: result.meta,
        modelIdUsed: candidate.model_id,
        requestedModelId: modelId,
        backup: !isRequested,
        attempts: failures,
      };
    } catch (err) {
      if (STOP_CODES.has(err?.code)) {
        done(null);
        throw err;
      }
      if (SKIP_BACKUP_CODES.has(err?.code)) {
        if (isRequested) {
          done(null);
          throw err;
        }
        console.warn(`[ChatFallback] backup ${candidate.model_id} unavailable: ${err.code}`);
        lastError = lastError || err;
        continue;
      }
      attemptsMade++;
      lastError = err;
      if (signal.aborted) {
        // Abandoned, not refused: the provider may still bill it.
        trackAbandonedChat({ modelId: candidate.model_id, vendor, systemPrompt, history, message, config });
      }
      const errorKind = classifyError(err);
      failures.push({
        modelId: candidate.model_id,
        errorKind,
        status: Number.isInteger(err?.status) ? err.status : null,
        message: err?.message || String(err),
      });
      const detail = `${errorKind}${err?.status ? ` ${err.status}` : ''}`;
      if (isNonRetryable(err)) {
        console.warn(`[ChatFallback] ${candidate.model_id} failed, not retryable (${detail}): ${(err?.message || '').slice(0, 200)}`);
        if (isRequested) {
          done(null);
          throw err;
        }
        continue;
      }
      noteFailure(key, Date.now());
      console.warn(`[ChatFallback] ${candidate.model_id} failed (${detail}): ${(err?.message || '').slice(0, 200)}`);
    }
  }

  done(null);
  throw lastError || new Error('No chat model is available');
}
