-- Migration: 014_scenario_positions.sql
-- Purpose: Add scenario_positions table for multi-position support with per-position arguments
-- Date: 2026-01-21

-- =====================================================
-- 1. Create scenario_positions table
-- =====================================================
CREATE TABLE IF NOT EXISTS scenario_positions (
  position_id INT AUTO_INCREMENT PRIMARY KEY,
  scenario_id INT NOT NULL COMMENT 'FK to case_scenarios.id',
  position_name VARCHAR(100) NOT NULL COMMENT 'Short identifier (e.g., agree, disagree)',
  position VARCHAR(255) NOT NULL COMMENT 'Full description shown to students',
  position_order INT DEFAULT 0 COMMENT 'Display order',
  arguments_for TEXT DEFAULT NULL COMMENT 'Arguments supporting this position (for AI prompts)',
  arguments_against TEXT DEFAULT NULL COMMENT 'Counter-arguments to this position (for AI prompts)',
  position_enabled TINYINT(1) DEFAULT 1 COMMENT 'Whether this position is available',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (scenario_id) REFERENCES case_scenarios(id) ON DELETE CASCADE,
  INDEX idx_scenario_positions_scenario (scenario_id),
  INDEX idx_scenario_positions_order (scenario_id, position_order),
  UNIQUE KEY unique_scenario_position_name (scenario_id, position_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 2. Add columns to cases table
-- =====================================================
ALTER TABLE cases
ADD COLUMN case_version VARCHAR(10) DEFAULT NULL COMMENT 'Version identifier (e.g., year)' AFTER case_title,
ADD COLUMN base_scenario_id INT DEFAULT NULL COMMENT 'Default scenario for this case' AFTER case_version;

-- Note: Foreign key for base_scenario_id added separately to avoid circular dependency issues
-- It references case_scenarios which references cases

-- =====================================================
-- 3. Add position tracking columns to section_cases
--    (moved from scenario-level chat_options_override)
-- =====================================================
ALTER TABLE section_cases
ADD COLUMN position_tracking_enabled TINYINT(1) DEFAULT 0
    COMMENT 'Enable position tracking for this assignment',
ADD COLUMN position_capture_method ENUM('explicit', 'ai_inferred', 'instructor_manual', 'none') DEFAULT 'explicit'
    COMMENT 'How initial position is captured',
ADD COLUMN track_position_change TINYINT(1) DEFAULT 1
    COMMENT 'Ask for final position after chat';

-- =====================================================
-- 4. Create section_case_positions junction table
--    (enables/disables specific positions per assignment)
-- =====================================================
CREATE TABLE IF NOT EXISTS section_case_positions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  section_case_id INT NOT NULL COMMENT 'FK to section_cases.id',
  position_id INT NOT NULL COMMENT 'FK to scenario_positions.position_id',
  enabled TINYINT(1) DEFAULT 1 COMMENT 'Whether this position is enabled for this assignment',
  sort_order INT DEFAULT 0 COMMENT 'Override display order for this assignment',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (section_case_id) REFERENCES section_cases(id) ON DELETE CASCADE,
  FOREIGN KEY (position_id) REFERENCES scenario_positions(position_id) ON DELETE CASCADE,
  UNIQUE KEY unique_section_case_position (section_case_id, position_id),
  INDEX idx_scp_section_case (section_case_id),
  INDEX idx_scp_position (position_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 5. Add position_id foreign key columns to case_chats
--    (linking to defined positions rather than free-text)
-- =====================================================
ALTER TABLE case_chats
ADD COLUMN initial_position_id INT DEFAULT NULL
    COMMENT 'FK to scenario_positions for initial position',
ADD COLUMN final_position_id INT DEFAULT NULL
    COMMENT 'FK to scenario_positions for final position';

-- Add foreign key constraints (allow NULL, SET NULL on delete)
ALTER TABLE case_chats
ADD CONSTRAINT case_chats_initial_pos_fk
    FOREIGN KEY (initial_position_id) REFERENCES scenario_positions(position_id) ON DELETE SET NULL,
ADD CONSTRAINT case_chats_final_pos_fk
    FOREIGN KEY (final_position_id) REFERENCES scenario_positions(position_id) ON DELETE SET NULL;

-- Add index for position_id lookups
ALTER TABLE case_chats
ADD INDEX idx_case_chats_position_ids (initial_position_id, final_position_id);
