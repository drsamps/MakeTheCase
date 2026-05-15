-- Migration: 044_case_writer_case_versions.sql
-- Date: 2026-05-14
-- Description: Add a case_versions table so instructors can keep multiple
--              named versions of the same student case (different sizes,
--              different attempts) with notes about how each played in class.
--              Versioning is additive: case_writer_projects.student_case
--              remains the working draft; rows here are saved snapshots.

CREATE TABLE IF NOT EXISTS `case_versions` (
  `case_version_id`   CHAR(36)      COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  `project_id`        CHAR(36)      COLLATE utf8mb4_unicode_ci NOT NULL,
  `case_size`         ENUM('story_problem','mini','abridged','regular','expanded')
                      COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'regular',
  `case_text`         LONGTEXT      COLLATE utf8mb4_unicode_ci NOT NULL,
  `version_name`      VARCHAR(255)  COLLATE utf8mb4_unicode_ci NOT NULL,
  `version_notes`     TEXT          COLLATE utf8mb4_unicode_ci NULL,
  `model_id`          VARCHAR(100)  COLLATE utf8mb4_unicode_ci NULL,
  `word_count`        INT           NULL,
  `version_created`   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `version_updated`   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_case_versions_project` FOREIGN KEY (`project_id`)
    REFERENCES `case_writer_projects`(`project_id`) ON DELETE CASCADE,
  KEY `idx_case_versions_project` (`project_id`, `version_created`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
