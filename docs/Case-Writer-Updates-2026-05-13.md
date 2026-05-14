# Case Writer Updates — May 13, 2026

## Summary

Reworked Case Writer from a working pipeline into an instructor-drivable tool. Markdown is now the source of truth for every generated step (brief, blueprint, student case, teaching note), with a thin JSON wrapper kept only for the Scenarios picker. The project page is now a two-column wizard shell (left rail + active pane) instead of a long-scrolling form. Source Material is a first-class section. Publish-time fields moved out of generated JSON and into a dedicated form. A migration runner script was added so applying new SQL files no longer means typing 12 separate `mysql.exe <` commands.

## 1. Markdown-first generation

Every step except Scenarios now stores and edits markdown directly. The previous flow generated structured JSON, then converted to markdown for export — the round-trip was brittle and made editing painful.

- **Prompts rewritten** in `038_case_writer_markdown_outputs.sql`:
  - `case_writer.teaching_brief` — outputs `## Case Summary`, `## Learning Objectives`, `## Why This Principle`, `## Anchor Decision Point`, `## Anticipated Difficulty`, `## Student Case Should Include`, `## Reserved For Teaching Note`.
  - `case_writer.scenario_generation` — outputs `{ scenarios: [{ title, industry, markdown }] }`. Markdown bodies use `### Protagonist`, `### Company Context`, `### Central Tension`, `### Decision Point`, `### Stakeholders`, `### Possible Exhibits`, `### Why It Teaches the Principle`.
  - `case_writer.case_blueprint` — markdown with 12 headings (Working Title through Teaching-Note-Only Content).
  - `case_writer.student_case_draft` — pure markdown. No JSON envelope.
  - `case_writer.teaching_note` — pure markdown. The old structured `board_plan` / `alternatives` shape was dropped; those become sections in the markdown.
  - `case_writer.section_revision` — now takes an `{output_format}` variable (`markdown` | `json_scenarios_array` | `json_scenario_object`) so the revise endpoint knows what shape to produce.

- **Storage** initially used the existing JSON columns on `case_writer_projects` (markdown stored as `JSON.stringify(markdownString)` so the column remained valid JSON; helper `asMarkdown(value)` unwrapped on read). **Superseded on 2026-05-14** — see section 9: the four pure-markdown columns are now `LONGTEXT` and the `asMarkdown` helper is gone.

- **`assembleTeachingNoteMarkdown()` deleted** from `server/services/markdownExport.js` — the LLM emits markdown directly, no assembly needed. `markdownToDocxBuffer` / `markdownToPdfBuffer` remain for export.

## 2. Source Material grounds every step

Migration `038` also adds `{source_materials}` to the brief, scenarios, blueprint, student-case, teaching-note, boundary-validation, and section-revision prompts.

- Helper `loadSourceMaterials(projectId)` in `server/routes/caseWriter.js` loads all `case_writer_references` rows where `approved_by_user = 1`, joins title + source notes + AI summary + key facts, and returns a single block injected into every generator.
- **Reference file upload** — `POST /projects/:id/references/upload` (multipart). Uses `server/services/fileConverter.js` to convert PDF/DOCX/MD/TXT to text. Extracted text goes directly into `case_writer_references.content` (no `case_files` row; the FK to `cases.case_id` ruled out the synthetic-case-id approach we briefly tried).
- Per-row **Summarize** button picks up the per-reference model override, pulses green while running, and shows a `Summarizing… 0:07` timer.

## 3. Publish-time fields

The four fields the chat tool needs at publish time used to live inside the teaching-note JSON, which was brittle. They now have their own columns and their own form:

- Migration `039_case_writer_publish_meta.sql` adds:
  - `publish_protagonist VARCHAR(255)`
  - `publish_chat_question TEXT`
  - `publish_arguments_for TEXT`
  - `publish_arguments_against TEXT`
- Migration `040_case_writer_publish_extraction_prompt.sql` seeds `case_writer.publish_field_extraction`.
- New endpoint `POST /case-writer/projects/:id/extract-publish-fields` runs that prompt against the student-case + teaching-note markdown and returns the four suggested values.
- The Publish pane has four inputs + an **Auto-fill from case & teaching note** button. Publish validates that protagonist and chat question are set before materializing the `cases` + `case_scenarios` rows.

## 4. Teaching-principle suggestions

Migration `041_case_writer_principle_extraction_prompt.sql` seeds `case_writer.principle_extraction`, and a new endpoint `POST /case-writer/extract-principles` accepts either pasted text, a `case_file_id`, or a multipart `file` upload.

