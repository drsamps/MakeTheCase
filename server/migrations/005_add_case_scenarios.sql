-- Migration: 005_add_case_scenarios.sql
-- Purpose: Add multiple scenario support for cases
-- Date: 2026-01-06

-- =====================================================
-- 1. Create case_scenarios table
-- =====================================================
CREATE TABLE IF NOT EXISTS case_scenarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  case_id VARCHAR(30) NOT NULL,
  scenario_name VARCHAR(100) NOT NULL COMMENT 'Display name for this scenario',
  protagonist VARCHAR(100) NOT NULL,
  protagonist_initials VARCHAR(5) NOT NULL,
  protagonist_role VARCHAR(200) DEFAULT NULL COMMENT 'Role/title of the protagonist (e.g., CEO, CFO, Marketing Director)',
  chat_topic VARCHAR(255) DEFAULT NULL,
  chat_question TEXT NOT NULL,

  -- Timing controls
  chat_time_limit INT DEFAULT 0 COMMENT 'Time limit in minutes (0 = unlimited)',
  chat_time_warning INT DEFAULT 5 COMMENT 'Minutes before end to show warning',

  -- Argument framework for AI prompt cache
  arguments_for TEXT DEFAULT NULL COMMENT 'Key arguments supporting one position',
  arguments_against TEXT DEFAULT NULL COMMENT 'Key arguments supporting opposing position',

  -- Chat options override (JSON to override section_cases.chat_options)
  chat_options_override JSON DEFAULT NULL COMMENT 'Scenario-specific chat options that override section defaults',

  -- Ordering and status
  sort_order INT DEFAULT 0,
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (case_id) REFERENCES cases(case_id) ON DELETE CASCADE,
  INDEX idx_case_scenarios_case_id (case_id),
  INDEX idx_case_scenarios_enabled (enabled),
  INDEX idx_case_scenarios_sort_order (case_id, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 2. Create section_case_scenarios junction table
-- =====================================================
CREATE TABLE IF NOT EXISTS section_case_scenarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  section_case_id INT NOT NULL COMMENT 'FK to section_cases.id',
  scenario_id INT NOT NULL COMMENT 'FK to case_scenarios.id',
  enabled BOOLEAN DEFAULT TRUE,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (section_case_id) REFERENCES section_cases(id) ON DELETE CASCADE,
  FOREIGN KEY (scenario_id) REFERENCES case_scenarios(id) ON DELETE CASCADE,
  UNIQUE KEY unique_section_scenario (section_case_id, scenario_id),
  INDEX idx_scs_section_case (section_case_id),
  INDEX idx_scs_scenario (scenario_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 3. Modify section_cases table - add scenario control columns
-- =====================================================
ALTER TABLE section_cases
ADD COLUMN IF NOT EXISTS selection_mode ENUM('student_choice', 'all_required') NOT NULL DEFAULT 'student_choice' COMMENT 'student_choice: student picks scenario; all_required: must complete all',
ADD COLUMN IF NOT EXISTS require_order BOOLEAN DEFAULT FALSE COMMENT 'If all_required, must complete scenarios in order',
ADD COLUMN IF NOT EXISTS use_scenarios BOOLEAN DEFAULT FALSE COMMENT 'If TRUE, uses case_scenarios; if FALSE, uses legacy case-level protagonist/question';

-- =====================================================
-- 4. Modify case_chats table - add scenario and timer tracking
-- =====================================================
ALTER TABLE case_chats
ADD COLUMN IF NOT EXISTS scenario_id INT DEFAULT NULL COMMENT 'FK to case_scenarios.id (NULL for legacy chats)',
ADD COLUMN IF NOT EXISTS time_limit_minutes INT DEFAULT NULL COMMENT 'Time limit applied to this chat (copied from scenario)',
ADD COLUMN IF NOT EXISTS time_started TIMESTAMP NULL DEFAULT NULL COMMENT 'When timer actually started (first message)';

-- Add foreign key constraint for scenario_id (separate statement for compatibility)
-- Note: Using SET NULL on delete so completed chats are preserved even if scenario is deleted
ALTER TABLE case_chats
ADD CONSTRAINT case_chats_scenario_fk FOREIGN KEY (scenario_id) REFERENCES case_scenarios(id) ON DELETE SET NULL;

-- Add index for scenario lookups
ALTER TABLE case_chats
ADD INDEX idx_case_chats_scenario_id (scenario_id);

-- =====================================================
-- 5. Migrate existing case data to create default scenarios
-- =====================================================
INSERT INTO case_scenarios (case_id, scenario_name, protagonist, protagonist_initials, chat_topic, chat_question, enabled, sort_order)
SELECT
  case_id,
  'Default Scenario' as scenario_name,
  protagonist,
  protagonist_initials,
  chat_topic,
  chat_question,
  enabled,
  0 as sort_order
FROM cases
WHERE case_id NOT IN (SELECT DISTINCT case_id FROM case_scenarios);

-- =====================================================
-- 6. Auto-assign default scenarios to existing section_cases and enable use_scenarios
-- =====================================================
INSERT INTO section_case_scenarios (section_case_id, scenario_id, enabled, sort_order)
SELECT
  sc.id as section_case_id,
  cs.id as scenario_id,
  TRUE as enabled,
  0 as sort_order
FROM section_cases sc
JOIN case_scenarios cs ON cs.case_id = sc.case_id AND cs.scenario_name = 'Default Scenario'
WHERE NOT EXISTS (
  SELECT 1 FROM section_case_scenarios scs
  WHERE scs.section_case_id = sc.id AND scs.scenario_id = cs.id
);

-- Enable use_scenarios for all existing section_cases that now have scenarios assigned
UPDATE section_cases sc
SET use_scenarios = TRUE
WHERE EXISTS (
  SELECT 1 FROM section_case_scenarios scs WHERE scs.section_case_id = sc.id
);
