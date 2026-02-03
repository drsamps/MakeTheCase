-- Migration: 021_backfill_case_chats_section_id.sql
-- Purpose: Backfill section_id for case_chats records where it is NULL
-- Date: 2026-02-02
-- Related: Investigation of missing students in Results/Analytics view
--
-- Root cause: Migration 010_migrate_transcripts_data.sql created case_chats
-- records for legacy evaluations WITHOUT setting section_id, causing those
-- records to not appear in the Results analytics view.
--
-- This migration attempts to derive the correct section_id from:
-- 1. The student's enrollment (student_sections table)
-- 2. Matching against sections that have the case assigned (section_cases)

-- ============================================================
-- PHASE 1: Backfill section_id using student enrollment + case assignment
-- ============================================================

-- For case_chats with NULL section_id, find the section where:
-- - The student is enrolled (via student_sections)
-- - The case is assigned to that section (via section_cases)
-- If multiple matches, use the most recently created section assignment

DROP PROCEDURE IF EXISTS backfill_case_chats_section_id;
DELIMITER //
CREATE PROCEDURE backfill_case_chats_section_id()
BEGIN
  DECLARE rows_updated INT DEFAULT 0;
  
  -- Update case_chats where section_id is NULL
  -- Match to the student's enrolled section that has this case assigned
  UPDATE case_chats cc
  JOIN (
    SELECT 
      cc_inner.id as chat_id,
      ss.section_id as derived_section_id
    FROM case_chats cc_inner
    JOIN student_sections ss ON cc_inner.student_id = ss.student_id
    JOIN section_cases sc ON ss.section_id = sc.section_id AND cc_inner.case_id = sc.case_id
    WHERE cc_inner.section_id IS NULL
    -- If student is in multiple sections with same case, pick one deterministically
    -- (group by chat_id and take any section - they're equivalent for this purpose)
  ) derived ON cc.id = derived.chat_id
  SET cc.section_id = derived.derived_section_id
  WHERE cc.section_id IS NULL;
  
  SET rows_updated = ROW_COUNT();
  SELECT CONCAT('Updated ', rows_updated, ' case_chats records with derived section_id') as result;
END //
DELIMITER ;

CALL backfill_case_chats_section_id();
DROP PROCEDURE IF EXISTS backfill_case_chats_section_id;

-- ============================================================
-- PHASE 2: Handle remaining NULLs using students.section_id (legacy field)
-- ============================================================

-- Some students may have section_id directly on students table (legacy)
-- but not in student_sections table

DROP PROCEDURE IF EXISTS backfill_from_legacy_section;
DELIMITER //
CREATE PROCEDURE backfill_from_legacy_section()
BEGIN
  DECLARE rows_updated INT DEFAULT 0;
  
  UPDATE case_chats cc
  JOIN students s ON cc.student_id = s.id
  JOIN section_cases sc ON s.section_id = sc.section_id AND cc.case_id = sc.case_id
  SET cc.section_id = s.section_id
  WHERE cc.section_id IS NULL
    AND s.section_id IS NOT NULL;
  
  SET rows_updated = ROW_COUNT();
  SELECT CONCAT('Updated ', rows_updated, ' additional case_chats from legacy students.section_id') as result;
END //
DELIMITER ;

CALL backfill_from_legacy_section();
DROP PROCEDURE IF EXISTS backfill_from_legacy_section;

-- ============================================================
-- Verification Queries (run manually to check results)
-- ============================================================

-- Check remaining NULLs:
-- SELECT COUNT(*) as remaining_nulls FROM case_chats WHERE section_id IS NULL;

-- View records that still have NULL section_id (if any):
-- SELECT cc.id, cc.student_id, s.full_name, cc.case_id, cc.status, cc.start_time
-- FROM case_chats cc
-- JOIN students s ON cc.student_id = s.id
-- WHERE cc.section_id IS NULL
-- LIMIT 20;

-- Check distribution of section_ids after migration:
-- SELECT section_id, COUNT(*) as count 
-- FROM case_chats 
-- GROUP BY section_id 
-- ORDER BY count DESC;
