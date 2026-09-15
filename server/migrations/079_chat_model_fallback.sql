-- Migration 079: chat model fallback (ranked default models as backups).
--
-- models.default_model is now a RANK, not a flag (no schema change -- TINYINT holds 0..127):
--   0      not a default
--   1      THE default model (#1)
--   2,3,.. backup defaults, tried in this order when a chat model fails
-- Ranks are kept unique and gap-free by setDefaultRank() in server/routes/models.js.
-- Any code that needs "the default model" must test default_model = 1, never truthiness.
--
-- case_chats.chat_model stays the model ASSIGNED at chat start. backup_models_used records only
-- the deviations: NULL when every reply came from chat_model, otherwise a count of replies per
-- backup model, e.g. {"anthropic/claude-haiku-4.5": 3}.
--
-- model_failures logs every failed chat attempt (rate limit, timeout, ...) and which model, if
-- any, answered instead. See server/services/chatFallback.js and docs/model-fallback.md.

ALTER TABLE case_chats
  ADD COLUMN backup_models_used JSON NULL
    COMMENT 'NULL = no backup used; else {model_id: reply_count} for replies not from chat_model';

ALTER TABLE models
  MODIFY COLUMN default_model TINYINT NOT NULL DEFAULT 0
    COMMENT 'Default rank: 0 = not a default, 1 = the default, 2+ = backup defaults in order';

CREATE TABLE model_failures (
  id                 BIGINT AUTO_INCREMENT PRIMARY KEY,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  case_chat_id       CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  section_id         VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  instructor_id      CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  model_id           VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  error_kind         ENUM('rate_limit','timeout','server_error','empty_reply','other') NOT NULL,
  http_status        SMALLINT NULL,
  message            VARCHAR(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  served_by_model_id VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL
    COMMENT 'Model that finally answered this reply; NULL if no model did',
  KEY idx_model_failures_model_time (model_id, created_at),
  KEY idx_model_failures_time (created_at),
  KEY idx_model_failures_section (section_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Failed student chat attempts, for chat model fallback and reliability reporting';
