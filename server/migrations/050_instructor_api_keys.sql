-- Migration: 050_instructor_api_keys.sql
-- Date: 2026-05-15
-- Description: Per-instructor API key storage (encrypted at rest) and two new
--              admin-grantable flags on instructors:
--                use_system_key - allow this instructor to use the shared env
--                                 API key instead of their own
--                can_publish    - allow this instructor to set visibility=public
--                                 on cases/rubrics/personas/case_writer_projects
--
-- Encryption: ciphertext is AES-256-GCM, produced by Node crypto with a
-- per-row IV; the IV (12 bytes) and auth tag (16 bytes) are prefixed to the
-- ciphertext in api_key_encrypted. Master secret lives in
-- MTC_KEY_ENCRYPTION_SECRET. Loss of that secret renders all stored keys
-- unrecoverable.

-- ============================================================
-- 1. Add admin-grantable flags to instructors
-- ============================================================
ALTER TABLE `instructors`
  ADD COLUMN `use_system_key` TINYINT(1) NOT NULL DEFAULT 0 AFTER `active`,
  ADD COLUMN `can_publish` TINYINT(1) NOT NULL DEFAULT 0 AFTER `use_system_key`;

-- ============================================================
-- 2. Per-instructor API keys
-- ============================================================
CREATE TABLE IF NOT EXISTS instructor_api_keys (
  id INT AUTO_INCREMENT NOT NULL,
  instructor_id CHAR(36) NOT NULL,
  provider ENUM('openai', 'anthropic', 'google', 'openrouter') NOT NULL,
  api_key_encrypted VARBINARY(512) NOT NULL COMMENT 'IV(12) || AUTH_TAG(16) || CIPHERTEXT',
  key_hint VARCHAR(8) NOT NULL DEFAULT '' COMMENT 'Last 4 chars of plaintext for UI identification',
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  last_validated_at TIMESTAMP NULL DEFAULT NULL COMMENT 'When the key was last successfully test-called',
  last_validation_error TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_instructor_provider (instructor_id, provider),
  INDEX idx_api_keys_instructor (instructor_id),
  CONSTRAINT fk_api_keys_instructor
    FOREIGN KEY (instructor_id) REFERENCES instructors(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
