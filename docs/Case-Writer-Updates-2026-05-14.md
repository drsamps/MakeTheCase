# Case Writer Updates — May 14, 2026

## Summary

Six usability tweaks on top of the May 13 markdown-first rebuild:

1. **Student-case sizing + versions.** Replaced the 3-value `length` enum with five sizes (story-problem → expanded), and added a new `case_versions` table so instructors can save multiple named/notated variants of the same case. The working draft on `case_writer_projects.student_case` is unchanged; versions are additive snapshots.
2. **Teaching-note format selector** (Brief / Standard / Detailed) — server already accepted the parameter; only UI work was needed.
3. **Scenarios count 1–5** (was 3–5).
4. **Admin-only ⓘ prompt-viewer** next to every Generate / Summarize / Auto-fill / Tweak button. Reuses the existing `GET /api/prompts?use={use}` route.
5. **Teaching-note title prepend** — server emits `# Teaching note for: {project.title}` ahead of the LLM output (idempotent on regenerate).
6. **Free-form "Tweak content"** on each markdown step (brief, blueprint, student case, teaching note). The LLM rewrites the current content according to a natural-language instruction; result is shown in a side-by-side diff with per-hunk Keep-left / Use-right. No DB write until the user clicks Save.

The full pre-implementation plan lives at `.claude/plans/the-file-dev-2026-05-14-more-case-writer-snoopy-patterson.md`. This file documents what shipped.

## 1. Student-case sizing + versions

### Five sizes (replacing the old 3-value enum)

| UI label        | API/DB value     | Word target              | Exhibits guidance     |
|-----------------|------------------|--------------------------|-----------------------|
| Story-problem   | `story_problem`  | ~200–500 words           | No exhibits           |
| Mini-Case       | `mini`           | ~500–1,000 words         | 1–2 exhibits          |
| Abridged Case   | `abridged`       | 1,000–2,000 words        | 1–2 exhibits          |
| Regular Case    | `regular`        | ~2,000–4,000 words       | Normal exhibits *(default)* |
| Expanded Case   | `expanded`       | ~4,000–7,500 words       | Generous exhibits     |

- `LENGTH_PRESETS` in `server/routes/caseWriter.js` rewritten with the five new size strings (used as `{length_target}` in `case_writer.student_case_draft`). Default key is now `regular` (was `standard`).
- `LENGTH_ALIASES = { standard: 'regular', extended: 'expanded' }` maps the previous values so in-flight clients keep working.
- Unknown size values are rejected with a 400 so typos surface immediately rather than silently falling back.

### `case_versions` table (Migration 044)

```sql
CREATE TABLE case_versions (
  case_version_id    CHAR(36)  PRIMARY KEY,
  project_id         CHAR(36)  NOT NULL,
  case_size          ENUM('story_problem','mini','abridged','regular','expanded')
                     NOT NULL DEFAULT 'regular',
  case_text          LONGTEXT  NOT NULL,
  version_name       VARCHAR(255) NOT NULL,
  version_notes      TEXT      NULL,
  model_id           VARCHAR(100) NULL,
  word_count         INT       NULL,
  version_created    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  version_updated    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_case_versions_project FOREIGN KEY (project_id)
    REFERENCES case_writer_projects(project_id) ON DELETE CASCADE
) COLLATE=utf8mb4_unicode_ci;
```

Notes:
- `case_size` lives on the version row, not on the project — one brief / blueprint can feed many sized variants of the same case.
- `model_id` and `word_count` are denormalized so the panel can sort and label without re-fetching the long text.
- All char columns are explicitly `COLLATE utf8mb4_unicode_ci` to match `case_writer_projects.project_id`; mismatched collation on the FK was the only migration error encountered.
- The working draft on `case_writer_projects.student_case` is still the "active" content. Versions are immutable archive rows; there is no `is_active_version_id` flag.

### Server endpoints

All five live in `server/routes/caseWriter.js` under `/api/case-writer/projects/:id/versions`:

| Method | Path                          | Behavior |
|--------|-------------------------------|----------|
| GET    | `/versions`                   | List, newest first. |
| POST   | `/versions`                   | Snapshot `project.student_case` into a new row. Body: `{ version_name, version_notes?, case_size, model_id? }`. Server computes `word_count`. |
| PATCH  | `/versions/:vid`              | Update `version_name`, `version_notes`, or `case_size`. `case_text` is immutable. |
| DELETE | `/versions/:vid`              | Hard delete. |
| POST   | `/versions/:vid/load`         | Snapshot current working draft into the revisions log (`recordRevision`), then replace `project.student_case` with `version.case_text`. Returns the new draft. |

