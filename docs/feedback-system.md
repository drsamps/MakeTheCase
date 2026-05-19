# In-App Feedback System

A lightweight channel for any logged-in user to report bugs, suggest features, or
comment on case content — with admin-controlled visibility, triage, archive/delete,
and AI-summarized digests.

## Overview & lifecycle

```
   ┌──────────────────────┐                 ┌──────────────────────┐
   │  FeedbackWidget      │                 │  Admin Feedback Tab  │
   │  (right-edge tab/    │   POST /api/    │   Inbox / Mine /     │
   │   FAB / header link) │───feedback─────►│   Summary            │
   └──────────────────────┘                 └──────────┬───────────┘
            ▲                                          │
            │ /eligibility                             │ PATCH (read,
            │                                          │ follow-up, resolve,
            ▼                                          │ priority, archive)
   any authed user                                     │ DELETE (admin-only)
                                                       │
                                                       ▼
                                              feedback_submissions
```

Submission lifecycle:

1. **Submit** — Any role enabled in `feedback.submitter_roles` clicks the widget,
   fills the panel (sentiment + type + category + body), POSTs.
2. **Triage** — A viewer permitted by `feedback.viewer_rules` (or any
   `feedback_admin`) sees the row in the Inbox. They Mark Read, set
   Needs-Follow-up, and finally Mark Resolved with a resolution note.
3. **Prioritize** *(admin-only)* — Admins set `priority` (None/Low/Med/High).
   This value is **never** returned to submitters.
4. **Archive / Delete** — Soft-archive (`archived_at`) clears items from the
   default inbox view; hard delete is reserved for `feedback_admin`.
5. **Summarize** *(admin-only)* — POST `/feedback/summarize` runs the
   `feedback_summary` prompt against a scope (case / category / all) and stores
   the digest in `feedback_summaries`.

## Schema

Three tables and three migrations. Apply with `npm run migrate`.

| Migration | Purpose |
|---|---|
| `056_feedback_system.sql` | `feedback_categories`, `feedback_submissions`, `feedback_summaries`; seeds default categories, the `feedback_summary` prompt, and the global settings rows. |
| `057_feedback_context_screen.sql` | Adds `feedback_submissions.context_screen` — the friendly breadcrumb captured at submission time (e.g. `Instructor Dashboard > Content > Case Files`). |
| `058_feedback_priority_archive.sql` | Adds `priority` (TINYINT 0–3), `archived_at`, `archived_by_user_id`, plus indexes. |

### feedback_submissions columns

| Column | Notes |
|---|---|
| `submitter_user_id` | CHAR(36). No FK — user can be in `students`, `instructors`, or `admins` (same pattern as `case_chats`). |
| `submitter_role` | ENUM. Resolved at submission time by `resolveSubmitterRole()`. |
| `submission_type` | `bug \| idea \| question \| praise`. |
| `sentiment` | `positive \| neutral \| negative`. |
| `category_id` | FK → `feedback_categories(id)`, ON DELETE SET NULL. |
| `body` | TEXT. |
| `context_route` | Raw hash route, e.g. `#/admin/setup/personas`. |
| `context_screen` | Human-readable breadcrumb (added 057). |
| `context_case_id` | FK → `cases(case_id)` if submission came from a case screen. |
| `user_agent`, `build_sha`, `viewport` | Diagnostics auto-captured by the panel. |
| `is_read`, `read_at`, `read_by_user_id` | Triage state. |
| `needs_follow_up`, `follow_up_resolved`, `resolved_at`, `resolved_by_user_id`, `resolution_note` | Follow-up workflow. |
| `priority` | Admin-only, 0=None, 1=Low, 2=Med, 3=High (added 058). Never returned to submitters. |
| `archived_at`, `archived_by_user_id` | Soft-archive (added 058). |

## Settings (global, in the `settings` table)

| Key | Type | Default | Used by |
|---|---|---|---|
| `feedback.submitter_roles` | JSON `{role: bool}` | all `true` | `canSubmit()` |
| `feedback.viewer_rules` | JSON `{submitterRole: [viewerRoles]}` | every source → `["admin"]` | `allowedSubmitterRolesForViewer()` |
| `feedback.summary_model_id` | string | `""` | `resolveModel()` for `/summarize` |
| `feedback.summary_prompt_use` | string | `"feedback_summary"` | template key |
| `feedback.widget_style` | enum | `"right_edge_tab"` | `<FeedbackWidget>` dispatcher |

Feedback admins read/write these via `GET /api/feedback/settings` and
`PATCH /api/feedback/settings/:key` (no broader `settings` permission required).
The rest of `/api/settings/:key` still requires the `settings` permission.

## Permission model

Two independent gates:

1. **`feedback.viewer_rules`** — A per-source matrix. For each submitter role,
   the list of viewer roles that may see those submissions. Used by both the
   Inbox listing and the per-item GET/PATCH.
