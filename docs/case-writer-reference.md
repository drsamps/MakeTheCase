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

Two orthogonal controls decide what an approved reference contributes:

```
selection  ->  WHICH part of the document        (migrations 068-069)
use_mode   ->  HOW MUCH detail of that part      (migration 067)
```

| `use_mode` | Sends |
|---|---|
| `full_text` (default) | the selected text verbatim |
| `summary` | the AI summary **of the selected text** |
| `summary_and_full_text` | the summary, then `--- Full text ---`, then the text — both covering the same portion |

The two used to ignore each other: the summarize route read the whole `content` column, so picking three chapters and choosing `summary` silently discarded the selection, and `summary_and_full_text` put a whole-document summary above three selected chapters. Migration 071 fixed that — see *Keeping the summary and selection in the same scope* below.

Two invariants, both of which exist because violating them caused a real bug:

1. **No mode ever emits a header with no body.** `summary` falls back to full text when `content_summary` is NULL (with a `_(not summarized yet — using full text)_` note), and a reference with nothing to contribute is skipped entirely rather than emitted as a title line. Before 067, `loadSourceMaterials` selected only `content_summary`, so an approved-but-never-summarized reference reached the model as a bare `### Source: …` header — the instructor saw "Approved" and got nothing.
2. **Output is capped.** `REFERENCE_TEXT_CHAR_CAP` = 60,000 chars per reference, `SOURCE_MATERIALS_TOTAL_CHAR_CAP` = 150,000 across all approved references (a running budget consumed in `created_at` order). Truncation appends a visible `[truncated — showing first N of M characters]` marker. A single 1.5 MB PDF extracts to ~110k chars and `{source_materials}` is rebuilt on all six generate calls, so an uncapped build would exceed provider context windows.

Note that `POST .../summarize` sets `approved_by_user = 0` by design, so a new summary must be re-approved before it is used. The Source Material UI shows an explicit notice when this happens.

#### Keeping the summary and selection in the same scope (migrations 071-072)

`POST .../summarize` summarizes the reference's **default selection**, not the whole document, and records which selection it used in `summary_scope_hash`.

`selectionScopeKey(row, step)` derives that key from the effective selection plus `outline_hash` — deliberately **not** from the document body, so it can also be computed on the list routes, which never load `content`. `summaryMatchesScope(row, step)` compares them:

- **Match** → the summary is used.
- **Mismatch** → the summary is *not* sent; the selected text goes instead, carrying `_(summary is out of date with the current selection — using the selected text)_`. The UI shows a re-summarize prompt (`summary_stale` on the list payload), so this is never silent.

Consequences worth knowing:

- A **per-step override** changes the scope for that step, and there is only one summary per reference — so an overridden step falls back to text under `summary` mode. That is intentional: the alternative is sending a summary of a portion that step is not using.
- **Editing `content`** rebuilds `outline_hash`, which changes the scope key, which flags the summary stale. No separate invalidation needed.
- A summary with a NULL `summary_scope_hash` is treated as untrusted and not sent. Migration 071 backfilled every existing summary with the "whole document" key, so this only occurs if a new code path forgets to record scope — write `summary_scope_hash` whenever you write `content_summary`.

Key derivation is duplicated in migration 071's backfill (`MD5(CONCAT('whole:', COALESCE(outline_hash, '')))`); the two must stay in sync, and `test-summary-scope.mjs` asserts they agree.

Migration 072 updates `case_writer.reference_summary` accordingly: it no longer claims `<content>` is the full document, gains a `{scope_note}` variable naming the selected sections, and asks the model to flag excerpts that begin or end mid-argument. Its JSON output contract is unchanged.

#### Choosing portions of a large document (migrations 068-070)

A 1.5 MB textbook PDF extracts to ~110,000 characters, and truncating to the first 60,000 keeps the title page and throws away the chapter that matters. So a reference can carry a selection:

- `outline` — detected sections `[{id, level, title, start, end, chars}]`, built by `server/services/referenceOutline.js`.
- `outline_hash` — md5 of `content` when the outline was built.
- `selection` — `{sections: [id], excerpts: [{id, start, end, label}]}`. NULL/empty means the whole document.
- `selection_overrides` — `{step: selection}` for `brief` / `scenarios` / `blueprint` / `student_case` / `teaching_note`. An absent key falls back to `selection`.

`loadSourceMaterials(projectId, step)` resolves override → default → whole document, merges section and excerpt ranges with `mergeRanges()` (so an excerpt inside a selected section is not sent twice), and joins the pieces with `[…]` to mark elision.

**Offsets are the fragile part.** `start`/`end` index into `content`, which is editable via PATCH. Two defences, and both are needed:

