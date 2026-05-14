-- Migration 043: switch the four Case Writer markdown columns from JSON to LONGTEXT.
--
-- After the markdown-first switch, learning_brief, case_blueprint, student_case,
-- and teaching_note hold pure markdown strings. Keeping them as JSON columns
-- forced JSON.stringify on every write and a parse helper on every read, and
-- left the values stored as escaped JSON strings (unreadable in DB tools).
--
-- The existing rows in these four columns are test data only and need not be
-- preserved. We NULL them first so the ALTER has nothing to coerce, then change
-- the type.
--
-- scenario_options and selected_scenario stay as JSON — they have real structure.

-- 1. Clear test data so the ALTER does no JSON-to-LONGTEXT coercion.
UPDATE case_writer_projects
SET learning_brief = NULL,
    case_blueprint = NULL,
    student_case   = NULL,
    teaching_note  = NULL;

-- 2. Switch the column type. All values are NULL at this point.
ALTER TABLE case_writer_projects
  MODIFY COLUMN learning_brief LONGTEXT NULL
    COMMENT 'Markdown body of the teaching brief (was JSON before migration 043)',
  MODIFY COLUMN case_blueprint LONGTEXT NULL
    COMMENT 'Markdown body of the case blueprint (was JSON before migration 043)',
  MODIFY COLUMN student_case   LONGTEXT NULL
    COMMENT 'Markdown body of the student-facing case (was JSON before migration 043)',
  MODIFY COLUMN teaching_note  LONGTEXT NULL
    COMMENT 'Markdown body of the teaching note (was JSON before migration 043)';
