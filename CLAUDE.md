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

**Database naming (changed 2026-09-16 — the dev database is no longer `ceochat_prod_copy`):**
- **Development:** `ceochat` on **localhost** — a copy of production synced 2026-09-16. This is what `.env.local` points at and what every command on this machine should use.
- **Production:** `ceochat` on `services.byu.edu`, reachable **only over SSH** (the sync script runs `mysqldump` on the remote box because MySQL there is not exposed to the network). A local `mysql` client cannot reach it.
- The two share the name `ceochat`. **The host separates them, not the name** — anything run here without `-h` defaults to localhost and so hits the dev copy.
- `ceochat_prod_copy` still exists locally but is **stale** (data through 2026-04-04), kept only as a fallback. Do not read current data from it. Its ids diverge from the live copy: `f26` is semester id **6** there, **5** in `ceochat`.

To refresh dev from production, run `C:\Users\ses3\Documents\dumps\DOWN-SYNC-ceochat-db-from-prod.ps1`. Read its variables before editing it — `$DEV_DB` is the database name **on the production server** and `$PROD_DB` is the **local** target, the reverse of what the names suggest.

**MySQL full path on this machine:**
```bash
"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u claudecode -pfordevonly ceochat < server/migrations/018_example.sql
```

Example migration sequence (using dev database):
```bash
"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u claudecode -pfordevonly ceochat < docs/mysql-database-structure-Oct2025.sql
"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u claudecode -pfordevonly ceochat < server/migrations/add_admin_auth.sql
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

### Semesters, Courses, Sections (migrations 077-078)
Courses span semesters; a section carries `semester_id` + `section_number`, and new section IDs are minted `{semester_code}-{course_code}-{n}` (`f26-gscm410-1`) by `utils/academicIds.js`, shared by server and dashboard (`node server/scripts/check-academic-ids.js`). Full design: `docs/semesters-courses-sections.md`.
- **Semesters sort by `start_date`, never by code or name** (f26 sorts before w26 alphabetically). Never join `courses.semester_id` (deprecated) — semester scope is `sections.semester_id`. `courses.primary_instructor_id` is the course OWNER (all semesters).
- **Structure is admin-only; teaching is instructors'.** Any admin creates courses and sections, moves them (`course_id`/`semester_id`/`section_number`), removes/deletes them, and rolls over. Course owners keep the case list, versions and bulk scheduling. Section primaries and TAs with `can_manage_cases` make Assignments: every `sectionCases.js` write carries `requireSectionCaseManager('sectionId')` **before** `guardFollowedCaseSettings`, and chat-options defaults/bulk-copy use `canManageSectionCases()` (global default and "all sections" stay admin). A new section-case write route needs the same gate — `requireRole(['admin'])` there silently locks instructors out of Assignments, which shipped until 2026-09. Table: `docs/semesters-courses-sections.md` § Who does what.
- **Read the columns, never parse a section_id**: legacy IDs (`GSCM401-1-F25`, `w26-adv-ops-emba`) were kept.
- **Case settings versions are write-through.** A course case has a Main version and optional semester copies; `section_cases.version_id` says which one a section follows (NULL = Customized). Editing a version rewrites linked `section_cases` rows (`services/caseVersionSync.js#applyVersion`). **Every section-level settings writer (chat_options, rubric_id, selection mode, position settings, scenario/position rows) must use `guardFollowedCaseSettings` on the server and `fetchSectionCaseSetting()` on the client**, or a later version edit silently overwrites the change. Scheduling columns are per section and not guarded.
- DATETIME inputs from the dashboard are ISO strings; convert with `server/utils/dateInput.js#parseDateInput` (strict MySQL rejects `'…Z'`).
- **One dashboard Semester selector** (header): `components/courses/semesterFilter.tsx`. Dashboard owns it (`useSemesterFilterState`) and provides `SemesterFilterContext`; Sections, Students, Assignments, Chat Options, Monitor, Results and Home read `useSemesterFilter()` and filter pickers with `inScope(section)`, clear a picked section that leaves scope, show `<SemesterScopeNote />`, and send `semester_id` to the server only for "all sections" (`/api/case-chats`, `/api/analytics/results`, `/api/analytics/positions*`). The server param only narrows; access scoping is applied first. Choice persists in `sessionStorage['mtc_semester_filter']`; the current-semester default applies only when nothing is stored. The Courses > Courses course list and the Assignments "Copy from" list are deliberately NOT filtered (an expanded course IS: it shows only in-scope sections).
- **Assignments is course-first.** `[ By course | By section ]` is a view switch (`localStorage['mtc_assignments_view']`), never a stored mode — following the course is already per case, per section (`section_cases.version_id`). By course (`components/courses/CourseAssignments.tsx`) edits versions for settings and each section's dates/Active; By section is the per-section screen. Courses > Courses covers structure and links to By course. Keep `CaseVersionEditor` at parity with the section editors when either changes. Full design: `docs/semesters-courses-sections.md` § Dashboard: Assignments is course-first.

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

