-- Migration: 046_case_writer_content_tweak_prompt_v2.sql
-- Date: 2026-05-14
-- Description: Tighten the case_writer.content_tweak prompt seeded by
--              migration 045. The previous template had four labeled
--              context sub-slots ("Learning brief:", "Case blueprint:",
--              "Source materials:") under a header that read
--              "Supporting context (read-only; do not append to your output):".
--              Some models echoed that header and its labels verbatim into
--              the tweaked output (observed on Blueprint tweaks where the
--              {current_value} and {case_blueprint} slots received the same
--              content under two different labels — the model treated the
--              second copy + its headers as part of the document to return).
--
--              This rewrite:
--                * Collapses the four labeled context slots into a single
--                  {background} variable. The server (caseWriter.js) builds
--                  the per-step background string and intentionally OMITS
--                  whichever upstream artifact is the section being tweaked,
--                  so the model never sees the same text twice with two
--                  different labels.
--                * Removes the literal phrase
--                  "Supporting context (read-only; do not append to your output):"
--                  that was the most visible leak.
--                * Uses explicit <<<BEGIN SECTION / END SECTION>>> fences
--                  around the document under revision so it is unambiguously
--                  distinct from BACKGROUND content.
--                * Re-states at the end that the output must NOT include any
--                  of the scaffolding labels (INSTRUCTION, SECTION, BEGIN
--                  SECTION, END SECTION, BACKGROUND, Rules:).
--
--              No schema change. UPDATEs the active 'default' row in
--              ai_prompts. The {learning_brief}, {case_blueprint}, and
--              {source_materials} interpolation slots from migration 045 are
--              no longer used by this template, but the server still passes
--              them so a downgrade to the 045 template would still render.

UPDATE `ai_prompts`
SET `prompt_template` =
'You are revising one section of a case-writing project. Apply the instructor''s instruction to the section content provided. Return ONLY the revised section.

INSTRUCTION:
{instruction}

SECTION TO REVISE ({step}):
<<<BEGIN SECTION
{current_value}
END SECTION>>>

BACKGROUND (for your reference only — never reproduce these labels or their contents in your output):
{background}

Rules:
- Apply the instruction to the section content. Return the full revised section, not a diff.
- Preserve heading structure, section ordering, and any explicit facts, figures, names, or dates UNLESS the instruction explicitly asks to change them.
- Keep all content unrelated to the instruction byte-identical where possible. Do not rewrite for style. Do not "polish." Do not summarize.
- Maintain the same general length unless the instruction asks for a length change.
- If the instruction is ambiguous, make the smallest reasonable change that honors its intent.
- If the instruction asks for something not supportable by the BACKGROUND, apply the closest reasonable interpretation rather than fabricating.

Output:
Return ONLY the revised markdown for {step}. No JSON wrapper, no preamble, no code fences, no commentary. Do NOT include the strings "INSTRUCTION", "SECTION TO REVISE", "BEGIN SECTION", "END SECTION", "BACKGROUND", "Rules:", or "Output:" anywhere in your response.'
WHERE `use` = 'case_writer.content_tweak' AND `version` = 'default';
