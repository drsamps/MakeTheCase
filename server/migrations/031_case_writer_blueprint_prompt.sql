-- Migration: 031_case_writer_blueprint_prompt.sql
-- Date: 2026-05-13
-- Description: Populate and enable the case_writer.case_blueprint prompt template,
--              and set 'default' as the active version.

UPDATE `ai_prompts`
SET `prompt_template` =
'You are an instructional design assistant building a case blueprint that an instructor will approve before any case prose is drafted.

Approved learning brief:
{learning_brief}

Selected scenario (already chosen and possibly refined by the instructor):
{selected_scenario}

Additional instructor guidance (optional, may be empty): {revision_hint}

Build a complete case blueprint. Do NOT write the case narrative yet. Do NOT include analysis or the recommended answer.

Return ONLY a JSON object (no prose, no code fences) with this exact shape:

{
  "working_title": "string",
  "case_type": "fictional|disguised|composite|real_company_inspired|real_company_verified",
  "teaching_principle": "string",
  "student_audience": "string",
  "opening_hook": "string",
  "protagonist": {
    "name": "string",
    "role": "string",
    "background": "string"
  },
  "company_background": "string",
  "industry_context": "string",
  "timeline": [
    { "when": "string", "event": "string" }
  ],
  "core_conflict": "string",
  "stakeholders": [
    { "name": "string", "role": "string", "position_or_interest": "string" }
  ],
  "evidence_to_include": ["string", "string", "string"],
  "exhibits": [
    { "title": "string", "type": "qualitative|quantitative", "description": "string" }
  ],
  "decision_point": "string",
  "information_to_withhold_from_students": ["string", "string"],
  "teaching_note_only_content": ["string", "string"]
}

Requirements:
- working_title: catchy and specific (not just the principle name).
- opening_hook: 2 to 4 sentences setting a vivid scene the student case can open with. Must hint at the decision pressure WITHOUT revealing the answer.
- protagonist: pull from the selected scenario when present; flesh out a plausible background if the scenario only named a role.
- timeline: 3 to 6 entries ordered earliest-to-latest, ending at or just before the decision moment.
- stakeholders: 4 to 7 named groups or individuals, each with a clear position or interest at stake.
- evidence_to_include: 4 to 8 concrete facts, metrics, or qualitative observations the student case must contain.
- exhibits: 2 to 5 items; mark each as qualitative or quantitative. These are what students will analyze.
- decision_point: phrase as the explicit question the protagonist must answer.
- information_to_withhold_from_students: things the instructor knows that the student case must NOT reveal (e.g. "what actually happened after the decision", "competitor''s undisclosed plans").
- teaching_note_only_content: analytical content reserved for the teaching note (e.g. "channel margin sensitivity analysis", "recommended decision and rationale", "expected outcomes").
- The blueprint must remain consistent with the approved brief and selected scenario. Do NOT introduce a different industry, protagonist, or decision than the scenario specifies.',
    `description` = 'Build a case blueprint from the selected scenario (JSON)',
    `enabled` = 1
WHERE `use` = 'case_writer.case_blueprint' AND `version` = 'default';

INSERT INTO `settings` (`setting_key`, `setting_value`, `description`)
VALUES ('active_prompt_case_writer.case_blueprint', 'default', 'Active version for case_writer.case_blueprint prompts')
ON DUPLICATE KEY UPDATE `setting_value` = 'default', `updated_at` = CURRENT_TIMESTAMP;