2. **`feedback_admin` permission** — Bypasses viewer rules (sees everything),
   plus unlocks Settings, Categories CRUD, AI summarization, hard delete, and
   the admin-only priority column.

`feedback_admin` is in `SUPERUSER_FUNCTIONS` in **both** `utils/permissions.ts`
and `server/middleware/permissions.js` — keep them in sync.

### Role resolution at submission time

`resolveSubmitterRole(user)` in `server/utils/feedbackRoles.js`:

- `student` → `student`
- `admin` → `admin`
- `instructor` user → check `instructor_semesters` / `courses.primary_instructor_id` / `sections.primary_instructor_id` → `primary_instructor`
- else check `instructor_sections` → `ta`
- else → `instructor`

The role is stamped on the row at insert time and is what `viewer_rules` keys on.

## Widget styles

`feedback.widget_style` controls the trigger UI. `<FeedbackWidget>` is always
mounted at the app root (`App.tsx`, ~lines 2191–2214); it self-selects the
variant and returns `null` on pre-auth routes or when the user isn't eligible.

| Value | Component | Where it renders |
|---|---|---|
| `right_edge_tab` (default) | `RightEdgeTab.tsx` | Fixed vertical pill, right edge. |
| `bottom_right_fab` | `BottomRightFab.tsx` | Floating circle, bottom-right. |
| `header_link` | `HeaderLink.tsx` | Text link inside the existing header bar (mounted by the header component, not at app root). |
| `hidden` | — | Widget suppressed entirely. |

The slide-out panel itself (`FeedbackPanel.tsx`) is the same for every variant.
It auto-captures `window.location.hash`, current case id, `navigator.userAgent`,
viewport (`${innerWidth}x${innerHeight}`), and `__APP_BUILD_SHA__` (injected by
`vite.config.ts` from `process.env.GIT_COMMIT`).

The friendly screen breadcrumb shown above route info — e.g.
`Instructor Dashboard > Content > Case Files` — comes from
`services/screenContext.ts`, a module-level store updated by Dashboard's
breadcrumb-builder useEffect. The panel sends it as `context_screen` on POST.

## API surface

All routes mount under `/api/feedback` and require auth.

### Reads

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/categories` | any auth | Active only. |
| GET | `/eligibility` | any auth | `{role, canSubmit, viewerHasAnyAllowedSource, isFeedbackAdmin, widgetStyle}`. Cached client-side in `useFeedbackEligibility`. |
| GET | `/mine` | any auth | Current user's own submissions. **Does not** return `priority`. |
| GET | `/unread-count` | viewer-scoped + admin | Excludes archived rows. Drives the Feedback tab badge. |
| GET | `/` (inbox) | viewer-scoped + admin | Filters: `status`, `category_id`, `case_id`, `submitter_role`, `submission_type`, `search`, `since`, `until`, `sort=field:dir`. See sort/status reference below. |
| GET | `/:id` | viewer-scoped (or own submission) | Full row + submitter name lookup. |

### Writes

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/` | any auth + `canSubmit` | Body validated; sliced to column lengths. |
| PATCH | `/:id` | viewer-scoped | Accepts any subset of `is_read`, `needs_follow_up`, `follow_up_resolved`, `resolution_note`, `priority` (0–3), `archived` (bool). Server stamps `read_by`, `resolved_by`, `archived_by`, and timestamps. |
| DELETE | `/:id` | `feedback_admin` | Hard delete. |
| POST | `/bulk` | viewer-scoped (action=`delete` requires `feedback_admin`) | Body `{action, ids[]}`; actions: `archive`, `unarchive`, `delete`, `mark_read`. Capped at 500 ids. Only operates on rows the viewer can see. |
| POST | `/summarize` | `feedback_admin` | See AI summarization. |

### Admin-only

| Method | Path | Notes |
|---|---|---|
| GET / PATCH | `/settings`, `/settings/:key` | The 5 feedback setting keys above. |
| GET / POST / PUT / DELETE | `/categories/admin`, `/categories[/:id]` | CRUD. Delete is soft (`active=0`) so historical submissions keep their label. |
| GET | `/summaries` | Cached AI digests by scope. |

### Sort and status reference

**`sort=field:dir`** — whitelist:

| `field` | Maps to | Default dir |
|---|---|---|
| `created` | `f.created_at` | desc |
| `priority` | `f.priority` | desc |
| `role` | `f.submitter_role` | asc |
| `type` | `f.submission_type` | asc |
| `category` | `c.name` | asc |
| `read` | `f.is_read` | asc |

`created_at DESC` is always a secondary tiebreaker. Unknown fields fall back to
created-desc silently.

**`status`** — `all` (default; hides archived) · `unread` · `read` · `followup`
· `resolved` · `archived` (shows only archived) · `all_including_archived`.

## AI summary flow

`POST /api/feedback/summarize` (`feedback_admin` only):

1. Validate `scope_type` (`case` / `category` / `all`); `scope_id` required for
   case or category scope.
