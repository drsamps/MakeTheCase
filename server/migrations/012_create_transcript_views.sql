-- Migration: 012_create_transcript_views.sql
-- Purpose: Create database views for simplified querying of the new three-table structure
-- Date: 2026-01-12
-- Related: dev/2026-01-12-table-redundancy-analysis.md

-- ============================================================
-- View 1: Completed Sessions with Evaluation
-- Purpose: Most common query - completed chats with their evaluations
-- ============================================================

CREATE OR REPLACE VIEW v_completed_sessions AS
SELECT 
  cc.id as case_chat_id,
  cc.student_id,
  s.full_name as student_name,
  cc.case_id,
  c.case_title,
  cc.section_id,
  sec.section_title,
  cc.status,
  cc.persona,
  cc.hints_used,
  cc.chat_model,
  cc.start_time,
  cc.end_time,
  TIMESTAMPDIFF(MINUTE, cc.start_time, cc.end_time) as duration_minutes,
  cc.initial_position,
  cc.final_position,
  cc.position_method,
  cc.transcript_id,
  e.id as evaluation_id,
  e.score,
  e.summary,
  e.criteria,
  e.helpful,
  e.liked,
  e.improve,
  e.super_model,
  e.allow_rechat,
  e.created_at as evaluated_at
FROM case_chats cc
JOIN students s ON cc.student_id = s.id
JOIN cases c ON cc.case_id = c.case_id
LEFT JOIN sections sec ON cc.section_id = sec.section_id
LEFT JOIN evaluations e ON e.case_chat_id = cc.id
WHERE cc.status = 'completed';

-- ============================================================
-- View 2: Sessions with Transcript
-- Purpose: For transcript viewing - includes transcript text and metadata
-- ============================================================

CREATE OR REPLACE VIEW v_sessions_with_transcript AS
SELECT 
  cc.id as case_chat_id,
  cc.student_id,
  s.full_name as student_name,
  cc.case_id,
  c.case_title,
  cc.section_id,
  sec.section_title,
  cc.status,
  cc.persona,
  cc.start_time,
  cc.end_time,
  t.id as transcript_id,
  t.transcript,
  t.is_anonymized,
  t.anonymized_at,
  t.word_count,
  t.saved_with_permission,
  t.created_at as transcript_saved_at
FROM case_chats cc
JOIN students s ON cc.student_id = s.id
JOIN cases c ON cc.case_id = c.case_id
LEFT JOIN sections sec ON cc.section_id = sec.section_id
LEFT JOIN transcripts t ON t.case_chat_id = cc.id;

-- ============================================================
-- View 3: Results Summary
-- Purpose: For analytics/results page - all students with completion status
-- ============================================================

CREATE OR REPLACE VIEW v_results_summary AS
SELECT 
  s.id as student_id,
  s.full_name as student_name,
  sec.section_id,
  sec.section_title,
  sec.year_term,
  c.case_id,
  c.case_title,
  COALESCE(cc.status, 'not_started') as status,
  cc.id as case_chat_id,
  cc.persona,
  cc.hints_used,
  cc.initial_position,
  cc.final_position,
  cc.start_time,
  cc.end_time,
  TIMESTAMPDIFF(MINUTE, cc.start_time, cc.end_time) as duration_minutes,
  e.id as evaluation_id,
  e.score,
  e.helpful,
  e.allow_rechat,
  e.created_at as evaluated_at,
  CASE WHEN t.id IS NOT NULL THEN TRUE ELSE FALSE END as has_transcript,
  t.is_anonymized,
  t.word_count
FROM students s
JOIN student_sections ss ON s.id = ss.student_id
JOIN sections sec ON ss.section_id = sec.section_id
JOIN section_cases sc ON sec.section_id = sc.section_id
JOIN cases c ON sc.case_id = c.case_id
LEFT JOIN case_chats cc ON s.id = cc.student_id 
  AND c.case_id = cc.case_id 
  AND cc.section_id = sec.section_id
LEFT JOIN evaluations e ON e.case_chat_id = cc.id
LEFT JOIN transcripts t ON t.case_chat_id = cc.id
WHERE sec.enabled = TRUE;

-- ============================================================
-- View 4: Transcript Analytics
-- Purpose: For privacy compliance reporting and transcript management
-- ============================================================

CREATE OR REPLACE VIEW v_transcript_analytics AS
SELECT 
  t.id as transcript_id,
  t.case_chat_id,
  s.full_name as student_name,
  c.case_title,
  sec.section_title,
  t.word_count,
  t.is_anonymized,
  t.anonymized_at,
  t.saved_with_permission,
  t.created_at,
  DATEDIFF(CURRENT_DATE, DATE(t.created_at)) as age_days,
  cc.status as chat_status,
  CASE 
    WHEN e.id IS NOT NULL THEN 'evaluated'
    WHEN cc.status = 'completed' THEN 'completed_no_eval'
    ELSE cc.status
  END as completion_status
FROM transcripts t
JOIN case_chats cc ON t.case_chat_id = cc.id
JOIN students s ON cc.student_id = s.id
JOIN cases c ON cc.case_id = c.case_id
LEFT JOIN sections sec ON cc.section_id = sec.section_id
LEFT JOIN evaluations e ON e.case_chat_id = cc.id;

-- ============================================================
-- Grant permissions (adjust as needed for your setup)
-- ============================================================

-- GRANT SELECT ON v_completed_sessions TO 'app_user'@'%';
-- GRANT SELECT ON v_sessions_with_transcript TO 'app_user'@'%';
-- GRANT SELECT ON v_results_summary TO 'app_user'@'%';
-- GRANT SELECT ON v_transcript_analytics TO 'app_user'@'%';

-- ============================================================
-- Usage Examples
-- ============================================================

-- Get all completed sessions for a section:
-- SELECT * FROM v_completed_sessions WHERE section_id = 'your_section_id';

-- Get transcript for a specific chat:
-- SELECT * FROM v_sessions_with_transcript WHERE case_chat_id = 'chat_id';

-- Get results summary for analytics page:
-- SELECT * FROM v_results_summary WHERE section_id = 'section_id' AND case_id = 'case_id';

-- Find old transcripts that should be anonymized:
-- SELECT * FROM v_transcript_analytics 
-- WHERE age_days > 365 AND is_anonymized = FALSE;
