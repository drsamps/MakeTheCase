/**
 * Per-instructor weekly dollar cap (replaces the old monthly token cap).
 *
 * Enforced ONLY when an instructor has use_system_key=1 (i.e. their LLM calls
 * are billed to the system key, not their own provider key). BYO-key
 * instructors are exempt because their spend is on their own card; an admin
 * setting a cap on a BYO row is harmless — the guard stays a no-op.
 *
 * Cap window: ISO week, Monday 00:00:00 – Sunday 23:59:59 America/Denver.
 * Week bounds are computed in app code (TZ-aware) and the UTC instants are
 * what's passed to MySQL — the DB itself stores timestamps in UTC.
 *
 * Race condition: cap is checked at request entry and the cost is written
 * after the call returns. Two concurrent calls can both pass the check and
 * push the total slightly over cap. Accepted for v1 — bounded by
 * (concurrent_calls × per_call_cost), which for typical $0.02 calls is
 * rounding error against a $10 cap. A v2 reservation/pre-charge model can
 * eliminate the overshoot if it ever becomes meaningful in production.
 *
 * Cost source: SUM(est_cost_usd) from model_usage. Rows with NULL est_cost_usd
 * (unpriced models) are excluded — see `allow_unpriced_llm_calls` setting +
 * UnpricedModelBlockedError below for the policy on those calls.
 */
import { pool } from '../db.js';

const TZ = 'America/Denver';

export class UsageCostCapExceededError extends Error {
  constructor(instructorId, used, cap) {
    super(`Instructor ${instructorId} has reached the weekly AI usage cap ($${used.toFixed(4)} / $${cap.toFixed(2)}).`);
    this.name = 'UsageCostCapExceededError';
    this.code = 'INSTRUCTOR_COST_CAP_EXCEEDED';
    this.instructorId = instructorId;
    this.used = used;
    this.cap = cap;
  }
}

export class UnpricedModelBlockedError extends Error {
  constructor(modelId) {
    super(`Model ${modelId} has no pricing configured and unpriced calls are disabled by admin setting.`);
    this.name = 'UnpricedModelBlockedError';
    this.code = 'MODEL_UNPRICED';
    this.modelId = modelId;
  }
}

/**
 * Return the Monday 00:00 (TZ-local) and the following Monday 00:00 (TZ-local)
 * surrounding `now`, both as UTC Date objects suitable for MySQL.
 *
 * Algorithm: format `now` in the target TZ, parse year/month/day/weekday,
 * compute the Monday-of-week date, then convert back to UTC by walking through
 * a TZ-aware ISO string. This avoids any dependency on Intl.DateTimeFormat
 * quirks beyond `formatToParts` (broadly supported in Node 18+).
 */
export function currentWeekBounds(now = new Date()) {
  // Get TZ-local Y/M/D + weekday for `now`.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]));
  const year  = Number(parts.year);
  const month = Number(parts.month);
  const day   = Number(parts.day);
  // weekday short: Sun, Mon, Tue, ...
  const weekdayIdx = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  // Days since Monday (Mon=0, Sun=6).
  const daysSinceMonday = (weekdayIdx + 6) % 7;

  // TZ-local midnight for the Monday of this week.
  const mondayLocal = new Date(Date.UTC(year, month - 1, day - daysSinceMonday, 0, 0, 0));
  const nextMondayLocal = new Date(Date.UTC(year, month - 1, day - daysSinceMonday + 7, 0, 0, 0));

  // We constructed those as if UTC, but they actually represent TZ-local
  // midnight. Convert by finding the offset between the constructed instant
  // (interpreted as UTC) and what that wall time means in our TZ.
  const weekStart = shiftToZone(mondayLocal, TZ);
  const weekEnd   = shiftToZone(nextMondayLocal, TZ);
  return { weekStart, weekEnd };
}

/**
 * Treat `dateAsUtc` as a wall-clock time in `zone` and return the actual UTC
 * instant. Done by computing the offset between the wall-time and UTC at that
 * moment, then subtracting it.
 */
function shiftToZone(dateAsUtc, zone) {
  const offsetMin = tzOffsetMinutes(dateAsUtc, zone);
  return new Date(dateAsUtc.getTime() - offsetMin * 60_000);
}

/**
 * Offset in minutes for `instant` in `zone`. Positive west of UTC (MT = +360 / +420).
 */
