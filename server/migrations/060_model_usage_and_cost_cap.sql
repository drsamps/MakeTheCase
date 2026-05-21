-- 060: AI usage tracking — cost-first model_usage table + weekly dollar cap
--
-- Replaces the per-instructor monthly token cap (055) with a weekly dollar cap.
-- Cost is computed at insert time (OpenRouter: usage.cost directly; direct
-- providers: from models.cpm_* × token counts). Raw provider usage payload is
-- retained in JSON for 90 days, then truncated to NULL by a daily job.
--
-- Also adds per-instructor vendor restrictions: allowed_vendors defaults to
-- the full set for existing instructors (backward compat) but new instructors
-- created after this migration default to ["openrouter"] only (enforced in
-- server/routes/instructors.js, not as a SQL default — JSON columns can't
-- have non-literal defaults in older MySQL).
--
-- ROLLBACK: forward-only project. Reverting requires manual SQL to recreate
-- monthly_token_cap and remove the new columns/table. The old token-cap data
-- was never widely deployed; nothing of value is being dropped.

-- ---------------------------------------------------------------------------
-- 1a. New model_usage table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS model_usage (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,

  purpose       VARCHAR(50)  NOT NULL
                COMMENT 'student_chat | evaluation | case_writer | case_prep | position_inference | model_test',

  case_id       VARCHAR(30)  NULL COMMENT 'student_chat, evaluation, case_prep, position_inference',
  project_id    VARCHAR(36)  NULL COMMENT 'case_writer_projects.id',
  section_id    VARCHAR(20)  NULL COMMENT 'student-facing call context',

  model_id      VARCHAR(255) NOT NULL,
  provider      VARCHAR(50)  NOT NULL COMMENT 'openai | anthropic | google | openrouter',

  instructor_id VARCHAR(64)  NULL COMMENT 'NULL = system env key with no instructor context',
  use_system_key TINYINT(1)  NOT NULL DEFAULT 0,

  cache_hit     TINYINT(1)   NOT NULL DEFAULT 0,

  est_cost_usd  DECIMAL(12,6) NULL
                COMMENT 'USD. OpenRouter: usage.cost directly. Direct: tokens × models.cpm_*/1M at insert time. NULL when pricing unconfigured.',

  raw_usage     JSON NULL
                COMMENT 'Full provider usage blob. Truncated to NULL after 90 days by truncateOldRawUsage job.',

  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_instructor_week (instructor_id, created_at),
  INDEX idx_purpose_date    (purpose, created_at),
  INDEX idx_case_date       (case_id, created_at),
  INDEX idx_section_date    (section_id, created_at),
  INDEX idx_model_date      (model_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 1b. Instructor columns: weekly cap, warning threshold, vendor allow-list
-- ---------------------------------------------------------------------------
ALTER TABLE instructors
  ADD COLUMN weekly_ai_usage_cap DECIMAL(8,4) NULL
    COMMENT 'USD per ISO week (Mon 00:00 America/Denver). NULL = no cap. Only enforced when use_system_key=1.',
  ADD COLUMN weekly_ai_usage_warning_pct TINYINT UNSIGNED NOT NULL DEFAULT 80
    COMMENT '0-100. Dashboard banner fires when cost_used >= cap * warning_pct / 100. Instructor-settable.',
  ADD COLUMN allowed_vendors JSON NOT NULL
    COMMENT 'JSON array of permitted vendors: openai | anthropic | google | openrouter. Filters Model dropdowns at selection time.';

-- Backfill: existing instructors keep access to every vendor. New instructor
-- inserts after this migration default to ["openrouter"] in instructors.js.
UPDATE instructors
   SET allowed_vendors = JSON_ARRAY('openai', 'anthropic', 'google', 'openrouter')
 WHERE allowed_vendors IS NULL
    OR JSON_LENGTH(allowed_vendors) = 0;

-- Drop the old monthly token cap (superseded by weekly_ai_usage_cap).
ALTER TABLE instructors
  DROP COLUMN monthly_token_cap;

-- ---------------------------------------------------------------------------
-- 1c. Global setting: block calls to unpriced models?
-- ---------------------------------------------------------------------------
-- Default true (current behavior). When false, assertWithinCostCap throws
-- UnpricedModelBlockedError for any model where cpm_input AND cpm_output are
-- both NULL, regardless of whether a cap is set.
INSERT IGNORE INTO settings (setting_key, scope, scope_id, setting_value, description)
VALUES (
  'allow_unpriced_llm_calls',
  'global',
  '',
  'true',
  'When true, LLM calls to models without configured pricing are allowed (est_cost_usd stored as NULL). When false, such calls are blocked.'
);