1. Any write to `content` calls `refreshReferenceOutline()`, which rebuilds `outline`/`outline_hash` and clears **both** `selection` and `selection_overrides`.
2. `resolveSelectionRanges()` re-checks `outline_hash` against `md5(content)` at read time and ignores a stale selection, degrading to the whole document rather than slicing at offsets that now point at the wrong text.

##### Outline detection tiers

`detectOutline(text, format)` tries, in order, and falls through when a tier's result fails a quality gate (≥3 sections averaging ≥500 chars after cleanup):

1. **markdown_headings** — `#`-`####`. Only DOCX (via mammoth) and `.md` carry these.
2. **text_headings** — `Chapter N —`/numbered/ALL-CAPS heuristics for plain text. Post-processing does the real work here: lines ending like prose are rejected, sections under 400 chars are absorbed into their predecessor (kills numbered-list false positives), repeated running headers are collapsed to their first occurrence (PDF page headers otherwise make every page a section), and sections over 12,000 chars are split into parts.
3. **chunks** — ~5,000-char blocks split at paragraph breaks, labelled by their opening words. Always succeeds.

PDFs go through `pdf-parse` + `cleanPdfText()`, which carries no headings and strips standalone page numbers, so tier 3 is load-bearing rather than a corner case. In practice the ESDI test document (`ESDI-4E_Chapters_1-3.pdf`, 109,942 chars) resolves on tier 2 into 11 sections with real chapter boundaries.

##### Routes

- `GET /projects/:id/references/:refId/content` — full text + outline. **The only route that ships `content` to the browser**; the list routes return `CHAR_LENGTH(content)` and a compact selection summary (`withSelectionSummary()`) instead.
- `POST /projects/:id/references/:refId/rebuild-outline` — force re-detection; clears the selection.
- `POST /projects/:id/references/:refId/fetch` — download a `link`'s page into `content`. Flag-gated; see *Fetching a link's page text* below.
- `GET /config` — `{ url_fetch_enabled }`. Deliberately its own route rather than a field on the reference list, which is about references.
- `POST /projects/:id/references/:refId/suggest-sections` — `case_writer.reference_section_select`. Sends **only the outline** (id, title, char count, 120-char snippet) plus the teaching principle, never the document body. Returns a suggestion and **persists nothing**; unknown section ids are dropped server-side. The picker pre-checks the boxes and the instructor saves.

#### Fetching a link's page text (migration 074)

A `link` reference used to store only `link_url`, leaving `content` NULL — so an approved link contributed a single `URL: https://…` line to every generation prompt and nothing else. `POST /projects/:id/references/:refId/fetch` downloads the page, extracts its text into `content`, and calls `refreshReferenceOutline()`.

**After a fetch, a link is indistinguishable from pasted text downstream.** Outline detection, section/excerpt selection, per-step overrides, `use_mode`, and summarization all work against `content` and needed no changes — the only thing that changed elsewhere is that the disable condition for those controls is now "has no stored text", not "is a link".

Provenance columns: `fetched_at`, `fetched_content_type`, `fetched_final_url`. The final URL is stored *separately* rather than overwriting `link_url` — the instructor typed `link_url` and it should stay as typed, while the final URL is what was actually read, so a redirect to a login or consent wall is visible rather than mysterious.

Like `POST .../summarize`, the route sets `approved_by_user = 0`: the reference's contribution just went from a URL to several thousand words that will feed five generation steps, and that deserves a look. The UI says so (the amber `justFetchedId` notice) rather than silently unchecking the box.

**Refetching** is the same route called again. It overwrites `content`, and `refreshReferenceOutline()` clears `selection` and `selection_overrides` because the stored character offsets no longer point at the same words. Nothing auto-refetches; `fetched_at` is surfaced in the row so staleness is the instructor's call.

##### Feature flag

Setting `case_writer_url_fetch_enabled`, **`'0'` by default**. Off: the route returns 403 and the button is absent (the client reads `GET /api/case-writer/config`). Enabling it lets any instructor cause this server to make outbound requests, which is an admin decision.

##### SSRF policy — `server/services/urlFetcher.js`

The URL comes from an authenticated instructor, but the *server* makes the request, so it can reach whatever this host can reach. The module is kept free of Express and DB imports so the policy is testable on its own.

