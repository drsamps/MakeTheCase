-- Migration: 027_openrouter_model_support.sql
-- Purpose: Add OpenRouter vendor + parameter tracking to models table
-- Date: 2026-05-13

DROP PROCEDURE IF EXISTS apply_openrouter_model_support;
DELIMITER //
CREATE PROCEDURE apply_openrouter_model_support()
BEGIN
  DECLARE has_input_cost INT DEFAULT 0;
  DECLARE has_output_cost INT DEFAULT 0;
  DECLARE has_cpm_input INT DEFAULT 0;
  DECLARE has_cpm_output INT DEFAULT 0;
  DECLARE has_cpm_input_cache INT DEFAULT 0;
  DECLARE has_vendor INT DEFAULT 0;
  DECLARE has_release_date INT DEFAULT 0;
  DECLARE has_type INT DEFAULT 0;
  DECLARE has_supported_parameters INT DEFAULT 0;
  DECLARE has_default_parameters INT DEFAULT 0;
  DECLARE has_parameter_settings INT DEFAULT 0;
  DECLARE has_test_status INT DEFAULT 0;
  DECLARE has_test_results INT DEFAULT 0;
  DECLARE has_created_at INT DEFAULT 0;
  DECLARE has_updated_at INT DEFAULT 0;
  DECLARE has_idx_vendor_enabled INT DEFAULT 0;

  -- Detect column presence
  SELECT COUNT(*) INTO has_input_cost FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'models' AND column_name = 'input_cost';
  SELECT COUNT(*) INTO has_output_cost FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'models' AND column_name = 'output_cost';
  SELECT COUNT(*) INTO has_cpm_input FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'models' AND column_name = 'cpm_input';
  SELECT COUNT(*) INTO has_cpm_output FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'models' AND column_name = 'cpm_output';
  SELECT COUNT(*) INTO has_cpm_input_cache FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'models' AND column_name = 'cpm_input_cache';
  SELECT COUNT(*) INTO has_vendor FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'models' AND column_name = 'vendor';
  SELECT COUNT(*) INTO has_release_date FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'models' AND column_name = 'release_date';
  SELECT COUNT(*) INTO has_type FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'models' AND column_name = 'type';
  SELECT COUNT(*) INTO has_supported_parameters FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'models' AND column_name = 'supported_parameters';
  SELECT COUNT(*) INTO has_default_parameters FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'models' AND column_name = 'default_parameters';
  SELECT COUNT(*) INTO has_parameter_settings FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'models' AND column_name = 'parameter_settings';
  SELECT COUNT(*) INTO has_test_status FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'models' AND column_name = 'test_status';
  SELECT COUNT(*) INTO has_test_results FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'models' AND column_name = 'test_results';
  SELECT COUNT(*) INTO has_created_at FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'models' AND column_name = 'created_at';
  SELECT COUNT(*) INTO has_updated_at FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'models' AND column_name = 'updated_at';
  SELECT COUNT(*) INTO has_idx_vendor_enabled FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'models' AND index_name = 'idx_vendor_enabled';

  -- Rename input_cost -> cpm_input (only if old exists and new doesn't)
  IF has_input_cost = 1 AND has_cpm_input = 0 THEN
    ALTER TABLE models CHANGE COLUMN input_cost cpm_input DECIMAL(10,4) NULL
      COMMENT 'Cost per million input tokens';
  ELSEIF has_cpm_input = 0 THEN
    ALTER TABLE models ADD COLUMN cpm_input DECIMAL(10,4) NULL
      COMMENT 'Cost per million input tokens';
  END IF;

  -- Rename output_cost -> cpm_output
  IF has_output_cost = 1 AND has_cpm_output = 0 THEN
    ALTER TABLE models CHANGE COLUMN output_cost cpm_output DECIMAL(10,4) NULL
      COMMENT 'Cost per million output tokens';
  ELSEIF has_cpm_output = 0 THEN
    ALTER TABLE models ADD COLUMN cpm_output DECIMAL(10,4) NULL
      COMMENT 'Cost per million output tokens';
  END IF;

  -- Add cached-input pricing
  IF has_cpm_input_cache = 0 THEN
    ALTER TABLE models ADD COLUMN cpm_input_cache DECIMAL(10,4) NULL
      COMMENT 'Cost per million cached-prompt read tokens';
  END IF;

  -- Add vendor column (NULL first so we can backfill, then set NOT NULL)
  IF has_vendor = 0 THEN
    ALTER TABLE models ADD COLUMN vendor VARCHAR(30) NULL
      COMMENT 'openai | anthropic | google | openrouter';
  END IF;

  -- Backfill vendor from model_id prefix
  UPDATE models SET vendor = 'openai'
    WHERE vendor IS NULL AND (
      LOWER(model_id) LIKE 'gpt%' OR LOWER(model_id) LIKE 'o1%' OR LOWER(model_id) LIKE 'o3%' OR LOWER(model_id) LIKE '%openai%'
    );
  UPDATE models SET vendor = 'anthropic'
    WHERE vendor IS NULL AND (LOWER(model_id) LIKE 'claude%' OR LOWER(model_id) LIKE '%anthropic%');
  UPDATE models SET vendor = 'google'
    WHERE vendor IS NULL AND (LOWER(model_id) LIKE 'gemini%' OR LOWER(model_id) LIKE '%google%');
  UPDATE models SET vendor = 'openai' WHERE vendor IS NULL;  -- safe fallback

  -- Promote vendor to NOT NULL with default
  ALTER TABLE models MODIFY COLUMN vendor VARCHAR(30) NOT NULL DEFAULT 'openai'
    COMMENT 'openai | anthropic | google | openrouter';

  IF has_release_date = 0 THEN
    ALTER TABLE models ADD COLUMN release_date DATE NULL COMMENT 'Vendor release date';
  END IF;

  IF has_type = 0 THEN
    ALTER TABLE models ADD COLUMN `type` VARCHAR(100) DEFAULT 'regular'
      COMMENT 'regular | reasoning | hybrid | vision | code | other';
  END IF;

  IF has_supported_parameters = 0 THEN
    ALTER TABLE models ADD COLUMN supported_parameters JSON NULL
      COMMENT 'Array of parameter names the model accepts';
  END IF;

  IF has_default_parameters = 0 THEN
    ALTER TABLE models ADD COLUMN default_parameters JSON NULL
      COMMENT 'Object of vendor-specified defaults';
  END IF;

  IF has_parameter_settings = 0 THEN
    ALTER TABLE models ADD COLUMN parameter_settings JSON NULL
      COMMENT 'Object of admin-chosen overrides applied at call time';
  END IF;

  IF has_test_status = 0 THEN
    ALTER TABLE models ADD COLUMN test_status VARCHAR(20) NULL
      COMMENT 'pass | fail | NULL (never tested)';
  END IF;

  IF has_test_results = 0 THEN
    ALTER TABLE models ADD COLUMN test_results JSON NULL
      COMMENT 'Full payload from last test run';
  END IF;

  IF has_created_at = 0 THEN
    ALTER TABLE models ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP;
  END IF;

  IF has_updated_at = 0 THEN
    ALTER TABLE models ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ON UPDATE CURRENT_TIMESTAMP;
  END IF;

  -- Backfill test_status from legacy test_result text
  UPDATE models
    SET test_status = CASE
      WHEN test_result IS NULL THEN NULL
      WHEN test_result = 'success' THEN 'pass'
      ELSE 'fail'
    END
    WHERE test_status IS NULL;

  IF has_idx_vendor_enabled = 0 THEN
    CREATE INDEX idx_vendor_enabled ON models (vendor, enabled);
  END IF;
END //
DELIMITER ;

CALL apply_openrouter_model_support();
DROP PROCEDURE IF EXISTS apply_openrouter_model_support;
