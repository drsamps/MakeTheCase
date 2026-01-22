-- Migration: 011_cleanup_redundant_columns.sql
-- Purpose: Remove redundant transcript/persona/hints columns after successful migration
-- Date: 2026-01-12
-- Related: dev/2026-01-12-table-redundancy-analysis.md
-- WARNING: Only run this AFTER verifying migrations 009 and 010 completed successfully!
-- WARNING: BACKUP YOUR DATABASE before running this script!

-- ============================================================
-- SAFETY CHECKS (uncomment and run these first!)
-- ============================================================

-- Verify all transcripts migrated successfully:
-- SELECT 
--   (SELECT COUNT(*) FROM case_chats WHERE transcript IS NOT NULL AND transcript != '') as cc_count,
--   (SELECT COUNT(*) FROM evaluations WHERE transcript IS NOT NULL AND transcript != '') as eval_count,
--   (SELECT COUNT(*) FROM transcripts) as transcript_count;
-- 
-- These numbers should make sense. Total transcripts should equal or exceed the sum of non-null transcripts.

-- Check for evaluations without case_chat_id (should be 0 or minimal):
-- SELECT COUNT(*) as orphaned_evaluations FROM evaluations WHERE case_chat_id IS NULL;

-- ============================================================
-- PHASE 1: Make case_chat_id NOT NULL in evaluations
-- ============================================================

-- First, handle any remaining NULL case_chat_ids (if any exist)
-- You may want to review these manually before proceeding
SELECT 
  e.id,
  e.student_id,
  e.case_id,
  e.created_at,
  'Evaluation without case_chat - review before cleanup'
FROM evaluations e
WHERE e.case_chat_id IS NULL;

-- Make case_chat_id required (only if verification above shows 0 orphans)
-- ALTER TABLE evaluations 
--   MODIFY case_chat_id CHAR(36) NOT NULL;

-- ============================================================
-- PHASE 2: Remove redundant columns from evaluations
-- ============================================================

-- Remove redundant columns from evaluations using procedure
DROP PROCEDURE IF EXISTS cleanup_evaluation_columns;
DELIMITER //
CREATE PROCEDURE cleanup_evaluation_columns()
BEGIN
  -- Remove transcript column
  IF EXISTS (SELECT * FROM information_schema.columns 
             WHERE table_schema = DATABASE() 
             AND table_name = 'evaluations' 
             AND column_name = 'transcript') THEN
    ALTER TABLE evaluations DROP COLUMN transcript;
  END IF;
  
  -- Remove persona column
  IF EXISTS (SELECT * FROM information_schema.columns 
             WHERE table_schema = DATABASE() 
             AND table_name = 'evaluations' 
             AND column_name = 'persona') THEN
    ALTER TABLE evaluations DROP COLUMN persona;
  END IF;
  
  -- Remove hints column
  IF EXISTS (SELECT * FROM information_schema.columns 
             WHERE table_schema = DATABASE() 
             AND table_name = 'evaluations' 
             AND column_name = 'hints') THEN
    ALTER TABLE evaluations DROP COLUMN hints;
  END IF;
  
  -- Remove chat_model column
  IF EXISTS (SELECT * FROM information_schema.columns 
             WHERE table_schema = DATABASE() 
             AND table_name = 'evaluations' 
             AND column_name = 'chat_model') THEN
    ALTER TABLE evaluations DROP COLUMN chat_model;
  END IF;
END //
DELIMITER ;
CALL cleanup_evaluation_columns();
DROP PROCEDURE IF EXISTS cleanup_evaluation_columns;

-- ============================================================
-- PHASE 3: Remove transcript column from case_chats
-- ============================================================

-- Remove transcript column using procedure
DROP PROCEDURE IF EXISTS cleanup_casechats_transcript;
DELIMITER //
CREATE PROCEDURE cleanup_casechats_transcript()
BEGIN
  IF EXISTS (SELECT * FROM information_schema.columns 
             WHERE table_schema = DATABASE() 
             AND table_name = 'case_chats' 
             AND column_name = 'transcript') THEN
    ALTER TABLE case_chats DROP COLUMN transcript;
  END IF;
END //
DELIMITER ;
CALL cleanup_casechats_transcript();
DROP PROCEDURE IF EXISTS cleanup_casechats_transcript;

-- ============================================================
-- PHASE 4: Remove circular reference from case_chats (OPTIONAL)
-- ============================================================

-- This is optional but recommended for cleaner architecture
-- evaluations.case_chat_id is sufficient for the relationship

-- Remove foreign key and evaluation_id column using procedure
DROP PROCEDURE IF EXISTS remove_circular_reference;
DELIMITER //
CREATE PROCEDURE remove_circular_reference()
BEGIN
  DECLARE fk_exists INT DEFAULT 0;
  
  -- Check if foreign key exists
  SELECT COUNT(*) INTO fk_exists FROM information_schema.table_constraints
    WHERE table_schema = DATABASE() 
    AND table_name = 'case_chats' 
    AND constraint_name = 'case_chats_evaluation_fk';
  
  -- Drop foreign key if it exists
  IF fk_exists > 0 THEN
    ALTER TABLE case_chats DROP FOREIGN KEY case_chats_evaluation_fk;
  END IF;
  
  -- Drop evaluation_id column if it exists
  IF EXISTS (SELECT * FROM information_schema.columns 
             WHERE table_schema = DATABASE() 
             AND table_name = 'case_chats' 
             AND column_name = 'evaluation_id') THEN
    ALTER TABLE case_chats DROP COLUMN evaluation_id;
  END IF;
END //
DELIMITER ;
CALL remove_circular_reference();
DROP PROCEDURE IF EXISTS remove_circular_reference;

-- ============================================================
-- PHASE 5: Add comments to document the new structure
-- ============================================================

ALTER TABLE case_chats 
  COMMENT = 'Chat session lifecycle tracking - links to transcripts via transcript_id';

ALTER TABLE evaluations 
  COMMENT = 'AI evaluation results - links to case_chats for operational data';

ALTER TABLE transcripts 
  COMMENT = 'Chat transcripts with privacy controls - linked to case_chats';

-- ============================================================
-- Verification Queries (run after cleanup)
-- ============================================================

-- Verify columns removed:
-- DESCRIBE evaluations;
-- DESCRIBE case_chats;

-- Verify relationships intact:
-- SELECT 
--   cc.id as case_chat_id,
--   cc.student_id,
--   cc.case_id,
--   t.id as transcript_id,
--   t.word_count,
--   e.id as evaluation_id,
--   e.score
-- FROM case_chats cc
-- LEFT JOIN transcripts t ON t.case_chat_id = cc.id
-- LEFT JOIN evaluations e ON e.case_chat_id = cc.id
-- WHERE cc.status = 'completed'
-- LIMIT 10;