- `assertUrlAllowed(url)` rejects non-`http(s)` schemes and embedded credentials, then `dns.lookup(…, {all: true})` and refuses if **any** returned address is blocked — a host publishing both a public and a `127.0.0.1` A record is refused outright, since we do not control which one the socket picks.
- `isBlockedAddress(ip)` refuses loopback, `0.0.0.0/8`, RFC1918, `169.254.0.0/16` (**cloud metadata**), CGNAT `100.64/10`, multicast, `::`, `::1`, `fe80::/10`, `fc00::/7`, `ff00::/8`. IPv6 is parsed into its eight groups rather than matched textually, because `new URL()` normalizes `::ffff:127.0.0.1` to `::ffff:7f00:1` and a dotted-quad regex sails straight past it; mapped, IPv4-compatible, and NAT64 (`64:ff9b::/96`) forms are all unwrapped and re-checked against the v4 rules.
- **The redirect loop is manual (`redirect: 'manual'`) and re-validates on every hop.** This is the load-bearing part: the origin controls the `Location` header, so a pre-flight-only check is defeated by any open redirector. Max 5 hops.
- 20 s timeout, 10 MB ceiling enforced on the running byte total (a lying `Content-Length` is the normal case), `MakeTheCase-CaseWriter/1.0` User-Agent.

##### Content-type branching

| Type | Handling | `format` |
|---|---|---|
| `text/html`, `application/xhtml+xml`, none | `jsdom` + `@mozilla/readability` (Firefox Reader Mode); `article.textContent` | `text` |
| `application/pdf` | temp file under `case_files/_cw-tmp/` → existing `convertFile()`, unlinked in a `finally` | `pdf` |
| `…wordprocessingml.document`, `application/msword` | same, via `convertFile(…, '.docx')` | `docx-markdown` |
| `text/plain` / `text/markdown` | decoded, honouring `charset=` | `text` / `markdown` |
| anything else | refused, naming the type and suggesting **Upload file** | — |

HTML returns `format: 'text'` deliberately: Readability's `textContent` carries no `#` headings, so the outline detector's plain-text tier (usually falling through to `chunks`) is the right one.

When extraction yields under 200 characters the raw `<body>` text is stored instead and `fetch_degraded` is returned so the UI warns — a JS-rendered SPA shell whose `<nav>` yields 40 characters must not quietly become source material. If nothing at all is extractable the route 422s.

**Error messages are the whole product here.** Paywalls, bot blocks, and JS-rendered pages are the common failures and none are fixable server-side, so every thrown message ends by telling the instructor to open the page and paste the text instead.

##### UI

`components/caseWriter/ReferenceContentViewer.tsx` is the picker (Sections / Excerpts tabs, running total against the cap, ✨ Suggest sections). Excerpt capture renders one `<span data-start>` per outline section, so a DOM selection maps to absolute offsets as `dataset.start + offsetWithinSpan`. `components/caseWriter/StepSourceScope.tsx` renders the per-step line under each Generate row — a per-step override has to be visible where it takes effect, or an unexpectedly narrow output is very hard to diagnose.

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

All five generator routes (**Learning Brief**, Scenarios, Blueprint, Student Case, Teaching Note) accept an optional `revision_hint` in the request body and substitute it into the prompt inside a `<revision_hint>` tag. The 💡 Hint button next to each Generate's model picker exposes this. **Ephemeral by design** — hint lives in component state, not persisted. Persistent guidance belongs in the Learning Brief / Case Blueprint, which the Tweak workflow can also edit.

The Learning Brief was wired up late (migration 073). `MarkdownStepEditor` renders 💡 Hint for **any** step that can Generate, so the Brief displayed the control from the start while the hint was discarded at three separate layers: `generateBrief()` forwarded only `log_this_prompt` from `opts`, `POST /generate/brief` destructured only `model_id`, and `case_writer.teaching_brief` had no `{revision_hint}` placeholder. **If you add a generate step, wire all three layers** — the button appears whether or not anything is listening.

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
- `loadSourceMaterials(projectId, step)` — concatenates approved `case_writer_references` per each row's `use_mode` and section/excerpt selection; see below.
- `refreshReferenceOutline(refId, text, format)` — rebuilds `outline`/`outline_hash`, clears `selection` + `selection_overrides`. Call on **every** write to `content`.
- `resolveSelectionRanges(row, text, step)` / `assembleSelectedText(text, ranges)` — resolve and stitch the selected portions.
- `withSelectionSummary(row)` — strips bulky `outline`/`selection` JSON from list responses, leaving counts.
- `loadPromptOrThrow(use, version)` — fetches `ai_prompts` rows.
- `generateOutlineWithLLM(...)` — wraps `llmRouter.generate()` with provider-aware token-limit handling.

## Reference docs

- **Per-release change logs:** `docs/Case-Writer-Updates-2026-05-13.md`, `…-05-14.md`, `…-05-21.md`, `…-08-14.md`.
- **Prompt logging (for prompt verification):** `docs/prompt-logging.md`.
- **DB structure:** `docs/mysql-database-structure-Oct2025.sql` (search for `case_writer_`).
