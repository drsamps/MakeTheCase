-- test-backfill-model-usage.sql
--
-- Copy llm_cache_metrics rows into model_usage for local UI testing of the
-- AI Usage panel. Costs are approximate (CPM from models table when present).
-- Not for production billing.
--
-- Dev database (see CLAUDE.md):
--   "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u claudecode -pfordevonly ceochat_prod_copy < server/scripts/test-backfill-model-usage.sql
--
-- Re-run safe: skips rows already backfilled (matched by _source_id in raw_usage).
-- To wipe and re-run:
--   DELETE FROM model_usage WHERE JSON_EXTRACT(raw_usage, '$._backfill') = 'llm_cache_metrics';

INSERT INTO model_usage (
  purpose,
  case_id,
  project_id,
  section_id,
  model_id,
  provider,
  instructor_id,
  use_system_key,
  cache_hit,
  est_cost_usd,
  raw_usage,
  created_at
)
SELECT
  CASE m.request_type
    WHEN 'evaluation' THEN 'evaluation'
    WHEN 'outline'     THEN 'case_prep'
    ELSE 'student_chat'
  END AS purpose,

  m.case_id,
  NULL AS project_id,
  NULL AS section_id,
  m.model_id,
  m.provider,
  m.instructor_id,
  COALESCE(i.use_system_key, 0) AS use_system_key,
  m.cache_hit,

  -- Rough USD: model CPM when configured, else generic $2/$0.20/$8 per million tokens
  ROUND(
    GREATEST(
      0.000010,
      (
        COALESCE(m.input_tokens, 0)   * COALESCE(md.cpm_input, 2.0) +
        COALESCE(m.cached_tokens, 0)  * COALESCE(md.cpm_input_cache, 0.2) +
        COALESCE(m.output_tokens, 0)    * COALESCE(md.cpm_output, 8.0)
      ) / 1000000
    ),
    6
  ) AS est_cost_usd,

  JSON_OBJECT(
    'prompt_tokens', COALESCE(m.input_tokens, 0),
    'completion_tokens', COALESCE(m.output_tokens, 0),
    'prompt_tokens_details', JSON_OBJECT(
      'cached_tokens', COALESCE(m.cached_tokens, 0)
    ),
    '_backfill', 'llm_cache_metrics',
    '_source_id', m.id
  ) AS raw_usage,

  -- Spread into last 14 days so "Last 7 days" / daily sparkline show data
  DATE_SUB(NOW(), INTERVAL (m.id MOD 14) DAY) AS created_at

FROM llm_cache_metrics m
LEFT JOIN models md ON md.model_id = m.model_id
LEFT JOIN instructors i ON i.id = m.instructor_id
WHERE NOT EXISTS (
  SELECT 1
    FROM model_usage u
   WHERE JSON_EXTRACT(u.raw_usage, '$._source_id') = m.id
     AND JSON_UNQUOTE(JSON_EXTRACT(u.raw_usage, '$._backfill')) = 'llm_cache_metrics'
);

-- ---------------------------------------------------------------------------
-- Sanity checks (optional; comment out INSERT above if you only want counts)
-- ---------------------------------------------------------------------------
SELECT COUNT(*) AS backfilled_rows
  FROM model_usage
 WHERE JSON_UNQUOTE(JSON_EXTRACT(raw_usage, '$._backfill')) = 'llm_cache_metrics';

SELECT purpose, COUNT(*) AS calls, ROUND(SUM(est_cost_usd), 4) AS cost_usd
  FROM model_usage
 WHERE JSON_UNQUOTE(JSON_EXTRACT(raw_usage, '$._backfill')) = 'llm_cache_metrics'
 GROUP BY purpose
 ORDER BY cost_usd DESC;

SELECT DATE(created_at) AS day, COUNT(*) AS calls, ROUND(SUM(est_cost_usd), 4) AS cost_usd
  FROM model_usage
 WHERE JSON_UNQUOTE(JSON_EXTRACT(raw_usage, '$._backfill')) = 'llm_cache_metrics'
 GROUP BY DATE(created_at)
 ORDER BY day DESC
 LIMIT 14;
