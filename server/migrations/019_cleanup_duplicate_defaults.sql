-- Migration 019: Clean up duplicate chat_options_defaults rows
-- MySQL's UNIQUE constraint on section_id allows multiple NULLs, causing duplicates

-- Show current duplicates before cleanup
SELECT 'Before cleanup - Global defaults (section_id IS NULL):' as status;
SELECT id, section_id, created_at, updated_at 
FROM chat_options_defaults 
WHERE section_id IS NULL 
ORDER BY id;

SELECT 'Before cleanup - Section-specific defaults by section:' as status;
SELECT section_id, COUNT(*) as count 
FROM chat_options_defaults 
WHERE section_id IS NOT NULL 
GROUP BY section_id 
HAVING COUNT(*) > 1;

-- Keep only the most recently updated global default (NULL section_id)
-- Delete all others
DELETE FROM chat_options_defaults
WHERE section_id IS NULL
AND id NOT IN (
  SELECT id FROM (
    SELECT id FROM chat_options_defaults
    WHERE section_id IS NULL
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
  ) as keep
);

-- For section-specific defaults, keep the most recently updated one per section
-- This handles any duplicates caused by the same issue
DELETE d1 FROM chat_options_defaults d1
INNER JOIN (
  SELECT section_id, MAX(id) as max_id
  FROM chat_options_defaults
  WHERE section_id IS NOT NULL
  GROUP BY section_id
) d2 ON d1.section_id = d2.section_id
WHERE d1.id < d2.max_id;

-- Show results after cleanup
SELECT 'After cleanup - All defaults:' as status;
SELECT id, section_id, created_at, updated_at 
FROM chat_options_defaults 
ORDER BY section_id IS NULL DESC, section_id, id;

-- Verify: Should have exactly 1 global default
SELECT 'Verification - Count of global defaults (should be 1):' as status;
SELECT COUNT(*) as global_default_count 
FROM chat_options_defaults 
WHERE section_id IS NULL;

-- Verify: No duplicate section_ids
SELECT 'Verification - Sections with duplicates (should be empty):' as status;
SELECT section_id, COUNT(*) as count 
FROM chat_options_defaults 
WHERE section_id IS NOT NULL 
GROUP BY section_id 
HAVING COUNT(*) > 1;