### Chat Model Fallback (ranked default models)
Student chat turns (`/api/llm/chat` → `server/services/chatFallback.js`) fall back to the next working model when the section's chat model is rate-limited, times out, or returns nothing. Full design: `docs/model-fallback.md`.
- **`models.default_model` is a RANK** (API field `default`): 0 = none, **1 = the default model**, 2+ = backup defaults tried in order. Test "is the default" with `=== 1` / `= 1`, **never truthiness** (a backup is truthy). Change ranks only through `setDefaultRank()` in `server/routes/models.js` (unique, gap-free); never write `default_model` directly.
- **`case_chats.chat_model` is the model ASSIGNED at chat start**; it does not change when a backup answers. `case_chats.backup_models_used` (JSON) is NULL unless a backup answered, then `{model_id: reply_count}`. Results filter/flag backup chats from it; `model_failures` logs every failed attempt and is pruned to 90 days daily by `server/jobs/pruneModelFailures.js` (status shown in Monitor → AI Usage; the table stays in backups).
- The fallback chain must finish in **50 s** (Apache proxy default timeout is 60 s). Breaker is in memory (single PM2 instance): 3 failures / 5 min → tried last for 10 min (moved to the end, never dropped). Guard errors (cost cap, missing key, unpriced) are not model failures, and backups are guard-checked before use so the 30 s attempt cap applies only when a later model can really run. Only transient errors fall back; other 4xx (context too long, bad key) are rethrown on the requested model (`isNonRetryable()`). Calls abandoned at the timeout are still written to `model_usage` as input-only estimates (`trackAbandonedChat`).

### AI Usage Tracking
Every LLM call is logged to the `model_usage` table with dollar cost, scope (instructor/section/case), and cache-hit flag via `server/services/modelUsageWriter.js`. Per-instructor weekly dollar caps (Mon 00:00 America/Denver) are enforced by `server/services/usageGuard.js` before student chats and AI features run. `allowed_vendors` on `instructors` (defaults to `["openrouter"]` for new rows) restricts which providers an instructor can pick. Reporting is served by `/api/usage*` (`server/routes/usage.js`) and shown in the **Monitor → AI Usage** panel (`components/AiUsagePanel.tsx`) plus a sticky warning banner. Raw token payloads in `raw_usage` are pruned after 90 days. See `docs/ai-usage-tracking.md` for full details.

