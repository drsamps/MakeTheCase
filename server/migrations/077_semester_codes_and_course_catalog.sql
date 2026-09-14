-- Migration 077: semester codes, a term-independent course catalog, and sections that
-- carry their own semester + section number.
--
-- BEFORE: semesters had only a free-text name ("Fall 2025"); a course belonged to exactly
-- one semester (courses.semester_id, UNIQUE (semester_id, course_name)), so a course that
-- runs every fall had to be re-created each year; section ids were typed by hand and
-- sections.year_term was a copy of the semester name that lists sorted alphabetically.
--
-- AFTER:
--   semesters.semester_code   'f26' -- the short semester id used to mint section ids.
--                             Format tyy (w / sp / su / f + 2-digit year). Non-conforming
--                             codes ('ongoing', 'unassigned') stay valid.
--   courses                   ONE row per course across all semesters, keyed by a unique
--                             lowercase course_code ('gscm410'). courses.semester_id is
--                             no longer read (kept NULLable here; a later migration drops it).
--   sections.semester_id      which semester the section runs in (FK).
--   sections.section_number   the n in {semester_code}-{course_code}-{n}.
--
-- IDS ARE MINTED FROM COLUMNS, NEVER PARSED AT RUNTIME. utils/academicIds.js mints new
-- section ids. The parsing below happens once, for the backfill. Existing section ids are
-- NOT renamed: they are referenced by case_chats, section_cases, student_sections,
-- instructor_sections, chat_options_defaults and model_usage, and the columns now carry
-- the truth, so a legacy id filters and groups exactly like a minted one.
--
-- NOTHING SORTS BY CODE OR NAME. w26 < sp26 < su26 < f26 chronologically, but alphabetically
-- f26 sorts first. semesters.start_date is the sort field; it is seeded below from an
-- approximate term start (the same TERMS table as utils/academicIds.js -- keep in sync) and
-- admins edit the real dates on the Semesters screen.
--
-- COURSE CODES ARE REWRITTEN (lowercased, stripped to [a-z0-9_]) because in this app
-- nothing references course_code -- no id embeds it -- so normalising it costs nothing and
-- lets every course mint section ids. Courses that share a normalised code across
-- semesters are MERGED into one row (the one in the most recent semester survives) and
-- their sections re-pointed. A course with no code gets one derived from its name,
-- truncated to 12 chars so '{su26}-{code}-{12}' still fits sections.section_id VARCHAR(20).

-- ============================================================================
-- 1. SEMESTERS: semester_code + seeded start dates
-- ============================================================================

ALTER TABLE semesters
  ADD COLUMN semester_code VARCHAR(10) NULL
    COMMENT 'Short semester id, e.g. f26. Minted into section ids. Unique.' AFTER id;

UPDATE semesters SET semester_code =
  CASE
    WHEN semester_name REGEXP '^(winter|spring|summer|fall)[[:space:]]*[0-9]{4}$' THEN CONCAT(
      CASE LOWER(REGEXP_SUBSTR(semester_name, '^[a-z]+'))
        WHEN 'winter' THEN 'w' WHEN 'spring' THEN 'sp' WHEN 'summer' THEN 'su' WHEN 'fall' THEN 'f'
      END,
      RIGHT(REGEXP_SUBSTR(semester_name, '[0-9]{4}$'), 2))
    WHEN semester_name REGEXP '^(sp|su|w|f)[0-9]{2}$' THEN LOWER(semester_name)
    ELSE LEFT(LOWER(REGEXP_REPLACE(semester_name, '[^A-Za-z0-9_]', '')), 10)
  END;

UPDATE semesters SET semester_code = CONCAT('sem', id)
 WHERE semester_code IS NULL OR semester_code = '';

-- Two names that normalise to one code ('Fall 2025' and 'Fall2025'): the lowest id keeps
-- the code, the others get an _id suffix. Merging them is an admin decision, not ours.
UPDATE semesters s
  JOIN (SELECT semester_code, MIN(id) AS keep_id
          FROM semesters GROUP BY semester_code HAVING COUNT(*) > 1) d
    ON d.semester_code = s.semester_code AND s.id <> d.keep_id
   SET s.semester_code = CONCAT(LEFT(s.semester_code, 9 - CHAR_LENGTH(s.id)), '_', s.id);

ALTER TABLE semesters
  MODIFY COLUMN semester_code VARCHAR(10) NOT NULL
    COMMENT 'Short semester id, e.g. f26. Minted into section ids. Unique.',
  ADD UNIQUE KEY uq_semester_code (semester_code);

