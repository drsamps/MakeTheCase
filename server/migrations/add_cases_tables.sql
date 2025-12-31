-- Migration: Add multi-case support tables
-- Run with: mysql -u root -p ceochat < server/migrations/add_cases_tables.sql

USE ceochat;

-- cases table: stores business case metadata
CREATE TABLE IF NOT EXISTS cases (
  case_id VARCHAR(30) PRIMARY KEY,
  case_title VARCHAR(100) NOT NULL,
  protagonist VARCHAR(100) NOT NULL,
  protagonist_initials VARCHAR(3) NOT NULL,
  chat_topic VARCHAR(255),
  chat_question TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  enabled BOOLEAN DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- case_files table: tracks uploaded files (case documents and teaching notes)
CREATE TABLE IF NOT EXISTS case_files (
  id INT AUTO_INCREMENT PRIMARY KEY,
  case_id VARCHAR(30) NOT NULL,
  filename VARCHAR(255) NOT NULL,
  file_type VARCHAR(30) NOT NULL, -- 'case' or 'teaching_note'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (case_id) REFERENCES cases(case_id) ON DELETE CASCADE,
  INDEX idx_case_id (case_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- section_cases junction table: links sections to cases with active toggle
-- Note: Only one case per section should have active=TRUE at a time (enforced by API)
CREATE TABLE IF NOT EXISTS section_cases (
  id INT AUTO_INCREMENT PRIMARY KEY,
  section_id VARCHAR(20) NOT NULL,
  case_id VARCHAR(30) NOT NULL,
  active BOOLEAN DEFAULT FALSE,
  chat_options JSON,  -- configurable options for this section-case (Phase 2)
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (section_id) REFERENCES sections(section_id) ON DELETE CASCADE,
  FOREIGN KEY (case_id) REFERENCES cases(case_id) ON DELETE CASCADE,
  UNIQUE KEY unique_section_case (section_id, case_id),
  INDEX idx_section_id (section_id),
  INDEX idx_case_id (case_id),
  INDEX idx_active (section_id, active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