All endpoints route through the existing `loadProject(id, req)` helper so ownership is enforced.

### UI — Step 4 (Student Case)

- A new **`CaseVersionsPanel`** (`components/caseWriter/CaseVersionsPanel.tsx`) renders as the `topAccessory` above the markdown editor on Step 4 only.
- Each version row shows a color-coded size badge (selectable to change size), the version name (click to rename inline), word count + created date, expandable/editable notes, and Load / Delete actions.
- A "Save current draft as version…" button opens an inline modal (name + size + notes; size defaults to whatever size the most recent generation used).
- Above the editor, `MarkdownStepEditor` now hosts a generic `generateOptions` prop: an array of dropdowns rendered between the Generate button and the model picker. For Step 4 that's the five sizes; for Step 5 it's the three teaching-note formats. The selected value is passed back via `onGenerate(modelId, { length | format })`.

### Brief / blueprint are NOT size-aware

The earlier sketch had the brief reflect intended case size. With the versions model, a single brief now feeds many sized variants — so the brief and blueprint stay size-agnostic and no prompt changes are needed there.

## 2. Teaching-note format selector

- Server already accepts `format` (`TEACHING_NOTE_FORMATS` near line 887 of `caseWriter.js`); previously only the API knew about it.
- `MarkdownStepEditor` on Step 5 now renders a `generateOptions` dropdown for Brief (1–2 pages) / Standard (4–6 pages) / Detailed (8+ pages). Default `standard`.
- `services/caseWriter/api.ts#generateTeachingNote` now accepts `format`.

## 3. Scenarios count 1–5

- `components/caseWriter/ScenariosList.tsx`: `min={3}` → `min={1}` on the count input; clamp changed to `Math.max(1, Math.min(5, ...))`.
- `server/routes/caseWriter.js`: server-side clamp changed to match.
- No prompt change — `case_writer.scenario_generation` already interpolates `{count}` and instructs the model to produce exactly that many.

## 4. Admin-only ⓘ prompt-viewer

- New component `components/caseWriter/PromptInfoButton.tsx`. Returns `null` unless `isAdmin`.
- On click, fetches `GET ${getApiBaseUrl()}/prompts?use={use}` with the admin token, picks the row where `is_active` is true, and opens an inline modal showing `description` (italic) and the full `prompt_template` in a `<pre>` block. Modal closes on Escape and on backdrop click.
- Footer of the modal links to `#/admin?tab=prompts` ("Admin users can edit prompts under Admin → Prompts").
- **Admin user threading**: `App.tsx` already passed `sessionUser` to `CaseWriterShell`. `CaseWriterShell.tsx` now forwards it to `CaseWriterProject.tsx`, which computes `const isAdmin = user?.role === 'admin'` and threads `isAdmin` into `MarkdownStepEditor`, `ScenariosList`, `SourceMaterial`, and the publish auto-fill action.
- **Placement**: every Generate / Summarize / Auto-fill / Tweak button surface now carries a ⓘ icon when admin. The `use` identifier is hard-coded by the caller:

| Step                       | `use` |
|----------------------------|-------|
| Brief                      | `case_writer.teaching_brief` |
| Scenarios                  | `case_writer.scenario_generation` |
| Blueprint                  | `case_writer.case_blueprint` |
| Student Case               | `case_writer.student_case_draft` |
| Teaching Note              | `case_writer.teaching_note` |
| Source Summarize           | `case_writer.reference_summary` |
| Publish Auto-fill          | `case_writer.publish_field_extraction` |
| Tweak (any markdown step)  | `case_writer.content_tweak` |

No new server route was needed — `GET /api/prompts?use=` already existed and is admin-gated.

## 5. Teaching-note title prepend

In the generate-teaching-note handler, after `stripMarkdownFence(text)` and before the `UPDATE`:

