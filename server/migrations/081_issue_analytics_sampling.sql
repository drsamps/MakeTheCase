-- Migration 081: Issue Analytics — analyze a sample of transcripts.
--
-- A run can cover a proportional-by-section sample of N usable transcripts instead of all of
-- them. The draw is deterministic (sha256(seed:case_chat_id) order within each section), so
-- the estimate and the run agree, and slots are allocated one at a time so a larger sample
-- with the same seed and pool keeps the smaller one (see the warning on drawSample about the
-- Alabama paradox). See docs/issue-analytics.md § Sampling and
-- services/issueAnalytics/scope.js#drawSample.
-- Chats not drawn are not written to issue_analysis_run_chats.

ALTER TABLE issue_analysis_runs
  ADD COLUMN sample_size INT NULL
    COMMENT 'Transcripts drawn; NULL = every usable transcript in scope' AFTER chats_failed,
  ADD COLUMN sample_seed VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL
    COMMENT 'Seed of the deterministic draw' AFTER sample_size,
  ADD COLUMN sample_pool INT NULL
    COMMENT 'Usable transcripts the sample was drawn from' AFTER sample_seed;
