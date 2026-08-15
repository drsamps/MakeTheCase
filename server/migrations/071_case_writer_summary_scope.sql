-- Migration: 071_case_writer_summary_scope.sql
-- Date: 2026-08-14
-- Description: Make the AI summary and the section/excerpt selection describe
--   the SAME portion of a reference.
--
--   Migrations 067 and 068 shipped two controls that silently ignored each
--   other. `use_mode` chose the channel (summary / document text / both) and
--   `selection` chose which characters of the document text were used — but the
--   summarize route read the whole `content` column and never looked at
--   `selection`. So an instructor could pick three chapters, switch to
--   "Summary only", and have their selection do nothing at all. Worse,
--   "Summary + full text" put a whole-document summary directly above three
--   selected chapters inside one ### Source: block — two different scopes,
--   presented as one source.
--
--   The intended model, now enforced:
--       selection  ->  WHICH parts of the document
--       use_mode   ->  HOW MUCH detail of those parts
--
--   `summary_scope_hash` records which selection the stored summary was built
--   from. loadSourceMaterials() compares it against the selection in effect for
--   the current step; on mismatch the summary is not sent (the selected text is
--   sent instead, with a note), so the model never receives a summary that
--   describes text we did not select. The Source Material UI shows a
--   "re-summarize" prompt when they diverge, so this is never silent.
--
--   Key derivation must stay in sync with selectionScopeKey() in
--   server/routes/caseWriter.js:
--     no selection  ->  MD5('whole:' + COALESCE(outline_hash, ''))
--     a selection   ->  MD5(JSON of {h: outline_hash, ids: [...], ex: [...]})
--
--   Backfill: every existing summary was made from the whole document, so it
--   gets the "whole" key. References that already carry a selection therefore
--   fail the comparison and are correctly flagged as needing a re-summarize.

ALTER TABLE `case_writer_references`
  ADD COLUMN `summary_scope_hash` CHAR(32) DEFAULT NULL
    COMMENT 'Which selection content_summary was built from; see selectionScopeKey() in routes/caseWriter.js'
    AFTER `content_summary`;

UPDATE `case_writer_references`
   SET `summary_scope_hash` = MD5(CONCAT('whole:', COALESCE(`outline_hash`, '')))
 WHERE `content_summary` IS NOT NULL;
