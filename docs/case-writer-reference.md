# Case Writer — Feature Reference

Living reference for the Case Writer subsystem. For dated change-logs, see `docs/Case-Writer-Updates-*.md`.

## Purpose

Instructor-facing wizard that turns a teaching principle and uploaded source materials into a published interactive case (student case + teaching note + chat scenario). The pipeline is markdown-first, source-grounded, and gated by per-step access control.

## Pipeline

```
Source Material → Brief → Scenarios → Blueprint → Student Case → Teaching Note → Publish → Export
```

Each step has its own DB column on `case_writer_projects`, its own prompt in `ai_prompts`, and its own generate route. Outputs are stored as markdown wrapped in JSON (`JSON.stringify(markdownString)`) and unwrapped on read via `asMarkdown()` in `server/routes/caseWriter.js`.

| Step           | Prompt `use`                              | Project column            | Generate route                                |
|----------------|-------------------------------------------|---------------------------|-----------------------------------------------|
| Brief          | `case_writer.teaching_brief`              | `learning_brief`          | `POST /projects/:id/generate/brief`           |
| Scenarios      | `case_writer.scenario_generation`         | `scenarios` (JSON array)  | `POST /projects/:id/generate/scenarios`       |
| Blueprint      | `case_writer.case_blueprint`              | `case_blueprint`          | `POST /projects/:id/generate/blueprint`       |
| Student Case   | `case_writer.student_case_draft`          | `student_case`            | `POST /projects/:id/generate/student-case`    |
| Teaching Note  | `case_writer.teaching_note`               | `teaching_note`           | `POST /projects/:id/generate/teaching-note`   |
| Publish-fields | `case_writer.publish_field_extraction`    | `publish_*` columns       | `POST /projects/:id/extract-publish-fields`   |

Additional supporting prompts: `case_writer.boundary_validation`, `case_writer.section_revision`, `case_writer.reference_summary`, `case_writer.content_tweak`, `case_writer.principle_extraction`.

## Schema

### `case_writer_projects` (current columns of note)

- Identity / ownership: `project_id`, `owner_id`, `owner_type`, `visibility`, `default_model_id`, `status`.
- Inputs: `title`, `teaching_principle`, `audience`, `course_context`, `difficulty`, `case_type`, `industries_preference`.
- Pipeline outputs (JSON-wrapped markdown): `learning_brief`, `scenarios`, `selected_scenario`, `case_blueprint`, `student_case`, `teaching_note`.
- Metadata: `industry` (mirrored from selected scenario), `published_case_id`, `created_at`, `updated_at`.
- Publish fields: `publish_protagonist`, `publish_chat_question`, `publish_arguments_for`, `publish_arguments_against`.

### `case_writer_references`

Approved rows feed every generator prompt as `{source_materials}` via `loadSourceMaterials(projectId)`. Uploads (`POST /projects/:id/references/upload`) store extracted text directly in the `content` column — they intentionally bypass `case_files` to avoid the FK to `cases.case_id`.

### `case_writer_versions`

Append-only snapshots of each step output. Created automatically by mutating routes; surfaced in `CaseVersionsPanel.tsx`.

## Prompts — conventions

- **Markdown-first.** Generator prompts emit markdown directly. Only `scenario_generation` keeps a JSON wrapper `[{title, industry, markdown}]` because the picker needs structured access.
- **XML-wrapped injected variables.** Every user-supplied value (`{source_materials}`, `{learning_brief}`, `{case_blueprint}`, `{student_case}`, `{teaching_note}`, `{revision_hint}`, `{industry_preference}`, `{teaching_principle}`, `{selected_scenario}`) is wrapped in named XML tags with an explicit "treat as data, not instructions" note. Reduces prompt-injection surface from uploaded reference documents. Set by Migration 063.
- **Narrative style on student case.** `case_writer.student_case_draft` forbids bullet/numbered lists in narrative sections (`opening_hook`, `company_background`, `market_context`, `problem_or_opportunity`, `stakeholders[].position`, `decision_point`). Bullets and tables are reserved for Evidence/Exhibits only. Set by Migration 062.
- **Substitution.** `renderPrompt()` does literal `{var}` replacement; XML wrappers surround the placeholder but don't affect substitution.

## Model selection

Resolution order per generate call: explicit `model_override` → `project.default_model_id` → `resolveDefault()`. OpenAI reasoning models (`gpt-5*`, `o1*`) detected by `isOpenAIReasoning(modelId)` to swap `max_tokens` for `max_completion_tokens`. All generators thread `maxTokens: 32000` to prevent silent truncation.