2. Build WHERE for the scope, capped to the most recent
   `MAX_SUMMARY_ITEMS = 500` rows.
3. Each body runs through `redactPii()` (`server/utils/redactPii.js`) before
   formatting. Conservative regex — emails, phone numbers; best-effort, not a
   guarantee.
4. Format items as a numbered list with meta: `1. [bug] (cat=…, screen="…", route=…, case=…, role=…, sentiment=…) "…"`.
5. Resolve model: body override → `feedback.summary_model_id` → `default_model_id` → first enabled model.
6. Render the `feedback_summary` prompt template (`ai_prompts.use = 'feedback_summary'`) with `{items}` and `{scope_label}`, call `generateOutlineWithLLM()` from `server/services/llmRouter.js`.
7. Insert the resulting markdown into `feedback_summaries` and return it.

Empty scopes return a friendly message and **do not** insert a row.

## Admin UI — Inbox

`components/feedback/FeedbackInbox.tsx`.

- **Filters** — Status, Category, Role, Type, Search.
- **Sortable column headers** — When, From (role), Type, Category, Priority
  (admin-only). Click to flip direction; ▲/▼ indicator.
- **Page-size selector** — 10 / 20 / 50 / 100 / All. Client-side slice over the
  server's already-fetched (and already-sorted/filtered) result set.
- **Pagination row** — Always rendered, fixed height. Shows
  `Showing 1–20 of N` + prev/next when nothing is selected; swaps to bulk
  actions when rows are selected so the table doesn't shift.
- **Row checkboxes** — Per-row + select-all (visible page only; indeterminate
  state when partially selected). Selections persist across page changes.
- **Bulk toolbar** — Mark read, Archive, Unarchive (when viewing archived),
  Delete (admin-only with confirm), Clear.
- **Archive resolved** quick button — Above the table when there are resolved
  items in the current view. Bulk-archives all resolved un-archived items.
- **Priority column** — Admin-only. Submitters and non-admin viewers don't see
  it at all (column conditionally rendered, and the server omits it from
  `/feedback/mine`).
- **Refresh** — Standard circular-arrow button matching the rest of the
  dashboard (spins while loading).

### Detail drawer

`components/feedback/FeedbackItemDetail.tsx`.

- Mark read / unread · Needs follow-up · Resolution note + Mark resolved · Reopen
- **Priority dropdown** (admin-only, with "Visible to admins only" hint)
- **Archive / Unarchive** (everyone with viewer access)
- **Delete permanently** (admin-only, confirm prompt)

## Admin UI — Settings

Feedback Settings is the **first** collapsible section under Admin → Settings
(see `components/SettingsManager.tsx`). It renders `<FeedbackSettingsAdmin>`:

- 5 submitter checkboxes (one per role)
- 5×5 viewer-rules matrix
- Categories CRUD (`<FeedbackCategoriesAdmin>`)
- Widget-style `<select>` with small visual previews
- Summary model picker

All writes go through `PATCH /api/feedback/settings/:key` on change — no batched
save flow.

## My Feedback subtab

`components/feedback/FeedbackMine.tsx`. Lists the current user's own
submissions with status badges (Read / Needs Follow-up / Resolved) and any
resolution note. Read-only; available to every authenticated user.

The server's `/feedback/mine` SELECT intentionally omits `priority` and
`archived_at` — submitters should not see admin triage state.

## Critical files

- `server/migrations/056_feedback_system.sql`
- `server/migrations/057_feedback_context_screen.sql`
- `server/migrations/058_feedback_priority_archive.sql`
- `server/routes/feedback.js`
- `server/utils/feedbackRoles.js`
- `server/utils/redactPii.js`
- `utils/permissions.ts` and `server/middleware/permissions.js` — `feedback_admin` in `SUPERUSER_FUNCTIONS`
- `vite.config.ts` — injects `__APP_BUILD_SHA__`
- `App.tsx` — mounts `<FeedbackWidget/>` at the authed root
- `services/screenContext.ts` — friendly breadcrumb store
- `hooks/useFeedbackEligibility.ts` — cached eligibility lookup
- `components/feedback/*` — Widget, Panel, Inbox, ItemDetail, Mine, Summary, SettingsAdmin, CategoriesAdmin
- `components/Dashboard.tsx` — Feedback top-level tab + sub-nav

## Out of scope (future work)

- **Notification on new feedback** — Email/Slack hooks would be a follow-on; only the in-app badge exists today.
- **Per-course scoping** — `viewer_rules` is global. A primary instructor sees student feedback from any course.
- **File attachments** (screenshots) — text-only v1.
- **True server pagination** — Client-side slice over a 500-row server cap is fine for current volumes. If an admin's backlog exceeds 500, switch `GET /feedback` to LIMIT/OFFSET + total count.
- **TA path** — The `ta` role is reachable through `instructor_sections`. A dedicated `instructors.is_ta` column would be cleaner; defer until TA-specific workflows are needed.