The New Project form on the home screen now has a "Suggest principles from source material" toggle with both **paste text** and **upload PDF/DOCX** options. Click a suggestion and it fills the principle field.

## 5. Model selection

- Migration `042_case_writer_default_model.sql` adds `default_model_id VARCHAR(100)` to `case_writer_projects`.
- Project Overview pane has a **Default AI model** dropdown populated from `GET /api/models?enabled=true`.
- Every Generate / Summarize button has a small ⚙ that opens a per-call override. The resolution order is: explicit override → `project.default_model_id` → `resolveDefault()` from `llmRouter`.
- **OpenAI reasoning models fix** (`server/services/llmRouter.js`): `gpt-5*` and `o1*` reject `max_tokens` and require `max_completion_tokens`. The `generateOutlineWithLLM` OpenAI branch now uses `isOpenAIReasoning(modelId)` to pick the right field.

## 6. Student-case silent-failure fix

The previous student-case handler didn't set `maxTokens`, so the LLM truncated long outputs and the parse silently produced empty JSON. Every generator now threads `maxTokens: 32000` through `generateOutlineWithLLM`.

## 7. Wizard shell + per-step editor

`components/caseWriter/CaseWriterProject.tsx` is now a two-column layout: vertical step rail on the left (Overview, Source Material, ─, 1 Brief, 2 Scenarios, 3 Blueprint, 4 Student Case, 5 Teaching Note, ─, Publish, Export) with status dots (`○` empty, `◉` draft, `●` approved, `▶` active), and a right pane that swaps in the active step's editor.

- Above each pane: `← Prior step: X` (left) and `Next step: Y →` (right) — dirty-checked the same way as the rail.
- **Above the editor**: Generate, model override, Save buttons. Below: the markdown textarea and the rendered preview side-by-side.
- Generate button pulses green and shows `Generating… 0:07` while busy (`useGenerationTimer` hook).
- Save / Saving… / Saved ✓ via `useSaveState`. Dismissable `×` error banner at the top of every pane.

### Reusable pieces

- `components/caseWriter/MarkdownPreview.tsx` — wraps `react-markdown` + `remark-gfm` with inline-styled components (headings, lists, tables, code, blockquotes). The Tailwind CDN build we use does **not** include the `@tailwindcss/typography` plugin, so the `prose` class is a no-op — this component provides explicit styles instead.
- `components/caseWriter/MarkdownStepEditor.tsx` — the shared editor: textarea + preview + Generate / model override / Save row at top.
- `components/caseWriter/ScenariosList.tsx` — accordion list of scenario cards (only one expanded at a time) with Edit / Select / Delete and markdown body rendering.
- `components/caseWriter/SourceMaterial.tsx` — references list with paste / link / upload, per-row Summarize (with model picker + timer) and Approve toggle.
- `components/caseWriter/StepRail.tsx` — left-rail navigation with status dots.
- `components/caseWriter/ErrorBanner.tsx` — pink banner with dismiss `×`.
- `components/caseWriter/useGenerationTimer.ts` — returns `m:ss` while a `boolean` is true.
- `components/caseWriter/useSaveState.ts` — `{ status, dirty, run, reset }`, status flips `idle → dirty → saving → saved (3s) → idle`.

### Overview pane

- Title and Teaching Principle are full-width rows. Teaching Principle is a vertically-resizable textarea (multi-line principles are common, e.g. *"Channel conflict between direct and indirect sales when a major partner threatens to walk"*).
- The rest of the metadata (Audience, Course Context, Difficulty, Case Type, **Default AI model**) is a 2-column grid below.

## 8. Migration runner

New script: `server/scripts/run-pending-migrations.js`. Replaces the old "type `mysql.exe < server/migrations/038_...sql` for every file" workflow.

```bash
npm run migrate              # apply any pending migrations, in order, with per-file timing
npm run migrate:dry          # list what would be applied, do not run anything
```

Direct flags:
- `--only 038` — apply only files starting with `038`.
- `--force` — re-apply even if already recorded.
- `--mark-applied` — record every existing `NNN_*.sql` as applied without running it. Use this once when initializing the tracker against an existing database.

**How it works**

