-- Migration 075: Case Writer — record where an uploaded reference's file landed on disk
--
-- `POST /projects/:id/references/upload` writes the uploaded file to
--   case_files/cw-<projectId>/uploads/<basename>-<timestamp><ext>
-- and then stores only the EXTRACTED TEXT in `case_writer_references.content`. The
-- path was never recorded anywhere — `source_notes` keeps a human-readable
-- "Uploaded file: report.pdf (1519040 bytes)" line and nothing machine-readable —
-- so there has been no way to hand the instructor back the original document.
--
-- These two columns close that gap going forward. The new
-- GET /projects/:id/references/:refId/download-original route streams the file when
-- `upload_stored_path` is set, and the UI hides the "Original file" download option
-- when it is NULL. Uploads made before this migration therefore keep working
-- normally; they simply do not offer that one download.
--
-- Deliberately NOT backfilled: matching the recorded name and byte size against the
-- upload directories would recover most rows, but a wrong match hands an instructor
-- someone else's document, and the failure is silent. A backfill script can be run
-- separately if the recovery is wanted.
--
-- `upload_stored_path` holds a path RELATIVE to the case_files/ directory. The
-- download route resolves it and refuses anything that escapes that root, so a
-- tampered value cannot be turned into an arbitrary file read.

ALTER TABLE `case_writer_references`
  ADD COLUMN `upload_original_name` VARCHAR(255) DEFAULT NULL
    COMMENT 'Original filename as uploaded; NULL for non-uploads and pre-075 rows' AFTER `fetched_final_url`,
  ADD COLUMN `upload_stored_path`   VARCHAR(512) DEFAULT NULL
    COMMENT 'Path to the stored file, relative to case_files/; NULL when unknown' AFTER `upload_original_name`;
