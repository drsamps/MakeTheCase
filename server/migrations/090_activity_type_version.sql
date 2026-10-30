-- Migration 090: record which version of its activity type each chat ran on and each evaluation
-- was graded with (StudyChat Phase 1, dev/StudyChat-plan.md §4).
--
-- The value is the type's version tag from server/services/activityTypes.js: for a built-in type
-- `case_chat@<first 12 hex of the definition's sha256>`; from Phase 2, a custom or system type's
-- version id. Written by POST /api/case-chats and POST /api/evaluations/run. NULL on rows from
-- before this migration (they ran on the hand-written builders, which the engine reproduces byte
-- for byte).

ALTER TABLE case_chats
  ADD COLUMN activity_type_version VARCHAR(80) NULL DEFAULT NULL AFTER persona;

ALTER TABLE evaluations
  ADD COLUMN activity_type_version VARCHAR(80) NULL DEFAULT NULL AFTER rubric_id;
