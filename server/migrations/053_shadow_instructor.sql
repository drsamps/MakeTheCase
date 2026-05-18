-- Migration: 053_shadow_instructor.sql
-- Date: 2026-05-15
-- Description: Adds an `is_system_account` flag to the instructors table and
--              seeds a single shadow account (admin_instructor@system.local)
--              that legacy ownership will be back-filled against.
--
--              The shadow account:
--                - is inactive (cannot log in)
--                - has a deliberately-invalid password_hash so any bcrypt
--                  compare returns false
--                - is hidden from regular instructor pickers
--                - is the parking spot for resources created before
--                  multi-instructor ownership existed
--
--              The admin can later reassign individual resources (or all of
--              them) from the shadow to the appropriate real instructor via
--              an admin "transfer ownership" flow.

ALTER TABLE `instructors`
  ADD COLUMN `is_system_account` TINYINT(1) NOT NULL DEFAULT 0 AFTER `active`,
  ADD INDEX `idx_instructors_system_account` (`is_system_account`);

-- Fixed UUID so other code can reference the shadow account by a stable id.
INSERT INTO `instructors`
  (`id`, `email`, `password_hash`, `first_name`, `last_name`, `full_name`,
   `active`, `is_system_account`, `use_system_key`, `can_publish`)
VALUES
  ('00000000-0000-0000-0000-000000000001',
   'admin_instructor@system.local',
   '!shadow-account-not-loginable!',
   'Admin',
   'Instructor',
   'Admin Instructor (system)',
   0,  -- active=0 so the auth route rejects login attempts
   1,  -- is_system_account=1
   0,
   0)
ON DUPLICATE KEY UPDATE `is_system_account` = 1;
