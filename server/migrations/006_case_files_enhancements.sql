-- Migration: Case Files Enhancements
-- Date: 2026-01-07
-- Description: Extends case_files table with metadata for file management, prompt ordering,
--              proprietary content tracking, and adds LLM cache metrics table

-- ============================================================================
-- 1. Extend case_files table with new metadata columns
-- ============================================================================

ALTER TABLE `case_files`
  ADD COLUMN `file_format` VARCHAR(20) DEFAULT NULL COMMENT 'File format: pdf, docx, doc, md, txt, jpg, etc.',
  ADD COLUMN `file_source` VARCHAR(30) DEFAULT 'uploaded' COMMENT 'Source: uploaded, ai_prepped, downloaded',
  ADD COLUMN `source_url` VARCHAR(2048) DEFAULT NULL COMMENT 'Original URL if file was downloaded',
  ADD COLUMN `proprietary` TINYINT(1) DEFAULT 0 COMMENT 'Whether content is proprietary (requires confirmation)',
  ADD COLUMN `include_in_chat_prompt` TINYINT(1) DEFAULT 1 COMMENT 'Whether to include in chat prompt context',
  ADD COLUMN `prompt_order` INT DEFAULT 0 COMMENT 'Order in prompt context (lower = earlier)',
  ADD COLUMN `file_version` VARCHAR(100) DEFAULT NULL COMMENT 'Descriptive version info (e.g., Fall 2025 revision)',
  ADD COLUMN `original_filename` VARCHAR(255) DEFAULT NULL COMMENT 'Original filename before standardization',
  ADD COLUMN `file_size` INT DEFAULT NULL COMMENT 'File size in bytes',
  ADD COLUMN `proprietary_confirmed_by` INT DEFAULT NULL COMMENT 'Admin ID who confirmed proprietary content use',
  ADD COLUMN `proprietary_confirmed_at` TIMESTAMP NULL DEFAULT NULL COMMENT 'When proprietary content use was confirmed';

-- ============================================================================
-- 2. Expand file_type to support custom types (predefined + "other:Custom Label")
-- ============================================================================

ALTER TABLE `case_files`
  MODIFY COLUMN `file_type` VARCHAR(50) NOT NULL COMMENT 'Predefined: case, teaching_note, chapter, reading, article, instructor_notes; Custom: other:Label';

-- ============================================================================
-- 3. Add index for prompt context ordering queries
-- ============================================================================

ALTER TABLE `case_files`
  ADD INDEX `idx_prompt_order` (`case_id`, `include_in_chat_prompt`, `prompt_order`);

-- ============================================================================
-- 4. Create LLM cache metrics table for tracking prompt caching performance
-- ============================================================================

CREATE TABLE IF NOT EXISTS `llm_cache_metrics` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `case_id` VARCHAR(30) NOT NULL COMMENT 'Case associated with this LLM call',
  `provider` VARCHAR(50) NOT NULL COMMENT 'LLM provider: anthropic, openai, google',
  `model_id` VARCHAR(255) NOT NULL COMMENT 'Model identifier used',
  `cache_hit` TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Whether prompt cache was hit',
  `input_tokens` INT DEFAULT NULL COMMENT 'Total input tokens',
  `cached_tokens` INT DEFAULT NULL COMMENT 'Tokens served from cache',
  `output_tokens` INT DEFAULT NULL COMMENT 'Output tokens generated',
  `request_type` VARCHAR(50) DEFAULT 'chat' COMMENT 'Type of request: chat, evaluation, outline',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_case_provider` (`case_id`, `provider`),
  INDEX `idx_created_at` (`created_at`),
  INDEX `idx_cache_hit` (`cache_hit`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 5. Update existing case_files records with default values for new columns
-- ============================================================================

-- Set file_format based on filename extension for existing records
UPDATE `case_files` SET `file_format` = 'md' WHERE `filename` LIKE '%.md' AND `file_format` IS NULL;
UPDATE `case_files` SET `file_format` = 'pdf' WHERE `filename` LIKE '%.pdf' AND `file_format` IS NULL;
UPDATE `case_files` SET `file_format` = 'txt' WHERE `filename` LIKE '%.txt' AND `file_format` IS NULL;
UPDATE `case_files` SET `file_format` = 'docx' WHERE `filename` LIKE '%.docx' AND `file_format` IS NULL;
UPDATE `case_files` SET `file_format` = 'doc' WHERE `filename` LIKE '%.doc' AND `file_format` IS NULL;

-- Set file_source to 'uploaded' for existing records (default behavior)
UPDATE `case_files` SET `file_source` = 'uploaded' WHERE `file_source` IS NULL;

-- Set prompt_order based on file_type for existing records
-- case documents should come first (order 1), teaching_note second (order 2)
UPDATE `case_files` SET `prompt_order` = 1 WHERE `file_type` = 'case' AND `prompt_order` = 0;
UPDATE `case_files` SET `prompt_order` = 2 WHERE `file_type` = 'teaching_note' AND `prompt_order` = 0;

-- ============================================================================
-- Migration complete
-- ============================================================================
