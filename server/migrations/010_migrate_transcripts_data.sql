-- Migration: 010_migrate_transcripts_data.sql
-- Purpose: Migrate existing transcripts from case_chats and evaluations to new transcripts table
-- Date: 2026-01-12
-- Related: dev/2026-01-12-table-redundancy-analysis.md
-- WARNING: Run 009_create_transcripts_table.sql first!

-- ============================================================
-- PHASE 1: Migrate transcripts from case_chats (newer records)
-- ============================================================

INSERT INTO transcripts (id, case_chat_id, transcript, created_at, word_count, saved_with_permission)
SELECT 
  UUID() as id,
  cc.id as case_chat_id,
  cc.transcript,
  COALESCE(cc.end_time, cc.last_activity, cc.start_time) as created_at,
  CASE 
    WHEN cc.transcript IS NOT NULL THEN 
      LENGTH(TRIM(cc.transcript)) - LENGTH(REPLACE(TRIM(cc.transcript), ' ', '')) + 1
    ELSE 0 
  END as word_count,
  TRUE as saved_with_permission
FROM case_chats cc
WHERE cc.transcript IS NOT NULL AND cc.transcript != '';

-- ============================================================
-- PHASE 2: Create case_chats for legacy evaluations
-- ============================================================

-- Create case_chats records for evaluations that don't have them yet
INSERT INTO case_chats (
  id, 
  student_id, 
  case_id, 
  status, 
  persona, 
  hints_used, 
  chat_model, 
  start_time,
  end_time
)
SELECT 
  UUID() as id,
  e.student_id,
  e.case_id,
  'completed' as status,
  e.persona,
  COALESCE(e.hints, 0) as hints_used,
  e.chat_model,
  e.created_at as start_time,
  e.created_at as end_time
FROM evaluations e
WHERE e.case_chat_id IS NULL
  AND e.case_id IS NOT NULL;

-- Update evaluations to reference their new case_chats
UPDATE evaluations e
JOIN case_chats cc ON cc.student_id = e.student_id 
  AND cc.case_id = e.case_id 
  AND cc.end_time = e.created_at
SET e.case_chat_id = cc.id
WHERE e.case_chat_id IS NULL
  AND cc.status = 'completed';

-- ============================================================
-- PHASE 3: Migrate transcripts from evaluations (legacy records)
-- ============================================================

INSERT INTO transcripts (id, case_chat_id, transcript, created_at, word_count, saved_with_permission)
SELECT 
  UUID() as id,
  e.case_chat_id,
  e.transcript,
  e.created_at,
  CASE 
    WHEN e.transcript IS NOT NULL THEN 
      LENGTH(TRIM(e.transcript)) - LENGTH(REPLACE(TRIM(e.transcript), ' ', '')) + 1
    ELSE 0 
  END as word_count,
  TRUE as saved_with_permission
FROM evaluations e
WHERE e.transcript IS NOT NULL 
  AND e.transcript != ''
  AND e.case_chat_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM transcripts t WHERE t.case_chat_id = e.case_chat_id
  );

-- ============================================================
-- PHASE 4: Link case_chats to their transcripts
-- ============================================================

-- Add transcript_id column to case_chats (using procedure for conditional DDL)
DROP PROCEDURE IF EXISTS add_transcript_id_column;
DELIMITER //
CREATE PROCEDURE add_transcript_id_column()
BEGIN
  DECLARE column_exists INT DEFAULT 0;
  
  SELECT COUNT(*) INTO column_exists FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'case_chats' AND column_name = 'transcript_id';
  
  IF column_exists = 0 THEN
    ALTER TABLE case_chats ADD COLUMN transcript_id CHAR(36) DEFAULT NULL AFTER evaluation_id;
  END IF;
END //
DELIMITER ;
CALL add_transcript_id_column();
DROP PROCEDURE IF EXISTS add_transcript_id_column;

-- Populate transcript_id in case_chats
UPDATE case_chats cc
JOIN transcripts t ON t.case_chat_id = cc.id
SET cc.transcript_id = t.id;

-- Add foreign key constraint (using procedure for conditional DDL)
DROP PROCEDURE IF EXISTS add_transcript_fk;
DELIMITER //
CREATE PROCEDURE add_transcript_fk()
BEGIN
  DECLARE fk_exists INT DEFAULT 0;
  
  SELECT COUNT(*) INTO fk_exists FROM information_schema.table_constraints
    WHERE table_schema = DATABASE() 
      AND table_name = 'case_chats' 
      AND constraint_name = 'case_chats_transcript_fk';
  
  IF fk_exists = 0 THEN
    ALTER TABLE case_chats
      ADD CONSTRAINT case_chats_transcript_fk 
      FOREIGN KEY (transcript_id) REFERENCES transcripts(id) ON DELETE SET NULL;
  END IF;
END //
DELIMITER ;
CALL add_transcript_fk();
DROP PROCEDURE IF EXISTS add_transcript_fk;

-- Add index (using procedure for conditional DDL)
DROP PROCEDURE IF EXISTS add_transcript_idx;
DELIMITER //
CREATE PROCEDURE add_transcript_idx()
BEGIN
  DECLARE index_exists INT DEFAULT 0;
  
  SELECT COUNT(*) INTO index_exists FROM information_schema.statistics
    WHERE table_schema = DATABASE() 
      AND table_name = 'case_chats' 
      AND index_name = 'idx_transcript_id';
  
  IF index_exists = 0 THEN
    CREATE INDEX idx_transcript_id ON case_chats(transcript_id);
  END IF;
END //
DELIMITER ;
CALL add_transcript_idx();
DROP PROCEDURE IF EXISTS add_transcript_idx;

-- ============================================================
-- Verification Queries (run these manually to check migration)
-- ============================================================

-- Check transcript counts before migration (run before this script):
-- SELECT COUNT(*) as case_chats_with_transcript FROM case_chats WHERE transcript IS NOT NULL;
-- SELECT COUNT(*) as evaluations_with_transcript FROM evaluations WHERE transcript IS NOT NULL;

-- Check transcript counts after migration (run after this script):
-- SELECT COUNT(*) as total_transcripts FROM transcripts;
-- SELECT COUNT(*) as linked_case_chats FROM case_chats WHERE transcript_id IS NOT NULL;

-- Check for any orphaned evaluations:
-- SELECT COUNT(*) FROM evaluations WHERE case_chat_id IS NULL;

-- View sample migrated data:
-- SELECT 
--   t.id as transcript_id,
--   t.case_chat_id,
--   cc.student_id,
--   cc.case_id,
--   t.word_count,
--   t.is_anonymized,
--   t.created_at
-- FROM transcripts t
-- JOIN case_chats cc ON t.case_chat_id = cc.id
-- LIMIT 10;
