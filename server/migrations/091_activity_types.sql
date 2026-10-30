-- Migration 091: activity types as data (StudyChat Phase 2, dev/StudyChat-plan.md §4).
--
-- activity_types          one row per type. Built-ins (case_chat, teach_back) have a row for the
--                         enabled flag and listings; their definitions stay in code
--                         (utils/activityEngine/builtins/*.json). System types (Phase 3, seeded)
--                         and custom types (cloned by admins) keep their definitions below.
-- activity_type_versions  draft -> published -> retired. At most one draft per type. Published and
--                         retired rows are never edited or deleted: chats record the version they
--                         ran on (case_chats.activity_type_version = '<type_key>@v<version_no>').
--
-- Keys are at most 30 characters, the width of cases.activity_type. Custom keys are
-- c_<slug>_<8 hex>, so they can never collide with a future system type.
-- Server code: server/services/activityTypeStore.js. Admin permission: activity_types.

CREATE TABLE IF NOT EXISTS activity_types (
  type_key VARCHAR(30) NOT NULL,
  uid CHAR(36) NOT NULL,
  tier ENUM('builtin', 'system', 'custom') NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  current_version_id INT NULL DEFAULT NULL,
  based_on VARCHAR(30) NULL DEFAULT NULL,
  created_by CHAR(36) NULL DEFAULT NULL,
  created_by_type ENUM('admin', 'instructor') NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (type_key),
  UNIQUE KEY uq_activity_types_uid (uid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS activity_type_versions (
  version_id INT NOT NULL AUTO_INCREMENT,
  type_key VARCHAR(30) NOT NULL,
  version_no INT NOT NULL,
  status ENUM('draft', 'published', 'retired') NOT NULL DEFAULT 'draft',
  definition JSON NOT NULL,
  definition_sha256 CHAR(64) NOT NULL,
  notes VARCHAR(500) NULL DEFAULT NULL,
  created_by CHAR(36) NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  published_at TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (version_id),
  UNIQUE KEY uq_activity_type_version (type_key, version_no),
  KEY idx_activity_type_versions_status (type_key, status),
  CONSTRAINT fk_activity_type_versions_type FOREIGN KEY (type_key) REFERENCES activity_types (type_key) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO activity_types (type_key, uid, tier, enabled) VALUES
  ('case_chat', UUID(), 'builtin', 1),
  ('teach_back', UUID(), 'builtin', 1);
