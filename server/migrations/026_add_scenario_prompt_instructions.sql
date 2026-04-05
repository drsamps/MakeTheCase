-- Migration: 026_add_scenario_prompt_instructions.sql
-- Purpose: Add prompt_instructions column to case_scenarios for per-scenario AI prompt customization
-- Date: 2026-04-04

-- Add prompt_instructions column (TEXT, after chat_question)
DROP PROCEDURE IF EXISTS add_prompt_instructions;
DELIMITER //
CREATE PROCEDURE add_prompt_instructions()
BEGIN
  DECLARE column_exists INT DEFAULT 0;

  SELECT COUNT(*) INTO column_exists FROM information_schema.columns
  WHERE table_schema = DATABASE()
  AND table_name = 'case_scenarios'
  AND column_name = 'prompt_instructions';

  IF column_exists = 0 THEN
    ALTER TABLE case_scenarios
    ADD COLUMN prompt_instructions TEXT DEFAULT NULL
    COMMENT 'Additional instructions included in the AI chat prompt (not shown to student)'
    AFTER chat_question;
  END IF;
END //
DELIMITER ;
CALL add_prompt_instructions();
DROP PROCEDURE IF EXISTS add_prompt_instructions;

-- Verification
SELECT column_name, data_type, column_comment
FROM information_schema.columns
WHERE table_schema = DATABASE()
AND table_name = 'case_scenarios'
AND column_name = 'prompt_instructions';
