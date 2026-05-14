-- Migration: 039_case_writer_publish_meta.sql
-- Date: 2026-05-13
-- Description: Add publish-time metadata columns to case_writer_projects so that
--              the user can supply (or auto-fill) the structured fields needed
--              for the published case_scenarios row. With the move to markdown-
--              first outputs we can no longer dig these values out of the
--              generated JSON, so they live on the project itself.

ALTER TABLE `case_writer_projects`
  ADD COLUMN `publish_protagonist` VARCHAR(255) NULL AFTER `teaching_note`,
  ADD COLUMN `publish_chat_question` TEXT NULL AFTER `publish_protagonist`,
  ADD COLUMN `publish_arguments_for` TEXT NULL AFTER `publish_chat_question`,
  ADD COLUMN `publish_arguments_against` TEXT NULL AFTER `publish_arguments_for`;
