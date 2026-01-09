-- 007_case_outlines_link.sql
-- Link AI-generated outlines to their source files and support versioning/ordering.

ALTER TABLE `case_files`
  ADD COLUMN `parent_file_id` BIGINT NULL AFTER `case_id`,
  ADD COLUMN `is_outline` TINYINT(1) NOT NULL DEFAULT 0 AFTER `file_type`,
  ADD COLUMN `is_latest_outline` TINYINT(1) NOT NULL DEFAULT 0 AFTER `include_in_chat_prompt`;

ALTER TABLE `case_files`
  ADD INDEX `idx_case_parent_outline` (`case_id`, `parent_file_id`, `is_outline`, `is_latest_outline`);

-- Backfill: ensure existing rows remain non-outlines
UPDATE `case_files`
SET is_outline = 0, is_latest_outline = 0
WHERE is_outline IS NULL OR is_latest_outline IS NULL;
