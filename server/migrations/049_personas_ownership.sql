-- Migration: 049_personas_ownership.sql
-- Date: 2026-05-15
-- Description: Adds ownership and visibility scoping to personas so each
--              instructor can author/own private personas while the 5 seeded
--              system personas remain read-only and visible to everyone.

ALTER TABLE `personas`
  ADD COLUMN `is_system_default` TINYINT(1) NOT NULL DEFAULT 0 AFTER `instructions`,
  ADD COLUMN `created_by` CHAR(36) NULL AFTER `is_system_default`,
  ADD COLUMN `created_by_type` ENUM('admin', 'instructor', 'system') NOT NULL DEFAULT 'system' AFTER `created_by`,
  ADD COLUMN `visibility` ENUM('private', 'team', 'public') NOT NULL DEFAULT 'private' AFTER `created_by_type`,
  ADD INDEX `idx_personas_visibility` (`visibility`),
  ADD INDEX `idx_personas_created_by` (`created_by`),
  ADD INDEX `idx_personas_system_default` (`is_system_default`);

-- The 5 seeded personas (moderate, strict, liberal, leading, sycophantic) are
-- system defaults and visible to all instructors as read-only.
UPDATE `personas`
  SET `is_system_default` = 1,
      `created_by_type` = 'system',
      `visibility` = 'public',
      `created_by` = NULL
  WHERE `persona_id` IN ('moderate', 'strict', 'liberal', 'leading', 'sycophantic');
