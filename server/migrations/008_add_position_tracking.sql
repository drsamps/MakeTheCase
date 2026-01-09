-- Migration: 008_add_position_tracking.sql
-- Purpose: Add student position tracking (for/against) on case proposals
-- Date: 2026-01-09

-- ============================================================
-- 1. Add position columns to case_chats table
-- ============================================================
ALTER TABLE case_chats
ADD COLUMN initial_position VARCHAR(50) DEFAULT NULL
    COMMENT 'Student initial position at chat start',
ADD COLUMN final_position VARCHAR(50) DEFAULT NULL
    COMMENT 'Student final position at chat end',
ADD COLUMN position_method ENUM('explicit', 'ai_inferred', 'instructor_manual') DEFAULT NULL
    COMMENT 'How the position was captured';

-- Add index for position filtering and analytics
ALTER TABLE case_chats
ADD INDEX idx_case_chats_positions (initial_position, final_position);

-- ============================================================
-- 2. Create position_logs table for audit trail
-- ============================================================
CREATE TABLE IF NOT EXISTS chat_position_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  case_chat_id CHAR(36) NOT NULL,
  position_type ENUM('initial', 'final') NOT NULL,
  position_value VARCHAR(50) NOT NULL,
  recorded_by ENUM('student', 'ai', 'instructor') NOT NULL,
  recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  notes TEXT DEFAULT NULL COMMENT 'AI reasoning or instructor notes',

  FOREIGN KEY (case_chat_id) REFERENCES case_chats(id) ON DELETE CASCADE,
  INDEX idx_position_logs_chat (case_chat_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
