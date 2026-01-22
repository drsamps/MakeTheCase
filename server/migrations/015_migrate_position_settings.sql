-- Migration: 015_migrate_position_settings.sql
-- Purpose: Migrate position tracking settings from scenario chat_options_override to section_cases
-- Date: 2026-01-21
-- Note: Positions will NOT be auto-created - instructors define them manually

-- =====================================================
-- 1. Migrate position tracking settings from chat_options_override to section_cases
-- =====================================================
-- For section_cases where the assigned scenario has position_tracking_enabled in chat_options_override,
-- copy those settings to the new section_cases columns

UPDATE section_cases sc
JOIN section_case_scenarios scs ON sc.id = scs.section_case_id
JOIN case_scenarios cs ON scs.scenario_id = cs.id
SET
  sc.position_tracking_enabled = CASE
    WHEN JSON_EXTRACT(cs.chat_options_override, '$.position_tracking_enabled') = true THEN 1
    ELSE 0
  END,
  sc.position_capture_method = COALESCE(
    JSON_UNQUOTE(JSON_EXTRACT(cs.chat_options_override, '$.position_capture_method')),
    'explicit'
  ),
  sc.track_position_change = CASE
    WHEN JSON_EXTRACT(cs.chat_options_override, '$.track_position_change') = false THEN 0
    ELSE 1
  END
WHERE JSON_EXTRACT(cs.chat_options_override, '$.position_tracking_enabled') IS NOT NULL;

-- =====================================================
-- 2. Link existing case_chats positions to scenario_positions (if positions exist)
-- =====================================================
-- Note: This will only link positions AFTER scenario_positions are created by instructors
-- Since we're not auto-creating positions, this step is a no-op initially
-- but provides the query structure for future use

-- Example query (commented out since no positions exist yet):
-- UPDATE case_chats cc
-- JOIN case_scenarios cs ON cc.scenario_id = cs.id
-- JOIN scenario_positions sp ON sp.scenario_id = cs.id
--   AND LOWER(TRIM(sp.position_name)) = LOWER(TRIM(cc.initial_position))
-- SET cc.initial_position_id = sp.position_id
-- WHERE cc.initial_position IS NOT NULL
--   AND cc.initial_position_id IS NULL;

-- =====================================================
-- 3. Clean up position tracking from chat_options_override (optional, delayed)
-- =====================================================
-- Note: We keep the chat_options_override values intact for now as a backup
-- This cleanup can be run manually after verifying the migration worked:
--
-- UPDATE case_scenarios
-- SET chat_options_override = JSON_REMOVE(
--   JSON_REMOVE(
--     JSON_REMOVE(chat_options_override, '$.position_tracking_enabled'),
--     '$.position_capture_method'
--   ),
--   '$.track_position_change'
-- )
-- WHERE chat_options_override IS NOT NULL
--   AND JSON_EXTRACT(chat_options_override, '$.position_tracking_enabled') IS NOT NULL;
