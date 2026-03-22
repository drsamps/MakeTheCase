-- Migration: 024_add_prompt_logging_settings.sql
-- Purpose: Add settings for AI prompt logging
-- Date: 2026-03-21

INSERT INTO settings (setting_key, setting_value, description)
VALUES
  ('log_case_chat_prompts', '0', 'Number of case chat prompts to log (countdown)'),
  ('log_evaluation_prompts', '0', 'Number of evaluation prompts to log (countdown)'),
  ('max_log_files', '100', 'Maximum number of log files allowed before logging stops'),
  ('log_with_full_case_context', 'false', 'Include full case context in logs (true) or extract/hide it (false)')
ON DUPLICATE KEY UPDATE description = VALUES(description);
