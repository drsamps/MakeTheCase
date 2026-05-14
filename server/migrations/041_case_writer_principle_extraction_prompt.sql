-- Migration: 041_case_writer_principle_extraction_prompt.sql
-- Date: 2026-05-13
-- Description: Seed case_writer.principle_extraction. From uploaded/pasted source
--              material (a textbook chapter, an article, etc.), extract a list
--              of candidate teaching principles the instructor could turn into
--              a case. Powers the New Project flow's "suggest principles" path.

INSERT IGNORE INTO `ai_prompts` (`use`, `version`, `description`, `prompt_template`, `enabled`) VALUES
('case_writer.principle_extraction', 'default',
 'From source material, suggest candidate teaching principles for a new case',
 '-- placeholder: set during implementation --', 0);

UPDATE `ai_prompts`
SET `prompt_template` =
'You are helping a business school instructor identify candidate teaching principles from source material they have uploaded or pasted. A teaching principle is a single concept, mechanism, framework, or trade-off that could anchor a case discussion.

Source material:
- Title (may be empty): {title}
- Type: {type}
- Content:
{content}

Read the source carefully and produce a list of 3 to 7 candidate teaching principles. Each candidate should be:
- A real, substantive idea drawn from the source (not generic management advice).
- Specific enough to anchor a 60-90 minute case discussion.
- Distinct from the others - not minor restatements of the same idea.

Return ONLY a JSON object (no prose, no code fences) with this exact shape:

{
  "principles": [
    {
      "principle": "string (one-line label, e.g. ''Vertical integration vs. modular outsourcing in hardware startups'')",
      "rationale": "string (2-3 sentences on why this principle is in the source and what makes it teachable)"
    }
  ]
}

Guidance:
- Order from most central / most teachable to least.
- If the source is thin or unrelated to management/strategy/operations, still return at least 3 best-effort candidates and note the thinness in their rationales.
- Do not invent content not in the source.',
    `description` = 'From source material, suggest candidate teaching principles for a new case',
    `enabled` = 1
WHERE `use` = 'case_writer.principle_extraction' AND `version` = 'default';

INSERT INTO `settings` (`setting_key`, `setting_value`, `description`)
VALUES ('active_prompt_case_writer.principle_extraction', 'default', 'Active version for case_writer.principle_extraction prompts')
ON DUPLICATE KEY UPDATE `setting_value` = 'default', `updated_at` = CURRENT_TIMESTAMP;
