-- Migration: Add superuser and permission system to admins table
-- Date: 2026-01-04
-- Description: Implements two-tier admin system with superusers and regular instructors

USE ceochat;

-- Add superuser column (boolean - all existing admins become superusers by default for safety)
ALTER TABLE admins
  ADD COLUMN superuser TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'Superuser has full access by default';

-- Add admin_access column for granular permissions (comma-separated list)
ALTER TABLE admins
  ADD COLUMN admin_access TEXT DEFAULT NULL COMMENT 'Comma-separated list of allowed functions for non-superusers';

-- Create index for faster superuser lookups
ALTER TABLE admins ADD INDEX idx_admins_superuser (superuser);

-- Ensure all existing admins are superusers (migration safety - prevents lockout)
UPDATE admins SET superuser = 1 WHERE superuser IS NULL OR superuser = 0;

-- Verify migration
SELECT 'Migration completed successfully' AS status, COUNT(*) AS total_admins,
       SUM(superuser) AS superusers FROM admins;