1. Creates a `schema_migrations` table on first run: `filename PRIMARY KEY, applied_at TIMESTAMP, duration_ms INT`.
2. Discovers files in `server/migrations/` matching `NNN_*.sql`, sorts numerically.
3. Skips anything already in `schema_migrations`.
4. Opens a connection with `multipleStatements: true` so multi-statement `.sql` files run cleanly.
5. Prints `[3/12] 040_xyz.sql … ok (47 ms)` (green) or `FAILED` (red) with the error.
6. **Stops on first failure** — later migrations may depend on it.
7. Exits non-zero if any failed; zero otherwise.

Reads MYSQL_* env vars from `.env.local`. Compatible with both `ceochat_prod_copy` (dev) and `ceochat` (prod).

## 9. Markdown columns moved from JSON to LONGTEXT (2026-05-14 follow-up)

Section 1 stored markdown as `JSON.stringify(markdownString)` inside JSON columns so the column remained valid JSON. That wrapper added nothing useful for the four pure-markdown columns — it just escaped newlines so rows were unreadable in DB tools, and required `JSON.stringify` on write plus `asMarkdown()` parsing on read.

- Migration `043_case_writer_markdown_columns.sql`:
  1. `UPDATE case_writer_projects SET learning_brief = NULL, case_blueprint = NULL, student_case = NULL, teaching_note = NULL;` (test data only, no production data to preserve)
  2. `ALTER TABLE case_writer_projects MODIFY COLUMN learning_brief LONGTEXT NULL, MODIFY COLUMN case_blueprint LONGTEXT NULL, MODIFY COLUMN student_case LONGTEXT NULL, MODIFY COLUMN teaching_note LONGTEXT NULL;`
  - Order matters: NULLing before the ALTER avoids any JSON→LONGTEXT coercion (which would have left awkward escaped `\n` strings in the new column until each row was regenerated).
  - `scenario_options` and `selected_scenario` stay `JSON` — they have real structure.
- `server/routes/caseWriter.js`:
  - `asMarkdown()` helper deleted; `asJson()` retained.
  - The four generator UPDATEs (brief / blueprint / student_case / teaching_note) now pass `markdown` directly instead of `JSON.stringify(markdown)`.
  - ~20 read sites changed from `asMarkdown(project.<field>)` to `(project.<field> || '')`.
  - The revise handler's storage UPDATE now branches on `isJsonStep`: markdown steps write the raw string, JSON steps (scenarios, selected_scenario) keep `JSON.stringify`.

`case_writer_revisions.snapshot` is intentionally left as `JSON` — it's append-only history with a mixed shape (markdown string for some steps, object for scenarios) and isn't read or edited by the UI.

## Files changed / added

### Backend

- `server/routes/caseWriter.js` — markdown-first response parsing in every generate handler; `maxTokens: 32000` threaded through; new endpoints (`extract-publish-fields`, `extract-principles`, `references/upload`); `default_model_id` resolution; `assembleTeachingNoteMarkdown` call sites removed.
- `server/services/llmRouter.js` — `generateOutlineWithLLM` OpenAI branch now uses `max_completion_tokens` for reasoning models.
- `server/services/markdownExport.js` — `assembleTeachingNoteMarkdown` removed.
- `server/scripts/run-pending-migrations.js` — new.

### Migrations

- `server/migrations/038_case_writer_markdown_outputs.sql`
- `server/migrations/039_case_writer_publish_meta.sql`
- `server/migrations/040_case_writer_publish_extraction_prompt.sql`
- `server/migrations/041_case_writer_principle_extraction_prompt.sql`
- `server/migrations/042_case_writer_default_model.sql`
- `server/migrations/043_case_writer_markdown_columns.sql` *(2026-05-14)*

### Frontend

- `components/caseWriter/CaseWriterProject.tsx` — full rewrite: two-column shell, per-pane editors, prev/next nav, dirty tracking.
- `components/caseWriter/CaseWriterHome.tsx` — file-upload variant of principle extraction.
- `components/caseWriter/MarkdownPreview.tsx` — new.
- `components/caseWriter/MarkdownStepEditor.tsx` — new.
- `components/caseWriter/ScenariosList.tsx` — new.
- `components/caseWriter/SourceMaterial.tsx` — new.
- `components/caseWriter/StepRail.tsx` — new.
- `components/caseWriter/ErrorBanner.tsx` — new.
- `components/caseWriter/useGenerationTimer.ts` — new.
- `components/caseWriter/useSaveState.ts` — new.
- `services/caseWriter/api.ts` — markdown return shapes, `uploadReference`, `extractPrinciples`, `extractPrinciplesFromFile`, `extractPublishFields`.

### Config

- `package.json` — `migrate` and `migrate:dry` scripts.