-- Approximate term starts (keep in sync with TERMS in utils/academicIds.js).
UPDATE semesters
   SET start_date = STR_TO_DATE(CONCAT(
         2000 + CAST(REGEXP_SUBSTR(semester_code, '[0-9]{2}$') AS UNSIGNED), '-',
         CASE REGEXP_SUBSTR(semester_code, '^[a-z]+')
           WHEN 'w' THEN '01-01' WHEN 'sp' THEN '04-25' WHEN 'su' THEN '06-20' WHEN 'f' THEN '09-01'
         END), '%Y-%m-%d')
 WHERE start_date IS NULL
   AND semester_code REGEXP '^(sp|su|w|f)[0-9]{2}$';

-- ============================================================================
-- 2. CURRENT SEMESTER: repair the pointer, mirror the flag, add the FK
-- ============================================================================
-- POST /api/semesters used to set semesters.is_current without touching
-- system_state.current_semester_id, and a deleted semester left the pointer dangling --
-- GET /api/semesters/current then returned 404.

UPDATE system_state ss
  LEFT JOIN semesters s ON s.id = ss.current_semester_id
   SET ss.current_semester_id = (
         SELECT id FROM (
           SELECT id FROM semesters WHERE is_current = TRUE
            ORDER BY start_date IS NULL, start_date DESC, id DESC LIMIT 1
         ) AS flagged)
 WHERE ss.id = 1 AND s.id IS NULL;

UPDATE semesters sem
  LEFT JOIN system_state ss ON ss.id = 1
   SET sem.is_current = (ss.current_semester_id IS NOT NULL AND sem.id = ss.current_semester_id);

ALTER TABLE system_state
  ADD CONSTRAINT fk_system_state_current_semester
  FOREIGN KEY (current_semester_id) REFERENCES semesters(id) ON DELETE SET NULL;

