# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**MakeTheCase** is an AI-powered interactive business case study teaching tool for undergraduate and MBA students. Students chat with AI-simulated case protagonists (e.g., a CEO) to practice case analysis and strategic thinking.

## Development Commands

```bash
npm run dev:all        # Run both frontend (3000) and backend (3001) concurrently
npm run dev            # Frontend only (Vite dev server, port 3000)
npm run server         # Backend only (Express, port 3001)
npm run server:watch   # Backend with nodemon auto-restart
npm run build          # Build frontend for production
npm run create-admin   # Create admin: node server/scripts/create-admin.js email password
npm run seed-malawis   # Seed sample case data
npm run migrate        # Apply all pending SQL migrations (tracked in schema_migrations table)
npm run migrate:dry    # List pending migrations without applying them
```

### Windows Shell Commands - NUL Device Note

**IMPORTANT:** On Windows, when using commands like `timeout /t 5 >nul`, the `>nul` redirects output to the NUL device (equivalent to `/dev/null` on Unix). This should NOT create an actual file.

**However**, if a command fails or syntax is incorrect, it may create an actual `nul` file in the current directory that needs manual deletion.

**Correct Windows timeout syntax:**
```powershell
timeout /t 5 >nul 2>&1      # Windows CMD/PowerShell
```

**For Bash/Git Bash/WSL:**
```bash
sleep 5                      # Use sleep instead
```

**To avoid creating a `nul` file:**
- Use correct command syntax (e.g., `timeout /t 5` not `timeout -t 5`)
- If using Bash shells within Windows, use `sleep` instead of `timeout`
- If a `nul` file appears, delete it manually: `del nul` in CMD or `rm nul` in Bash

The `>nul` redirection itself is safe and correct; file creation only happens when commands have syntax errors or fail to parse properly.

## Architecture

### Full-Stack Structure
- **Frontend**: React 19 + TypeScript + Tailwind CSS (Vite build)
- **Backend**: Node.js + Express.js (ES modules)
- **Database**: MySQL 8
- **AI Providers**: Google Gemini, OpenAI, Anthropic (auto-detected from model_id prefix)

### Key Directories
```
components/          # React components (TypeScript)
  └── ui/            # Reusable UI components (HelpTooltip, etc.)
services/            # Client-side API/LLM services
help/                # Help content files (editable separately from components)
  └── dashboard/     # Instructor dashboard help content
server/
  ├── routes/        # Express API endpoints (~20 route files)
  ├── services/      # Business logic (llmRouter.js, fileConverter.js)
  ├── migrations/    # SQL migrations (run in numerical order)
  ├── middleware/    # auth.js (JWT), permissions.ts
  └── db.js          # MySQL connection pool
case_files/          # Uploaded case documents organized by case_id
```

### API Communication
- Vite proxies `/api` to `http://localhost:3001/api` in development
- In production, the app runs at `/makethecase/` so API calls must use the correct base path
- JWT authentication via Bearer token in Authorization header
- Token stored in localStorage as `admin_auth_token` (admin) or `student_auth_token` (student)

**IMPORTANT: Making API calls in frontend code**
Always use `getApiBaseUrl()` from `services/apiClient.ts` for fetch calls:
```typescript
import { getApiBaseUrl } from '../services/apiClient';

// Correct - works in both dev and production
fetch(`${getApiBaseUrl()}/courses`, { ... })

// WRONG - breaks in production (missing /makethecase prefix)
fetch('/api/courses', { ... })
```
The `getApiBaseUrl()` function returns `/api` in development and `/makethecase/api` in production.

### Database Migrations

**Preferred:** use `npm run migrate` (script at `server/scripts/run-pending-migrations.js`). It tracks applied files in a `schema_migrations` table, runs only pending `NNN_*.sql` files in numeric order with per-file timing, stops on first failure, and exits non-zero if anything failed. Flags: `--dry-run`, `--only NNN`, `--force`, `--mark-applied` (record existing files as applied without running — use once when bootstrapping the tracker against an existing database).

For one-off direct application, use the dev credentials (user: `claudecode@localhost`, password: `fordevonly`).

**Database naming:**
- **Development:** `ceochat_prod_copy` (local dev server)
- **Production:** `ceochat` (production server)

**MySQL full path on this machine:**
```bash
"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u claudecode -pfordevonly ceochat_prod_copy < server/migrations/018_example.sql
```

