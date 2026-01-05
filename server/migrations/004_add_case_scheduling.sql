-- Migration: Add date/time scheduling controls to section_cases
-- Created: 2026-01-05
-- Description: Adds open_date, close_date, and manual_status fields to control when cases are available to students

-- Add new columns to section_cases table
ALTER TABLE section_cases
ADD COLUMN open_date DATETIME NULL COMMENT 'Date and time when case becomes available to students',
ADD COLUMN close_date DATETIME NULL COMMENT 'Date and time when case is no longer available for starting (existing chats can continue)',
ADD COLUMN manual_status ENUM('auto', 'manually_opened', 'manually_closed') NOT NULL DEFAULT 'auto' COMMENT 'Manual override: auto uses dates, manually_opened always available, manually_closed never available';

-- Add indexes for better query performance
ALTER TABLE section_cases
ADD INDEX idx_scheduling (section_id, open_date, close_date, manual_status);
