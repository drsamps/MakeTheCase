-- Migration 025: Add converted_text cache to case_files
-- Caches PDF/DOCX-to-text conversion so files are converted once at upload,
-- not re-parsed on every LLM call.

-- Add converted_text column
DROP PROCEDURE IF EXISTS add_converted_text;
DELIMITER //
CREATE PROCEDURE add_converted_text()
BEGIN
  DECLARE col_exists INT DEFAULT 0;

  SELECT COUNT(*) INTO col_exists FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'case_files'
    AND column_name = 'converted_text';

  IF col_exists = 0 THEN
    ALTER TABLE case_files ADD COLUMN converted_text LONGTEXT DEFAULT NULL
      COMMENT 'Cached text extraction from PDF/DOCX files' AFTER outline_content;
  END IF;
END //
DELIMITER ;
CALL add_converted_text();
DROP PROCEDURE IF EXISTS add_converted_text;

-- Add converted_at column
DROP PROCEDURE IF EXISTS add_converted_at;
DELIMITER //
CREATE PROCEDURE add_converted_at()
BEGIN
  DECLARE col_exists INT DEFAULT 0;

  SELECT COUNT(*) INTO col_exists FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'case_files'
    AND column_name = 'converted_at';

  IF col_exists = 0 THEN
    ALTER TABLE case_files ADD COLUMN converted_at TIMESTAMP NULL DEFAULT NULL
      COMMENT 'When text conversion was last performed' AFTER converted_text;
  END IF;
END //
DELIMITER ;
CALL add_converted_at();
DROP PROCEDURE IF EXISTS add_converted_at;

-- Verify columns were added
SELECT column_name, data_type, column_comment
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'case_files'
  AND column_name IN ('converted_text', 'converted_at')
ORDER BY ordinal_position;
