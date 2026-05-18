-- 055_instructor_usage_cap.sql
-- A1: per-instructor monthly token cap, only enforced when use_system_key=1.
-- Adds the cap column on instructors and stamps each llm_cache_metrics row
-- with the instructor that initiated the call so the monthly aggregate is
-- a simple indexed sum.

ALTER TABLE instructors
  ADD COLUMN monthly_token_cap BIGINT NULL DEFAULT NULL
    COMMENT 'NULL = no cap. Only enforced when use_system_key=1. Total input+cached+output tokens per calendar month.';

ALTER TABLE llm_cache_metrics
  ADD COLUMN instructor_id VARCHAR(64) NULL DEFAULT NULL AFTER case_id,
  ADD INDEX idx_llm_cache_instructor_month (instructor_id, created_at);