### Issue Analytics (Results → Issue Analytics, migration 080)
AI themes from one case + scenario's completed transcripts: pass 1 per transcript (cached in `issue_analysis_chat_facts` by transcript hash + model + prompt-text hash), pass 2 clusters the compact facts, and pass 3 re-scans only for instructor-added themes. The runner is in-process (`server/services/issueAnalytics/runner.js`, concurrency 2, heartbeat + reaper in `server/jobs/issueAnalyticsMaintenance.js`), and the client polls. Full design: `docs/issue-analytics.md`. Rules that fail silently:
- **Every transcript writer goes through `utils/transcriptFormat.js#formatTranscript`** (`[STUDENT …]` / `[PROTAGONIST …]` markers, with markers neutralised inside message text so a student cannot forge a turn). Both `App.tsx` builders share `buildTranscript()`; the final save overwrites the auto-save, so they must not diverge.
- **Turn timing is for instructors, never for models.** Every `Message` literal in `App.tsx` carries `at: Date.now()`, so markers read `[STUDENT Name | 12 after 3.52m]` (the Prompt Logging file shows `[12 after 3.52m] STUDENT:`, numbered over model-bound messages only, so it can trail the transcript). Admin Anonymize rewrites through `rewriteOutsideTurnTiming()` so replaced words cannot corrupt the suffix. Any code that sends a stored transcript to an LLM must call `stripTurnTiming()` (Re-evaluate, Preview prompt and position inference do; Issue Analytics sends only turn content). Provider history mappings in `llmRouter.js` copy role + content only, never `...h`. For timing analysis, use `parseTranscript()` → `turnNumber` / `elapsedMinutes`.
- **Staleness is keyed on transcript TEXT (hash), never `transcripts.is_anonymized`**: bulk-anonymize sets the flag without changing the text, and rewrites can arrive via the plain upsert.
- **Quotes must be verbatim from a student turn** (`verifyQuote`); text that repeats a position's wording is rejected.
- **Render Issue Analytics prompts with `renderOnce()`**, not `renderPrompt()`, which substitutes sequentially and would expand `{placeholders}` found inside transcripts.
- **`POST /runs` requires the estimate to be confirmed and within the billed instructor's remaining weekly cap.** Billing: launcher-if-owner → first in-scope section owner → launcher; `null` only for admins on unowned sections.
- A run is visible only to callers who can see **all** its sections. Names are hidden by default, and a names-off CSV has no identifying columns.
- **Sampling (migration 081) is drawn only in `planRun()` → `drawSample()`, deterministically** (`sha256(seed:case_chat_id)` per section, proportional). The estimate and `POST /runs` are separate requests and must pick the same chats, so never use `Math.random()` there. Chats not drawn are not written to `issue_analysis_run_chats`: the runner recomputes `chats_skipped` from that table, so they would count as skipped.
- **`drawSample()` allocates slots one at a time, and that is load-bearing:** it makes the draw for N a subset of the draw for N+1, so raising the sample size reuses the cached transcripts instead of dropping paid-for work. Computing all N slots from a quota (largest remainder) is non-monotone — the Alabama paradox — and shipped that way until 2026-09-17. Any rewrite must stay monotone in N, and the instructor-facing help promises it.

### Database Backup
**Admin > Backup** (`components/BackupManager.tsx`, `/api/admin/backups` in `server/routes/backups.js`, `server/services/databaseBackup.js`) takes a gzipped `mysqldump` into `backups/` (gitignored, outside `dist/`), keeps the newest 10 `pre-rollover` and the newest 10 other backups (counted separately), and lists/downloads/deletes them. Gated by the grantable `backups` admin permission (superusers always). Rollover's "Take a database backup first" (`backup_first`, execute only) takes a `pre-rollover` backup before the transaction and refuses the rollover if it fails. Four rules in the service header are load-bearing: **password only in a temp 0600 option file passed as the first arg `--defaults-extra-file`** (never `-p`), `backups/` never web-served, **download/delete names must equal a listed name (never joined into a path)**, paths from `PROJECT_ROOT` not cwd. Dev needs `MYSQLDUMP_PATH` in `.env.local`. No restore from the UI. See `docs/database-backup.md`.

### System Prompt Construction
**The server builds the student chat prompt** (`server/services/chatPrompt.js` gathers inputs from the `case_chats` record; `server/services/chatPromptTemplates.js` holds the case-chat and Teach-back templates). The browser sends only `{ caseChatId, studentName, message, messageAt, history }` to `/api/llm/chat`; a request carrying `systemPrompt` is an outdated page and gets 409 `CLIENT_OUTDATED`. Students never receive the teaching note, argument framework, scenario `prompt_instructions`, persona instructions or `chatbot_personality` (`sectionCases.js#forStudent`, `/llm/case-data`).
Cache-optimized: static content (case, supplementary, teaching note, arguments) placed first for LLM prompt caching. **The templates' output must stay byte-for-byte stable** (it is the provider cache prefix): run `node server/scripts/check-chat-prompt.js` after touching them; a deliberate wording change updates its golden fixture in the same commit.

### Conversation Flow States
Defined in `types.ts` as `ConversationPhase` enum: PRE_CHAT → CHATTING → feedback phases → EVALUATION_LOADING → EVALUATING.

### Case Writer (AI-assisted case authoring)
Instructor-facing wizard that turns a teaching principle into a published case + scenario. Pipeline: Source Material → Brief → Scenarios → Blueprint → Student Case → Teaching Note → Publish → Export.

**Before changing any Case Writer code, invoke the `case-writer` skill** (`.claude/skills/case-writer/SKILL.md`). It holds the load-bearing rules — markdown-first prompt contract, `loadSourceMaterials` + section selection, summary-scope hashing, SSRF-pinned link fetching, publish fields, model selection, the UI shell, the access model, the 💡 Hint three-layer wiring, and prompt-injection defense — many of which fail silently if broken. Reference: `docs/case-writer-reference.md`.

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
