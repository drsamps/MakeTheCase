# Multi-Instructor Architecture — Overview

MakeTheCase was originally a single-tenant tool with one global admin and one set of API keys. The multi-instructor pivot turns it into a multi-tenant system where each instructor has their own resources, their own optional API keys, and the ability to share with peers via teams. Admins keep system-wide oversight but no longer own teaching resources directly.

This doc is the index for everything below.

## Related docs

- **[multi-instructor-permissions.md](./multi-instructor-permissions.md)** — Permission matrix (Admin / Primary / TA / Other Instructor) for every action.
- **[multi-instructor-personas.md](./multi-instructor-personas.md)** — Built-in vs custom personas, clone, Allowed Personas in chat options, student `available_personas`.
- **[multi-instructor-visibility.md](./multi-instructor-visibility.md)** — Resource visibility (Private / Team / Public) + team sharing.
- **[multi-instructor-api-keys.md](./multi-instructor-api-keys.md)** — Per-instructor API keys, encryption, usage caps, the system-key fallback.
- **[multi-instructor-impersonation.md](./multi-instructor-impersonation.md)** — Admin "act as instructor" flow + audit log.

## Mental model

```
                          ┌─────────────────────┐
                          │   admins (legacy)   │  ← system-wide control
                          │   admin_access[]    │     no teaching resources
                          │   superuser flag    │
                          └─────────┬───────────┘
                                    │ can impersonate
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                       instructors                                │
│   id, email, use_system_key, can_publish, monthly_token_cap     │
└──┬───────────────┬───────────────┬───────────────┬──────────────┘
   │               │               │               │
   │ owns          │ assigned to   │ belongs to    │ has keys for
   ▼               ▼               ▼               ▼
┌─────────┐  ┌──────────────┐  ┌────────────┐  ┌─────────────────┐
│ cases   │  │ courses /    │  │ instructor │  │ instructor_api_ │
│ rubrics │  │ sections     │  │ _teams     │  │ keys (AES-256)  │
│ rubric_ │  │ (primary +   │  │            │  │                 │
│ criteria│  │ TA via       │  │ + invites  │  │ falls back to   │
│ personas│  │ instructor_  │  │            │  │ env when use_   │
│ case_   │  │ sections)    │  │            │  │ system_key=1    │
│ writer_ │  └──────────────┘  └─────┬──────┘  └─────────────────┘
│ projects│                          │
└────┬────┘                          │
     │                               │
     │ visibility: private/team/public
     └────► resource_team_shares ◄───┘
```

## Key design decisions (locked-in)

| # | Decision |
|---|---|
| 1 | **Separate tables** for admins and instructors. Admins do not own teaching resources; they impersonate when they need to act inside an instructor's data. |
| 2 | **Per-instructor API keys are the default.** Admins can grant `use_system_key=1` to specific instructors as an opt-in fallback to the env key. |
| 3 | **System defaults are read-only.** Built-in personas and rubric criteria stay; instructors can clone them but cannot edit the originals. Admins control prompts, models, and global settings. |
| 4 | **Multi-team membership.** Each resource has a single visibility (private / team / public). When team-shared, `resource_team_shares` lists which teams + their `access_level` (`view` or `edit`). |
| 5 | **Legacy data was assigned to a shadow instructor.** UUID `00000000-0000-0000-0000-000000000001`. Admins reassign to real instructors over time. |
| 6 | **TA permissions are granular flags** on `instructor_sections`: `can_manage_students`, `can_manage_cases`, `can_view_chats`. No implicit elevation. |
| 7 | **Global "current semester" stays**; each instructor's dashboard defaults to it but can be switched via header dropdown. |
| 8 | **Hard-block on missing API keys.** A student-facing endpoint returns 409 `INSTRUCTOR_SETUP_INCOMPLETE` if the section's primary instructor lacks keys for the configured models. |

## Migration timeline

| # | File | What it adds |
|---|---|---|
| 047 | `instructor_teams.sql` | `instructor_teams`, `instructor_team_members`, `instructor_team_invitations` |
| 048 | `resource_visibility.sql` | `visibility` ENUM on `cases`, `rubrics`, `rubric_criteria`; `resource_team_shares` table |
| 049 | `personas_ownership.sql` | Adds `created_by`, `created_by_type`, `is_system_default`, `visibility` to `personas`; marks 5 seeded personas as system defaults |
| 050 | `instructor_api_keys.sql` | `instructor_api_keys` table; adds `use_system_key`, `can_publish` to `instructors` |
| 051 | `settings_scoping.sql` | Adds `scope`, `scope_id` to `settings`; PK becomes `(setting_key, scope, scope_id)` |
| 052 | `audit_log_and_system_state.sql` | `audit_log` table (append-only); `system_state` singleton for CAS-safe current-semester writes |
| 053 | `shadow_instructor.sql` | Adds `is_system_account` to `instructors`; seeds shadow account |
| 054 | `case_writer_visibility.sql` | Adds `visibility`, `created_by_type` to `case_writer_projects` |
| 055 | `instructor_usage_cap.sql` | Adds `monthly_token_cap` to `instructors`; adds `instructor_id` to `llm_cache_metrics` |

Apply with `npm run migrate`. The runner tracks applied files in `schema_migrations`.

## One-time data backfill

`server/scripts/backfill-multi-instructor.js` claims legacy ownership of all teaching resources for a target instructor.

```bash
# Dry run (no writes)
node server/scripts/backfill-multi-instructor.js --dry-run

# Assign all legacy rows to a real instructor (their email)
node server/scripts/backfill-multi-instructor.js --email=founding@university.edu

# No --email → rows are assigned to the shadow instructor; admins reassign later
node server/scripts/backfill-multi-instructor.js
```

