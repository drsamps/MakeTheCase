-- Migration: 023_add_model_test_tracking.sql
-- Purpose: Persist model connectivity test metadata for Instructor Dashboard
-- Date: 2026-02-23

-- Use information_schema checks for compatibility with MySQL variants that do not
-- support ADD COLUMN IF NOT EXISTS.
DROP PROCEDURE IF EXISTS add_model_test_tracking_columns;
DELIMITER //
CREATE PROCEDURE add_model_test_tracking_columns()
BEGIN
  DECLARE has_test_date INT DEFAULT 0;
  DECLARE has_test_result INT DEFAULT 0;
  DECLARE test_result_len INT DEFAULT 0;

  SELECT COUNT(*) INTO has_test_date
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'models'
    AND column_name = 'test_date';

  SELECT COUNT(*) INTO has_test_result
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'models'
    AND column_name = 'test_result';

  IF has_test_result = 1 THEN
    SELECT COALESCE(character_maximum_length, 0) INTO test_result_len
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'models'
      AND column_name = 'test_result'
    LIMIT 1;
  END IF;

  IF has_test_date = 0 THEN
    ALTER TABLE models
      ADD COLUMN test_date DATETIME NULL COMMENT 'Last model connectivity test timestamp';
  END IF;

  IF has_test_result = 0 THEN
    ALTER TABLE models
      ADD COLUMN test_result VARCHAR(200) NULL COMMENT 'NULL=not tested, success=passed, otherwise failed: <error message>';
  ELSEIF test_result_len < 200 THEN
    ALTER TABLE models
      MODIFY COLUMN test_result VARCHAR(200) NULL COMMENT 'NULL=not tested, success=passed, otherwise failed: <error message>';
  END IF;
END //
DELIMITER ;

CALL add_model_test_tracking_columns();
DROP PROCEDURE IF EXISTS add_model_test_tracking_columns;
