-- Migration: 052_audit_log_and_system_state.sql
-- Date: 2026-05-15
-- Description: Two infrastructure tables that support multi-instructor
--              operation:
--                1. audit_log - Records sensitive actions (impersonation,
--                   transcript viewing, sharing, key changes, ownership
--                   transfers). Both actor_admin_id and acted_as_instructor_id
--                   are captured so writes made under impersonation remain
--                   attributable.
--                2. system_state - Single-row table holding the global
--                   current_semester_id with a compare-and-swap pattern so
--                   two admins can't silently race each other when switching
--                   the current semester.

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGINT AUTO_INCREMENT NOT NULL,
  ts TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  actor_admin_id CHAR(36) NULL COMMENT 'Admin who initiated the action (if any)',
  actor_instructor_id CHAR(36) NULL COMMENT 'Instructor who initiated (if not an admin)',
  acted_as_instructor_id CHAR(36) NULL COMMENT 'Target instructor when an admin is impersonating',
  action VARCHAR(80) NOT NULL COMMENT 'e.g. login, impersonate.start, case.share, key.set, ownership.transfer',
  resource_type VARCHAR(40) NULL,
  resource_id VARCHAR(64) NULL,
  ip VARCHAR(64) NULL,
  user_agent VARCHAR(255) NULL,
  details JSON NULL COMMENT 'Optional structured payload (old/new values, etc.)',
  PRIMARY KEY (id),
  INDEX idx_audit_ts (ts),
  INDEX idx_audit_actor_admin (actor_admin_id),
  INDEX idx_audit_actor_instructor (actor_instructor_id),
  INDEX idx_audit_acted_as (acted_as_instructor_id),
  INDEX idx_audit_action (action),
  INDEX idx_audit_resource (resource_type, resource_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- system_state: at most one row; holds CAS-safe globals
-- ============================================================
CREATE TABLE IF NOT EXISTS system_state (
  id TINYINT NOT NULL DEFAULT 1 COMMENT 'Always 1; enforced by UNIQUE',
  current_semester_id INT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by_admin_id CHAR(36) NULL,
  PRIMARY KEY (id),
  CONSTRAINT chk_system_state_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed the one row using whatever the existing semesters.is_current value is.
INSERT INTO system_state (id, current_semester_id)
SELECT 1, (SELECT id FROM semesters WHERE is_current = 1 LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM system_state WHERE id = 1);