Example migration sequence (using dev database):
```bash
"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u claudecode -pfordevonly ceochat_prod_copy < docs/mysql-database-structure-Oct2025.sql
"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u claudecode -pfordevonly ceochat_prod_copy < server/migrations/add_admin_auth.sql
# ... continue with numbered migrations in order
```

### MySQL Configuration - ONLY_FULL_GROUP_BY Mode

**CRITICAL:** This MySQL instance has `ONLY_FULL_GROUP_BY` enabled in `sql_mode`. When writing queries, follow these rules:

1. **GROUP BY with COALESCE/aliases:**
   - ❌ WRONG: `GROUP BY position_name` (using alias)
   - ✅ CORRECT: `GROUP BY cc.final_position, sp.position_name, cc.initial_position` (all columns in COALESCE)

2. **Example:**
```sql
-- WRONG - Will fail with ER_WRONG_FIELD_WITH_GROUP error
SELECT COALESCE(cc.final_position, sp.position_name) as position_name, COUNT(*)
FROM case_chats cc
LEFT JOIN scenario_positions sp ON cc.final_position_id = sp.position_id
GROUP BY position_name;  -- ❌ Can't group by alias

-- CORRECT - Groups by actual columns
SELECT COALESCE(cc.final_position, sp.position_name) as position_name, COUNT(*)
FROM case_chats cc
LEFT JOIN scenario_positions sp ON cc.final_position_id = sp.position_id
GROUP BY cc.final_position, sp.position_name;  -- ✅ Groups by all columns in COALESCE
```

3. **Why this matters:**
   - MySQL's `ONLY_FULL_GROUP_BY` enforces strict SQL standard compliance
   - All non-aggregated columns in SELECT must be in GROUP BY
   - When using `COALESCE()` or functions, include all component columns in GROUP BY
   - Cannot use column aliases in GROUP BY clause - must use actual column references

4. **ORDER BY can still use aliases** (unlike GROUP BY):
```sql
-- This is OK
SELECT COALESCE(cc.final_position, sp.position_name) as position_name
FROM ...
GROUP BY cc.final_position, sp.position_name
ORDER BY position_name;  -- ✅ ORDER BY can use alias
```

## Key Architectural Patterns

### Persona System
Five built-in protagonist personalities: Strict, Moderate, Liberal, Leading, Sycophantic. Custom personas stored in database. Personas are configurable per section-case assignment.

### Chat Options (per section-case)
JSON configuration stored in `section_cases.chat_options`: hints_allowed, free_hints, ask_for_feedback, ask_save_transcript, allowed_personas, default_persona, chatbot_personality, show_case, do_evaluation.

### Case File Organization
Cases stored in `case_files/{case_id}/` with:
- `case.md` - Student-facing case document
- `teaching_note.md` - AI-only content for evaluation and counter-arguments

### Case File Text Caching
PDF/DOCX files are converted to text once at upload time and cached in the `case_files.converted_text` column. `loadCaseData()` in `server/routes/llm.js` reads the cached text directly instead of re-parsing files on every LLM call. Legacy files without cached text are backfilled automatically on first access. Admins can view/edit the extracted text and force re-extraction from the Case Files screen. See `docs/case-file-text-caching.md` for full details.

### LLM Provider Routing
Provider auto-detected from model_id prefix in `server/services/llmRouter.js`:
- `gemini-*` → Google Gemini
- `gpt-*` or `o*` → OpenAI
- `claude-*` → Anthropic

### AI Usage Tracking
Every LLM call is logged to the `model_usage` table with dollar cost, scope (instructor/section/case), and cache-hit flag via `server/services/modelUsageWriter.js`. Per-instructor weekly dollar caps (Mon 00:00 America/Denver) are enforced by `server/services/usageGuard.js` before student chats and AI features run. `allowed_vendors` on `instructors` (defaults to `["openrouter"]` for new rows) restricts which providers an instructor can pick. Reporting is served by `/api/usage*` (`server/routes/usage.js`) and shown in the **Monitor → AI Usage** panel (`components/AiUsagePanel.tsx`) plus a sticky warning banner. Raw token payloads in `raw_usage` are pruned after 90 days. See `docs/ai-usage-tracking.md` for full details.

