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
 *   - Direct providers: tokens times cpm_* divided by 1M, summed across input/cached/output+reasoning
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
  const cost =
    (tokens.input  * (cpmIn    ?? 0)) +
    (tokens.cached * (cpmCache ?? 0)) +
    ((tokens.output + tokens.reasoning) * (cpmOut ?? 0));
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
 * @param {string} params.purpose — student_chat | evaluation | case_writer | case_prep | position_inference | model_test
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
