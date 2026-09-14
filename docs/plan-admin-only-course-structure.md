# Plan: courses, sections and rollover become admin-only

Status: **implemented** (2026-09-12). Decisions are recorded under [Decisions (resolved)](#decisions-resolved);
the "What instructors can do today" table describes the state *before* this change.

## Found during review: instructors could not make Assignments

All 17 write routes in `server/routes/sectionCases.js` (and the section-scoped writes in
`chatOptions.js`) still carried `requireRole(['admin'])` from before multi-instructor support, so an
instructor login got 403 on assign, activate, chat options, rubric, scheduling, scenarios, positions and
copy-from — contradicting `docs/multi-instructor-permissions.md`. It went unnoticed because every
"assign case" row in `dev/2026-05-16-permissions-test-checklist.md` was deferred. Fixed as part of this
change (Phase 1), per the matrix: admins, the section's primary instructor, and TAs with
`can_manage_cases`.

## Goal

Instructors (JWT `role: 'instructor'`) can no longer create, move, remove or roll over course
structure. Only admins (`role: 'admin'`) can. Instructors keep teaching their sections.

## What instructors can do today

Admin-only already: create/edit/delete a **course** (`courses.js` POST/PUT/DELETE), `POST /api/sections`,
whole-semester rollover (`semesters.js:315`), semesters CRUD (superuser), and every section-level
case settings route in `sectionCases.js` (`requireRole(['admin'])`).

Reachable by instructors today:

| Route | Who | File |
|---|---|---|
| `POST /api/courses/:id/sections` (new section) | course owner | `courses.js:392` |
| `DELETE /api/courses/:id/sections/:sectionId` (remove from course) | course owner | `courses.js:432` |
| `PUT /api/courses/:id/sections/:sectionId/assign` (adopt orphan) | course owner | `courses.js:463` |
| `POST /api/courses/:id/rollover` (+ `backup_first`) | course owner | `courseCases.js:343` |
| `PATCH /api/sections/:id` — `course_id`, `semester_id`, `section_number` | primary instructor | `sections.js:251` |
| `DELETE /api/sections/:id` (**deletes** the section) | primary instructor | `sections.js:409` |
| `POST`/`DELETE /api/courses/:id/cases` (course case list) | course owner | `courseCases.js:165,216` |
| Version edit / clone / delete, `PUT .../cases/:caseId/version` | course owner | `courseCases.js:473-737` |
| `POST /api/courses/:id/schedule` (bulk dates) | owner or primary of every section | `courseCases.js:246` |

Client entry points: `CourseCatalog.tsx` header **+ Add section** (shown to everyone, line 174),
per-course **+ Add section** / **Roll over…** (`canManageCourse`, line 243), `SectionFormModal.tsx`
non-admin path, and the Home quick action **New Section** (`DashboardHome.tsx:864`).

## Proposed change

### Server (the real gate)
1. `courses.js`: `requireCourseOwnerOrAdmin('id')` → `requireAdmin` on add section, remove section,
   assign orphan.
2. `courseCases.js`: same swap on `POST /courses/:id/rollover`.
3. `sections.js` `PATCH /:id`: `course_id`, `semester_id`, `section_number` become admin-only
   (today: admin or primary). `DELETE /:id`: admin-only.
4. Decisions below may add the course case list, versions and bulk scheduling to this list.

### Client (hide what the server refuses)
5. `CourseCatalog.tsx`: header and per-course **+ Add section** and **Roll over…** only when `isAdmin`;
   drop `canManageCourse` if nothing else uses it.
6. `SectionFormModal.tsx`: non-admins can no longer create; hide/disable Course and Semester
   fields when an instructor edits a section.
7. `DashboardHome.tsx`: hide **New Section** for instructors.
8. Sections tab: hide Delete for instructors.

### Docs
9. `docs/semesters-courses-sections.md` (lines 18-19, 130 table), `docs/INSTRUCTOR-management.md`
   (lines 109-148), `docs/database-backup.md:85` ("including instructor course owners"),
   CLAUDE.md Semesters section.

### Verification
10. Log in as an instructor who owns a course: each route above answers 403; buttons are gone.
    As admin: everything still works, including rollover with backup.

## Decisions (resolved)

| # | Question | Decision |
|---|---|---|
| 1 | Which admins gate structure | **Any admin** (`requireRole(['admin'])`) |
| 2 | Course case list + versions | **Keep for course owners** |
| 3 | Bulk scheduling | **Keep as today** (admin, owner, or primary of every target section) |
| 4 | Primary instructor section edits | **Keep** title/enabled/accept/key/models; course/semester/number admin-only |
| 5 | Backup pruning | **Prune separately**: 10 `pre-rollover` + 10 other |
| — | Assignments for instructors | **Fixed**: primary instructor and TA with `can_manage_cases` |
| — | A non-owner primary edits a setting followed from a course version | **Allowed with the "Customize this section?" prompt** (`?detach=1`); re-following stays owner/admin |

### What shipped

- **Server.** `instructorAccess.js`: `requireSectionCaseManager()`, `canManageSectionCases()`,
  `canViewSection()`. `sectionCases.js`: every write gated by those (before
  `guardFollowedCaseSettings`); assigning a case / setting a rubric also requires `view` on it;
  copy-from needs manage on target + view on source; live-session needs `can_view_chats`.
  `chatOptions.js`: section defaults and section bulk-copy for section managers; global default and
  `target: 'all'` admin-only. `courses.js` add/remove/adopt section, `courseCases.js` rollover,
  `sections.js` DELETE and the `course_id`/`semester_id`/`section_number` PATCH fields → admin-only.
  `databaseBackup.js` prunes per kind.
- **Client.** `CourseCatalog.tsx` (Add section ×3, Roll over…), `Dashboard.tsx` (Sections tab New
  Section and Duplicate, Home "new-section" navigation, Chat Options global/all-sections controls),
  `DashboardHome.tsx` (New Section quick action), `SectionFormModal.tsx` (no instructor create;
  Course/Semester/Number read-only for instructors), `BackupManager.tsx` retention copy. There was no
  section Delete button in the UI.
- **Verified** 2026-09-12 against the dev API with a 48-call probe (admin, course owner, section
  primary, TA with and without flags; fixtures created and removed), and a pruning run with seeded
  files. See the dev checklist.

### Not in this change

- `server/routes/scenarios.js` and `positionTemplates.js` writes are also `requireRole(['admin'])`, so
  `ScenarioManager` likely 403s for instructors on cases they own — same class of bug, Content area.

## Decisions as originally posed

1. **Which admins?** (a) any admin *(recommended — matches course create/delete today)*;
   (b) superusers only; (c) a new grantable admin permission `courses`, like `backups`.
2. **Course case list and versions** (Main + semester copies, which settings a section follows).
   (a) keep for course owners — these are teaching choices, not structure *(recommended)*;
   (b) admin-only too. Note: instructors already cannot edit section-level case settings
   (`sectionCases.js` is `requireRole(['admin'])`), so with (b) instructors edit no case settings at all.
3. **Bulk scheduling** (open/close dates across sections): keep for owners/primary instructors
   *(recommended — dates are per-section teaching work)*, or admin-only.
4. **Section edits by the primary instructor** other than course/semester/number
   (title, enabled, accept new students, enrollment key, chat/super model): keep as today
   *(recommended)*, or restrict models to admins as well.
5. **Backup pruning (review finding 1).** Once rollover is admin-only, an instructor can no longer push
   out an admin's backup, but an admin's rollover still can. (a) prune `pre-rollover` backups
   separately from manual ones, each keeping 10 *(recommended, small change in
   `databaseBackup.js`)*; (b) leave as is.
