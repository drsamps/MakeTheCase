-- Migration: 037_case_writer_reference_summary_prompt.sql
-- Date: 2026-05-13
-- Description: Populate and enable case_writer.reference_summary. This prompt
--              produces a concise summary of an uploaded or pasted reference
--              document. The instructor approves the summary before it feeds
--              downstream prompts (brief generation, blueprint, etc.).

UPDATE `ai_prompts`
SET `prompt_template` =
'You are summarizing a reference document the instructor uploaded or pasted to inform an in-progress business case.

Reference title (may be empty): {title}
Reference type: {type}
Reference source notes (may be empty): {source_notes}

Reference content:
{content}

Produce a faithful summary the instructor can verify in under a minute. Do NOT add interpretation, opinion, or content that is not in the source. If the content is incomplete, note that explicitly.

Return ONLY a JSON object (no prose, no code fences) with this exact shape:

{
  "summary": "string (4 to 8 sentences capturing the central argument or content)",
  "key_facts": ["string", "string"],
  "useful_for": ["string", "string"],
  "cautions": ["string"]
}

Field requirements:
- summary: 4 to 8 sentences. Plain prose, no headers or bullets inside the string.
- key_facts: 4 to 10 specific facts, metrics, quotes, or definitions from the source that a case writer might draw on.
- useful_for: 2 to 5 labels for what this reference can support in case writing, e.g. "industry context", "stakeholder framing", "comparison case", "regulatory background".
- cautions: 0 to 4 caveats. Examples: "single-source claim", "regional only", "older than 5 years", "appears to be opinion not data". Empty array if none apply.',
    `description` = 'Summarize an uploaded/pasted reference for instructor approval',
    `enabled` = 1
WHERE `use` = 'case_writer.reference_summary' AND `version` = 'default';

INSERT INTO `settings` (`setting_key`, `setting_value`, `description`)
VALUES ('active_prompt_case_writer.reference_summary', 'default', 'Active version for case_writer.reference_summary prompts')
ON DUPLICATE KEY UPDATE `setting_value` = 'default', `updated_at` = CURRENT_TIMESTAMP;
