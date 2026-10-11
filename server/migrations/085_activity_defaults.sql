-- Migration 085: a case carries its own default settings.
--
-- An activity's settings (chat options, rubric, which scenarios are offered, selection mode,
-- position tracking) used to exist only where the case was assigned: on a course case version or
-- a section assignment. A case that was not yet assigned had none, so nothing could say "this is
-- how the activity is meant to be run", and an activity installed from a package had nowhere to
-- put the settings it arrived with.
--
-- default_settings   JSON: { chat_options, selection_mode, require_order, use_scenarios,
--                    position_tracking_enabled, position_capture_method, track_position_change,
--                    scenarios: [{scenario_id, enabled, sort_order}],
--                    positions: [{position_id, enabled, sort_order}], saved_at, source }
--                    NULL = the case has no defaults (new assignments start from the server's).
-- default_rubric_id  the rubric that goes with them (NULL = the system default rubric).
--
-- They are COPIED when the case is attached: a new course Main version starts from them
-- (caseVersionSync.js#createCourseCase), and so does a section assignment that follows no Main
-- (POST /api/sections/:sectionId/cases). Existing versions and assignments are never changed by
-- an edit to the defaults. See server/services/activityDefaults.js.

ALTER TABLE `cases`
  ADD COLUMN `default_settings` JSON NULL
    COMMENT 'Default assignment settings copied when the case is attached (services/activityDefaults.js); NULL = none',
  ADD COLUMN `default_rubric_id` INT NULL
    COMMENT 'Rubric that goes with default_settings; NULL = system default rubric',
  ADD CONSTRAINT `fk_cases_default_rubric`
    FOREIGN KEY (`default_rubric_id`) REFERENCES `rubrics` (`rubric_id`) ON DELETE SET NULL;
