-- Migration: 007_multi_section_support.sql
-- Date: 2026-01-07
-- Description: Adds support for students to be enrolled in multiple sections
--              and adds accept_new_students field to control enrollment

-- ============================================================================
-- 1. Add accept_new_students column to sections table
--    0 = locked (default) - no new students can enroll
--    1 = accept - students can select this section at login
-- ============================================================================
ALTER TABLE `sections`
  ADD COLUMN `accept_new_students` TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'Whether section accepts new enrollments: 0=locked, 1=accept';

-- ============================================================================
-- 2. Create student_sections junction table for many-to-many relationship
-- ============================================================================
CREATE TABLE IF NOT EXISTS `student_sections` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `student_id` CHAR(36) NOT NULL,
  `section_id` VARCHAR(20) NOT NULL,
  `enrolled_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `enrolled_by` ENUM('self', 'instructor', 'cas') DEFAULT 'self'
    COMMENT 'How enrollment happened: self=student chose, instructor=admin assigned, cas=auto from CAS',
  `is_primary` TINYINT(1) DEFAULT 1
    COMMENT 'Primary section for backward compatibility with students.section_id',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_student_section` (`student_id`, `section_id`),
  CONSTRAINT `fk_student_sections_student`
    FOREIGN KEY (`student_id`) REFERENCES `students`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_student_sections_section`
    FOREIGN KEY (`section_id`) REFERENCES `sections`(`section_id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  INDEX `idx_student_sections_student` (`student_id`),
  INDEX `idx_student_sections_section` (`section_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 3. Migrate existing section_id data from students table to junction table
--    Only migrate valid section references (where section exists)
-- ============================================================================
INSERT INTO `student_sections` (`student_id`, `section_id`, `enrolled_by`, `is_primary`)
SELECT s.`id`, s.`section_id`, 'self', 1
FROM `students` s
WHERE s.`section_id` IS NOT NULL
  AND s.`section_id` != ''
  AND s.`section_id` NOT LIKE 'other:%'
  AND EXISTS (
    SELECT 1 FROM `sections` sec
    WHERE sec.`section_id` = s.`section_id`
  );

-- ============================================================================
-- 4. Set existing enabled sections to accept new students for smooth transition
--    This ensures existing workflow continues to work immediately after migration
-- ============================================================================
UPDATE `sections` SET `accept_new_students` = 1 WHERE `enabled` = 1;

-- ============================================================================
-- Notes:
-- - The students.section_id column is PRESERVED for backward compatibility
-- - Reads should prefer student_sections as source of truth going forward
-- - The is_primary flag indicates which section syncs to students.section_id
-- - When a student is removed from all sections, students.section_id should be
--   set to NULL (handled in application code)
-- ============================================================================
