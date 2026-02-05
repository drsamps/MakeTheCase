-- Migration: 022_add_rubrics_system.sql
-- Purpose: Add customizable evaluation rubrics with reusable criteria
-- Date: 2026-02-04

-- =====================================================
-- 1. Reusable evaluation criteria (can be used in multiple rubrics)
-- =====================================================
CREATE TABLE IF NOT EXISTS rubric_criteria (
  id INT AUTO_INCREMENT PRIMARY KEY,
  criteria_id VARCHAR(50) NOT NULL UNIQUE COMMENT 'User-specified identifier (e.g., "study_material", "justification")',
  name VARCHAR(100) NOT NULL COMMENT 'Display name',
  question_text TEXT NOT NULL COMMENT 'The evaluation question',
  max_points INT NOT NULL DEFAULT 5,
  scoring_guide JSON COMMENT '{"1": "desc", "2": "desc", ...}',
  prompt_text TEXT COMMENT 'LLM prompt fragment for this criterion',
  created_by CHAR(36) DEFAULT NULL,
  enabled TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_criteria_id (criteria_id),
  INDEX idx_enabled (enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 2. Rubrics (composed of multiple criteria)
-- =====================================================
CREATE TABLE IF NOT EXISTS rubrics (
  rubric_id INT AUTO_INCREMENT PRIMARY KEY,
  rubric_name VARCHAR(100) NOT NULL,
  description TEXT,
  criteria_ids JSON NOT NULL COMMENT 'Ordered array of criteria_id strings, e.g., ["study_material", "solid_answers", "justification"]',
  total_points INT NOT NULL DEFAULT 15 COMMENT 'Cached sum of criteria max_points',
  criteria_prompt TEXT COMMENT 'Cached LLM prompt generated from criteria',
  additional_prompt TEXT COMMENT 'Instructor-specified additional LLM instructions',
  prompt_stale TINYINT(1) DEFAULT 0 COMMENT 'Set to 1 when a criterion is edited; cleared after regenerate',
  is_system_default TINYINT(1) DEFAULT 0,
  created_by CHAR(36) DEFAULT NULL,
  enabled TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_system_default (is_system_default),
  INDEX idx_enabled (enabled),
  INDEX idx_stale (prompt_stale)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 3. Link rubrics to section-case assignments
-- =====================================================
ALTER TABLE section_cases
ADD COLUMN rubric_id INT DEFAULT NULL COMMENT 'FK to rubrics (NULL = use system default)';

ALTER TABLE section_cases
ADD CONSTRAINT section_cases_rubric_fk
  FOREIGN KEY (rubric_id) REFERENCES rubrics(rubric_id) ON DELETE SET NULL;

-- =====================================================
-- 4. Track which rubric was used for each evaluation
-- =====================================================
ALTER TABLE evaluations
ADD COLUMN rubric_id INT DEFAULT NULL COMMENT 'FK to rubrics used for this evaluation';

-- Note: Not adding FK constraint on evaluations to allow flexibility
-- and avoid issues with historical data

-- =====================================================
-- 5. Seed default criteria (current 3-question rubric)
-- =====================================================
INSERT INTO rubric_criteria (criteria_id, name, question_text, max_points, scoring_guide, prompt_text) VALUES
('study_material',
 'Reading Comprehension',
 'Did the student appear to have studied the reading material?',
 5,
 '{"1": "Student answers were inconsistent with reading material", "2": "Student answers were loosely related to reading material", "3": "Student answers were somewhat consistent with reading material", "4": "Student answers were quite consistent with reading material", "5": "Student answers were very consistent with reading material"}',
 'Q1. Did the student appear to have studied the reading material? (5 points)\n- 1 point = inconsistent with reading material\n- 2 points = loosely related\n- 3 points = somewhat consistent\n- 4 points = quite consistent\n- 5 points = very consistent'),

('solid_answers',
 'Answer Quality',
 'Did the student provide solid answers to chatbot questions?',
 5,
 '{"1": "Weak answers missing common sense", "2": "Fair answers that were just okay", "3": "Good answers, but lacking in some areas", "4": "Great answers, but not perfect", "5": "Excellent answers, well articulated and complete"}',
 'Q2. Did the student provide solid answers to chatbot questions? (5 points)\n- 1 = weak answers\n- 2 = fair answers\n- 3 = good answers, lacking in some areas\n- 4 = great answers, not perfect\n- 5 = excellent answers'),

('justification',
 'Evidence-Based Reasoning',
 'Did the student justify the answer using relevant reading information?',
 5,
 '{"1": "Answer not justified using reading material", "2": "Answer mildly justified", "3": "Okay justification, superficial references", "4": "Good justification based on reading", "5": "Solid justification with relevant points from reading"}',
 'Q3. Did the student justify the answer using relevant reading information? (5 points)\n- 1 = not justified\n- 2 = mildly justified\n- 3 = okay justification\n- 4 = good justification\n- 5 = solid justification');

-- =====================================================
-- 6. Seed default rubric
-- =====================================================
INSERT INTO rubrics (rubric_name, description, criteria_ids, total_points, criteria_prompt, is_system_default) VALUES
('Default Case Analysis Rubric',
 'Standard 3-question evaluation for case analysis',
 '["study_material", "solid_answers", "justification"]',
 15,
 'Evaluate the student based on the following criteria:\n\nQ1. Did the student appear to have studied the reading material? (5 points)\n- 1 point = inconsistent with reading material\n- 2 points = loosely related\n- 3 points = somewhat consistent\n- 4 points = quite consistent\n- 5 points = very consistent\n\nQ2. Did the student provide solid answers to chatbot questions? (5 points)\n- 1 = weak answers\n- 2 = fair answers\n- 3 = good answers, lacking in some areas\n- 4 = great answers, not perfect\n- 5 = excellent answers\n\nQ3. Did the student justify the answer using relevant reading information? (5 points)\n- 1 = not justified\n- 2 = mildly justified\n- 3 = okay justification\n- 4 = good justification\n- 5 = solid justification',
 1);
