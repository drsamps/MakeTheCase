-- Migration: 068_case_writer_reference_sections.sql
-- Date: 2026-08-14
-- Description: Let instructors choose WHICH PORTIONS of a large reference
--   document ground generation, instead of sending the whole thing (capped at
--   60,000 chars by migration 067) on every generate call.
--
--   A 1.5 MB textbook PDF extracts to ~110,000 characters. Truncating to the
--   first 60,000 is a blunt instrument: it keeps the title page and table of
--   contents and throws away the chapter the instructor actually cares about.
--
--   Columns:
--     outline       — detected sections, [{id,level,title,start,end,chars}].
--                     Built by server/services/referenceOutline.js, which tiers
--                     markdown headings → plain-text heading heuristics →
--                     fixed-size chunks. PDFs carry no headings and
--                     cleanPdfText() strips page numbers, so the chunk tier is
--                     load-bearing, not a corner case.
--     outline_hash  — md5 of `content` when the outline was built.
--     selection     — {sections:[id], excerpts:[{id,start,end,label}]}.
--                     NULL/empty means "use the whole document" (migration 067
--                     behavior), so this is backward compatible.
--
--   IMPORTANT — `start`/`end` are character offsets into `content`, and
--   `content` is editable via PATCH /projects/:id/references/:refId. Any write
--   to `content` MUST recompute `outline`/`outline_hash` and clear `selection`.
--   loadSourceMaterials() additionally re-checks the hash at read time and
--   ignores a stale selection rather than slicing at offsets that now point at
--   the wrong text.

ALTER TABLE `case_writer_references`
  ADD COLUMN `outline` JSON DEFAULT NULL
    COMMENT 'Detected sections: [{id,level,title,start,end,chars}]'
    AFTER `use_mode`,
  ADD COLUMN `outline_hash` CHAR(32) DEFAULT NULL
    COMMENT 'md5 of content when outline was built; guards the offsets in selection'
    AFTER `outline`,
  ADD COLUMN `selection` JSON DEFAULT NULL
    COMMENT 'Chosen portions: {sections:[id], excerpts:[{id,start,end,label}]}; NULL = whole document'
    AFTER `outline_hash`;
