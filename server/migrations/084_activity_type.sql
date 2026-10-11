-- Migration 084: the Study-Chat activity type moves onto the case.
--
-- A Study-Chat activity is: study documents, chat on a scenario with a persona, get graded on
-- a rubric. The existing `cases` row IS the activity, and it now says which type it is:
--   case_chat   the student argues a position with the case protagonist (the default)
--   teach_back  the student explains the reading to an AI audience
-- The list of types and their traits is utils/activityTypes.js; the per-type prompt builders
-- are server/services/activityTypes.js.
--
-- Before this, the type was `chat_options.activity_mode` on each assignment (section_cases,
-- course_case_versions, chat_options_defaults), so one case could be either type depending on
-- where it was assigned and a case on its own could not say what it was. That key is retired:
-- no code reads it, and every route that stores chat options strips it
-- (services/chatOptions.js#withoutActivityMode). Stored copies of the key are left in place
-- and are inert.
--
-- The type is fixed once the case has assignments, course listings or chats (PATCH
-- /api/cases/:id answers 409 ACTIVITY_TYPE_IN_USE).
--
-- The UPDATE below carries over any case that an assignment or a course version had marked
-- teach_back, resolving an assignment with no options of its own the way the retired
-- getActivityMode() did: the section default if the section has one, else the global default.
-- Teach-back shipped on the same branch as this migration, so on a database that never ran it
-- the UPDATE changes nothing.

ALTER TABLE `cases`
  ADD COLUMN `activity_type` VARCHAR(30) NOT NULL DEFAULT 'case_chat'
    COMMENT 'Study-Chat activity type (utils/activityTypes.js): case_chat, teach_back' AFTER `case_version`;

UPDATE `cases` c
   SET c.`activity_type` = 'teach_back'
 WHERE EXISTS (
         SELECT 1 FROM `section_cases` sc
          WHERE sc.`case_id` = c.`case_id`
            AND JSON_UNQUOTE(JSON_EXTRACT(sc.`chat_options`, '$.activity_mode')) = 'teach_back')
    OR EXISTS (
         SELECT 1 FROM `course_case_versions` v
           JOIN `course_cases` cc ON cc.`id` = v.`course_case_id`
          WHERE cc.`case_id` = c.`case_id`
            AND JSON_UNQUOTE(JSON_EXTRACT(v.`chat_options`, '$.activity_mode')) = 'teach_back')
    OR EXISTS (
         SELECT 1 FROM `section_cases` sc
           LEFT JOIN `chat_options_defaults` sd ON sd.`section_id` = sc.`section_id`
           LEFT JOIN `chat_options_defaults` gd ON gd.`section_id` IS NULL
          WHERE sc.`case_id` = c.`case_id`
            AND sc.`chat_options` IS NULL
            AND JSON_UNQUOTE(JSON_EXTRACT(IF(sd.`section_id` IS NOT NULL, sd.`chat_options`, gd.`chat_options`),
                                          '$.activity_mode')) = 'teach_back');
