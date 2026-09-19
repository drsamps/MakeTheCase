/**
 * model_usage writer + cost computation.
 *
 * Cost source by provider:
 *   - openrouter: usage.cost directly (authoritative, requires `usage: { include: true }`)
 *   - openai / anthropic / google: tokens times models.cpm_* divided by 1,000,000 at insert time
 *   - unpriced (cpm_* all NULL): est_cost_usd stored as NULL
 *
 * Writes are fire-and-forget — failures log as MODEL_USAGE_WRITE_FAILED but
 * never throw, so a DB outage can't break an LLM call that already happened.
 */
import { pool } from '../db.js';

// Cache-read price as a fraction of the input rate, used ONLY when a model row has no
// cpm_input_cache configured. Published vendor discounts; unlisted providers pay full rate.
const CACHE_DISCOUNT_FALLBACK = { anthropic: 0.10, openai: 0.50, openrouter: 0.50, google: 1.0 };

/**
 * Normalize a provider's raw usage payload into {input, cached, output, reasoning}
 * token counts. Field names differ per provider; this is the single point where
 * those differences are flattened.
 *
 * Anthropic v1 approximation: cache_creation_input_tokens (cache write, ~1.25×
 * input rate in reality) is rolled into `input` and billed at the regular input
 * rate. Slight under-pricing of writes is accepted for v1 simplicity; v2 may
 * add cpm_input_cache_write if drift becomes meaningful.
 */
export function normalizeUsageTokens(provider, raw) {
  if (!raw) return { input: 0, cached: 0, output: 0, reasoning: 0 };

  if (provider === 'google') {
    return {
      input:     raw.promptTokenCount         || 0,
      cached:    raw.cachedContentTokenCount  || 0,
      output:    raw.candidatesTokenCount     || 0,
      reasoning: raw.thoughtsTokenCount       || 0,
    };
  }
  if (provider === 'anthropic') {
    return {
      input:     (raw.input_tokens || 0) + (raw.cache_creation_input_tokens || 0),
      cached:    raw.cache_read_input_tokens || 0,
      output:    raw.output_tokens           || 0,
      reasoning: 0,
    };
  }
  // openai + openrouter (when usage.cost is absent and we fall through)
  return {
    input:     raw.prompt_tokens                                || 0,
    cached:    raw.prompt_tokens_details?.cached_tokens
               ?? raw.cached_tokens                             ?? 0,
    output:    raw.completion_tokens                            || 0,
    reasoning: raw.completion_tokens_details?.reasoning_tokens  || 0,
  };
}

/**
 * Compute est_cost_usd at call time.
 *   - OpenRouter: use raw.cost when present (authoritative, includes their margin)
 *   - Direct providers: tokens times cpm_* divided by 1M, summed across input/cached/output
 *     (plus reasoning for google only — see billableOutput below)
 *   - Returns null when no pricing is configured (caller stores NULL)
 *
 * @param {string} provider — openai | anthropic | google | openrouter
 * @param {object|null} rawUsage — provider's usage blob
 * @param {object} modelConfig — { cpm_input, cpm_input_cache, cpm_output }
 * @returns {number|null}
 */
