-- Migration: 020_instructor_access_control.sql
-- Date: 2026-01-28
-- Description: Implements four-tier instructor access control system
--   - Superuser admins (admins table, superuser=1) - Full access
--   - Regular admins (admins table, superuser=0) - Function-based access (unchanged)
--   - Primary instructors (instructors table) - Assigned to semesters
--   - TAs (instructors table) - Assigned to specific sections

-- ============================================================
-- 1. Create instructors table
-- ============================================================
CREATE TABLE IF NOT EXISTS instructors (
  id CHAR(36) NOT NULL,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  first_name VARCHAR(100) DEFAULT NULL,
  last_name VARCHAR(100) DEFAULT NULL,
  full_name VARCHAR(200) NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  last_login TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_instructors_email (email),
  INDEX idx_instructors_email (email),
  INDEX idx_instructors_active (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 2. Create instructor_semesters junction table (primary instructors)
-- ============================================================
CREATE TABLE IF NOT EXISTS instructor_semesters (
  id INT AUTO_INCREMENT NOT NULL,
  instructor_id CHAR(36) NOT NULL,
  semester_id INT NOT NULL,
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  assigned_by CHAR(36) DEFAULT NULL COMMENT 'Admin who made assignment',
  PRIMARY KEY (id),
  UNIQUE KEY uq_instructor_semester (instructor_id, semester_id),
  INDEX idx_instructor_semesters_instructor (instructor_id),
  INDEX idx_instructor_semesters_semester (semester_id),
  CONSTRAINT fk_instructor_semesters_instructor
    FOREIGN KEY (instructor_id) REFERENCES instructors(id) ON DELETE CASCADE,
  CONSTRAINT fk_instructor_semesters_semester
    FOREIGN KEY (semester_id) REFERENCES semesters(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 3. Create instructor_sections junction table (TAs)
-- ============================================================
CREATE TABLE IF NOT EXISTS instructor_sections (
  id INT AUTO_INCREMENT NOT NULL,
  instructor_id CHAR(36) NOT NULL,
  section_id VARCHAR(20) NOT NULL,
  can_manage_students TINYINT(1) NOT NULL DEFAULT 1,
  can_manage_cases TINYINT(1) NOT NULL DEFAULT 1,
  can_view_chats TINYINT(1) NOT NULL DEFAULT 1,
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  assigned_by CHAR(36) DEFAULT NULL COMMENT 'Admin or primary instructor who made assignment',
  PRIMARY KEY (id),
  UNIQUE KEY uq_instructor_section (instructor_id, section_id),
  INDEX idx_instructor_sections_instructor (instructor_id),
  INDEX idx_instructor_sections_section (section_id),
  CONSTRAINT fk_instructor_sections_instructor
    FOREIGN KEY (instructor_id) REFERENCES instructors(id) ON DELETE CASCADE,
  CONSTRAINT fk_instructor_sections_section
    FOREIGN KEY (section_id) REFERENCES sections(section_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 4. Add ownership columns to cases table
-- ============================================================
-- Use stored procedure for conditional ALTER TABLE
DROP PROCEDURE IF EXISTS add_cases_ownership_columns;
DELIMITER //
CREATE PROCEDURE add_cases_ownership_columns()
BEGIN
  -- Add created_by_type column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
    AND table_name = 'cases'
    AND column_name = 'created_by_type'
  ) THEN
    ALTER TABLE cases ADD COLUMN created_by_type ENUM('admin', 'instructor') DEFAULT 'admin';
  END IF;

  -- Add created_by column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
    AND table_name = 'cases'
    AND column_name = 'created_by'
  ) THEN
    ALTER TABLE cases ADD COLUMN created_by CHAR(36) DEFAULT NULL;
  END IF;

  -- Add is_shared column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
    AND table_name = 'cases'
    AND column_name = 'is_shared'
  ) THEN
    ALTER TABLE cases ADD COLUMN is_shared TINYINT(1) NOT NULL DEFAULT 0;
  END IF;

  -- Add shared_at column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
    AND table_name = 'cases'
    AND column_name = 'shared_at'
  ) THEN
    ALTER TABLE cases ADD COLUMN shared_at TIMESTAMP NULL DEFAULT NULL;
  END IF;

  -- Add shared_by column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
    AND table_name = 'cases'
    AND column_name = 'shared_by'
  ) THEN
    ALTER TABLE cases ADD COLUMN shared_by CHAR(36) DEFAULT NULL;
  END IF;

  -- Add indexes
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
    AND table_name = 'cases'
    AND index_name = 'idx_cases_created_by'
  ) THEN
    ALTER TABLE cases ADD INDEX idx_cases_created_by (created_by);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
    AND table_name = 'cases'
    AND index_name = 'idx_cases_is_shared'
  ) THEN
    ALTER TABLE cases ADD INDEX idx_cases_is_shared (is_shared);
  END IF;
END //
DELIMITER ;

CALL add_cases_ownership_columns();
DROP PROCEDURE IF EXISTS add_cases_ownership_columns;

-- ============================================================
-- 5. Add primary_instructor_id to courses table
-- ============================================================
DROP PROCEDURE IF EXISTS add_courses_instructor_column;
DELIMITER //
CREATE PROCEDURE add_courses_instructor_column()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
    AND table_name = 'courses'
    AND column_name = 'primary_instructor_id'
  ) THEN
    ALTER TABLE courses ADD COLUMN primary_instructor_id CHAR(36) DEFAULT NULL;
    ALTER TABLE courses ADD INDEX idx_courses_primary_instructor (primary_instructor_id);
  END IF;
END //
DELIMITER ;

CALL add_courses_instructor_column();
DROP PROCEDURE IF EXISTS add_courses_instructor_column;

-- ============================================================
-- 6. Add primary_instructor_id to sections table
-- ============================================================
DROP PROCEDURE IF EXISTS add_sections_instructor_column;
DELIMITER //
CREATE PROCEDURE add_sections_instructor_column()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
    AND table_name = 'sections'
    AND column_name = 'primary_instructor_id'
  ) THEN
    ALTER TABLE sections ADD COLUMN primary_instructor_id CHAR(36) DEFAULT NULL;
    ALTER TABLE sections ADD INDEX idx_sections_primary_instructor (primary_instructor_id);
  END IF;
END //
DELIMITER ;

CALL add_sections_instructor_column();
DROP PROCEDURE IF EXISTS add_sections_instructor_column;

-- ============================================================
-- 7. Mark all existing cases as shared (backward compatibility)
-- ============================================================
UPDATE cases SET is_shared = 1 WHERE is_shared = 0 OR is_shared IS NULL;

-- ============================================================
-- Summary of changes:
-- - Created instructors table for primary instructors and TAs
-- - Created instructor_semesters for linking primary instructors to semesters
-- - Created instructor_sections for linking TAs to sections with permissions
-- - Added case ownership columns (created_by, is_shared, etc.)
-- - Added primary_instructor_id to courses and sections
-- - Marked all existing cases as shared for backward compatibility
-- ============================================================
