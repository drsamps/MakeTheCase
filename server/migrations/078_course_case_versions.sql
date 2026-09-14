-- Migration 078: course case lists and case settings versions.
--
-- Cases are assigned to COURSES; sections follow a version of each case's settings.
--
--   course_cases                    the course's case list (term-independent)
--   course_case_versions            settings for one case on one course:
--                                     semester_id IS NULL -> "Main" (exactly one per course case)
--                                     semester_id = N     -> a semester copy, shared by any subset
--                                                            of that semester's sections
--   course_case_version_scenarios   mirror of section_case_scenarios
--   course_case_version_positions   mirror of section_case_positions
--   section_cases.version_id        which version this section follows; NULL = "Customized"
--
-- LIVE INHERITANCE IS WRITE-THROUGH, NOT READ-TIME. Editing a version copies its settings into
-- every linked section_cases row (and replaces their scenario/position rows) in the same
-- transaction -- server/services/caseVersionSync.js. So the ~15 places that read section_cases
-- at chat time are unchanged. The price: EVERY writer of section-level settings must honour
-- version_id (409 CASE_FOLLOWS_VERSION unless ?detach=1). Scheduling columns (active, open_date,
-- close_date, manual_status) are per section and never written through.
--
-- Replaces the "template section" (courses.primary_section_id) + Sync, dropped at the end.
--
-- BACKFILL. For every (course, case) already assigned to a section of that course, Main is
-- built from one source row: the old template section's row if it has the case, otherwise the
-- row in the most recent semester. Every row of that course + case whose settings are
-- IDENTICAL to the source (scalar settings + scenario set + position overrides, compared by a
-- signature string) is linked to Main; the rest stay Customized. Nothing a student sees changes.

-- ============================================================================
-- 1. TABLES
-- ============================================================================