### System Prompt Construction
Cache-optimized: static content (case, teaching note) placed first for LLM prompt caching. Three components: case document, teaching note (hidden from students), argument framework.

### Conversation Flow States
Defined in `types.ts` as `ConversationPhase` enum: PRE_CHAT → CHATTING → feedback phases → EVALUATION_LOADING → EVALUATING.

### Case Writer (AI-assisted case authoring)
Instructor-facing wizard that turns a teaching principle into a published case + scenario. Pipeline: Source Material → Brief → Scenarios → Blueprint → Student Case → Teaching Note → Publish → Export.

- **Markdown-first outputs.** All generation prompts (`case_writer.teaching_brief`, `case_blueprint`, `student_case_draft`, `teaching_note`) emit markdown directly. Only `scenario_generation` keeps a JSON wrapper (`[{title, industry, markdown}]`) for the picker UI, and `publish_field_extraction` returns four named fields. Markdown is stored as `JSON.stringify(markdownString)` in the existing JSON columns on `case_writer_projects`; `asMarkdown(value)` in `server/routes/caseWriter.js` unwraps on read. **When editing any of these four prompts (e.g. to add an XML wrapper, tweak section guidance, etc.) you MUST preserve the "Return ONLY a markdown document (no JSON, no code fences, no preamble)" instruction** — the four `/generate/*` routes call `stripMarkdownFence(text)` and store the result verbatim; they do NOT JSON-parse. Migrations 062/063 regressed this and produced raw-JSON output rendered to instructors; migration 064 restored it. Mirror this contract in any new migration that rewrites these prompts.
- **Source materials ground every step.** Approved rows from `case_writer_references` are joined and injected as `{source_materials}` into every generator prompt. Helper: `loadSourceMaterials(projectId)`. Reference uploads (`POST /projects/:id/references/upload`) store extracted text directly in `case_writer_references.content` — they intentionally bypass `case_files` to avoid the FK to `cases.case_id`.
  - Two orthogonal controls: **`selection` = which part of the document** (migrations 068-069), **`use_mode` = how much detail of that part** (migration 067: `full_text` / `summary` / `summary_and_full_text`). Summaries are generated from the selection, not the whole document.
  - **Never let any mode emit a `### Source:` header with no body** — `summary` falls back to the selected text when there is no usable summary, and a reference with nothing to contribute is skipped. That exact bug shipped: `loadSourceMaterials` selected only `content_summary`, so approved-but-unsummarized references reached the model as a title line and nothing else.
  - **A summary is only sent when it covers the same portion the text channel would send.** `summary_scope_hash` records which selection a summary was built from; `summaryMatchesScope()` re-checks it per step. On mismatch the summary is dropped in favour of the selected text (with a note) and the UI flags `summary_stale`. **Write `summary_scope_hash` whenever you write `content_summary`** — a NULL hash is treated as untrusted and the summary will not be used. Key derivation is mirrored in migration 071's SQL backfill; keep them in sync.
  - Output is capped by `REFERENCE_TEXT_CHAR_CAP` (60k/reference) and `SOURCE_MATERIALS_TOTAL_CHAR_CAP` (150k total, a running budget), with a visible `[truncated — …]` marker. Keep the caps when extending this function; a 1.5 MB PDF extracts to ~110k chars and `{source_materials}` is rebuilt on all six generate calls.
  - **Section selection (migrations 068-070).** A reference can carry `outline` + `outline_hash` + `selection` + `selection_overrides` (per-step), so only chosen portions of a long document are sent. `loadSourceMaterials(projectId, step)` resolves override → default → whole document. Outline detection lives in `server/services/referenceOutline.js` (markdown headings → text heuristics → fixed chunks; the chunk tier is load-bearing because PDFs carry no headings).
  - **Offsets are fragile — two defences, both required.** `selection` holds character offsets into `content`, and `content` is PATCHable. (1) Every write to `content` must call `refreshReferenceOutline()`, which rebuilds the outline and clears `selection` **and** `selection_overrides`. (2) `resolveSelectionRanges()` re-checks `outline_hash` at read time and falls back to the whole document on mismatch. If you add another path that writes `content`, wire it to `refreshReferenceOutline()` or it will slice at offsets pointing into the wrong text.
  - **Link references can be fetched (migration 074).** `POST .../references/:refId/fetch` downloads `link_url` into `content` via `server/services/urlFetcher.js`, so a fetched link is indistinguishable from pasted text downstream. Gated on the `case_writer_url_fetch_enabled` setting, **off by default** (client reads `GET /api/case-writer/config`). The SSRF policy blocks loopback/RFC1918/link-local (incl. `169.254.169.254`)/CGNAT/IPv6-ULA, and needs **both** of its halves: (1) **re-validate on every redirect hop** — a pre-flight-only check is defeated by any open redirector, so keep the manual redirect loop; (2) **connect to the addresses `assertUrlAllowed()` returned**, via the `lookup` option in `pinnedLookup()`. Handing the *hostname* to an HTTP client resolves DNS a second time, and a short-TTL record answers "public IP" to the check and `169.254.169.254` to the socket. This is why the module uses `node:http`/`node:https` rather than `fetch()` — `fetch` gives no way to pin the address. Never swap it back. Another instance of the `refreshReferenceOutline()` rule below: the route writes `content`, so it must (and does) call it.
  - Reference `content` reaches the browser from exactly one route, `GET .../references/:refId/content`. List routes (including `GET /reference-library`) return `CHAR_LENGTH(content)` plus `withSelectionSummary()` counts — do not add `content` or raw `outline` to them. The shared column list is `REFERENCE_ROW_COLUMNS` in `server/routes/caseWriter.js`.
  - **References are viewable/editable (`components/caseWriter/ReferenceDetail.tsx`) and copyable across projects.** Two rules that fail *silently* if broken: (1) **`summary_scope_hash` must be written on every path that writes `content_summary`** — the PATCH handler recomputes it, because a stale/NULL hash makes `summaryMatchesScope()` withhold the summary from all five generators with no visible signal; (2) **`POST .../references/import` and `/clone` must NOT call `refreshReferenceOutline()`** — the copy is byte-identical, so the outline and the instructor's section selection stay valid, and rebuilding would clear them. `GET /reference-library` is scoped by `buildVisibilityScope(req, 'case_writer_project', 'p')`; imports re-check `view` on each source project, run in a transaction, and additionally check `edit` — a copy taken out of a view-only project gets NULL `upload_original_name`/`upload_stored_path`, because otherwise "copy into my own project, then download" walks straight around the rule below.
  - **`GET .../references/:refId/download-original` requires `'edit'`, not `'view'`** — the only reference route that does. Everything else a shared project exposes is text this platform extracted or generated, and the visibility disclosures say so; the untouched PDF/DOCX may be licensed material the owner cannot redistribute. Costs nothing in the UI: view-only callers get the read-only document view and never see the Source Material pane.
  - Note `admin.css` is **not imported anywhere** — its rules are dormant. Component-scoped `<style>` blocks are the working pattern (`.cw-input` in `CaseWriterProject.tsx`, the print rules in `ReferenceDetail.tsx`).