export function computeEstCost(provider, rawUsage, modelConfig = {}) {
  if (provider === 'openrouter' && rawUsage?.cost != null) {
    const n = Number(rawUsage.cost);
    return Number.isFinite(n) ? n : null;
  }
  const cpmIn = modelConfig.cpm_input != null ? Number(modelConfig.cpm_input) : null;
  const cpmCache = modelConfig.cpm_input_cache != null ? Number(modelConfig.cpm_input_cache) : null;
  const cpmOut = modelConfig.cpm_output != null ? Number(modelConfig.cpm_output) : null;

  if (cpmIn == null && cpmOut == null) return null;

  const tokens = normalizeUsageTokens(provider, rawUsage);
  const isOpenAIFamily = provider === 'openai' || provider === 'openrouter';

  // openai/openrouter report cached_tokens as a SUBSET of prompt_tokens (verified live:
  // 1408 cached inside 1621 prompt), so only the uncached remainder may be charged at the
  // full input rate — otherwise the cached tokens are billed twice.
  // anthropic's input_tokens already EXCLUDES cache reads, and google's cached path is
  // unverified, so both keep the original plain sum.
  const billableInput = isOpenAIFamily ? Math.max(0, tokens.input - tokens.cached) : tokens.input;
  // Cached tokens must never be silently free. When cpm_input_cache is unset, fall back to
  // the input rate times the provider's published cache discount (same approximation used
  // in promptLogger.js#calculateCost) — configuring cpm_input_cache is still the real fix.
  const cacheDiscount = CACHE_DISCOUNT_FALLBACK[provider] ?? 1;
  const cacheRate = cpmCache ?? (cpmIn != null ? cpmIn * cacheDiscount : 0);

  // Whether reasoning tokens are already inside the output count is provider-specific,
  // so they can only be added for the providers that report them separately:
  //   google — thoughtsTokenCount is EXCLUDED from candidatesTokenCount, so it must be
  //     added (verified live: prompt 38 + candidates 5 + thoughts 394 = total 437).
  //   openai/openrouter — reasoning_tokens is a SUBSET of completion_tokens, so adding
  //     it would bill the same tokens twice (verified live: prompt 41 + completion 141
  //     = total 182, with reasoning_tokens 128 inside that 141).
  //   anthropic — reports no separate reasoning count (always 0 here).
  const billableOutput = provider === 'google'
    ? tokens.output + tokens.reasoning
    : tokens.output;
  const cost =
    (billableInput  * (cpmIn ?? 0)) +
    (tokens.cached  * cacheRate) +
    (billableOutput * (cpmOut ?? 0));
  return cost / 1_000_000;
}

/**
 * Look up cpm_* pricing for a model. Returns {} if not found — caller treats
 * that as "unpriced". Cheap lookup; could be cached if hot.
 */
export async function getModelPricing(modelId) {
  if (!modelId) return {};
  try {
    const [rows] = await pool.execute(
      'SELECT cpm_input, cpm_input_cache, cpm_output FROM models WHERE model_id = ? LIMIT 1',
      [modelId]
    );
    return rows[0] || {};
  } catch (e) {
    console.warn('[modelUsageWriter] getModelPricing failed:', e.message);
    return {};
  }
}

/**
 * Insert a model_usage row. Fire-and-forget — never throws.
 *
 * @param {object} params
 * @param {string} params.purpose — student_chat | evaluation | case_writer | case_prep | position_inference | model_test | issue_analytics
 * @param {string|null} params.caseId
 * @param {string|null} params.projectId
 * @param {string|null} params.sectionId
 * @param {string} params.modelId
 * @param {string} params.provider — openai | anthropic | google | openrouter
 * @param {string|null} params.instructorId
 * @param {boolean} params.useSystemKey
 * @param {boolean} params.cacheHit
 * @param {number|null} params.estCostUsd
 * @param {object|null} params.rawUsage — provider usage blob (stored as JSON)
 */
export async function writeModelUsage({
  purpose,
  caseId = null,
  projectId = null,
  sectionId = null,
  modelId,
  provider,
  instructorId = null,
  useSystemKey = false,
  cacheHit = false,
  estCostUsd = null,
  rawUsage = null,
}) {
  if (!purpose || !modelId || !provider) {
    console.error('[MODEL_USAGE_WRITE_FAILED] missing required field', { purpose, modelId, provider });
    return;
  }
  try {
    await pool.execute(
      `INSERT INTO model_usage (
         purpose, case_id, project_id, section_id,
         model_id, provider, instructor_id, use_system_key,
         cache_hit, est_cost_usd, raw_usage
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        purpose,
        caseId || null,
        projectId || null,
        sectionId || null,
        modelId,
        provider,
        instructorId || null,
        useSystemKey ? 1 : 0,
        cacheHit ? 1 : 0,
        estCostUsd == null ? null : Number(estCostUsd),
        rawUsage == null ? null : JSON.stringify(rawUsage),
      ]
    );
  } catch (e) {
    console.error('[MODEL_USAGE_WRITE_FAILED]', {
      purpose, modelId, provider, instructorId, error: e.message,
    });
  }
}
