-- Migration 018: Remove redundant columns from cases table
-- These columns have been migrated to case_scenarios table and are no longer needed in cases
-- protagonist, protagonist_initials, chat_topic, chat_question are now stored per-scenario

-- Before running this migration, ensure all cases have at least one scenario
-- with the protagonist data migrated (done in migration 005)

-- Remove the redundant columns (one at a time for compatibility)
ALTER TABLE cases DROP COLUMN protagonist;
ALTER TABLE cases DROP COLUMN protagonist_initials;
ALTER TABLE cases DROP COLUMN chat_topic;
ALTER TABLE cases DROP COLUMN chat_question;

-- Note: The case_scenarios table (created in migration 005) now holds:
-- - protagonist
-- - protagonist_initials
-- - protagonist_role
-- - chat_topic
-- - chat_question
