# AI Usage Tracking

Cost-first observability and rate-limiting for every LLM call the app makes.
Replaces the older token-count view (`llm_cache_metrics`) with a dollar-based
ledger, a weekly per-instructor spend cap, and a vendor allowlist.

For the original design rationale and migration history see
`ai-usage-tracking-plan.md`. This doc describes what shipped.

## What it does

1. **Records every LLM call** to `model_usage` with cost in USD, provider,
   model, purpose, instructor/section/case scope, cache-hit flag, and raw
   token usage.
2. **Enforces a weekly dollar cap** per instructor. Window is
   Monday 00:00 – Sunday 23:59 **America/Denver** (hardcoded for v1).
   Going over blocks student chats and other AI features until the next
   Monday reset.
3. **Restricts which providers** an instructor can pick from
   (`allowed_vendors`). New instructors default to `["openrouter"]`.
4. **Surfaces spend** in an **AI Usage** panel under Monitor and a sticky
   warning banner on the dashboard.

## Data model

Migration `060_model_usage_and_cost_cap.sql` adds:

### `model_usage` (one row per LLM call)

| Column | Notes |
|---|---|
| `id` BIGINT PK | |
| `created_at` TIMESTAMP | UTC |
| `purpose` ENUM | `student_chat`, `evaluation`, `case_writer`, `case_prep`, `position_inference`, `feedback_summary`, `model_test` |
| `model_id`, `provider` | e.g. `openai/gpt-4o-mini`, `openrouter` |
| `instructor_id`, `section_id`, `case_id`, `project_id` | scope keys (any can be NULL) |
| `use_system_key` BOOL | `0` = instructor's own key, `1` = system key |
| `cache_hit` BOOL | provider-reported prompt-cache hit |
| `est_cost_usd` DECIMAL(12,6) | NULL if pricing unavailable |
| `raw_usage` JSON | provider's raw usage block (tokens etc.) — pruned after 90 days |

### `instructors` (new columns)

| Column | Default | Notes |
|---|---|---|
| `weekly_ai_usage_cap` DECIMAL(8,4) | NULL | dollar cap, NULL = no cap |
| `weekly_ai_usage_warning_pct` TINYINT | 80 | instructor-settable; banner fires at this % of cap |
| `allowed_vendors` JSON | `["openrouter"]` (new rows) | array of allowed provider slugs |

## How costs are computed

`server/services/modelUsageWriter.js` is the single write path. Called from
each LLM provider wrapper after a response returns. Two cost sources:

- **OpenRouter** — uses `response.usage.cost` directly (cents-accurate).
- **Direct providers** (OpenAI/Anthropic/Gemini) — computed at insert time
  from `models.cpm_input` / `models.cpm_output` (cost per million tokens).
  If pricing is missing the row is stored with `est_cost_usd = NULL` and
  shown in the panel as "unpriced calls."

Writes are **fire-and-forget** — the LLM caller doesn't await the insert.

## Cap enforcement

`server/services/usageGuard.js` exports:

- `currentWeekBounds()` — Monday 00:00 → next Monday 00:00 in America/Denver,
  returned as UTC `Date` instants for SQL comparisons. Uses
  `Intl.DateTimeFormat.formatToParts` (MySQL's `CONVERT_TZ` requires named
  TZ tables which this install lacks).
- `getWeeklyUsage(instructorId)` — returns `{ costUsed, cap, warnPct,
  warnThreshold, capActive, overWarning, overCap, weekStart, weekEnd }`.
- `assertNotOverCap(instructorId)` — throws if `overCap`; called from
  student-chat and AI feature entry points.

Instructors using their own API keys (`use_system_key = 0`) are not capped.

## API

All under `server/routes/usage.js`, mounted at `/api/usage`:

| Endpoint | Who | Returns |
|---|---|---|
| `GET /weekly-status` | instructor or admin | compact cap+usage summary used by the warning banner |
| `GET /?period=…&instructor_id=…` | instructor (self) or admin (any) | totals, daily sparkline, by-purpose / by-model / by-section breakdowns, plus by-instructor leaderboard when admin not filtering |
| `GET /export?period=…` | same | CSV of raw rows in window (capped at 50,000) |
| `PATCH /warning-pct` | instructor (self) | sets `weekly_ai_usage_warning_pct` (0–100) |

