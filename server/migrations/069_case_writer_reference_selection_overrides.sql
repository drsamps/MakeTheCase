-- Migration: 069_case_writer_reference_selection_overrides.sql
-- Date: 2026-08-14
-- Description: Allow a reference's section/excerpt selection to differ per
--   generation step. The Learning Brief may want the framing chapters while the
--   Student Case wants the data exhibits, from the same source document.
--
--   Shape: {"brief": {"sections": [...], "excerpts": [...]}, "student_case": {...}}
--   An absent key means "use the default `selection`" (migration 068). This is
--   purely additive — a project that never touches per-step overrides behaves
--   exactly as before.
--
--   Step keys match the ones already used in the route file: 'brief',
--   'scenarios', 'blueprint', 'student_case', 'teaching_note' (see TWEAK_STEPS
--   in server/routes/caseWriter.js, extended with 'scenarios').
--
--   The same offset-invalidation rule as migration 068 applies: writes to
--   `content` clear overrides along with `selection`, and loadSourceMaterials()
--   re-checks `outline_hash` before slicing.

ALTER TABLE `case_writer_references`
  ADD COLUMN `selection_overrides` JSON DEFAULT NULL
    COMMENT 'Per-step selection: {"brief":{sections,excerpts},...}; absent key falls back to `selection`'
    AFTER `selection`;
