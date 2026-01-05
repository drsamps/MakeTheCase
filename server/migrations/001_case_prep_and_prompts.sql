-- Migration: Case Prep & Prompt Management System
-- Date: 2025-01-04
-- Description: Adds tables and columns for Case Prep file processing and AI prompt management

-- ============================================================================
-- 1. Create ai_prompts table for versioned prompt template management
-- ============================================================================

CREATE TABLE IF NOT EXISTS `ai_prompts` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `use` VARCHAR(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Where prompt is used (e.g., case_outline_generation, notes_cleanup)',
  `version` VARCHAR(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Version identifier (e.g., default, aggressive, for-claude)',
  `description` TEXT COLLATE utf8mb4_unicode_ci COMMENT 'Human-readable description of this prompt variant',
  `prompt_template` TEXT COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'The actual prompt text with {placeholder} variables',
  `enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_use_version` (`use`, `version`),
  KEY `idx_use_enabled` (`use`, `enabled`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 2. Create settings table for application configuration
-- ============================================================================

CREATE TABLE IF NOT EXISTS `settings` (
  `setting_key` VARCHAR(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `setting_value` TEXT COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` TEXT COLLATE utf8mb4_unicode_ci,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 3. Extend case_files table for Case Prep processing workflow
-- ============================================================================

ALTER TABLE `case_files`
  ADD COLUMN `processing_status` ENUM('pending','processing','completed','failed') COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Status of AI outline generation',
  ADD COLUMN `processing_model` VARCHAR(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Model used for processing',
  ADD COLUMN `processing_error` TEXT COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Error message if processing failed',
  ADD COLUMN `outline_content` LONGTEXT COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'AI-generated outline in markdown',
  ADD COLUMN `processed_at` TIMESTAMP NULL DEFAULT NULL COMMENT 'When outline was generated',
  ADD INDEX `idx_processing_status` (`case_id`, `processing_status`);

-- ============================================================================
-- 4. Seed default prompt templates
-- ============================================================================

-- Case Outline Generation - Default Version
INSERT INTO `ai_prompts` (`use`, `version`, `description`, `prompt_template`, `enabled`) VALUES
('case_outline_generation', 'default', 'Standard case outline with detailed structure and key facts',
'You are a business case analysis expert. Convert the following case document into a detailed markdown outline.

# Instructions:
- Create hierarchical structure with clear headings (use ##, ###, ####)
- Extract key facts, numbers, dates, and people
- Identify the main business problem or decision
- Summarize key data points and exhibits
- Note important quotes verbatim
- Preserve context and relationships between concepts
- Remove page numbers, headers, and footers
- Fix spacing issues (e.g., "w o r d s" should be "words")

# Case Document:
{case_content}

# Output Format:
Return ONLY the markdown outline with proper structure. No other commentary.', 1);

-- Case Outline Generation - Aggressive Version
INSERT INTO `ai_prompts` (`use`, `version`, `description`, `prompt_template`, `enabled`) VALUES
('case_outline_generation', 'aggressive', 'Critical analysis with assumption questioning and gap identification',
'You are a critical business analyst. Analyze this case document and create a detailed markdown outline that questions assumptions and identifies gaps.

# Instructions:
- Create hierarchical structure with clear headings
- Extract ALL quantitative data and financial metrics
- Identify unstated assumptions explicitly
- Note missing information or data gaps
- Flag potential biases in the case narrative
- Question the framing of the business problem
- Highlight contradictions or inconsistencies
- Remove page numbers, headers, and footers
- Fix spacing issues (e.g., "w o r d s" should be "words")

# Case Document:
{case_content}

# Output Format:
Return ONLY the markdown outline with critical analysis integrated. No other commentary.', 1);

-- Notes Cleanup - Default Version
INSERT INTO `ai_prompts` (`use`, `version`, `description`, `prompt_template`, `enabled`) VALUES
('notes_cleanup', 'default', 'Clean and structure teaching notes with learning objectives',
'You are a teaching case expert. Convert the following teaching note into a well-structured markdown document.

# Instructions:
- Organize by: Learning Objectives, Discussion Questions, Key Teaching Points, Suggested Answers
- Preserve pedagogical insights and instructor guidance
- Extract discussion questions verbatim
- Note suggested time allocations if present
- Highlight common student misconceptions if mentioned
- Preserve instructor notes and private comments
- Remove page numbers, headers, and footers
- Fix spacing issues (e.g., "w o r d s" should be "words")

# Teaching Note Document:
{notes_content}

# Output Format:
Return ONLY the markdown outline organized by sections. No other commentary.', 1);

-- ============================================================================
-- 5. Seed default settings for active prompt versions
-- ============================================================================

INSERT INTO `settings` (`setting_key`, `setting_value`, `description`) VALUES
('active_prompt_case_outline_generation', 'default', 'Active version for case outline generation prompts'),
('active_prompt_notes_cleanup', 'default', 'Active version for teaching notes cleanup prompts');

-- ============================================================================
-- Migration complete
-- ============================================================================
