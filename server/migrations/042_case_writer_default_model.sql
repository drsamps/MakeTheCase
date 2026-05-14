-- Migration: 042_case_writer_default_model.sql
-- Date: 2026-05-13
-- Description: Add a project-level default model id to case_writer_projects.
--              Each generate handler resolves the model with this precedence:
--                req.body.model_id (per-call override) ||
--                project.default_model_id ||
--                resolveDefault().

ALTER TABLE `case_writer_projects`
  ADD COLUMN `default_model_id` VARCHAR(100) NULL AFTER `publish_arguments_against`;
