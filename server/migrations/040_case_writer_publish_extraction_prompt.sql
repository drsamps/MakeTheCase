-- Migration: 040_case_writer_publish_extraction_prompt.sql
-- Date: 2026-05-13
-- Description: Seed case_writer.publish_field_extraction. Extracts the four
--              structured fields needed for the case_scenarios row (protagonist,
--              chat opening question, arguments for, arguments against) from a
--              completed student case + teaching note. Used by the Publish
--              setup pane's "Auto-fill" action; the user reviews and saves.

INSERT IGNORE INTO `ai_prompts` (`use`, `version`, `description`, `prompt_template`, `enabled`) VALUES
('case_writer.publish_field_extraction', 'default',
 'Extract publish-time fields (protagonist, opening question, arguments for/against) from finished case + teaching note',
 '-- placeholder: set during implementation --', 0);

UPDATE `ai_prompts`
SET `prompt_template` =
'You are preparing to publish a finished business case into a chat-based teaching tool. You must extract four structured fields from the case and teaching note. These will be presented to the instructor for review before publication.

Inputs:
- Student case (markdown):
{student_case_markdown}

- Teaching note (markdown):
{teaching_note_markdown}

Return ONLY a JSON object (no prose, no code fences) with this exact shape:

{
  "protagonist": "string",
  "chat_question": "string",
  "arguments_for": "string",
  "arguments_against": "string"
}

Field requirements:
- protagonist: The full name and role of the case protagonist, e.g. "Maya Chen, CEO of Northwind Robotics". Do not include backstory - just identity and role.
- chat_question: A single open-ended question the case will use to open the student chat. It should put the student in the protagonist''s shoes facing the decision point. 1-2 sentences, ending in a question mark.
- arguments_for: A short paragraph (3-6 sentences) summarizing the strongest case FOR the most likely affirmative course of action. Concrete reasons, not platitudes.
- arguments_against: A short paragraph (3-6 sentences) summarizing the strongest case AGAINST that same action (or FOR a competing alternative). Concrete reasons.

Guidance:
- Read both documents; the teaching note typically names the "recommended" direction, but extract balanced arguments either way so students see real tension.
- Do not invent facts. Stay inside what the case and teaching note describe.
- Do not include framework jargon (no "5 forces", "BCG matrix", etc.) unless the case itself does.',
    `description` = 'Extract publish-time fields (protagonist, opening question, arguments for/against) from finished case + teaching note',
    `enabled` = 1
WHERE `use` = 'case_writer.publish_field_extraction' AND `version` = 'default';

INSERT INTO `settings` (`setting_key`, `setting_value`, `description`)
VALUES ('active_prompt_case_writer.publish_field_extraction', 'default', 'Active version for case_writer.publish_field_extraction prompts')
ON DUPLICATE KEY UPDATE `setting_value` = 'default', `updated_at` = CURRENT_TIMESTAMP;
