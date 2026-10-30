-- Migration 092: assigned positions and the activity goal (StudyChat Phase 3, dev/StudyChat-plan.md §6).
--
-- 'assigned' capture: the SERVER picks the student's side when the chat starts
-- (server/services/sideAssignment.js) and ignores any position the client sends.
-- case_chats.position_method also gains its missing 'none', which section_cases already had.
--
-- cases.goal: the learning objective, for the AI and the grader; shown to students only when the
-- activity type's intro copy has a `goal` line (utils/activityEngine/copy.js).

ALTER TABLE section_cases
  MODIFY COLUMN position_capture_method ENUM('explicit', 'ai_inferred', 'instructor_manual', 'none', 'assigned') DEFAULT 'explicit' COMMENT 'How initial position is captured';

ALTER TABLE course_case_versions
  MODIFY COLUMN position_capture_method ENUM('explicit', 'ai_inferred', 'instructor_manual', 'none', 'assigned') DEFAULT 'explicit';

ALTER TABLE case_chats
  MODIFY COLUMN position_method ENUM('explicit', 'ai_inferred', 'instructor_manual', 'none', 'assigned') DEFAULT NULL COMMENT 'How the position was captured';

ALTER TABLE cases
  ADD COLUMN goal TEXT NULL DEFAULT NULL AFTER activity_type;
