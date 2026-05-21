/**
 * AI Usage routes — cost-first reporting on the model_usage table.
 *
 * All endpoints scope to `getEffectiveInstructorId(req)`:
 *   instructor                  -> their own rows
 *   admin (impersonating)       -> impersonated instructor's rows
 *   admin (not impersonating)   -> all rows (god mode)
 *
 * Admins can also pass ?instructor_id=X to filter to a specific instructor.
 */

import express from 'express';
import { pool } from '../db.js';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { requireAdminOrInstructor } from '../middleware/instructorAccess.js';
import { getEffectiveInstructorId, hasAdminVision } from '../services/resourceAccess.js';
import { getWeeklyUsage, currentWeekBounds } from '../services/usageGuard.js';

const router = express.Router();

const VALID_PERIODS = new Set(['this_week', 'last_week', 'last_7_days', 'last_30_days', 'last_90_days']);

const DISPLAY_TZ = 'America/Denver';

/**
 * Return today's date in the display TZ as a UTC midnight Date object, plus
 * the current TZ offset in hours (positive west of UTC; 6 for MDT, 7 for MST).
 * The offset lets us shift SQL's UTC-bucketed DATE() so chat rows fall into
 * the same bar a human would put them in when reading their wall clock.
 */
function todayInDisplayTz() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: DISPLAY_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]));
  const y = Number(parts.year), m = Number(parts.month), d = Number(parts.day);
  const today = new Date(Date.UTC(y, m - 1, d));

  // Compute MT offset (in hours) for the current instant.
  const localAsUtc = Date.UTC(
    y, m - 1, d,
    Number(parts.hour), Number(parts.minute), Number(parts.second)
  );
  const offsetHours = Math.round((localAsUtc - now.getTime()) / 3_600_000) * -1;
  return { today, offsetHours };
}

function toUtcDayString(d) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Fill `rows` (output of the daily GROUP BY) into a contiguous date range so
 * the sparkline shows zero-cost days too. `start` is inclusive, `end` exclusive
 * — both are UTC instants; we bucket by UTC date to match the SQL DATE().
 */