Idempotent: each UPDATE is guarded by `WHERE … IS NULL`. Re-running on already-claimed rows is a no-op.

## Component surface (frontend)

| File | What it does |
|---|---|
| `components/Dashboard.tsx` | Top-level shell. Renders the semester switcher, view-as picker (admins only), impersonation banner, and tab navigation. Tab visibility is driven by `hasAccess(user, …)`. |
| `components/InstructorManager.tsx` | Admin-only. Lists/creates/edits instructors with toggles for `use_system_key`, `can_publish`, and `monthly_token_cap`. |
| `components/TeamsManager.tsx` | Self-service team CRUD + invite/accept flow. |
| `components/ApiKeysManager.tsx` | Per-instructor key entry/rotate/remove. Plaintext never re-displayed; UI shows only the 4-char hint. |
| `components/ui/VisibilityPicker.tsx` | Reusable Private/Team/Public selector with team multi-select and `can_publish` gating. |
| `utils/permissions.ts` | `hasAccess(user, functionName)` — drives which tabs render in the dashboard. `BASE_FUNCTIONS` includes `personas`, `teams`, `apikeys`, `rubrics`; `SUPERUSER_FUNCTIONS` includes `prompts`, `models`, `settings`, `instructors`. |
| `utils/personas.ts` | Client helpers for persona row actions (built-in vs custom), Allowed Personas parsing, and chat-options persona pickers. |
| `services/apiClient.ts` | Centralizes the `Authorization` header + `X-Act-As-Instructor` impersonation header + token refresh on focus. |

## Server surface

| File | Purpose |
|---|---|
| `server/middleware/auth.js` | JWT verify (12h TTL), role hydration, deactivated-instructor rejection. |
| `server/middleware/instructorAccess.js` | All `requireXxxAccess(…)` middleware factories. |
| `server/middleware/permissions.js` | `requirePermission(functionName)` legacy admin allowlist gate. |
| `server/services/resourceAccess.js` | `buildVisibilityScope`, `canAccessResource` — single source of truth for visibility reads. |
| `server/services/visibilityWrites.js` | `setVisibility` — enforces `can_publish`, rewrites `resource_team_shares`. |
| `server/services/keyResolver.js` | `resolveProviderKey` resolution order; section readiness helpers. |
| `server/services/encryption.js` | AES-256-GCM encrypt/decrypt; `keyHint` helper. |
| `server/services/usageGuard.js` | `assertWithinUsageCap` (A1: cap only when `use_system_key=1`). |
| `server/services/auditLog.js` | `writeAudit(req, {action, …})` — best-effort append to `audit_log`. |
| `server/routes/auth.js` | Login (dual-table), `/me`, `/refresh`. |
| `server/routes/instructors.js` | CRUD; impersonate token issuance; `GET /:id/usage`. |
| `server/routes/teams.js` | Team CRUD, invitations, membership. |
| `server/routes/apiKeys.js` | Per-instructor key CRUD; admin grant of `use_system_key`. |
| `server/routes/personas.js` | Persona CRUD, clone (`POST /:id/clone`), visibility; system-default PATCH returns 409. |
| `server/services/personaService.js` | `clonePersona`, `resolveAvailablePersonas` for student case lists. |
| `server/scripts/backfill-multi-instructor.js` | Legacy ownership claim. |

## Conventions

- **Resource visibility goes through `resourceAccess.js`.** Routes never write their own visibility `WHERE` clauses. If you add a new shared resource type, add it to `RESOURCE_CONFIG` in `resourceAccess.js` and use the helpers.
- **Audit any write that crosses tenants.** Impersonation start/end, `use_system_key` toggle, ownership transfer, visibility change, key creation/rotation. Use `writeAudit(req, {action, resourceType, resourceId, details})`.
- **Never log plaintext keys.** `encryption.js` is the only module that handles cleartext.
- **The `MTC_KEY_ENCRYPTION_SECRET` env var is unrecoverable if lost.** Document this in your deployment runbook. If it must rotate, plan to mass-invalidate keys and have instructors re-enter them.
- **Frontend `user.can_publish` / `user.use_system_key` come from `/auth/session`.** The dashboard reads them on mount and uses them to gate affordances (most visibly the Public option in `VisibilityPicker`). Any new instructor-scoped flag that the UI must see at startup needs to be added to the `/auth/session` payload in `server/routes/auth.js`, not just to the `instructors` row.
- **Permission changes need an end-to-end pass.** The verification artifact at `dev/2026-05-16-permissions-test-checklist.md` (driven by `.claude/perm-tests/run.mjs`) covers all five role contexts × the matrix in `multi-instructor-permissions.md`. Re-run it after touching middleware, route gates, `resourceAccess.js`, or `visibilityWrites.js`.
- **Admin sub-tab asterisks mark default admin-only tools.** Sub-tabs labeled with ` *` (Instructors, Settings, Models, Prompts) map to `SUPERUSER_FUNCTIONS`. Instructor-accessible admin-area tabs (Personas, API Keys, Teams) omit the asterisk. See `multi-instructor-personas.md` § Dashboard navigation.

## What's not in this implementation (deferred)

- **`is_shared` is still on the `cases` table** as a compat shim. Drop it in a future migration after a cycle of confidence in `visibility`.
- **Email / transactional notifications.** Team invites, key-validation failures, and usage-cap warnings are in-app only.
- **A read endpoint for `audit_log`.** The table is wired for writes; an admin viewer is a follow-up.
- **Per-instructor rate limits.** Decision was A1 (monthly token cap on system-key users) only. B (per-minute rate limit) was explicitly skipped.
- **Renaming `AdminUser` → `DashboardUser` in TS.** The `AdminUser` interface now covers instructors too (`role: 'admin' | 'instructor'`); rename is cosmetic and deferred.