### Scope rules (`resolveScope(req)`)

- **Instructor** — sees their own rows only.
- **Admin impersonating** (`X-Act-As-Instructor` header) — sees impersonated
  instructor's rows.
- **Admin not impersonating** — sees all rows. Can pass `?instructor_id=X`
  to filter to one instructor.

### Period & timezone

`period` is one of `this_week`, `last_week`, `last_7_days`, `last_30_days`,
`last_90_days`. **Display week is Sunday–Saturday** (separate from the
Mon-MT cap window — the cap is enforced on a different schedule than what's
shown in the calendar bars).

`resolvePeriodBounds` returns `start`/`end` aligned to MT-midnight and an
`offsetHours` value. Both the WHERE clause bounds and the daily SQL
`DATE()` bucket are shifted by `offsetHours` so a late-evening MT chat
(which is "tomorrow" in raw UTC) lands in the correct calendar bar.

## UI

### AI Usage panel — `components/AiUsagePanel.tsx`

Lives at **Monitor → AI Usage**. Shows:

- Weekly cap bar (red/yellow/green) — for instructor scope.
- Totals strip: total cost, calls, cache hits + rate, avg cost/call.
- Daily spend bar chart (capped at last 30 days). Labels are two-line
  `Mo 3 / Jul` and use TZ-shifted MT calendar dates.
- Breakdowns by purpose, model, section, and (admin-only) by instructor.
- Period selector, "for Everyone" / per-instructor dropdown (admin only),
  refresh button, CSV export.

Admin detection: the panel sets `isAdmin = true` the first time it sees
`scope: 'global'` from either endpoint; that unlocks the instructor
dropdown which loads from `/api/instructors`.

### Warning banner — `components/AiUsageWarningBanner.tsx`

Sticky banner mounted below the impersonation banner in `Dashboard.tsx`.
Polls `/usage/weekly-status` on mount and every 5 minutes.

- **Yellow** at `cost_used >= cap * warn_pct / 100`
- **Red** at `cost_used >= cap`

Dismiss is keyed by `weekStart` in sessionStorage — survives tab switches,
returns next week or in a fresh session.

### Instructor admin — `components/InstructorManager.tsx`

The instructor edit form has $ cap, warning %, and vendor checkboxes.
Removing vendor access prompts a confirmation noting the cascade:
existing section configs still work, but new dropdowns hide removed
vendors and stored API keys for removed vendors are greyed out (not
deleted) in `ApiKeysManager.tsx`.

## Background jobs

`server/jobs/truncateOldRawUsage.js` clears `raw_usage` JSON on rows older
than 90 days. Runs 30s after server start and every 24h thereafter, in
batches of 5,000 rows.

The cost (`est_cost_usd`) and scope columns are kept indefinitely — only
the verbose token payload is pruned.

## Key files

| File | Role |
|---|---|
| `server/migrations/060_model_usage_and_cost_cap.sql` | Schema |
| `server/services/modelUsageWriter.js` | Single insert path (called by provider wrappers) |
| `server/services/usageGuard.js` | Week bounds, cap reads, `assertNotOverCap` |
| `server/jobs/truncateOldRawUsage.js` | 90-day `raw_usage` cleanup |
| `server/routes/usage.js` | `/api/usage*` endpoints |
| `server/routes/instructors.js` | Cap / warning / `allowed_vendors` CRUD |
| `server/routes/apiKeys.js` | Returns `allowedVendors` for greying out keys |
| `components/AiUsagePanel.tsx` | Monitor → AI Usage screen |
| `components/AiUsageWarningBanner.tsx` | Sticky banner |
| `components/InstructorManager.tsx` | Cap / vendor admin form |
| `components/ApiKeysManager.tsx` | Vendor allowlist enforcement on the keys screen |
| `components/CacheMetrics.tsx` | Now shows a sunset notice pointing to AI Usage |
