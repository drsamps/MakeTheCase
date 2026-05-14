-- Migration: 036_case_writer_section_revision_prompt.sql
-- Date: 2026-05-13
-- Description: Populate and enable case_writer.section_revision. This prompt
--              revises a single step's JSON output in place, preserving the
--              shape so the route can drop the result back into the project.

UPDATE `ai_prompts`
SET `prompt_template` =
'You are revising one section of a business case authoring project.

Step being revised: {step}
Revision command: {command}
Optional free-text instruction (may be empty): {instruction}

Current value of this step (as JSON):
{current_value}

For context, here is the rest of the project (may be empty if earlier steps haven''t been generated yet):

Learning brief:
{learning_brief}

Selected scenario:
{selected_scenario}

Case blueprint:
{case_blueprint}

Student case (markdown form, may be empty):
{student_case_markdown}

Common revision commands and what they mean:
- rewrite: rewrite from scratch while keeping the same intent and shape
- shorten: cut length significantly while preserving meaning
- expand: add detail and depth
- tighten: keep the same content but make the writing crisper
- sharpen_decision: make the decision question more concrete and forced
- add_ambiguity: make the dilemma less obviously resolvable
- harden_evidence: add specific numbers, dates, or stakeholder quotes
- soften_tone: less editorial, more neutral and observational
- preserve_facts: do not introduce new facts; only revise wording and structure

Rules:
- Return ONLY a JSON object (no prose, no code fences) with the SAME top-level shape as the current value. Do NOT change keys, add new top-level keys, or remove existing ones.
- Honor the revision command first, then the free-text instruction (which may further refine the command).
- Stay consistent with the rest of the project context above. Do not contradict earlier approved steps.
- For step=student_case the boundary rules from the original draft prompt still apply: NO recommended answer, analysis, expected outcomes, lessons learned, discussion questions, or rubrics in the student case.
- For step=teaching_note, the structured fields and the assembled note_markdown (if present) must stay consistent with each other. If you change a structured field, update related fields too.',
    `description` = 'Revise a single project step in place; preserves the JSON shape of the step',
    `enabled` = 1
WHERE `use` = 'case_writer.section_revision' AND `version` = 'default';

INSERT INTO `settings` (`setting_key`, `setting_value`, `description`)
VALUES ('active_prompt_case_writer.section_revision', 'default', 'Active version for case_writer.section_revision prompts')
ON DUPLICATE KEY UPDATE `setting_value` = 'default', `updated_at` = CURRENT_TIMESTAMP;
