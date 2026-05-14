-- Migration: 028_case_writer.sql
-- Date: 2026-05-13
-- Description: Case Writer authoring tool — project, references, and revision tables.
--              Case Writer projects are draft artifacts that materialize into the
--              existing cases / case_scenarios / case_files tables on publish.
--              Tables are prefixed case_writer_* and self-contained so the module
--              could be split into a standalone product later.

-- ============================================================================
-- 1. case_writer_projects — one row per authoring project
-- ============================================================================

CREATE TABLE IF NOT EXISTS `case_writer_projects` (
  `project_id`         CHAR(36) NOT NULL,
  `owner_id`           CHAR(36) NOT NULL COMMENT 'admins.id or instructors.id',
  `owner_type`         ENUM('admin','instructor') NOT NULL,
  `title`              VARCHAR(255) DEFAULT NULL,
  `status`             ENUM('draft','reviewed','exported','published','archived') NOT NULL DEFAULT 'draft',
  `teaching_principle` TEXT DEFAULT NULL,
  `audience`           VARCHAR(255) DEFAULT NULL,
  `course_context`     VARCHAR(255) DEFAULT NULL,
  `difficulty`         ENUM('introductory','intermediate','advanced','executive') DEFAULT NULL,
  `case_type`          ENUM('fictional','disguised','composite','real_company_inspired','real_company_verified') DEFAULT NULL,
  `learning_brief`     JSON DEFAULT NULL COMMENT 'Output of teaching-brief step',
  `scenario_options`   JSON DEFAULT NULL COMMENT 'Array of generated scenario alternatives',
  `selected_scenario`  JSON DEFAULT NULL COMMENT 'Chosen and refined scenario',
  `case_blueprint`     JSON DEFAULT NULL COMMENT 'Approved blueprint',
  `student_case`       JSON DEFAULT NULL COMMENT 'Structured student-facing case',
  `teaching_note`      JSON DEFAULT NULL COMMENT 'Structured instructor-only teaching note',
  `published_case_id`  VARCHAR(30) DEFAULT NULL COMMENT 'FK to cases.case_id once published',
  `created_at`         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`project_id`),
  INDEX `idx_cwp_owner` (`owner_id`, `owner_type`),
  INDEX `idx_cwp_status` (`status`),
  INDEX `idx_cwp_published_case` (`published_case_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 2. case_writer_references — reference material attached to a project
-- ============================================================================

CREATE TABLE IF NOT EXISTS `case_writer_references` (
  `reference_id`      CHAR(36) NOT NULL,
  `project_id`        CHAR(36) NOT NULL,
  `type`              ENUM('pasted_text','uploaded_file','link','saved_framework') NOT NULL,
  `title`             VARCHAR(255) DEFAULT NULL,
  `content`           LONGTEXT DEFAULT NULL COMMENT 'Pasted text or extracted file text',
  `content_summary`   TEXT DEFAULT NULL COMMENT 'AI summary, instructor-approved',
  `approved_by_user`  TINYINT(1) NOT NULL DEFAULT 0,
  `source_notes`      TEXT DEFAULT NULL,
  `link_url`          VARCHAR(1024) DEFAULT NULL,
  `case_file_id`      INT DEFAULT NULL COMMENT 'FK to case_files.id for uploaded files',
  `created_at`        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`reference_id`),
  INDEX `idx_cwr_project` (`project_id`),
  CONSTRAINT `fk_cwr_project` FOREIGN KEY (`project_id`)
    REFERENCES `case_writer_projects` (`project_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 3. case_writer_revisions — lightweight snapshot history per step
-- ============================================================================

CREATE TABLE IF NOT EXISTS `case_writer_revisions` (
  `revision_id`  BIGINT NOT NULL AUTO_INCREMENT,
  `project_id`   CHAR(36) NOT NULL,
  `step`         VARCHAR(50) NOT NULL COMMENT 'brief|scenarios|blueprint|student_case|teaching_note|reference_summary',
  `snapshot`     JSON NOT NULL,
  `created_by`   CHAR(36) DEFAULT NULL,
  `created_at`   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`revision_id`),
  INDEX `idx_cwrev_project_step` (`project_id`, `step`, `created_at`),
  CONSTRAINT `fk_cwrev_project` FOREIGN KEY (`project_id`)
    REFERENCES `case_writer_projects` (`project_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 4. Seed Case Writer prompt templates in ai_prompts
--    Real prompt bodies will be filled in alongside the generation endpoints;
--    these rows just reserve the use slugs so the admin Prompts UI can show them.
-- ============================================================================

INSERT IGNORE INTO `ai_prompts` (`use`, `version`, `description`, `prompt_template`, `enabled`) VALUES
('case_writer.teaching_brief',      'default', 'Convert teaching principle + context into a structured learning brief',
 '-- placeholder: set during implementation --', 0),
('case_writer.scenario_generation', 'default', 'Generate 3–5 distinct scenario alternatives from the learning brief',
 '-- placeholder: set during implementation --', 0),
('case_writer.case_blueprint',      'default', 'Build a case blueprint from the selected scenario',
 '-- placeholder: set during implementation --', 0),
('case_writer.student_case_draft',  'default', 'Draft the student-facing case from the approved blueprint',
 '-- placeholder: set during implementation --', 0),
('case_writer.teaching_note',       'default', 'Draft the instructor-only teaching note',
 '-- placeholder: set during implementation --', 0),
('case_writer.reference_summary',   'default', 'Summarize uploaded reference material for instructor approval',
 '-- placeholder: set during implementation --', 0),
('case_writer.exhibit_generation',  'default', 'Generate an exhibit (table, chart data, or qualitative figure)',
 '-- placeholder: set during implementation --', 0),
('case_writer.boundary_validation', 'default', 'Validate that the student case does not contain analysis/answer content',
 '-- placeholder: set during implementation --', 0),
('case_writer.section_revision',    'default', 'Apply a revision command (shorten, expand, add data, etc.) to a section',
 '-- placeholder: set during implementation --', 0);
