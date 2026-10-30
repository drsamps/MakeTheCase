-- Migration 093: signals, completion reasons and touchpoints (StudyChat Phase 4, plan §5-6).
--
-- case_chats.completion_reason  how the chat ended; written once (services/chatCompletion.js).
-- case_chats.goal_reached_at    the AI signalled the goal was reached. Only offers Finish.
-- chat_turns.signals            what the AI signalled with that reply. Never in `content`, so
--                               transcripts, grading and Issue Analytics never see it.
-- evaluations.touchpoints       [{key, label, hit, evidence}] from grading, with the label
--                               SNAPSHOTTED, so renaming a touchpoint later changes no result.

ALTER TABLE case_chats
  ADD COLUMN completion_reason ENUM('time', 'max_exchanges', 'student', 'goal', 'instructor', 'canceled') NULL DEFAULT NULL,
  ADD COLUMN goal_reached_at TIMESTAMP NULL DEFAULT NULL;

ALTER TABLE chat_turns
  ADD COLUMN signals JSON NULL DEFAULT NULL;

ALTER TABLE evaluations
  ADD COLUMN touchpoints JSON NULL DEFAULT NULL;
