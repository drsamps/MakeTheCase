-- Migration 095: email/password sign-in for non-BYU students, and Student view (preview students).
--
-- students.email / password_hash   came from the unnumbered add_case_chats_table.sql; added here
--                                  only if missing. A student with a password_hash can sign in
--                                  with email + password (POST /api/auth/student-login).
-- students.preview_for             'admin:<id>' or 'instructor:<id>' for the one preview student
--                                  each staff member gets from Dashboard > Student view; NULL for
--                                  real students. Instructor-facing counts and analytics must
--                                  exclude rows where it is NOT NULL.
-- allow_student_self_register      global setting; when 'true', email students may create their
--                                  own account, and only into a section that has an enrollment key.
--
-- Conditional DDL uses PREPARE (the migration runner sends the file through mysql2, which has
-- no DELIMITER support).

SET @s = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'students' AND column_name = 'email') = 0,
  'ALTER TABLE students ADD COLUMN email VARCHAR(255) NULL AFTER full_name',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'students' AND index_name = 'idx_students_email') = 0,
  'CREATE UNIQUE INDEX idx_students_email ON students (email)',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'students' AND column_name = 'password_hash') = 0,
  'ALTER TABLE students ADD COLUMN password_hash VARCHAR(255) NULL AFTER email',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

ALTER TABLE students
  ADD COLUMN preview_for VARCHAR(80) NULL DEFAULT NULL,
  ADD UNIQUE KEY uq_students_preview_for (preview_for);

INSERT IGNORE INTO settings (setting_key, scope, scope_id, setting_value, description)
VALUES (
  'allow_student_self_register',
  'global',
  '',
  'false',
  'When true, students without a BYU NetID may create their own email/password account from the hidden student sign-in form (Ctrl-click or long-press the NetID button), but only to join a section that has an enrollment key.'
);
