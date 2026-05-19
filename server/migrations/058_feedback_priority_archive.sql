-- Adds admin-only priority + archive/delete capabilities for the feedback inbox.
--
-- priority: 0 = none (default), 1 = low, 2 = medium, 3 = high.
--   Stored as TINYINT so SQL ORDER BY sorts correctly without a CASE.
--   Submitters never see this column; backend /feedback/mine omits it.
--
-- archived_at / archived_by_user_id: soft-archive. The inbox hides archived
-- rows by default. Hard DELETE is still available to feedback admins.
ALTER TABLE feedback_submissions
  ADD COLUMN priority TINYINT NOT NULL DEFAULT 0 AFTER resolution_note,
  ADD COLUMN archived_at TIMESTAMP NULL DEFAULT NULL AFTER priority,
  ADD COLUMN archived_by_user_id CHAR(36) DEFAULT NULL AFTER archived_at,
  ADD INDEX idx_feedback_archived (archived_at),
  ADD INDEX idx_feedback_priority (priority);