- **Publish-time fields** live in dedicated columns (`publish_protagonist`, `publish_chat_question`, `publish_arguments_for`, `publish_arguments_against`) on `case_writer_projects`, not inside the teaching-note JSON. `POST /projects/:id/extract-publish-fields` runs the `case_writer.publish_field_extraction` prompt to auto-fill them.
- **Model selection.** Project-level `default_model_id` + per-call override. Resolution order: explicit override → `project.default_model_id` → `resolveDefault()`. The OpenAI branch in `generateOutlineWithLLM` uses `isOpenAIReasoning(modelId)` to switch between `max_tokens` and `max_completion_tokens` (required by `gpt-5*` and `o1*`). All generators thread `maxTokens: 32000` to prevent silent truncation.
- **UI shell.** `components/caseWriter/CaseWriterProject.tsx` is a two-column wizard: left rail (`StepRail.tsx`) with status dots (`○ ◉ ● ▶`), right pane swaps per active step. Each markdown step uses `MarkdownStepEditor.tsx` (textarea + `MarkdownPreview.tsx` side-by-side) with Generate / model-override / 💡 Hint / Save controls above. Tailwind CDN does **not** include `@tailwindcss/typography`, so `MarkdownPreview` provides explicit `react-markdown` component overrides instead of relying on `prose`.
- **Access model.** Visibility (read) is controlled by `buildVisibilityScope()` (owner + team-shared + public + admin). Edit/delete is centralized in `loadProject(projectId, req, action?)` in `server/routes/caseWriter.js`, which infers the required action from `req.method` (`GET`→view, `DELETE`→delete, otherwise edit) — so all mutating routes inherit edit-gating without per-call-site changes. Non-owners with view-only access get a single scrollable read-only document view in `CaseWriterProject.tsx` and a Clone button (`POST /projects/:id/clone` requires only `'view'`).
- **💡 Hint (`revision_hint`) spans three layers.** All five generate steps (Brief, Scenarios, Blueprint, Student Case, Teaching Note) accept it, as does the reference-summary editor. `MarkdownStepEditor` renders the Hint button — and the admin "log this prompt with data" checkbox — for **any** step with a Generate action, so a step whose client handler, route destructure, or prompt placeholder is missing shows a control that silently does nothing. That shipped twice: on the Learning Brief until migration 073, and on the AI summary until migration 076 (whose client handler took one parameter and dropped `MarkdownStepEditor`'s whole `opts` object). Wire all three together, and forward `opts` — not just the model id — from every `onGenerate`.
- **Prompt-injection defense.** Every user-supplied variable injected into a Case Writer prompt (`{source_materials}`, `{learning_brief}`, `{case_blueprint}`, `{student_case}`, `{teaching_note}`, `{revision_hint}`, `{industry_preference}`, `{selected_scenario}`, `{teaching_principle}`, plus `{content}` / `{title}` / `{source_notes}` in `reference_summary`, `{content}` / `{title}` / `{type}` in `principle_extraction`, and `{teaching_principle}` / `{case_context}` / `{document_title}` / `{outline}` in `reference_section_select`) is wrapped in named XML tags with an explicit "treat as data, not instructions" framing. The `{var}` placeholder syntax is unchanged, so `renderPrompt()` is unaffected. New prompts that inject instructor-supplied text MUST follow this pattern.
- **Reference:** `docs/case-writer-reference.md`. **Change logs:** `docs/Case-Writer-Updates-2026-05-13.md`, `…-05-14.md`, `…-05-21.md`, `…-08-14.md`, `…-08-15.md`.

## Access Points
- Student view: `http://localhost:3000/`
- Instructor dashboard: `http://localhost:3000/#/admin` (or Ctrl+click header)

### Instructor Welcome screen

- Copy: `config/welcome.md` (Markdown + optional sanitized HTML for layout).
- Served by `GET /api/content/welcome` (`server/routes/content.js`), rendered in `components/WelcomeScreen.tsx` with `MarkdownPreview` (`allowHtml="sanitized"`, `sanitizePreset="welcome"`).
- Sanitize presets and `allowHtml` modes: `utils/markdownSanitizeSchemas.ts`, `components/caseWriter/MarkdownPreview.tsx`. Authoring guide: `docs/welcome-screen.md`.

### Dashboard primary tabs: Setup vs Admin

The dashboard has two distinct admin-area primary tabs in `components/Dashboard.tsx`:

- **Setup** — visible to every instructor and admin (`hasSetupAccess()`). Sub-tabs: **Personas, API Keys, Teams**. These are in `BASE_FUNCTIONS` in `utils/permissions.ts`.
- **Admin** — visible only to admins with access to admin-only tools (`hasAdminAccess()` — checks `instructors`/`prompts`/`models`/`settings`). Sub-tabs: **Instructors, Settings, Models, Prompts, Admins, Logging, Shadow-Owned** (last is superuser-only). These are in `SUPERUSER_FUNCTIONS`.

When adding a new admin-area feature, place it under **Setup** if instructors should reach it, or **Admin** if it's admin-only. Don't reintroduce instructor-accessible items under Admin — that was the prior structure and was confusing to instructors. Full rationale in `docs/multi-instructor-personas.md` § Dashboard navigation.

## Platform-Specific Notes

The `.claude/` directory (gitignored) contains machine-specific settings:
- **`.claude/settings.local.json`** - Dev credentials in `env` field (MYSQL_CLAUDE_USER, MYSQL_CLAUDE_PASSWORD)
- **`.claude/PLATFORM.md`** - Platform-specific guidance (Windows vs Linux shell commands, MySQL paths, etc.)

Check `.claude/PLATFORM.md` for this machine's MySQL path and shell conventions.

## Environment Configuration
Copy `env.local.example` to `.env.local` and configure:
- `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`
- `MYSQL_USER`, `MYSQL_PASSWORD`, `JWT_SECRET`
- `CAS_ENABLED` (false for local dev)

## Prompt Logging (Debug Feature)

Debug feature for capturing AI prompts/responses to disk. Access via **Admin > Logging** tab.

**Key files:**
- `server/services/promptLogger.js` - Core logging service
- `server/routes/logs.js` - Admin API endpoints
- `components/LoggingManager.tsx` - Admin UI
- `docs/prompt-logging.md` - Full documentation

**Settings (in `settings` table):**
- `log_case_chat_prompts` - Countdown of chat turns to log (0 = disabled)
- `log_evaluation_prompts` - Countdown of evaluations to log
- `max_log_files` - Maximum files before logging stops (default: 100)
- `log_with_full_case_context` - Include case content or hide it (default: false)

**Log location:** `logs/` directory in project root

**Prompt tagging:** Case content in prompts is wrapped in `<context type="..." file="...">` tags for clean extraction when logging. These tags are inside the existing `=== MARKERS ===` for backward compatibility.

## UI Components

### HelpTooltip Component
Location: `components/ui/HelpTooltip.tsx`
Styles: `admin.css` (`.help-tooltip-*` classes)

A standardized help info component for providing contextual help throughout the instructor dashboard. Displays a circled "i" icon that opens a resizable popup when clicked.

**Features:**
- Scrollable content area
- Resizable popup (drag bottom-right corner to resize)
- Closes on click outside or Escape key

**Usage:**
```tsx
import HelpTooltip from './ui/HelpTooltip';
import { SomeFeatureHelp } from '../help/dashboard';

<HelpTooltip title="Feature Name">
  <SomeFeatureHelp />
</HelpTooltip>
```

### Destructive-action confirm() labels

When adding a `window.confirm()` for a destructive row action (Delete, Remove, Kill, Revoke, Deactivate), quote the human-readable label the row displays — not "this X". Pass the entity object into the handler, not a bare ID. Use the helpers in `utils/confirmLabels.ts`:

- `quote(s, max=60)` — wraps a string in `"..."` and truncates with `…` past 60 chars.
- `personLabel({ name, email })` — `"Jane Doe" (jane@byu.edu)` / `"Jane Doe"` / `"jane@byu.edu"`.
- `caseLabel(title, caseId)` — quotes the title; falls back to `caseId` only when the title is missing.

Bulk operations stay count-based (`Delete 5 log files?`). Non-destructive confirms (unsaved edits, copy/push, SQL export) are out of scope. Reference impls: `InstructorManager.handleDeleteInstructor`, `Dashboard.handleDeleteCase`.

### Help Content Files
Location: `help/dashboard/`

Help content is stored in separate TSX files for easy editing without modifying component code. Each file exports a React component containing the help text.

**Directory structure:**
```
help/
  └── dashboard/           # Instructor dashboard help content
      ├── index.ts         # Exports all help components
      ├── ChatOptionsHelp.tsx
      └── (future help files)
```

**To edit existing help content:**
1. Open the relevant file in `help/dashboard/` (e.g., `ChatOptionsHelp.tsx`)
2. Edit the JSX content using supported HTML elements
3. Save and rebuild

**To add new help content:**
1. Create a new file in `help/dashboard/` (e.g., `AssignmentsHelp.tsx`)
2. Export a React component with the help content
3. Add export to `help/dashboard/index.ts`
4. Import and use with `<HelpTooltip>` in the relevant component

**Supported HTML elements (styled via admin.css):**
- `<h4>` - Section headers within help content
- `<p>`, `<ul>`, `<ol>`, `<li>` - Standard text and lists
- `<strong>` - Bold/emphasized text
- `<code>` - Inline code snippets
- `<div className="help-callout">` - Highlighted tip/note box

**Example help file:**
```tsx
import React from 'react';

const MyFeatureHelp: React.FC = () => (
  <>
    <h4>Overview</h4>
    <p>Description of the feature...</p>

    <h4>How to Use</h4>
    <ul>
      <li><strong>Step 1</strong> - Do this first</li>
      <li><strong>Step 2</strong> - Then do this</li>
    </ul>

    <div className="help-callout">
      <strong>Tip:</strong> Helpful advice here
    </div>
  </>
);

export default MyFeatureHelp;
```
