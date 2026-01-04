-- Migration: Add case_chats table for tracking chat sessions
-- Date: 2025-01-03
-- Description: Supports multiple chats per student with full lifecycle tracking
-- Note: MySQL does NOT support "IF NOT EXISTS" for ADD COLUMN or CREATE INDEX.
--       This migration uses stored procedures for conditional DDL operations.

-- ============================================================================
-- STEP 1: Create case_chats table
-- ============================================================================

CREATE TABLE IF NOT EXISTS `case_chats` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `student_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `case_id` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `section_id` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'started',
  `persona` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `hints_used` int NOT NULL DEFAULT 0,
  `chat_model` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `start_time` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_activity` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `end_time` timestamp NULL DEFAULT NULL,
  `transcript` text COLLATE utf8mb4_unicode_ci,
  `evaluation_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_student_id` (`student_id`),
  KEY `idx_case_id` (`case_id`),
  KEY `idx_section_id` (`section_id`),
  KEY `idx_status` (`status`),
  KEY `idx_student_case` (`student_id`, `case_id`),
  KEY `idx_last_activity` (`last_activity`),
  KEY `idx_evaluation_id` (`evaluation_id`),
  CONSTRAINT `case_chats_student_fk` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `case_chats_case_fk` FOREIGN KEY (`case_id`) REFERENCES `cases` (`case_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `case_chats_section_fk` FOREIGN KEY (`section_id`) REFERENCES `sections` (`section_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `case_chats_chat_model_fk` FOREIGN KEY (`chat_model`) REFERENCES `models` (`model_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `case_chats_evaluation_fk` FOREIGN KEY (`evaluation_id`) REFERENCES `evaluations` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- STEP 2: Modify students table - add auth columns (using procedure)
-- ============================================================================

DROP PROCEDURE IF EXISTS add_students_columns;
DELIMITER //
CREATE PROCEDURE add_students_columns()
BEGIN
  DECLARE email_exists INT DEFAULT 0;
  DECLARE password_hash_exists INT DEFAULT 0;

  -- Check if email column exists
  SELECT COUNT(*) INTO email_exists FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'students' AND column_name = 'email';

  -- Check if password_hash column exists
  SELECT COUNT(*) INTO password_hash_exists FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'students' AND column_name = 'password_hash';

  -- Add email column if it doesn't exist
  IF email_exists = 0 THEN
    ALTER TABLE students ADD COLUMN `email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `full_name`;
  END IF;

  -- Add password_hash column if it doesn't exist
  IF password_hash_exists = 0 THEN
    ALTER TABLE students ADD COLUMN `password_hash` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `email`;
  END IF;
END //
DELIMITER ;
CALL add_students_columns();
DROP PROCEDURE IF EXISTS add_students_columns;

-- Add unique index on email (if column exists and index doesn't)
DROP PROCEDURE IF EXISTS add_email_index;
DELIMITER //
CREATE PROCEDURE add_email_index()
BEGIN
  DECLARE column_exists INT DEFAULT 0;
  DECLARE index_exists INT DEFAULT 0;

  SELECT COUNT(*) INTO column_exists FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'students' AND column_name = 'email';

  IF column_exists = 1 THEN
    SELECT COUNT(*) INTO index_exists FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'students' AND index_name = 'idx_students_email';
    IF index_exists = 0 THEN
      CREATE UNIQUE INDEX idx_students_email ON students(email);
    END IF;
  END IF;
END //
DELIMITER ;
CALL add_email_index();
DROP PROCEDURE IF EXISTS add_email_index;

-- ============================================================================
-- STEP 3: Rename persona to favorite_persona (optional - for clarity)
-- ============================================================================

DROP PROCEDURE IF EXISTS rename_persona_column;
DELIMITER //
CREATE PROCEDURE rename_persona_column()
BEGIN
  DECLARE persona_exists INT DEFAULT 0;
  DECLARE fav_persona_exists INT DEFAULT 0;

  SELECT COUNT(*) INTO persona_exists FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'students' AND column_name = 'persona';
  SELECT COUNT(*) INTO fav_persona_exists FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'students' AND column_name = 'favorite_persona';

  IF persona_exists = 1 AND fav_persona_exists = 0 THEN
    ALTER TABLE students CHANGE COLUMN `persona` `favorite_persona` text COLLATE utf8mb4_unicode_ci;
  END IF;
END //
DELIMITER ;
CALL rename_persona_column();
DROP PROCEDURE IF EXISTS rename_persona_column;

-- ============================================================================
-- STEP 4: Add case_chat_id to evaluations table (using procedure)
-- ============================================================================

DROP PROCEDURE IF EXISTS add_case_chat_id_column;
DELIMITER //
CREATE PROCEDURE add_case_chat_id_column()
BEGIN
  DECLARE column_exists INT DEFAULT 0;

  SELECT COUNT(*) INTO column_exists FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'evaluations' AND column_name = 'case_chat_id';

  IF column_exists = 0 THEN
    ALTER TABLE evaluations ADD COLUMN `case_chat_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `case_id`;
  END IF;
END //
DELIMITER ;
CALL add_case_chat_id_column();
DROP PROCEDURE IF EXISTS add_case_chat_id_column;

-- Add foreign key (using procedure for conditional DDL)
DROP PROCEDURE IF EXISTS add_case_chat_fk;
DELIMITER //
CREATE PROCEDURE add_case_chat_fk()
BEGIN
  DECLARE fk_exists INT DEFAULT 0;
  DECLARE column_exists INT DEFAULT 0;

  SELECT COUNT(*) INTO column_exists FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'evaluations' AND column_name = 'case_chat_id';

  IF column_exists = 1 THEN
    SELECT COUNT(*) INTO fk_exists FROM information_schema.table_constraints
      WHERE table_schema = DATABASE() AND table_name = 'evaluations' AND constraint_name = 'evaluations_case_chat_fk';
    IF fk_exists = 0 THEN
      ALTER TABLE evaluations
        ADD CONSTRAINT `evaluations_case_chat_fk` FOREIGN KEY (`case_chat_id`) REFERENCES `case_chats` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
  END IF;
END //
DELIMITER ;
CALL add_case_chat_fk();
DROP PROCEDURE IF EXISTS add_case_chat_fk;

-- Add index on case_chat_id
DROP PROCEDURE IF EXISTS add_case_chat_idx;
DELIMITER //
CREATE PROCEDURE add_case_chat_idx()
BEGIN
  DECLARE index_exists INT DEFAULT 0;
  DECLARE column_exists INT DEFAULT 0;

  SELECT COUNT(*) INTO column_exists FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'evaluations' AND column_name = 'case_chat_id';

  IF column_exists = 1 THEN
    SELECT COUNT(*) INTO index_exists FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'evaluations' AND index_name = 'idx_case_chat_id';
    IF index_exists = 0 THEN
      CREATE INDEX idx_case_chat_id ON evaluations(case_chat_id);
    END IF;
  END IF;
END //
DELIMITER ;
CALL add_case_chat_idx();
DROP PROCEDURE IF EXISTS add_case_chat_idx;

-- ============================================================================
-- Status Values Reference:
-- ============================================================================
-- 'started'     - Chat session created, student may not have sent first message
-- 'in_progress' - At least one exchange has occurred
-- 'abandoned'   - No activity for extended period (set by background job)
-- 'canceled'    - Student explicitly canceled without completing
-- 'killed'      - Admin terminated the chat session
-- 'completed'   - Chat finished normally with evaluation
-- ============================================================================
