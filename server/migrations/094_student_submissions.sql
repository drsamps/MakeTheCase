-- Migration 094: the student's own work as material (StudyChat Phase 6, plan §6, decision D6).
--
-- student_submissions  one row per upload or paste; the newest for a student and assignment is the
--                      one a new chat uses. Earlier rows stay, because a chat pins the one it
--                      started on (case_chats.submission_id), so re-uploading never changes what a
--                      chat in progress or a past grade was based on. Student work: never in
--                      packages (activityPack/export.js reads no such table), removed with the
--                      student. Server code: server/services/studentSubmissions.js.

CREATE TABLE IF NOT EXISTS student_submissions (
  id INT NOT NULL AUTO_INCREMENT,
  section_id VARCHAR(20) NOT NULL,
  case_id VARCHAR(30) NOT NULL,
  student_id CHAR(36) NOT NULL,
  uploaded_by CHAR(36) NULL DEFAULT NULL,
  uploaded_by_role ENUM('student', 'instructor', 'admin') NOT NULL,
  filename VARCHAR(255) NULL DEFAULT NULL,
  converted_text MEDIUMTEXT NOT NULL,
  text_sha256 CHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_student_submissions_latest (section_id, case_id, student_id, id),
  KEY idx_student_submissions_student (student_id),
  CONSTRAINT fk_student_submissions_student FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE CASCADE,
  CONSTRAINT fk_student_submissions_case FOREIGN KEY (case_id) REFERENCES cases (case_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE case_chats
  ADD COLUMN submission_id INT NULL DEFAULT NULL,
  ADD CONSTRAINT fk_case_chats_submission FOREIGN KEY (submission_id) REFERENCES student_submissions (id) ON DELETE SET NULL;
