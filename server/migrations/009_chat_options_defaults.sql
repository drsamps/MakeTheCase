-- Migration 009: Chat Options Defaults
-- Adds a table for storing default chat options per section or globally

CREATE TABLE IF NOT EXISTS chat_options_defaults (
  id INT AUTO_INCREMENT PRIMARY KEY,
  section_id VARCHAR(20) NULL,  -- NULL = global default for all sections
  chat_options JSON NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_section_default (section_id),
  FOREIGN KEY (section_id) REFERENCES sections(section_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add index for quick lookups
CREATE INDEX idx_section_default ON chat_options_defaults(section_id);

-- Insert global default if not exists
INSERT INTO chat_options_defaults (section_id, chat_options)
VALUES (NULL, JSON_OBJECT(
  'hints_allowed', 3,
  'free_hints', 1,
  'ask_for_feedback', false,
  'ask_save_transcript', false,
  'allowed_personas', 'moderate,strict,liberal,leading,sycophantic',
  'default_persona', 'moderate',
  'show_case', true,
  'do_evaluation', true,
  'chatbot_personality', '',
  'allow_repeat', false,
  'timeout_chat', false,
  'restart_chat', false,
  'allow_exit', false,
  'disable_position_tracking', false
))
ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP;
