-- Migration: 048_resource_visibility.sql
-- Date: 2026-05-15
-- Description: Adds the Private/Team/Public visibility model to shared
--              resources (cases, rubrics, rubric_criteria) and a single
--              resource_team_shares table to record team-level grants.
--
--              The existing `cases.is_shared` flag is kept for one release
--              for read compatibility; new writes use `visibility` and
--              migration 053 will drop is_shared later.

-- ============================================================
-- 1. cases: add visibility column; back-fill from is_shared
-- ============================================================
ALTER TABLE `cases`
  ADD COLUMN `visibility` ENUM('private', 'team', 'public') NOT NULL DEFAULT 'private' AFTER `is_shared`,
  ADD INDEX `idx_cases_visibility` (`visibility`);

UPDATE `cases` SET `visibility` = 'public' WHERE `is_shared` = 1;

-- ============================================================
-- 2. rubrics: add created_by_type, visibility, owner FK
-- ============================================================
ALTER TABLE `rubrics`
  ADD COLUMN `created_by_type` ENUM('admin', 'instructor', 'system') NOT NULL DEFAULT 'admin' AFTER `created_by`,
  ADD COLUMN `visibility` ENUM('private', 'team', 'public') NOT NULL DEFAULT 'private' AFTER `created_by_type`,
  ADD INDEX `idx_rubrics_visibility` (`visibility`),
  ADD INDEX `idx_rubrics_created_by` (`created_by`);

-- System default rubric: mark as system-typed and publicly visible.
UPDATE `rubrics`
  SET `created_by_type` = 'system',
      `visibility` = 'public',
      `created_by` = NULL
  WHERE `is_system_default` = 1;

-- ============================================================
-- 3. rubric_criteria: add is_system_default + ownership trio
-- ============================================================
ALTER TABLE `rubric_criteria`
  ADD COLUMN `is_system_default` TINYINT(1) NOT NULL DEFAULT 0 AFTER `prompt_text`,
  ADD COLUMN `created_by_type` ENUM('admin', 'instructor', 'system') NOT NULL DEFAULT 'admin' AFTER `created_by`,
  ADD COLUMN `visibility` ENUM('private', 'team', 'public') NOT NULL DEFAULT 'private' AFTER `created_by_type`,
  ADD INDEX `idx_rubric_criteria_visibility` (`visibility`),
  ADD INDEX `idx_rubric_criteria_created_by` (`created_by`),
  ADD INDEX `idx_rubric_criteria_system_default` (`is_system_default`);

-- The 3 seeded criteria from migration 022 are system defaults.
UPDATE `rubric_criteria`
  SET `is_system_default` = 1,
      `created_by_type` = 'system',
      `visibility` = 'public',
      `created_by` = NULL
  WHERE `criteria_id` IN ('study_material', 'solid_answers', 'justification');

-- ============================================================
-- 4. resource_team_shares: one row per (resource, team) grant
-- ============================================================
-- resource_id is VARCHAR(64) to accommodate all id shapes:
--   cases.case_id          VARCHAR(30)
--   rubrics.rubric_id      INT
--   rubric_criteria.id     INT (PK; criteria_id business key not used here)
--   personas.persona_id    VARCHAR(30)
--   case_writer_projects.project_id CHAR(36)
CREATE TABLE IF NOT EXISTS resource_team_shares (
  id INT AUTO_INCREMENT NOT NULL,
  resource_type ENUM('case', 'rubric', 'rubric_criteria', 'persona', 'case_writer_project') NOT NULL,
  resource_id VARCHAR(64) NOT NULL,
  team_id CHAR(36) NOT NULL,
  access_level ENUM('view', 'edit') NOT NULL DEFAULT 'view',
  shared_by CHAR(36) NULL COMMENT 'Instructor who created the share',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_share (resource_type, resource_id, team_id),
  INDEX idx_share_lookup (resource_type, resource_id),
  INDEX idx_share_team (team_id),
  CONSTRAINT fk_share_team
    FOREIGN KEY (team_id) REFERENCES instructor_teams(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
