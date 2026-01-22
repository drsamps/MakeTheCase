-- Migration: 009_create_transcripts_table.sql
-- Purpose: Create dedicated transcripts table for clean separation from case_chats and evaluations
-- Date: 2026-01-12
-- Related: dev/2026-01-12-table-redundancy-analysis.md

-- ============================================================
-- 1. Create transcripts table
-- ============================================================

CREATE TABLE IF NOT EXISTS transcripts (
  id CHAR(36) NOT NULL,
  case_chat_id CHAR(36) NOT NULL,
  transcript TEXT,
  is_anonymized BOOLEAN DEFAULT FALSE,
  anonymized_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  word_count INT DEFAULT 0,
  saved_with_permission BOOLEAN DEFAULT FALSE,
  
  PRIMARY KEY (id),
  INDEX idx_case_chat_id (case_chat_id),
  INDEX idx_created_at (created_at),
  INDEX idx_anonymized (is_anonymized),
  
  FOREIGN KEY (case_chat_id) REFERENCES case_chats(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Stores chat transcripts with privacy/anonymization tracking';
