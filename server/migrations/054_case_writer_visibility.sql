-- 054_case_writer_visibility.sql
-- Add visibility + created_by_type to case_writer_projects so the same
-- Private/Team/Public model used by cases/rubrics/personas applies here.
--
-- Existing rows: owner_type already records who owns the project; map it to
-- created_by_type. owner_id is reused as created_by for the resource access
-- helpers (the access layer reads `created_by` by config).
--
-- Default visibility is 'private' — case-writer drafts are not shared by
-- default. Authors can flip to team or public from the editor once the
-- VisibilityPicker is wired in.

ALTER TABLE case_writer_projects
  ADD COLUMN visibility ENUM('private','team','public') NOT NULL DEFAULT 'private' AFTER status,
  ADD COLUMN created_by_type ENUM('admin','instructor','system') NOT NULL DEFAULT 'instructor' AFTER visibility;

-- Backfill created_by_type from the existing owner_type column.
UPDATE case_writer_projects
SET created_by_type = owner_type
WHERE owner_type IN ('admin','instructor');
