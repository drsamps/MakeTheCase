-- Migration: 051_settings_scoping.sql
-- Date: 2026-05-15
-- Description: Scope the `settings` table by (scope, scope_id) so that the
--              same setting_key can have global, per-instructor, and
--              per-section values. Existing rows are back-filled as global.
--
--              Reserved global-only keys (will be enforced in route):
--                feature flags, logging_*, log_*, active_prompt_*,
--                default_model_id, max_log_files.

-- Add scope columns first; default everything to global so the existing PK
-- stays unique while we drop and recreate it.
ALTER TABLE `settings`
  ADD COLUMN `scope` ENUM('global', 'instructor', 'section') NOT NULL DEFAULT 'global' AFTER `setting_key`,
  ADD COLUMN `scope_id` VARCHAR(64) NOT NULL DEFAULT '' AFTER `scope`;

ALTER TABLE `settings`
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (`setting_key`, `scope`, `scope_id`),
  ADD INDEX `idx_settings_scope_lookup` (`scope`, `scope_id`);
