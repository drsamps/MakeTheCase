/**
 * Per-instructor monthly token cap (A1).
 *
 * Enforced ONLY when an instructor has use_system_key=1 (i.e. their LLM calls
 * are billed to the system key, not their own provider key). BYO-key
 * instructors are exempt because their spend is on their own card.
 *
 * monthly_token_cap = NULL means "no cap" (default).
 *
 * Total = SUM(input_tokens + cached_tokens + output_tokens) for the current
 * calendar month (server local time) from llm_cache_metrics.
 */
import { pool } from '../db.js';

export class UsageCapExceededError extends Error {
  constructor(instructorId, used, cap) {
    super(`Instructor ${instructorId} has exceeded the monthly token cap (${used}/${cap}).`);
    this.name = 'UsageCapExceededError';
    this.code = 'INSTRUCTOR_USAGE_CAP_EXCEEDED';
    this.instructorId = instructorId;
    this.used = used;
    this.cap = cap;
  }
}

/**
 * Returns { tokensUsed, cap, useSystemKey, capActive } for the current month.
 *  - capActive is true only when useSystemKey=1 AND cap is a positive number.
 *  - When instructorId is null/unknown, returns capActive=false (cannot cap).
 */
export async function getMonthlyUsage(instructorId) {
  if (!instructorId) {
    return { tokensUsed: 0, cap: null, useSystemKey: false, capActive: false };
  }
  const [iRows] = await pool.execute(
    'SELECT use_system_key, monthly_token_cap FROM instructors WHERE id = ? LIMIT 1',
    [instructorId]
  );
  if (iRows.length === 0) {
    return { tokensUsed: 0, cap: null, useSystemKey: false, capActive: false };
  }
  const useSystemKey = iRows[0].use_system_key === 1;
  const cap = iRows[0].monthly_token_cap == null ? null : Number(iRows[0].monthly_token_cap);
  const capActive = useSystemKey && cap !== null && cap > 0;

  const [sumRows] = await pool.execute(
    `SELECT COALESCE(SUM(COALESCE(input_tokens,0) + COALESCE(cached_tokens,0) + COALESCE(output_tokens,0)), 0) AS tokens
       FROM llm_cache_metrics
      WHERE instructor_id = ?
        AND created_at >= DATE_FORMAT(NOW(), '%Y-%m-01 00:00:00')`,
    [instructorId]
  );
  const tokensUsed = Number(sumRows[0]?.tokens || 0);
  return { tokensUsed, cap, useSystemKey, capActive };
}

/**
 * Throw UsageCapExceededError if the instructor is over their cap. No-op when
 * cap is not active (BYO key, or cap is NULL/0).
 */
export async function assertWithinUsageCap(instructorId) {
  const { tokensUsed, cap, capActive } = await getMonthlyUsage(instructorId);
  if (capActive && tokensUsed >= cap) {
    throw new UsageCapExceededError(instructorId, tokensUsed, cap);
  }
}
