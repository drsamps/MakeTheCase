-- Migration: 045_case_writer_content_tweak_prompt.sql
-- Date: 2026-05-14
-- Description: Seed case_writer.content_tweak. A free-form revise prompt that
--              takes the current content of any markdown step (brief, blueprint,
--              student case, teaching note) plus a natural-language instruction
--              and returns a revised full document. Used by POST /projects/:id/tweak
--              which previews the revision in a side-by-side diff without persisting.

INSERT IGNORE INTO `ai_prompts` (`use`, `version`, `description`, `prompt_template`, `enabled`) VALUES
('case_writer.content_tweak', 'default',
 'Free-form natural-language tweak applied to one markdown step (brief, blueprint, student case, teaching note). Used for the side-by-side diff preview.',
 '-- placeholder: set during implementation --', 0);

UPDATE `ai_prompts`
SET `prompt_template` =
'You are helping a business school instructor make a focused, surgical revision to one document inside a case-writing project. The instructor has typed a free-form instruction describing the change they want. Apply ONLY that change.

Step being tweaked: {step}

Instructor''s tweak instruction:
{instruction}

Current content of the {step}:
---
{current_value}
---

Supporting context (read-only; do not append to your output):

Learning brief:
{learning_brief}

Case blueprint:
{case_blueprint}

Source materials (approved references):
{source_materials}

Rules:
- Apply the instructor''s instruction to the current content. Return the full revised document, not a diff or a delta.
- Preserve the document''s existing heading structure, section ordering, and any explicit facts, figures, names, or dates UNLESS the instruction explicitly asks to change them.
- Keep all content unrelated to the instruction byte-identical where possible. Do not rewrite for style. Do not "polish." Do not summarize.
- Maintain the same general length unless the instruction asks for a length change.
- If the instruction is ambiguous, make the smallest reasonable change that honors its intent.
- If the instruction asks for something impossible or unsafe (e.g. invent facts not supported by the brief or source materials), apply the closest reasonable interpretation rather than fabricating.

Output:
- Return ONLY the revised markdown document. No JSON wrapper, no preamble, no explanation, no code fences.',
    `description` = 'Free-form natural-language tweak applied to one markdown step (brief, blueprint, student case, teaching note). Used for the side-by-side diff preview.',
    `enabled` = 1
WHERE `use` = 'case_writer.content_tweak' AND `version` = 'default';

INSERT INTO `settings` (`setting_key`, `setting_value`, `description`)
VALUES ('active_prompt_case_writer.content_tweak', 'default', 'Active version for case_writer.content_tweak prompts')
ON DUPLICATE KEY UPDATE `setting_value` = 'default', `updated_at` = CURRENT_TIMESTAMP;