```js
const titleLine = `# Teaching note for: ${project.title || 'Untitled case'}\n\n`;
const alreadyTitled = /^#\s+Teaching note for:/i.test(rawMarkdown.trimStart());
const markdown = alreadyTitled ? rawMarkdown : titleLine + rawMarkdown;
```

The idempotency check prevents stacked titles on regenerate. Existing teaching notes do not get a backfilled title — they pick it up the next time the instructor regenerates.

## 6. Free-form "Tweak content"

A new affordance on each `MarkdownStepEditor` (brief, blueprint, student case, teaching note) that lets the instructor type a free-text instruction ("make the protagonist female", "shorten the opening by half", "add an exhibit summarizing 2024 revenue") and have the LLM rewrite the current content accordingly, then review the result in a side-by-side diff with per-hunk Keep-left / Use-right buttons.

Scenarios and Overview are intentionally excluded — Scenarios is a card list, Overview is structured metadata.

### Server — `POST /projects/:id/tweak` (no persistence)

Body: `{ step, current_value, instruction, model_id? }` where `step ∈ {brief, blueprint, student_case, teaching_note}`.

Returns: `{ revised, meta }`. **Does not write to the project.** The client previews the diff and only persists when the user clicks the existing Save button after applying.

- Validates step against an allowlist; validates `current_value` and `instruction` are non-empty.
- Builds a `background` string from approved source materials plus whichever upstream artifacts apply to this step, intentionally **omitting** the artifact that corresponds to the section being tweaked (so the LLM never sees the same content twice under two different labels — see the migration-046 note below).
- Calls the `case_writer.content_tweak` prompt (migrations 045 → 046) via `getActivePrompt` + `renderPrompt`.
- Resolves model through `resolveModel(requestedModelId, project.default_model_id)`.
- `maxTokens: 32000` to match every other markdown generator.

### Prompt — `case_writer.content_tweak` (Migrations 045, then 046)

**Migration 045** (`server/migrations/045_case_writer_content_tweak_prompt.sql`) seeded the initial prompt with four labeled context sub-slots (`Learning brief:`, `Case blueprint:`, `Source materials:`) under a header reading *"Supporting context (read-only; do not append to your output):"*.

**Bug surfaced on the Blueprint step.** When tweaking the Blueprint, the server was passing the same blueprint markdown into both `{current_value}` (the section to revise) and `{case_blueprint}` (one of the read-only context slots). Some models treated the second labeled copy — header and all — as part of the document under revision and echoed the leaked phrase verbatim into the tweaked output.

**Migration 046** (`server/migrations/046_case_writer_content_tweak_prompt_v2.sql`) rewrites the template to fix this:

- Collapses the four labeled context sub-slots into a single `{background}` variable. The server now builds `background` per-step and explicitly skips the artifact being tweaked, so duplicate content never reaches the model.
- Removes the leaked phrase *"Supporting context (read-only; do not append to your output):"* entirely.
- Wraps the document under revision in unambiguous `<<<BEGIN SECTION` / `END SECTION>>>` fences so it can never be confused with background context.
- Adds an explicit rule at the end: *"Do NOT include the strings 'INSTRUCTION', 'SECTION TO REVISE', 'BEGIN SECTION', 'END SECTION', 'BACKGROUND', 'Rules:', or 'Output:' anywhere in your response."*

The server still passes the legacy `{learning_brief}`, `{case_blueprint}`, and `{source_materials}` interpolation slots so a rollback to the 045 template would still render — they're simply ignored by the 046 template.

The template instructs the model to:

- Apply only the requested change; keep unrelated content byte-identical where possible (this maximizes diff readability).
- Preserve heading structure, section ordering, and explicit facts/figures unless the instruction explicitly asks to change them.
- Maintain the same general length unless asked otherwise.
- Return the full revised markdown — no JSON wrapper, no preamble, no code fences.

### Client — `diff` package

- Added `diff` (v9, ~10KB gzipped, runs in the browser) to `dependencies` and `@types/diff` to `devDependencies`.
- Diff is computed client-side every time a tweak preview is rendered. No diff work happens on the server.

### Client — `TweakDiffViewer.tsx` (new)

- `Diff.diffLines(original, tweaked)` produces ordered segments. Contiguous removed+added pairs collapse into a single "hunk". Pure additions or pure deletions are still treated as hunks.
- Inside each hunk, `Diff.diffWordsWithSpace(removedText, addedText)` produces character-level highlights — removed words show red strike-through on the left side, added words show a green background on the right side.
- Unchanged blocks longer than 3 lines collapse to a clickable "… N unchanged lines …" placeholder so the user can focus on what changed.
- Each hunk has a tri-state decision: `pending` (default — counted as Use-right when merging), `kept-left`, `used-right`. Toggling is non-destructive.
- Header shows word count delta in real time: `1,240 → 1,180 words (−60, −4.8%)`. Recomputes as hunks toggle.
- Header buttons: **Apply changes** (treat all pending hunks as Use-right, build merged result, replace editor value, close the viewer) and **Cancel** (discard, restore the original).
- When the LLM returns an identical document the component shows a single "no changes to review" panel instead of an empty diff.

### Client — `MarkdownStepEditor.tsx` integration

- New props: `tweakStep` (`'brief' | 'blueprint' | 'student_case' | 'teaching_note'`) and `projectId`. When both are set, the component shows a `✎ Tweak content` toggle next to the Save button.
- Opening the toggle reveals a purple-themed panel with a textarea, a Tweak button (disabled until the textarea has content), a model-override dropdown, and an optional ⓘ button for the `content_tweak` prompt.
- The Tweak button uses the existing `useGenerationTimer` hook so it reads `Tweaking… 0:12` while running.
- On success, the side-by-side `TweakDiffViewer` replaces the textarea + preview area until the user applies or cancels.
- Applied content goes into the editor's `currentValue` only — the user still has to click the (now dirty) Save button to persist.

## Files touched

**Server**
- `server/routes/caseWriter.js` — 5-size `LENGTH_PRESETS` + back-compat aliases; scenario count clamp 1–5; teaching-note title prepend; 5 version endpoints (`GET / POST / PATCH / DELETE / load`); `POST /projects/:id/tweak`.
- `server/migrations/044_case_writer_case_versions.sql` (new).
- `server/migrations/045_case_writer_content_tweak_prompt.sql` (new — initial seed).
- `server/migrations/046_case_writer_content_tweak_prompt_v2.sql` (new — fixes the "Supporting context …" leak by collapsing labeled context slots into a single `{background}` and adding `<<<BEGIN SECTION>>>` fences).

**Client — new files**
- `components/caseWriter/CaseVersionsPanel.tsx`
- `components/caseWriter/PromptInfoButton.tsx`
- `components/caseWriter/TweakDiffViewer.tsx`

**Client — modified**
- `components/caseWriter/CaseWriterProject.tsx` — `user` prop, `isAdmin`, versions state + reload, per-step `tweakStep` + `promptUse` + `generateOptions` wiring, `CaseVersionsPanel` as `topAccessory` on Step 4.
- `components/caseWriter/CaseWriterShell.tsx` — forwards `user` into `CaseWriterProject`.
- `components/caseWriter/MarkdownStepEditor.tsx` — `generateOptions`, `topAccessory`, `promptUse`, `isAdmin`, `tweakStep`, `projectId`. Hosts the Tweak panel and renders the diff viewer in place of the editor while a tweak is being previewed.
- `components/caseWriter/ScenariosList.tsx` — count clamp 1–5 + ⓘ button.
- `components/caseWriter/SourceMaterial.tsx` — `isAdmin` prop + ⓘ button on the header.
- `services/caseWriter/api.ts` — `CaseSize` type union, `CaseVersion` interface, 5 version methods, `tweakContent` method, `format` param on `generateTeachingNote`, `length: CaseSize` on `generateStudentCase`.
- `package.json` — `diff` + `@types/diff`.

## Notable alternatives considered & rejected

- **`case_size` column on `case_writer_projects`.** Rejected per the instructor's direction — size lives on the version row, not the project. One brief can feed many sized variants of the same case.
- **`is_active_version_id` FK on the project.** Rejected: with the additive model, the working draft (`project.student_case`) is the implicit "active" content. Loading a version copies its text into the working draft.
- **Versioning brief / blueprint / teaching note too.** Rejected — only the student case is versioned. Brief, blueprint, teaching note, and scenarios remain single-valued on the project.
- **`parent_version_id` for derivation history.** Rejected as scope creep; can be added later if variant trees become useful.
- **Renaming the API param `length` → `case_size` for consistency.** Rejected: would break in-flight clients and the alias map handles the migration silently.
- **Building a reusable `<Modal>` in `components/ui/`.** Rejected — codebase has no reusable modal yet; introducing one is its own scope. Used the inline `fixed inset-0 bg-black bg-opacity-50 …` pattern that `Dashboard.tsx` and `PromptManager.tsx` already use.
- **Allowing prompt edits inside the ⓘ modal.** Rejected — viewing only; the footer points to Admin → Prompts for edits.
- **Simple Accept/Reject tweak** (replace editor immediately, single confirm button). Rejected in favor of the side-by-side diff with per-hunk decisions — gives the instructor surgical control instead of all-or-nothing.
- **Reusing `POST /projects/:id/revise` with a `preview=true` flag.** Rejected — keeps the preset-command semantics distinct from free-text tweak semantics; `/revise` stays for any preset-button UI.
- **Server-side diff.** Rejected — `diff` is small (~10KB gzipped) and runs in the browser, so we save a round trip and the hunk decisions stay purely client-side.
- **Asking the LLM to also return a one-line summary of what it changed.** Not needed — the side-by-side diff and character-level highlights show the change directly. Reconsider if users find the diff hard to read.
