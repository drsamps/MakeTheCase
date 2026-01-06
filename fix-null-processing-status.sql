-- Fix any case_files records with NULL processing_status
-- This can happen if files were created before the Case Prep migration was run

UPDATE case_files 
SET processing_status = 'pending' 
WHERE processing_status IS NULL;

-- Verify the update
SELECT id, case_id, filename, processing_status 
FROM case_files 
WHERE processing_status = 'pending' OR processing_status IS NULL;
