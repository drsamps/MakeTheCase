-- Migration 086: identity for activities that travel between MakeTheCase servers.
--
-- An activity package (server/services/activityPack, docs/activity-packages.md) is a ZIP of one
-- or more cases with their documents, scenarios, positions, personas, rubric and default
-- settings. Numeric ids never travel, so each thing that must be recognised again on another
-- server carries a UUID:
--
--   cases.activity_uid              the activity. Unique per server: installing a package whose
--                                   uid is already here is reported as "already installed", and
--                                   a deliberate second copy gets a new uid.
--   case_scenarios.scenario_uid     a scenario within its activity
--   scenario_positions.position_uid a position within its scenario
--
-- All three are NULL until the case is first exported (the exporter mints them) or installed
-- (the installer writes the package's). Nothing else reads them yet; they are in the package
-- format from version 1 so that updating an installed activity in place can be added later
-- without changing the format.
--
--   cases.origin   JSON, set only on an installed activity:
--                  { activity_uid, content_hash, exported_at, exported_from, installed_at, copy }
--                  activity_uid is the uid in the package (differs from cases.activity_uid on a
--                  separate copy). content_hash identifies the exact package content installed.

ALTER TABLE `cases`
  ADD COLUMN `activity_uid` CHAR(36) NULL
    COMMENT 'UUID that travels in activity packages; NULL until first exported or installed',
  ADD COLUMN `origin` JSON NULL
    COMMENT 'Set when installed from an activity package: where it came from and which content',
  ADD UNIQUE KEY `uq_cases_activity_uid` (`activity_uid`);

ALTER TABLE `case_scenarios`
  ADD COLUMN `scenario_uid` CHAR(36) NULL
    COMMENT 'UUID that travels in activity packages; NULL until first exported or installed',
  ADD KEY `idx_case_scenarios_uid` (`scenario_uid`);

ALTER TABLE `scenario_positions`
  ADD COLUMN `position_uid` CHAR(36) NULL
    COMMENT 'UUID that travels in activity packages; NULL until first exported or installed',
  ADD KEY `idx_scenario_positions_uid` (`position_uid`);