function tzOffsetMinutes(instant, zone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = Object.fromEntries(dtf.formatToParts(instant).map(p => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second)
  );
  // (asUtc - instant) = local wall clock minus actual UTC instant.
  // Negative west of UTC (e.g. MDT returns -360, MST returns -420).
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/**
 * Return current-week dollar usage for an instructor along with the cap and
 * computed warning threshold.
 *
 * @returns {Promise<{
 *   costUsed:number, cap:number|null, warnPct:number, warnThreshold:number|null,
 *   capActive:boolean, overWarning:boolean, overCap:boolean, useSystemKey:boolean,
 *   weekStart:Date, weekEnd:Date
 * }>}
 */
export async function getWeeklyUsage(instructorId) {
  const { weekStart, weekEnd } = currentWeekBounds();

  if (!instructorId) {
    return {
      costUsed: 0, cap: null, warnPct: 80, warnThreshold: null,
      capActive: false, overWarning: false, overCap: false, useSystemKey: false,
      weekStart, weekEnd,
    };
  }

  const [iRows] = await pool.execute(
    'SELECT use_system_key, weekly_ai_usage_cap, weekly_ai_usage_warning_pct FROM instructors WHERE id = ? LIMIT 1',
    [instructorId]
  );
  if (iRows.length === 0) {
    return {
      costUsed: 0, cap: null, warnPct: 80, warnThreshold: null,
      capActive: false, overWarning: false, overCap: false, useSystemKey: false,
      weekStart, weekEnd,
    };
  }

  const useSystemKey = iRows[0].use_system_key === 1;
  const cap = iRows[0].weekly_ai_usage_cap == null ? null : Number(iRows[0].weekly_ai_usage_cap);
  const warnPct = iRows[0].weekly_ai_usage_warning_pct == null ? 80 : Number(iRows[0].weekly_ai_usage_warning_pct);
  const capActive = useSystemKey && cap !== null && cap > 0;

  const [sumRows] = await pool.execute(
    `SELECT COALESCE(SUM(est_cost_usd), 0) AS cost
       FROM model_usage
      WHERE instructor_id = ?
        AND created_at >= ?
        AND created_at <  ?`,
    [instructorId, weekStart, weekEnd]
  );
  const costUsed = Number(sumRows[0]?.cost || 0);

  const warnThreshold = cap !== null ? (cap * warnPct) / 100 : null;
  const overWarning = capActive && warnThreshold != null && costUsed >= warnThreshold;
  const overCap = capActive && costUsed >= cap;

  return {
    costUsed, cap, warnPct, warnThreshold,
    capActive, overWarning, overCap, useSystemKey,
    weekStart, weekEnd,
  };
}

/**
 * Throws UsageCostCapExceededError if the instructor is over their weekly cap.
 * No-op when cap is not active (BYO key, no cap set, instructorId null).
 *
 * Optionally checks the unpriced-model policy when `modelId` is provided:
 * if the global setting `allow_unpriced_llm_calls` is false AND the model has
 * no pricing configured (cpm_input AND cpm_output both NULL), throws
 * UnpricedModelBlockedError regardless of cap state.
 */
export async function assertWithinCostCap(instructorId, modelId = null) {
  if (modelId) await assertModelIsPricedIfRequired(modelId);

  if (!instructorId) return;
  const { costUsed, cap, capActive } = await getWeeklyUsage(instructorId);
  if (capActive && costUsed >= cap) {
    throw new UsageCostCapExceededError(instructorId, costUsed, cap);
  }
}

async function assertModelIsPricedIfRequired(modelId) {
  const allow = await getAllowUnpricedSetting();
  if (allow) return;

  const [rows] = await pool.execute(
    'SELECT cpm_input, cpm_output FROM models WHERE model_id = ? LIMIT 1',
    [modelId]
  );
  if (!rows.length) return; // model row missing; let downstream handle
  const { cpm_input, cpm_output } = rows[0];
  if (cpm_input == null && cpm_output == null) {
    throw new UnpricedModelBlockedError(modelId);
  }
}

let _allowUnpricedCache = null;
let _allowUnpricedCacheAt = 0;
const ALLOW_UNPRICED_TTL_MS = 30_000;

async function getAllowUnpricedSetting() {
  const now = Date.now();
  if (_allowUnpricedCache !== null && now - _allowUnpricedCacheAt < ALLOW_UNPRICED_TTL_MS) {
    return _allowUnpricedCache;
  }
  try {
    const [rows] = await pool.execute(
      `SELECT setting_value FROM settings
        WHERE setting_key = 'allow_unpriced_llm_calls' AND scope = 'global' LIMIT 1`
    );
    const raw = rows[0]?.setting_value;
    _allowUnpricedCache = raw == null ? true : raw !== 'false';
    _allowUnpricedCacheAt = now;
    return _allowUnpricedCache;
  } catch {
    return true; // fail open
  }
}
