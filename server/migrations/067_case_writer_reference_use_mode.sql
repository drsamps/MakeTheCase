-- Migration: 067_case_writer_reference_use_mode.sql
-- Date: 2026-08-14
-- Description: Add `use_mode` to case_writer_references, controlling how each
--   approved reference is injected into {source_materials} for generation.
--
--   Background: loadSourceMaterials() in server/routes/caseWriter.js selected
--   only `title`, `content_summary`, and `source_notes` — never `content`,
--   which is where pasted text and extracted file text actually live. The only
--   thing that populates `content_summary` is a manual "Summarize" click, so an
--   approved-but-unsummarized reference reached the LLM as a bare header line:
--
--     ### Source: ESDI-4E_Chapters_1-3.pdf (uploaded_file)
--     Notes: Uploaded file: ESDI-4E_Chapters_1-3.pdf (1519040 bytes)
--
--   ...with none of the document's actual text. That affected all six
--   generators (brief, scenarios, blueprint, student case, teaching note,
--   tweak), and made migration 064's teaching_brief prompt inaccurate where it
--   tells the model the <source_materials> block "contains text extracted from
--   instructor-uploaded reference documents".
--
--   `use_mode` makes the choice explicit and visible in the Source Material UI
--   instead of being an invisible consequence of whether Summarize was clicked:
--
--     full_text             — send the reference's real text (default)
--     summary               — send the AI summary only
--     summary_and_full_text — send the summary, then the full text
--
--   Every existing row is backfilled to 'full_text' deliberately: it guarantees
--   no existing reference keeps silently contributing nothing to generation.
--   Switching back to 'summary' is one click in the new dropdown.
--
--   Note that 'summary' falls back to full text when no summary exists yet —
--   see loadSourceMaterials(). Emitting a header with no body is the exact
--   regression this migration exists to fix, so no mode may produce one.

ALTER TABLE `case_writer_references`
  ADD COLUMN `use_mode` ENUM('full_text','summary','summary_and_full_text')
    NOT NULL DEFAULT 'full_text'
    COMMENT 'How this reference is injected into {source_materials} for generation'
    AFTER `content_summary`;

UPDATE `case_writer_references` SET `use_mode` = 'full_text';
