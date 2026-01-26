-- Migration: 019_semesters_and_courses.sql
-- Date: 2026-01-25
-- Description: Adds semesters and courses tables for hierarchical organization
--              Semester > Course > Section > Case Assignments

-- ============================================================================
-- 1. CREATE SEMESTERS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS semesters (
  id INT AUTO_INCREMENT PRIMARY KEY,
  semester_name VARCHAR(50) NOT NULL UNIQUE COMMENT 'e.g., Fall 2025, Winter 2026',
  is_current BOOLEAN DEFAULT FALSE COMMENT 'Only one semester can be current',
  start_date DATE COMMENT 'Optional semester start date',
  end_date DATE COMMENT 'Optional semester end date',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_is_current (is_current)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 2. CREATE COURSES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS courses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  semester_id INT NOT NULL COMMENT 'FK to semesters.id',
  course_name VARCHAR(100) NOT NULL COMMENT 'e.g., MBA 620, STRAT 401',
  course_code VARCHAR(20) COMMENT 'Optional short code',
  description TEXT COMMENT 'Optional course description',
  primary_section_id VARCHAR(20) COMMENT 'FK to sections.section_id - template section',
  sync_scheduling BOOLEAN DEFAULT FALSE COMMENT 'Whether to sync open/close dates when pushing',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (semester_id) REFERENCES semesters(id) ON DELETE CASCADE,
  UNIQUE KEY unique_course_per_semester (semester_id, course_name),
  INDEX idx_semester (semester_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 3. ADD course_id COLUMN TO SECTIONS TABLE
-- ============================================================================

-- Add course_id column (nullable for backward compatibility with existing sections)
ALTER TABLE sections
ADD COLUMN course_id INT COMMENT 'FK to courses.id - NULL for orphaned/unassigned sections'
AFTER section_id;

-- Add foreign key constraint
ALTER TABLE sections
ADD CONSTRAINT fk_sections_course
FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE SET NULL;

-- Add index for performance
ALTER TABLE sections ADD INDEX idx_course_id (course_id);

-- ============================================================================
-- 4. ADD FOREIGN KEY FOR primary_section_id IN COURSES
-- ============================================================================

-- Now that sections has course_id, we can add the FK for primary_section_id
ALTER TABLE courses
ADD CONSTRAINT fk_courses_primary_section
FOREIGN KEY (primary_section_id) REFERENCES sections(section_id) ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- 5. DATA MIGRATION - Create semesters from existing year_term values
-- ============================================================================

-- Insert distinct year_term values as semesters
INSERT INTO semesters (semester_name)
SELECT DISTINCT year_term
FROM sections
WHERE year_term IS NOT NULL AND year_term != ''
ON DUPLICATE KEY UPDATE semester_name = semester_name;

-- Mark the most recent semester as current (assumes naming like "Fall 2025", "Winter 2026")
-- This uses alphabetical ordering which works for consistent naming conventions
UPDATE semesters SET is_current = TRUE
WHERE id = (
  SELECT id FROM (
    SELECT id FROM semesters ORDER BY semester_name DESC LIMIT 1
  ) AS subquery
);

-- ============================================================================
-- 6. NOTES
-- ============================================================================

-- Existing sections remain with course_id = NULL (orphaned)
-- Instructors will:
--   1. Create courses in the appropriate semester
--   2. Assign existing sections to courses (or create new sections within courses)
--
-- The "is_current" uniqueness is enforced at the application level, not DB level,
-- because MySQL doesn't support partial unique indexes. The API will ensure
-- only one semester has is_current = TRUE at a time.