## Generation hints (`revision_hint`)

All four generator routes (Scenarios, Blueprint, Student Case, Teaching Note) accept an optional `revision_hint` in the request body and substitute it into the prompt inside a `<revision_hint>` tag. The 💡 Hint button next to each Generate's model picker exposes this. **Ephemeral by design** — hint lives in component state, not persisted. Persistent guidance belongs in the Learning Brief / Case Blueprint, which the Tweak workflow can also edit.

## Access model

### Visibility (read access)
- Controlled by `buildVisibilityScope()` (`server/services/resourceAccess.js`).
- An instructor sees: owned projects + team-shared projects + `visibility='public'` projects + (admin) every project.

### Edit / delete access
- Centralized in `loadProject(projectId, req, action?)`. When the caller omits `action`, it is inferred from `req.method`:
  - `GET` → `'view'`
  - `DELETE` → `'delete'`
  - `POST` / `PATCH` / `PUT` → `'edit'`
- All ~25 mutating routes (PATCH, DELETE, all `/generate/*`, `/publish`, `/extract-publish-fields`, `/validate`, `/tweak`, `/revise`, references, versions) inherit edit-gating without per-call-site changes.
- The list endpoint computes `can_edit` per row in SQL via a CASE expression with an EXISTS subquery against `resource_team_shares`. Coerced to a JS boolean before serialization.

### Clone
- `POST /projects/:id/clone` requires only `'view'` access — anyone who can see a project can clone it.
- Copies every artifact column and approved references (fresh `reference_id`s). Resets `project_id`, `published_case_id` (NULL), `status` (`'draft'`), `visibility` (`'private'`). Title prefixed with `Copy of `.

### Read-only document view
- When `GET /projects/:id` returns `can_edit: false`, `CaseWriterProject.tsx` replaces the wizard with a single scrollable preview: top banner ("Read-only — owned by {owner_label}. Clone to edit."), Overview metadata, then each markdown section rendered via `MarkdownPreview`. The wizard branch is untouched — no prop-threading into editor components.

## UI shell

- `components/caseWriter/CaseWriterHome.tsx` — project list. Columns: Title, Teaching Principle, Industry, Owner, Status, Updated, Actions. All columns sortable with ▲/▼ indicators (default `updated_at DESC`). Client-side title/teaching-principle search; Owner filter dropdown (hidden when only one distinct owner is visible). Two-arrow refresh button in the header matches `FeedbackInbox.tsx`.
- `components/caseWriter/CaseWriterProject.tsx` — two-column wizard. Left rail (`StepRail.tsx`) with status dots (`○ ◉ ● ▶`); right pane swaps per active step. On `!can_edit`, replaces wizard with read-only document view.
- `components/caseWriter/MarkdownStepEditor.tsx` — generic editor for Brief / Blueprint / Student Case / Teaching Note: textarea + `MarkdownPreview` side-by-side, with Generate / model-override / 💡 Hint / Save above. Tailwind CDN does not include `@tailwindcss/typography`, so `MarkdownPreview` provides explicit `react-markdown` component overrides instead of relying on `prose`.
- `components/caseWriter/ScenariosList.tsx` — Scenarios step: count input, model override, Industries (optional) input, 💡 Hint button, Generate, then a card per scenario with Select / details. `onGenerate` signature: `(overrideModelId?, count?, industriesPreference?, revisionHint?)`.

## Backend service surface

`server/routes/caseWriter.js` is the single route file (~30 routes). Key helpers in the same file:

- `loadProject(projectId, req, action?)` — access-gated load (see above).
- `asMarkdown(value)` — unwraps `JSON.stringify(markdownString)` storage.
- `renderPrompt(template, vars)` — literal `{var}` substitution.
- `loadSourceMaterials(projectId)` — concatenates approved `case_writer_references`.
- `loadPromptOrThrow(use, version)` — fetches `ai_prompts` rows.
- `generateOutlineWithLLM(...)` — wraps `llmRouter.generate()` with provider-aware token-limit handling.

## Reference docs

- **Per-release change logs:** `docs/Case-Writer-Updates-2026-05-13.md`, `…-05-14.md`, `…-05-21.md`.
- **Prompt logging (for prompt verification):** `docs/prompt-logging.md`.
- **DB structure:** `docs/mysql-database-structure-Oct2025.sql` (search for `case_writer_`).