-- ============================================================================
-- 3. SECTIONS: semester_id + section_number (backfilled BEFORE courses are merged,
--    because a section's semester currently comes from its course)
-- ============================================================================

ALTER TABLE sections
  ADD COLUMN semester_id INT NULL
    COMMENT 'FK to semesters.id - the semester this section runs in' AFTER course_id,
  ADD COLUMN section_number SMALLINT UNSIGNED NULL
    COMMENT 'n in {semester_code}-{course_code}-{n}; NULL for legacy ids that carry none' AFTER semester_id;

UPDATE sections s
  JOIN courses c ON c.id = s.course_id
   SET s.semester_id = c.semester_id
 WHERE s.semester_id IS NULL;

-- Sections with no course: match the year_term copy of the semester name.
UPDATE sections s
  JOIN semesters sem ON sem.semester_name = s.year_term
   SET s.semester_id = sem.id
 WHERE s.semester_id IS NULL;

-- Section number: the LAST 1-2 digit hyphen-delimited part that is followed only by parts
-- starting with a letter. GSCM401-2-F25 -> 2, f26-gscm410-12 -> 12, f25-410-2 -> 2 (not 410),
-- w26-adv-ops-emba -> NULL.
UPDATE sections
   SET section_number = CAST(REGEXP_SUBSTR(
         REGEXP_SUBSTR(section_id, '-[0-9]{1,2}(-[A-Za-z][A-Za-z0-9_]*)*$'), '[0-9]{1,2}') AS UNSIGNED)
 WHERE section_id REGEXP '-[0-9]{1,2}(-[A-Za-z][A-Za-z0-9_]*)*$';

UPDATE sections s
  JOIN semesters sem ON sem.id = s.semester_id
   SET s.year_term = sem.semester_name;

ALTER TABLE sections
  ADD CONSTRAINT fk_sections_semester
  FOREIGN KEY (semester_id) REFERENCES semesters(id);

-- ============================================================================
-- 4. COURSES: normalise codes, merge across semesters, detach from semesters
-- ============================================================================

CREATE TABLE _mig077_course_map (
  id          INT PRIMARY KEY,
  norm_code   VARCHAR(100) NOT NULL,
  from_name   TINYINT(1)   NOT NULL,
  sort_date   DATE         NULL,
  survivor_id INT          NULL
) ENGINE=InnoDB;

INSERT INTO _mig077_course_map (id, norm_code, from_name, sort_date)
SELECT c.id,
       LOWER(REGEXP_REPLACE(COALESCE(NULLIF(TRIM(c.course_code), ''), c.course_name), '[^A-Za-z0-9_]', '')),
       (c.course_code IS NULL OR TRIM(c.course_code) = ''),
       sem.start_date
  FROM courses c
  LEFT JOIN semesters sem ON sem.id = c.semester_id;

UPDATE _mig077_course_map SET norm_code = CONCAT('course', id) WHERE norm_code = '';

-- Survivor per code: the course in the most recent semester (undated last), then highest id.
UPDATE _mig077_course_map m
  JOIN (SELECT norm_code,
               CAST(SUBSTRING_INDEX(GROUP_CONCAT(id ORDER BY sort_date IS NULL, sort_date DESC, id DESC), ',', 1) AS UNSIGNED) AS survivor_id
          FROM _mig077_course_map
         GROUP BY norm_code) w
    ON w.norm_code = m.norm_code
   SET m.survivor_id = w.survivor_id;

-- A survivor with no owner/description inherits one from a merged row.
UPDATE courses keep
  JOIN _mig077_course_map km ON km.id = keep.id AND km.survivor_id = keep.id
  JOIN _mig077_course_map om ON om.survivor_id = keep.id AND om.id <> keep.id
  JOIN courses other ON other.id = om.id
   SET keep.primary_instructor_id = COALESCE(keep.primary_instructor_id, other.primary_instructor_id),
       keep.description = COALESCE(keep.description, other.description);

UPDATE sections s
  JOIN _mig077_course_map m ON m.id = s.course_id
   SET s.course_id = m.survivor_id
 WHERE m.id <> m.survivor_id;

DELETE c FROM courses c
  JOIN _mig077_course_map m ON m.id = c.id
 WHERE m.id <> m.survivor_id;

ALTER TABLE courses
  DROP FOREIGN KEY courses_ibfk_1,
  DROP INDEX unique_course_per_semester,
  MODIFY COLUMN semester_id INT NULL
    COMMENT 'DEPRECATED (migration 077): read by nothing. Courses span semesters; see sections.semester_id.';

-- Final codes: explicit codes keep their normalised form (<= 20); name-derived codes are
-- truncated to 12 so they can still be minted into a section id.
UPDATE courses c
  JOIN _mig077_course_map m ON m.id = c.id
   SET c.course_code = IF(m.from_name, LEFT(m.norm_code, 12), LEFT(m.norm_code, 20));

-- Truncation can collide: lowest id keeps the code, others get an _id suffix.
UPDATE courses c
  JOIN (SELECT course_code, MIN(id) AS keep_id
          FROM courses GROUP BY course_code HAVING COUNT(*) > 1) d
    ON d.course_code = c.course_code AND c.id <> d.keep_id
   SET c.course_code = CONCAT(LEFT(c.course_code, 11 - CHAR_LENGTH(c.id)), '_', c.id);

ALTER TABLE courses
  MODIFY COLUMN course_code VARCHAR(20) NOT NULL
    COMMENT 'Course id, e.g. gscm410. Lowercase [a-z0-9_]. Minted into section ids. Unique.',
  MODIFY COLUMN course_name VARCHAR(100) NOT NULL
    COMMENT 'e.g. GSCM 410 - Ops Mgt',
  MODIFY COLUMN primary_instructor_id CHAR(36) NULL
    COMMENT 'Course owner: controls the course case list and its sections',
  ADD UNIQUE KEY uq_course_code (course_code);

-- Two legacy ids in one course + semester that parsed to the same number: the
-- alphabetically first keeps it, the rest go back to NULL (legacy, unnumbered).
UPDATE sections s
  JOIN (SELECT course_id, semester_id, section_number, MIN(section_id) AS keep_id
          FROM sections
         WHERE course_id IS NOT NULL AND semester_id IS NOT NULL AND section_number IS NOT NULL
         GROUP BY course_id, semester_id, section_number HAVING COUNT(*) > 1) d
    ON d.course_id = s.course_id AND d.semester_id = s.semester_id
   AND d.section_number = s.section_number AND s.section_id <> d.keep_id
   SET s.section_number = NULL;

ALTER TABLE sections
  ADD UNIQUE KEY uq_section_course_semester_number (course_id, semester_id, section_number);

DROP TABLE _mig077_course_map;

-- ============================================================================
-- 5. VERIFICATION -- each query must return zero rows
-- ============================================================================

-- Sections attached to a course but not to a semester.
SELECT section_id, course_id FROM sections WHERE course_id IS NOT NULL AND semester_id IS NULL;

-- Duplicate course codes / semester codes.
SELECT course_code, COUNT(*) FROM courses GROUP BY course_code HAVING COUNT(*) > 1;
SELECT semester_code, COUNT(*) FROM semesters GROUP BY semester_code HAVING COUNT(*) > 1;

-- system_state pointing at a missing semester.
SELECT ss.current_semester_id FROM system_state ss
  LEFT JOIN semesters s ON s.id = ss.current_semester_id
 WHERE ss.current_semester_id IS NOT NULL AND s.id IS NULL;
