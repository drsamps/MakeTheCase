-- Migration: 056_feedback_system.sql
-- Date: 2026-05-18
-- Description: Adds the in-app user feedback system.
--   - feedback_categories: editable taxonomy (admin-managed)
--   - feedback_submissions: one row per submitted feedback item, with
--     auto-captured context and triage/follow-up state
--   - feedback_summaries: cached AI-generated digests by scope
--   - Seeds default categories, the feedback_summary prompt template,
--     and the global settings rows that drive widget behavior and access.
--
-- User-id columns reference rows that may live in students/instructors/admins
-- (all CHAR(36)). No FK is enforced — same pattern used by case_chats.
-- context_case_id references cases.case_id (VARCHAR(30)).

-- ============================================================
-- 1. feedback_categories
-- ============================================================
CREATE TABLE IF NOT EXISTS `feedback_categories` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(100) NOT NULL,
  `description` TEXT DEFAULT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_feedback_categories_name` (`name`),
  INDEX `idx_feedback_categories_active_sort` (`active`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `feedback_categories` (`name`, `description`, `sort_order`) VALUES
  ('Report a problem (bug)', 'Something is broken or behaves incorrectly',  10),
  ('User interface',         'Visual or interaction concerns',              20),
  ('Case Content',    'Issues with case text, persona, rubric, or eval',    30),
  ('Feature Request', 'Suggestion for new capability',                      40),
  ('Other',           'General comments',                                   50);

-- ============================================================
-- 2. feedback_submissions
-- ============================================================
-- TA role is reserved in the enum but is currently inferable via
-- instructor_sections rows. resolveSubmitterRole() in
-- server/utils/feedbackRoles.js handles that mapping.
CREATE TABLE IF NOT EXISTS `feedback_submissions` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `submitter_user_id` CHAR(36) DEFAULT NULL,
  `submitter_role` ENUM('student','ta','instructor','primary_instructor','admin') NOT NULL,
  `submission_type` ENUM('bug','idea','question','praise') DEFAULT NULL,
  `sentiment` ENUM('positive','neutral','negative') DEFAULT NULL,
  `category_id` INT DEFAULT NULL,
  `body` TEXT NOT NULL,
  `context_route` VARCHAR(512) DEFAULT NULL,
  `context_case_id` VARCHAR(30) DEFAULT NULL,
  `user_agent` VARCHAR(512) DEFAULT NULL,
  `build_sha` VARCHAR(40) DEFAULT NULL,
  `viewport` VARCHAR(20) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `is_read` TINYINT(1) NOT NULL DEFAULT 0,
  `read_by_user_id` CHAR(36) DEFAULT NULL,
  `read_at` TIMESTAMP NULL DEFAULT NULL,
  `needs_follow_up` TINYINT(1) NOT NULL DEFAULT 0,
  `follow_up_resolved` TINYINT(1) NOT NULL DEFAULT 0,
  `resolved_by_user_id` CHAR(36) DEFAULT NULL,
  `resolved_at` TIMESTAMP NULL DEFAULT NULL,
  `resolution_note` TEXT DEFAULT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_feedback_created` (`created_at`),
  INDEX `idx_feedback_category` (`category_id`),
  INDEX `idx_feedback_case` (`context_case_id`),
  INDEX `idx_feedback_unread` (`is_read`, `created_at`),
  INDEX `idx_feedback_followup` (`needs_follow_up`, `follow_up_resolved`),
  INDEX `idx_feedback_role` (`submitter_role`),
  INDEX `idx_feedback_submitter` (`submitter_user_id`),
  INDEX `idx_feedback_type` (`submission_type`),
  CONSTRAINT `fk_feedback_category`
    FOREIGN KEY (`category_id`) REFERENCES `feedback_categories`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_feedback_case`
    FOREIGN KEY (`context_case_id`) REFERENCES `cases`(`case_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 3. feedback_summaries (cache of AI-generated digests)
-- ============================================================
-- scope_id is VARCHAR(64) so the same column can hold either a numeric
-- category_id or a varchar(30) case_id.
CREATE TABLE IF NOT EXISTS `feedback_summaries` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `scope_type` ENUM('case','category','all') NOT NULL,
  `scope_id` VARCHAR(64) DEFAULT NULL,
  `summary_text` MEDIUMTEXT NOT NULL,
  `model_id` VARCHAR(100) DEFAULT NULL,
  `created_by_user_id` CHAR(36) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `source_count` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  INDEX `idx_feedback_summary_scope` (`scope_type`, `scope_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 4. Seed: feedback_summary prompt template
-- ============================================================
INSERT IGNORE INTO `ai_prompts` (`use`, `version`, `description`, `prompt_template`, `enabled`) VALUES
('feedback_summary', 'default',
 'Summarizes a set of user feedback items into a markdown digest.',
 'You are summarizing user feedback for {scope_label}.\n\nFeedback items:\n{items}\n\nProduce a concise markdown digest with these sections:\n\n## Recurring Themes\nGroup similar items. Cite item numbers in brackets like [3] or [3, 7, 12].\n\n## Severity\nCall out which themes appear most urgent (bug-tagged items, negative sentiment, repeated reports).\n\n## Suggested Actions\nConcrete, prioritized next steps. Be specific.\n\nKeep the digest under ~400 words. Do not invent items that are not in the list.',
 1);

-- ============================================================
-- 5. Seed: global feedback settings
-- ============================================================
-- Note: setting_value is TEXT, JSON values stored as JSON-encoded strings.
INSERT IGNORE INTO `settings` (`setting_key`, `scope`, `scope_id`, `setting_value`, `description`) VALUES
('feedback.submitter_roles', 'global', '',
 '{"student":true,"ta":true,"instructor":true,"primary_instructor":true,"admin":true}',
 'Which roles are allowed to submit feedback. JSON map of role -> boolean.'),
('feedback.viewer_rules', 'global', '',
 '{"student":["admin"],"ta":["admin"],"instructor":["admin"],"primary_instructor":["admin"],"admin":["admin"]}',
 'For each submitter role, the list of viewer roles permitted to see that source. JSON map.'),
('feedback.summary_model_id', 'global', '', '',
 'Optional model id used for AI feedback summarization. Empty falls back to default.'),
('feedback.summary_prompt_use', 'global', '', 'feedback_summary',
 'The ai_prompts.use key for the feedback summarization template.'),
('feedback.widget_style', 'global', '', 'right_edge_tab',
 'In-app feedback trigger style: right_edge_tab | bottom_right_fab | header_link | hidden.'),
('active_prompt_feedback_summary', 'global', '', 'default',
 'Active version pointer for the feedback_summary prompt template.');