function fillDailyRange(start, end, rows) {
  const byDay = new Map();
  for (const r of rows) {
    let day = r.day;
    if (day instanceof Date) day = toUtcDayString(day);
    byDay.set(day, { calls: Number(r.calls), cost: Number(r.cost) });
  }
  const out = [];
  const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const stop = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  while (cur < stop) {
    const key = toUtcDayString(cur);
    const hit = byDay.get(key);
    out.push({ day: key, calls: hit?.calls || 0, cost: hit?.cost || 0 });
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/**
 * Display period bounds for the AI Usage chart. All windows are UTC-date
 * aligned (start = inclusive UTC midnight, end = exclusive UTC midnight) so
 * the day buckets match the SQL DATE() grouping and fillDailyRange produces
 * exactly the expected count of bars.
 *
 * Note: this is intentionally separate from the cap window in usageGuard.js
 * (Mon 00:00 America/Denver), which still drives the dollar cap. The display
 * weeks here run Sunday–Saturday because that's how the user reads a calendar
 * — the cap is enforced on a different schedule.
 */
function resolvePeriodBounds(period) {
  const { today, offsetHours } = todayInDisplayTz();
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  if (period === 'this_week') {
    const sunday = new Date(today);
    sunday.setUTCDate(sunday.getUTCDate() - today.getUTCDay());
    const nextSunday = new Date(sunday);
    nextSunday.setUTCDate(nextSunday.getUTCDate() + 7);
    return { start: sunday, end: nextSunday, label: 'This week (Sun–Sat)', offsetHours };
  }
  if (period === 'last_week') {
    const sunday = new Date(today);
    sunday.setUTCDate(sunday.getUTCDate() - today.getUTCDay() - 7);
    const nextSunday = new Date(sunday);
    nextSunday.setUTCDate(nextSunday.getUTCDate() + 7);
    return { start: sunday, end: nextSunday, label: 'Last week (Sun–Sat)', offsetHours };
  }
  if (period === 'last_7_days') {
    const start = new Date(today);
    start.setUTCDate(start.getUTCDate() - 6);
    return { start, end: tomorrow, label: 'Last 7 days', offsetHours };
  }
  if (period === 'last_30_days') {
    const start = new Date(today);
    start.setUTCDate(start.getUTCDate() - 29);
    return { start, end: tomorrow, label: 'Last 30 days', offsetHours };
  }
  if (period === 'last_90_days') {
    const start = new Date(today);
    start.setUTCDate(start.getUTCDate() - 89);
    return { start, end: tomorrow, label: 'Last 90 days', offsetHours };
  }
  // fallback: this week
  const sunday = new Date(today);
  sunday.setUTCDate(sunday.getUTCDate() - today.getUTCDay());
  const nextSunday = new Date(sunday);
  nextSunday.setUTCDate(nextSunday.getUTCDate() + 7);
  return { start: sunday, end: nextSunday, label: 'This week (Sun–Sat)', offsetHours };
}

/**
 * Resolve the instructor-id scope filter for the request.
 *
 * Returns { instructorId, isGlobalAdminView }:
 *   instructorId == null + isGlobalAdminView=true  -> show all rows
 *   instructorId == string                          -> filter to that instructor
 */
function resolveScope(req) {
  const effective = getEffectiveInstructorId(req);
  const queryInstructorId = req.query.instructor_id || null;

  if (effective) {
    if (queryInstructorId && queryInstructorId !== effective) {
      const err = new Error('You can only view your own usage');
      err.status = 403;
      throw err;
    }
    return { instructorId: effective, isGlobalAdminView: false };
  }

  if (queryInstructorId) {
    return { instructorId: queryInstructorId, isGlobalAdminView: false };
  }
  return { instructorId: null, isGlobalAdminView: true };
}

/**
 * GET /api/usage/weekly-status
 * Compact cap+usage summary for the cap bar / banner.
 */
router.get('/weekly-status', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const { instructorId, isGlobalAdminView } = resolveScope(req);

    if (isGlobalAdminView) {
      const { weekStart, weekEnd } = currentWeekBounds();
      const [[row]] = await pool.execute(
        `SELECT COALESCE(SUM(est_cost_usd), 0) AS cost,
                COUNT(*) AS calls
           FROM model_usage
          WHERE created_at >= ? AND created_at < ?`,
        [weekStart, weekEnd]
      );
      return res.json({
        data: {
          scope: 'global',
          weekStart, weekEnd,
          costUsed: Number(row.cost || 0),
          callCount: Number(row.calls || 0),
          cap: null, warnPct: null, warnThreshold: null,
          capActive: false, overWarning: false, overCap: false,
        },
        error: null,
      });
    }

    const status = await getWeeklyUsage(instructorId);
    res.json({ data: { scope: 'instructor', instructorId, ...status }, error: null });
  } catch (error) {
    const status = error.status || 500;
    if (status !== 500) return res.status(status).json({ error: error.message });
    console.error('Error fetching weekly status:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

/**
 * GET /api/usage
 * Detail breakdown: by-purpose, by-model, by-section, daily sparkline.
 *
 * Query params:
 *   period      this_week | last_week | last_7_days | last_30_days | last_90_days
 *   instructor_id  (admin-only filter)
 */
router.get('/', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const { instructorId, isGlobalAdminView } = resolveScope(req);
    const period = VALID_PERIODS.has(req.query.period) ? req.query.period : 'this_week';
    const { start, end, label, offsetHours } = resolvePeriodBounds(period);

    // start/end are UTC-midnight stand-ins for MT calendar dates. Shift by
    // offsetHours to get the real UTC instants of MT-midnight on those dates,
    // so a late-evening MT chat (which is "tomorrow" in raw UTC) isn't dropped.
    const startUtc = new Date(start.getTime() + offsetHours * 3_600_000);
    const endUtc = new Date(end.getTime() + offsetHours * 3_600_000);

    const scopeClause = isGlobalAdminView
      ? 'created_at >= ? AND created_at < ?'
      : 'instructor_id = ? AND created_at >= ? AND created_at < ?';
    const scopeParams = isGlobalAdminView ? [startUtc, endUtc] : [instructorId, startUtc, endUtc];

    // Totals + cache hit rate
    const [[totals]] = await pool.execute(
      `SELECT COUNT(*) AS calls,
              COALESCE(SUM(est_cost_usd), 0) AS cost,
              SUM(CASE WHEN cache_hit = 1 THEN 1 ELSE 0 END) AS cache_hits,
              SUM(CASE WHEN est_cost_usd IS NULL THEN 1 ELSE 0 END) AS unpriced_calls
         FROM model_usage WHERE ${scopeClause}`,
      scopeParams
    );

    // By purpose
    const [byPurpose] = await pool.execute(
      `SELECT purpose,
              COUNT(*) AS calls,
              COALESCE(SUM(est_cost_usd), 0) AS cost
         FROM model_usage WHERE ${scopeClause}
        GROUP BY purpose
        ORDER BY cost DESC`,
      scopeParams
    );

    // By model
    const [byModel] = await pool.execute(
      `SELECT model_id, provider,
              COUNT(*) AS calls,
              COALESCE(SUM(est_cost_usd), 0) AS cost
         FROM model_usage WHERE ${scopeClause}
        GROUP BY model_id, provider
        ORDER BY cost DESC
        LIMIT 50`,
      scopeParams
    );

    // By section (only meaningful rows — section_id IS NOT NULL)
    const [bySection] = await pool.execute(
      `SELECT mu.section_id,
              COALESCE(s.section_title, mu.section_id) AS section_title,
              c.course_name,
              COUNT(*) AS calls,
              COALESCE(SUM(mu.est_cost_usd), 0) AS cost
         FROM model_usage mu
         LEFT JOIN sections s ON s.section_id = mu.section_id
         LEFT JOIN courses c  ON s.course_id  = c.id
        WHERE ${scopeClause.replace(/(?<![\w.])(created_at|instructor_id)/g, 'mu.$1')}
          AND mu.section_id IS NOT NULL
        GROUP BY mu.section_id, s.section_title, c.course_name
        ORDER BY cost DESC
        LIMIT 50`,
      scopeParams
    );

    // Daily sparkline. MySQL's CONVERT_TZ needs the named TZ tables loaded
    // (silently returns NULL otherwise), so instead we subtract the current MT
    // offset from created_at before bucketing with DATE(). That shifts e.g. a
    // 22:00 MDT chat from the UTC-Wednesday bucket back into MT-Tuesday, which
    // is the bar the user expects to see it in.
    const [daily] = await pool.execute(
      `SELECT DATE(created_at - INTERVAL ? HOUR) AS day,
              COUNT(*) AS calls,
              COALESCE(SUM(est_cost_usd), 0) AS cost
         FROM model_usage WHERE ${scopeClause}
        GROUP BY day
        ORDER BY day ASC`,
      [offsetHours, ...scopeParams]
    );

    // Admin "all instructors" leaderboard
    let byInstructor = null;
    if (isGlobalAdminView) {
      const [rows] = await pool.execute(
        `SELECT mu.instructor_id,
                i.email, i.full_name,
                COUNT(*) AS calls,
                COALESCE(SUM(mu.est_cost_usd), 0) AS cost
           FROM model_usage mu
           LEFT JOIN instructors i ON i.id = mu.instructor_id
          WHERE mu.created_at >= ? AND mu.created_at < ?
          GROUP BY mu.instructor_id, i.email, i.full_name
          ORDER BY cost DESC
          LIMIT 100`,
        [startUtc, endUtc]
      );
      byInstructor = rows.map(r => ({
        instructor_id: r.instructor_id,
        email: r.email,
        full_name: r.full_name,
        calls: Number(r.calls),
        cost: Number(r.cost),
      }));
    }

    const callCount = Number(totals.calls || 0);
    const cacheHits = Number(totals.cache_hits || 0);

    res.json({
      data: {
        scope: isGlobalAdminView ? 'global' : 'instructor',
        instructorId: instructorId || null,
        period, periodLabel: label, start, end,
        totals: {
          callCount,
          cost: Number(totals.cost || 0),
          cacheHits,
          cacheHitRate: callCount > 0 ? cacheHits / callCount : 0,
          unpricedCalls: Number(totals.unpriced_calls || 0),
        },
        byPurpose: byPurpose.map(r => ({ purpose: r.purpose, calls: Number(r.calls), cost: Number(r.cost) })),
        byModel: byModel.map(r => ({ model_id: r.model_id, provider: r.provider, calls: Number(r.calls), cost: Number(r.cost) })),
        bySection: bySection.map(r => ({
          section_id: r.section_id, section_title: r.section_title, course_name: r.course_name,
          calls: Number(r.calls), cost: Number(r.cost),
        })),
        daily: fillDailyRange(start, end, daily),
        byInstructor,
      },
      error: null,
    });
  } catch (error) {
    const status = error.status || 500;
    if (status !== 500) return res.status(status).json({ error: error.message });
    console.error('Error fetching usage detail:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

/**
 * GET /api/usage/export — CSV download of raw rows in window.
 */
router.get('/export', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const { instructorId, isGlobalAdminView } = resolveScope(req);
    const period = VALID_PERIODS.has(req.query.period) ? req.query.period : 'this_week';
    const { start, end, offsetHours } = resolvePeriodBounds(period);
    const startUtc = new Date(start.getTime() + offsetHours * 3_600_000);
    const endUtc = new Date(end.getTime() + offsetHours * 3_600_000);

    const scopeClause = isGlobalAdminView
      ? 'created_at >= ? AND created_at < ?'
      : 'instructor_id = ? AND created_at >= ? AND created_at < ?';
    const scopeParams = isGlobalAdminView ? [startUtc, endUtc] : [instructorId, startUtc, endUtc];

    const [rows] = await pool.execute(
      `SELECT created_at, purpose, model_id, provider, instructor_id,
              section_id, case_id, project_id,
              use_system_key, cache_hit, est_cost_usd
         FROM model_usage WHERE ${scopeClause}
        ORDER BY created_at ASC
        LIMIT 50000`,
      scopeParams
    );

    const header = [
      'created_at_utc', 'purpose', 'model_id', 'provider', 'instructor_id',
      'section_id', 'case_id', 'project_id',
      'use_system_key', 'cache_hit', 'est_cost_usd'
    ];
    const escape = (v) => {
      if (v == null) return '';
      const s = String(v);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };
    const lines = [header.join(',')];
    for (const r of rows) {
      lines.push([
        r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
        r.purpose, r.model_id, r.provider, r.instructor_id || '',
        r.section_id || '', r.case_id || '', r.project_id || '',
        r.use_system_key ? '1' : '0', r.cache_hit ? '1' : '0',
        r.est_cost_usd == null ? '' : Number(r.est_cost_usd).toFixed(6),
      ].map(escape).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ai-usage-${period}.csv"`);
    res.send(lines.join('\n'));
  } catch (error) {
    const status = error.status || 500;
    if (status !== 500) return res.status(status).json({ error: error.message });
    console.error('Error exporting usage CSV:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

/**
 * PATCH /api/usage/warning-pct — instructor sets their own warning threshold.
 * (Same as PATCH /api/instructors/:id with weekly_ai_usage_warning_pct, but
 * scoped to the current user and doesn't require knowing the id.)
 */
router.patch('/warning-pct', verifyToken, requireRole(['instructor', 'admin']), async (req, res) => {
  try {
    const id = req.user.id;
    if (req.user.role !== 'instructor') {
      return res.status(400).json({ error: 'Only instructors have a personal warning threshold' });
    }
    const { weekly_ai_usage_warning_pct } = req.body || {};
    const pct = weekly_ai_usage_warning_pct === null || weekly_ai_usage_warning_pct === ''
      ? null
      : Number(weekly_ai_usage_warning_pct);
    if (pct !== null && (!Number.isFinite(pct) || pct < 0 || pct > 100)) {
      return res.status(400).json({ error: 'weekly_ai_usage_warning_pct must be between 0 and 100' });
    }
    await pool.execute(
      'UPDATE instructors SET weekly_ai_usage_warning_pct = ? WHERE id = ?',
      [pct == null ? 80 : pct, id]
    );
    res.json({ data: { weekly_ai_usage_warning_pct: pct == null ? 80 : pct }, error: null });
  } catch (error) {
    console.error('Error updating warning pct:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

export default router;
