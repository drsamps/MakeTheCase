# Semesters, Courses, Sections, and Case Settings Versions

*2026-09-12. Migrations 077 and 078. Modeled on Quizzer's semesters/course catalog design.*

## The hierarchy

| Level | Table | Key | Example |
|---|---|---|---|
| Semester | `semesters` | `semester_code` (plus INT `id`) | `f26` — Fall 2026 |
| Course | `courses` | `course_code` (plus INT `id`) | `gscm410` — GSCM 410 - Ops Mgt |
| Section | `sections` | `section_id` | `f26-gscm410-2` |

- **Courses do not belong to a semester.** A course is one row across all semesters.
  "GSCM 410 in Fall 2026" (the *offering*) is simply the course's sections whose
  `sections.semester_id` is Fall 2026. There is no offering table.
- `courses.semester_id` is **deprecated and read by nothing** (kept NULLable by 077; drop in a
  later migration). Never join it.
- `courses.primary_instructor_id` is the **course owner**: controls the course's case list,
  versions and bulk scheduling — in every semester. **Course structure is admin-only**: creating,
  moving (course / semester / number), removing, adopting or deleting sections, and rollover.
  See [Who does what](#who-does-what).
- `sections.semester_id` + `sections.section_number` carry the truth about a section.
  `sections.year_term` is a display copy of the semester name, rewritten on section
  create/update and on semester rename.

## IDs: minted from columns, never parsed at runtime

`utils/academicIds.js` is the single implementation, imported by both the server (to mint and
validate) and the dashboard (to preview). Assertions: `node server/scripts/check-academic-ids.js`.

```
semester_code   tyy: w26 sp26 su26 f26   (non-conforming allowed: 'ongoing')   <= 10 chars
course_code     lowercase [a-z0-9_], new codes <= 12 chars                     'gscm410'
section_id      {semester_code}-{course_code}-{section_number}                  <= 20 chars
section title   "{course_name} - Sec {n}"   (default; editable)
```

- Hyphens separate the parts, so no part may contain one.
- The section number is always included, even for section 1.
- **Existing section IDs were not renamed** (`GSCM401-1-F25`, `w26-adv-ops-emba`). 077
  backfilled `semester_id` and, where a trailing `-<n>-` was present, `section_number`.
  Code that needs a section's semester, course or number reads the columns.
- A course code change does not rename existing sections; only new sections use the new code.

## Semesters sort by start date, never by code or name

Chronological order is w26 < sp26 < su26 < f26, but alphabetically f26 comes first. Every list
orders by `semesters.start_date DESC` with undated semesters last (`SEMESTER_ORDER_SQL` in
`server/routes/semesters.js`, `sortSemesters()` in `utils/academicIds.js`). 077 seeded
approximate start dates for recognised codes (w Jan 1, sp Apr 25, su Jun 20, f Sep 1) — admins
should enter real dates, because **rollover shifts case dates by the difference between start
dates**.

The current semester lives in `system_state.current_semester_id` (FK, ON DELETE SET NULL).
`semesters.is_current` is a mirror; `setCurrentSemester()` in `semesters.js` is the only writer
of both. (Before 077, creating a semester with "Set as current" wrote only the flag and
`GET /api/semesters/current` answered 404.)

## Creating sections

`server/services/sectionProvisioning.js#createCourseSection` is the one creator for sections of
a course, used by `POST /api/courses/:id/sections`, `POST /api/sections` (with `course_id`), and
rollover:

- `section_number` defaults to `MAX + 1` for the course in that semester
  (`GET /api/courses/:id/next-section?semester_id=` previews it)
- `section_id` is minted unless explicitly overridden
- the primary instructor defaults to the course owner
- **the new section gets a row for every course case**, inactive, following that case's Main

Dashboard: `components/courses/SectionFormModal.tsx` (Semester → Course → Section # → minted ID
preview → title with an edit latch → models → instructor; "Save & add another").

## Who does what

Admins (any admin, `requireRole(['admin'])`) own **structure**; instructors own **teaching**.

| Action | Admin | Course owner | Section primary instructor | TA |
|---|---|---|---|---|
| Create / delete a course | ✓ | ✗ | ✗ | ✗ |
| Create a section (`POST /api/sections`, `POST /api/courses/:id/sections`, Duplicate) | ✓ | ✗ | ✗ | ✗ |
| Move a section: `course_id`, `semester_id`, `section_number` (`PATCH /api/sections/:id`) | ✓ | ✗ | ✗ | ✗ |
| Remove / adopt a section (`DELETE`/`PUT /api/courses/:id/sections/:sid[/assign]`) | ✓ | ✗ | ✗ | ✗ |
| Delete a section (`DELETE /api/sections/:id`) | ✓ | ✗ | ✗ | ✗ |
| Roll over a course or semester | ✓ | ✗ | ✗ | ✗ |
| Section title, enabled, accept new students, enrollment key | ✓ | ✓ | ✓ | ✓ (with section access) |
| Section chat / supervisor model | ✓ | ✓ | ✓ | ✗ |
| Course case list and versions | ✓ | ✓ | ✗ | ✗ |
| Bulk scheduling | ✓ | ✓ | own sections only | ✗ |
| Assignments on a section (`sectionCases.js`, section chat-options defaults) | ✓ | ✓ | ✓ | if `can_manage_cases` |

"Course owner" and "section primary instructor" both count as primary for a section in
`requireSectionAccess`, as does an instructor assigned to the section's semester. A primary
instructor who edits a setting the section follows from a course version gets the "Customize this
section?" prompt; re-following a version stays with the owner or an admin. Global chat-options
defaults and "copy to all sections" stay admin-only. Rationale and verification:
`docs/plan-admin-only-course-structure.md`.

## Case settings versions (migration 078)

```
course_cases                     the course's case list
course_case_versions             settings for one case on one course
   is_main = 1, semester_id NULL   "Main" — exactly one per course case
   is_main NULL, semester_id = N   a semester copy, shared by some of that semester's sections
course_case_version_scenarios    mirror of section_case_scenarios
course_case_version_positions    mirror of section_case_positions
section_cases.version_id         which version the row follows; NULL = "Customized"
```

Settings owned by a version: `chat_options`, `selection_mode`, `require_order`, `use_scenarios`,
`position_tracking_enabled`, `position_capture_method`, `track_position_change`, `rubric_id`,
plus the scenario and position rows. **Scheduling (`active`, `open_date`, `close_date`,
`manual_status`) is always per section.**

### Live inheritance is write-through

Editing a version copies its settings into every linked `section_cases` row, and replaces their
scenario/position rows, in the same transaction (`applyVersion()` in
`server/services/caseVersionSync.js`). Chat-time readers of `section_cases` (llm.js,
caseChats.js, keyResolver.js, analytics …) do not know versions exist.

⚠ **The rule that keeps this honest: every writer of section-level settings honours
`version_id`.** Guarded routes answer `409 CASE_FOLLOWS_VERSION` unless called with `?detach=1`,
which makes the row Customized first:

- `sectionCases.js`: `options`, `rubric`, `selection-mode`, `position-settings`,
  `scenarios` (POST/DELETE/toggle/reorder), `positions` (toggle/reorder) — via
  `guardFollowedCaseSettings`
- `chatOptions.js` `bulk-copy` skips linked rows and reports how many

On the client every such write goes through `fetchSectionCaseSetting()`
(`services/sectionCaseSettings.ts`), which turns the 409 into "Customize this section?" and
retries with `?detach=1`. **Add a new settings writer → add the guard and use the helper.**

Other links that must stay consistent:

- a section moved to another course or semester: `detachMismatchedLinks()` (called from
  `PATCH /api/sections/:id` and course unassign)
- a case assigned directly to a section of a course that lists that case follows Main
  (unless `chat_options` were supplied)
- `linkSectionToVersion()` refuses a semester copy for a section in a different semester

### Routes (`server/routes/courseCases.js`)

| Route | Who |
|---|---|
| `GET /api/courses/:id/cases` — case list, versions, followers, Customized sections | course access |
| `POST /api/courses/:id/cases` `{case_id, from_section_id?, section_ids?}` | admin / owner |
| `DELETE /api/courses/:id/cases/:caseId` (rows become Customized) | admin / owner |
| `GET /api/case-versions/:id[/scenarios\|/positions]` | course access |
| `PATCH /api/case-versions/:id/{options,rubric,selection-mode,position-settings}` and scenario/position writes — same bodies as the section routes | admin / owner |
| `POST /api/case-versions/:id/clone` `{semester_id, label, section_ids}` | admin / owner |
| `DELETE /api/case-versions/:id` (copies only) | admin / owner |
| `PUT /api/sections/:sid/cases/:caseId/version` `{version_id \| null}` | admin / owner |
| `POST /api/courses/:id/schedule` — bulk dates, per-section offsets | admin / owner / primary instructor of every target |
| `POST /api/courses/:id/rollover` | admin |

Dashboard: `components/courses/CourseCatalog.tsx` → `CourseCasesPanel.tsx`
(`CaseVersionEditor.tsx`, "Who follows what", semester copies), `ScheduleCasesModal.tsx`,
`RolloverModal.tsx`. The Assignments tab shows a "Follows: …" / "Customized" chip per case.

## Rollover

`server/services/courseRollover.js` — `planRollover()` (writes nothing) and `executeRollover()`.
Course: `POST /api/courses/:id/rollover`; whole semester: `POST /api/semesters/:id/rollover`
(admin; all courses in one transaction). The dashboard requires a current preview before the
button enables.

| Copied | Not copied |
|---|---|
| sections under minted IDs, same section number | students, chats |
| title (re-derived if it was the default) | enrollment keys; `accept_new_students` starts 0 |
| models, primary instructor, enabled | TAs (unless `copy_tas`) |
| case assignments, inactive, `manual_status = 'auto'` | |
| dates shifted by `to.start_date − from.start_date` (cleared if either is missing) | |
| Main links; each semester copy cloned once into the target semester; Customized rows | |

- **Safe to run twice:** a source whose (course, target semester, number) exists is `exists`
  and skipped.
- A legacy section with no `section_number` is `needs_number` until one is supplied.
- Per-section problems (an ID that can't be minted or is too long) are reported in the preview,
  not raised part-way through.
- **Back up first:** the modal's "Take a database backup first" (on by default) sends
  `backup_first: true`; on execute the route takes a `pre-rollover` database backup before the
  transaction and refuses the rollover if it fails. See `docs/database-backup.md`.

## Dashboard Semester selector

The header "Semester:" dropdown filters the whole dashboard (`components/courses/semesterFilter.tsx`).

- **Filtered:** Courses > Sections (grouped by course only when one semester is chosen; the
  synthetic "Not in a course" / "Other course sections" rows only under All), Students ("All
  sections" = students in that semester's sections; "Unassigned" only under All), Assignments and
  Chat Options section pickers, Monitor > Chats and Live, Results (Student Results, Position
  Analytics, Section Results), Home.
- **Not filtered:** Courses > Courses, Semesters, the Assignments "Copy case assignments from"
  list (grouped by semester instead), Content, Setup, Admin.
- A picked section that falls outside the chosen semester is cleared.
- With "all sections" and one semester chosen, the dashboard sends `semester_id` to
  `GET /api/case-chats`, `GET /api/analytics/results` and `GET /api/analytics/positions*`. It only
  narrows; `getAccessibleSectionIds` scoping is applied first.
- The choice lasts for the browser session (`sessionStorage['mtc_semester_filter']`). A new
  session starts on the current semester; an explicit "All semesters" is stored and does not snap
  back. A stored semester that no longer exists falls back to All.
- New sections (SectionFormModal) default to the chosen semester.

## Dates

`section_cases.open_date/close_date` are DATETIME. The dashboard sends ISO strings; strict MySQL
rejects `'…Z'` for DATETIME, so routes convert with `parseDateInput()`
(`server/utils/dateInput.js`), and mysql2 writes/reads them in the server's local time zone.
The per-section scheduling route had been failing with "Incorrect datetime value" before this
fix.

## Deliberately not done

- Dropping `courses.semester_id` (read by nothing; drop in a follow-up migration).
- Renaming legacy section IDs (no rename endpoint; the columns make them behave like minted ones).
- A per-semester course title or owner (no offering table, by decision).
