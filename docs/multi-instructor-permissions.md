# Multi-Instructor Permission Matrix

This is the canonical reference for "who can do what" across the four user types in MakeTheCase:

- **Admin (superuser)** — full system access. Holds the legacy global keys; can manage prompts/models/settings, mint instructors, set the current semester, and impersonate any instructor.
- **Admin (non-superuser)** — admins with a restricted `adminAccess` allowlist. Same legacy mental model; superuser ops blocked.
- **Primary Instructor** — owns a section via `sections.primary_instructor_id`. Full CRUD over their own teaching resources.
- **TA** — added to a section via `instructor_sections` with three granular permission flags. Owns nothing in the section by default; can act on it only where a flag is true.
- **Other Instructor** — any instructor account that has no relationship to the resource in question (not the owner, not a team member, not a TA). Sees only what the owner has shared publicly or via a team they belong to.

> **Resource visibility** (Private/Team/Public) is independent of role. See `multi-instructor-visibility.md` for how it composes with the matrix below.

## Matrix

| Action | Admin (super) | Admin (non-super) | Primary Instr. | TA (granular) | Other Instr. |
|---|---|---|---|---|---|
| **Semesters & courses** |
| List semesters | ✓ | ✓ | ✓ (read) | ✓ (read) | ✓ (read) |
| Create semester | ✓ | ✗ (superuser only) | ✗ | ✗ | ✗ |
| Set current semester | ✓ | ✗ (superuser only) | ✗ | ✗ | ✗ |
| Create course | ✓ | ✗ | ✗ (via impersonate) | ✗ | ✗ |
| Assign primary instructor | ✓ | ✗ | ✗ | ✗ | ✗ |
| **Sections** |
| Create section in own course | ✓ | ✗ | ✓ | ✗ | ✗ |
| List sections | all | all | own + TA assignments | TA assignments | none |
| Delete section | ✓ | ✗ | ✓ (own) | ✗ (even with `can_manage_cases`) | ✗ |
| Add/remove TA on own section | ✓ | ✗ | ✓ | ✗ | ✗ |
| Edit section settings (chat_model, super_model) | ✓ | ✗ | ✓ | ✗ | ✗ |
| **Students within a section** |
| Enroll/remove students | ✓ | ✓ | ✓ | if `can_manage_students` | ✗ |
| View roster | ✓ | ✓ | ✓ | ✓ (always for TAs) | ✗ |
| **Chats & evaluations** |
| View student chats / results | ✓ | ✓ | ✓ | if `can_view_chats` | ✗ |
| Edit a chat transcript | ✓ | ✗ | ✓ | ✗ | ✗ |
| Run / re-run evaluation | ✓ | ✓ | ✓ | if `can_view_chats` | ✗ |
| **Section-case assignment** |
| Assign case to section | ✓ | ✓ | ✓ | if `can_manage_cases` | ✗ |
| Edit chat options on assignment | ✓ | ✓ | ✓ | if `can_manage_cases` | ✗ |
| **Cases (resource ownership)** |
| Create case | ✗ (admins don't own) | ✗ | ✓ | ✓ | ✓ |
| Read own case | n/a | n/a | ✓ | ✓ | ✓ |
| Read public case | ✓ | ✓ | ✓ | ✓ | ✓ |
| Read team-shared case | ✓ | ✓ | if team member | if team member | if team member |
| Edit own case | n/a | n/a | ✓ | ✓ | ✓ |
| Edit team-shared case | n/a | n/a | only if `access_level=edit` on the share | only if `access_level=edit` | only if `access_level=edit` |
| Delete own case | n/a | n/a | ✓ | ✓ | ✓ |
| Change visibility to **public** | ✓ | ✓ | only if `can_publish=1` | only if `can_publish=1` | only if `can_publish=1` |
| **Rubrics & rubric_criteria** |
| List rubrics | all (read) | all (read) | system defaults + own + team + public | same as primary | same as primary |
| Create rubric | ✗ | ✗ | ✓ | ✓ | ✓ |
| Edit system-default rubric | superuser only | ✗ | ✗ | ✗ | ✗ |
| Clone system or team rubric | n/a (read-only) | n/a | ✓ (`POST /rubrics/:id/clone`) | ✓ | ✓ |
| Edit criterion referenced by own rubric | superuser if system | ✗ | ✓ if owned; otherwise must clone first (409) | same | same |
| **Personas** |
| List personas | all (read) | all (read) | system defaults + own + team + public | same | same |
| Edit system-default persona | superuser only | ✗ | ✗ | ✗ | ✗ |
| Clone system or custom persona | n/a | n/a | ✓ (`POST /personas/:id/clone`) | ✓ | ✓ |
| Create persona | ✗ | ✗ | ✓ | ✓ | ✓ |
| **Case Writer projects** |
| Create project | ✗ | ✗ | ✓ | ✓ | ✓ |
| Edit team-shared project | n/a | n/a | only if `access_level=edit` | only if `access_level=edit` | only if `access_level=edit` |
| **API keys** |
| Set own provider key | n/a (admins use env keys) | n/a | ✓ | ✓ | ✓ |
| Grant `use_system_key=1` to any instructor | ✓ | ✗ | ✗ | ✗ | ✗ |
| Set `monthly_token_cap` on instructor | ✓ | ✗ | ✗ | ✗ | ✗ |
| **Teams** |
| Create team | ✓ | ✓ | ✓ | ✓ | ✓ |
| Invite member to team | team owner or editor | same | same | same | same |
| Accept invitation | the invitee | the invitee | the invitee | the invitee | the invitee |
| **Admin-only tools** |
| Manage prompts, models, settings | ✓ | only with explicit `adminAccess` entry | ✗ | ✗ | ✗ |
| Create instructor | ✓ | ✗ | ✗ | ✗ | ✗ |
| Impersonate (act as) another instructor | ✓ | ✓ | ✗ | ✗ | ✗ |
| Transfer ownership of resources | ✓ | ✗ | ✗ | ✗ | ✗ |

## Notes & invariants

- **Admins do not own teaching resources.** When the matrix says an admin "can create" a case or section, that action is performed under an instructor identity (either via impersonation or via a direct admin endpoint that requires a `target_instructor_id`).
- **TA permissions are pure granular flags** stored on `instructor_sections`. There is no implicit elevation: a TA without `can_manage_cases` cannot reassign cases even if they are listed on the section.
- **Visibility = "what they can see"; role = "what they can do."** The two compose. Example: an instructor with `can_publish=0` cannot *change* visibility to public, but they can still *use* a public case made by someone else.
- **Co-editors on a team-shared resource** (`access_level=edit`) may save the item with its existing visibility, including `public` — even if they personally lack `can_publish`. The `can_publish` check fires only when *transitioning* to public, not on every save.
- **Revocation does not auto-demote** existing public items. If an admin removes `can_publish` from instructor A, A's previously-published items remain public until an admin explicitly demotes them.
- **Impersonation actions are double-attributed.** Any write performed by an admin under impersonation logs `actor_admin_id` AND `acted_as_instructor_id` in `audit_log`. See `multi-instructor-impersonation.md`.
- **Semesters sub-tab is read-only for everyone except superuser admins.** Primary instructors and TAs see the Courses → Semesters tab and the list of semesters (the matrix grants them read access), but the New Semester button and the per-row action cluster (Instructors, Set as Current, Clone, Edit, Delete) are hidden unless `user.role === 'admin' && user.superuser`. Non-superuser admins also see the list without action buttons — this matches the server, which gates every mutating `/api/semesters` endpoint with `requireRole(['admin'])` + `requireSuperuser`. Hiding buttons that the API would reject avoids 403s on click. Enforced in `components/Dashboard.tsx` (`renderSemestersTab`, `canEditSemesters`).
- **Personas is instructor-accessible under Setup.** Personas, API Keys, and Teams live under a dedicated **Setup** primary tab (visible to all instructors and admins). Instructors reach Personas via `hasAccess(user, 'personas')` (`BASE_FUNCTIONS`). Built-in personas remain read-only except for superuser; instructors use **Clone** for editable copies. Chat-option **Allowed Personas** (blank = all enabled) is documented in `multi-instructor-personas.md`.
- **Teams workflow (invite / accept).** The matrix above lists who may invite or accept; step-by-step UI flow, in-app-only notifications, and API routes are in **`multi-instructor-teams.md`**.

## Enforcement locations

| Layer | File | What it enforces |
|---|---|---|
| JWT verify | `server/middleware/auth.js` | Token validity, 12h TTL, deactivated-instructor rejection |
| Role gates | `server/middleware/instructorAccess.js` | `requireSuperuser`, `requireAdminOrInstructor`, `requireSectionAccess`, `requireResourceAccess` |
| Permission lookup | `server/middleware/permissions.js` | `requirePermission(functionName)` for the legacy `adminAccess` allowlist |
| Resource visibility | `server/services/resourceAccess.js` | `buildVisibilityScope`, `canAccessResource` |
| Resource writes | `server/services/visibilityWrites.js` | `setVisibility` (enforces `can_publish`, normalizes team_ids) |
| Section field gates | `server/routes/sections.js` | `PATCH /:id` blocks non-admin/non-primary edits of `chat_model`, `super_model`, `course_id` (TAs with `can_manage_cases` can edit other fields but not these) |
| Chat scoping | `server/routes/caseChats.js` | `getChatViewableSectionIds(req)` scopes `GET /case-chats` and `POST /case-chats/mark-abandoned` for instructors to sections where they are primary or have `can_view_chats=1`; admins not impersonating see everything |
| Key resolution | `server/services/keyResolver.js` | `resolveProviderKey` (env key vs. per-instructor key vs. error) |
| Usage cap | `server/services/usageGuard.js` | `assertWithinUsageCap` (only when `use_system_key=1`) |
| Client tab gating | `utils/permissions.ts` | `hasAccess(user, functionName)` — drives Dashboard tab visibility |
| Client per-tab gating | `components/Dashboard.tsx` | Inline `user.superuser` checks for mutation controls inside otherwise-readable tabs (e.g. `renderSemestersTab.canEditSemesters`). Primary tabs: **Setup** gated by `hasSetupAccess()` (Personas / API Keys / Teams — all in `BASE_FUNCTIONS`); **Admin** gated by `hasAdminAccess()` (Instructors / Settings / Models / Prompts / Admins / Logging / Shadow-Owned — all `SUPERUSER_FUNCTIONS`). |
| Persona resolution (students) | `server/services/personaService.js` | `resolveAvailablePersonas`, `clonePersona`; used by `sectionCases.js` and `personas.js` |
| Audit | `server/services/auditLog.js` | `writeAudit(req, …)` writes append-only rows to `audit_log` |

## Verification

End-to-end verification of this matrix lives in **`dev/2026-05-16-permissions-test-checklist.md`**. It exercises every `[A]` row (~70 API calls across all five role contexts) via a scripted harness, plus `[M]` rows that require human eyes on the UI.

- **Harness:** `.claude/perm-tests/run.mjs` — drives login + per-role probes against `http://localhost:3001/api`. Credentials for the six test accounts are cached in `.claude/permissions-test-credentials.json` during a run.
- **Fixtures:** § 0 of the checklist creates 2 admins (`super`, `nonsuper`) and 4 instructors (`primary`, `ta`, `other`, `teammate`) plus a semester/course/section/team. § 8 cleans them up (deactivate instructors, hard-delete admins, drop test-owned rows).
- **Failures uncovered during the 2026-05-16 pass** were captured in the checklist's `## Failures` section and fixed in-place — chiefly: TA `chat_model` PATCH (now field-gated in `sections.js`), instructor 403s on `/case-chats` (now scoped in `caseChats.js`), and impersonation reload logout (resilience fix in `apiClient.getSession`).

If you add a new role-gated route, extend `run.mjs` with a probe in the appropriate section and re-run end-to-end before merging.