CREATE TABLE course_cases (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  course_id  INT NOT NULL,
  case_id    VARCHAR(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_course_case (course_id, case_id),
  KEY idx_course_cases_case (case_id),
  CONSTRAINT fk_course_cases_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
  CONSTRAINT fk_course_cases_case FOREIGN KEY (case_id) REFERENCES cases(case_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='A course''s case list. Sections get a section_cases row per course case.';

CREATE TABLE course_case_versions (
  version_id                INT AUTO_INCREMENT PRIMARY KEY,
  course_case_id            INT NOT NULL,
  semester_id               INT NULL COMMENT 'NULL = Main; otherwise a semester copy',
  label                     VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  parent_version_id         INT NULL COMMENT 'Version this was copied from',
  chat_options              JSON NULL,
  selection_mode            ENUM('student_choice','all_required') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'student_choice',
  require_order             TINYINT(1) NOT NULL DEFAULT 0,
  use_scenarios             TINYINT(1) NOT NULL DEFAULT 0,
  position_tracking_enabled TINYINT(1) NOT NULL DEFAULT 0,
  position_capture_method   ENUM('explicit','ai_inferred','instructor_manual','none') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'explicit',
  track_position_change     TINYINT(1) NOT NULL DEFAULT 1,
  rubric_id                 INT NULL,
  created_by                CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  created_at                TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  -- 1 on Main, NULL on semester copies: UNIQUE treats NULLs as distinct, so this allows one Main
  -- and any number of copies. Not a generated column: MySQL forbids CASCADE on the base columns
  -- of a stored generated column, and course_case_id/semester_id both need it. The app keeps
  -- is_main = 1 <=> semester_id IS NULL (caseVersionSync.js is the only writer).
  is_main                   TINYINT(1) NULL,
  UNIQUE KEY uq_one_main_per_course_case (course_case_id, is_main),
  KEY idx_versions_course_case (course_case_id),
  KEY idx_versions_semester (semester_id),
  CONSTRAINT fk_versions_course_case FOREIGN KEY (course_case_id) REFERENCES course_cases(id) ON DELETE CASCADE,
  CONSTRAINT fk_versions_semester FOREIGN KEY (semester_id) REFERENCES semesters(id) ON DELETE CASCADE,
  CONSTRAINT fk_versions_parent FOREIGN KEY (parent_version_id) REFERENCES course_case_versions(version_id) ON DELETE SET NULL,
  CONSTRAINT fk_versions_rubric FOREIGN KEY (rubric_id) REFERENCES rubrics(rubric_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Case settings shared by sections. Edits are written through to section_cases.';

CREATE TABLE course_case_version_scenarios (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  version_id  INT NOT NULL,
  scenario_id INT NOT NULL,
  enabled     TINYINT(1) DEFAULT 1,
  sort_order  INT DEFAULT 0,
  UNIQUE KEY uq_version_scenario (version_id, scenario_id),
  CONSTRAINT fk_vscen_version FOREIGN KEY (version_id) REFERENCES course_case_versions(version_id) ON DELETE CASCADE,
  CONSTRAINT fk_vscen_scenario FOREIGN KEY (scenario_id) REFERENCES case_scenarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE course_case_version_positions (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  version_id  INT NOT NULL,
  position_id INT NOT NULL,
  enabled     TINYINT(1) DEFAULT 1,
  sort_order  INT DEFAULT 0,
  UNIQUE KEY uq_version_position (version_id, position_id),
  CONSTRAINT fk_vpos_version FOREIGN KEY (version_id) REFERENCES course_case_versions(version_id) ON DELETE CASCADE,
  CONSTRAINT fk_vpos_position FOREIGN KEY (position_id) REFERENCES scenario_positions(position_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE section_cases
  ADD COLUMN version_id INT NULL
    COMMENT 'course_case_versions this row follows (settings written through); NULL = Customized' AFTER rubric_id,
  ADD KEY idx_section_cases_version (version_id),
  ADD CONSTRAINT fk_section_cases_version
    FOREIGN KEY (version_id) REFERENCES course_case_versions(version_id) ON DELETE SET NULL;

-- ============================================================================
-- 2. BACKFILL
-- ============================================================================

-- One row per section_cases row that belongs to a course, with a settings signature.
-- JSON is stored normalised (keys sorted), so CAST(... AS CHAR) compares by content.
CREATE TABLE _mig078_rows (
  sc_id      INT PRIMARY KEY,
  course_id  INT NOT NULL,
  case_id    VARCHAR(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  is_primary TINYINT(1) NOT NULL,
  sort_date  DATE NULL,
  sig        LONGTEXT NOT NULL,
  KEY idx_m78_pair (course_id, case_id)
) ENGINE=InnoDB;

SET SESSION group_concat_max_len = 1000000;

INSERT INTO _mig078_rows (sc_id, course_id, case_id, is_primary, sort_date, sig)
SELECT sc.id, s.course_id, sc.case_id,
       (co.primary_section_id <=> s.section_id),
       sem.start_date,
       CONCAT_WS('|',
         COALESCE(CAST(sc.chat_options AS CHAR), 'null'),
         sc.selection_mode, COALESCE(sc.require_order, 0), COALESCE(sc.use_scenarios, 0),
         COALESCE(sc.position_tracking_enabled, 0), COALESCE(sc.position_capture_method, ''),
         COALESCE(sc.track_position_change, 1), COALESCE(sc.rubric_id, ''),
         COALESCE((SELECT GROUP_CONCAT(CONCAT(x.scenario_id, ':', COALESCE(x.enabled, 1), ':', COALESCE(x.sort_order, 0))
                                       ORDER BY x.scenario_id)
                     FROM section_case_scenarios x WHERE x.section_case_id = sc.id), ''),
         COALESCE((SELECT GROUP_CONCAT(CONCAT(y.position_id, ':', COALESCE(y.enabled, 1), ':', COALESCE(y.sort_order, 0))
                                       ORDER BY y.position_id)
                     FROM section_case_positions y WHERE y.section_case_id = sc.id), '')
       )
  FROM section_cases sc
  JOIN sections s ON s.section_id = sc.section_id
  JOIN courses co ON co.id = s.course_id
  LEFT JOIN semesters sem ON sem.id = s.semester_id;

-- The source row per (course, case): template section first, then most recent semester, then lowest id.
CREATE TABLE _mig078_source (
  course_id INT NOT NULL,
  case_id   VARCHAR(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  sc_id     INT NOT NULL,
  PRIMARY KEY (course_id, case_id)
) ENGINE=InnoDB;

INSERT INTO _mig078_source (course_id, case_id, sc_id)
SELECT course_id, case_id,
       CAST(SUBSTRING_INDEX(GROUP_CONCAT(sc_id ORDER BY is_primary DESC, sort_date IS NULL, sort_date DESC, sc_id ASC), ',', 1) AS UNSIGNED)
  FROM _mig078_rows
 GROUP BY course_id, case_id;

INSERT INTO course_cases (course_id, case_id)
SELECT course_id, case_id FROM _mig078_source;

INSERT INTO course_case_versions
  (course_case_id, semester_id, is_main, label, chat_options, selection_mode, require_order, use_scenarios,
   position_tracking_enabled, position_capture_method, track_position_change, rubric_id)
SELECT cc.id, NULL, 1, 'Main', sc.chat_options, sc.selection_mode, COALESCE(sc.require_order, 0),
       COALESCE(sc.use_scenarios, 0), COALESCE(sc.position_tracking_enabled, 0), sc.position_capture_method,
       COALESCE(sc.track_position_change, 1), sc.rubric_id
  FROM _mig078_source src
  JOIN course_cases cc ON cc.course_id = src.course_id AND cc.case_id = src.case_id
  JOIN section_cases sc ON sc.id = src.sc_id;

INSERT INTO course_case_version_scenarios (version_id, scenario_id, enabled, sort_order)
SELECT v.version_id, x.scenario_id, x.enabled, x.sort_order
  FROM _mig078_source src
  JOIN course_cases cc ON cc.course_id = src.course_id AND cc.case_id = src.case_id
  JOIN course_case_versions v ON v.course_case_id = cc.id AND v.semester_id IS NULL
  JOIN section_case_scenarios x ON x.section_case_id = src.sc_id;

INSERT INTO course_case_version_positions (version_id, position_id, enabled, sort_order)
SELECT v.version_id, y.position_id, y.enabled, y.sort_order
  FROM _mig078_source src
  JOIN course_cases cc ON cc.course_id = src.course_id AND cc.case_id = src.case_id
  JOIN course_case_versions v ON v.course_case_id = cc.id AND v.semester_id IS NULL
  JOIN section_case_positions y ON y.section_case_id = src.sc_id;

-- Link every row whose settings match its Main's source row exactly.
UPDATE section_cases sc
  JOIN _mig078_rows r ON r.sc_id = sc.id
  JOIN _mig078_source src ON src.course_id = r.course_id AND src.case_id = r.case_id
  JOIN _mig078_rows srcrow ON srcrow.sc_id = src.sc_id
  JOIN course_cases cc ON cc.course_id = r.course_id AND cc.case_id = r.case_id
  JOIN course_case_versions v ON v.course_case_id = cc.id AND v.semester_id IS NULL
   SET sc.version_id = v.version_id
 WHERE r.sig = srcrow.sig;

DROP TABLE _mig078_source;
DROP TABLE _mig078_rows;

-- ============================================================================
-- 3. RETIRE THE TEMPLATE SECTION
-- ============================================================================

ALTER TABLE courses
  DROP FOREIGN KEY fk_courses_primary_section,
  DROP COLUMN primary_section_id,
  DROP COLUMN sync_scheduling;

-- ============================================================================
-- 4. VERIFICATION -- each query must return zero rows
-- ============================================================================

-- Every course case has exactly one Main.
SELECT cc.id, COUNT(v.version_id) AS mains
  FROM course_cases cc
  LEFT JOIN course_case_versions v ON v.course_case_id = cc.id AND v.semester_id IS NULL
 GROUP BY cc.id HAVING mains <> 1;

-- is_main out of step with semester_id.
SELECT version_id FROM course_case_versions WHERE (is_main = 1) <> (semester_id IS NULL);

-- A linked row whose version belongs to a different course or case.
SELECT sc.id FROM section_cases sc
  JOIN sections s ON s.section_id = sc.section_id
  JOIN course_case_versions v ON v.version_id = sc.version_id
  JOIN course_cases cc ON cc.id = v.course_case_id
 WHERE cc.course_id <> s.course_id OR cc.case_id <> sc.case_id;
