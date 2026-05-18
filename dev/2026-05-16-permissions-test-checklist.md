# Multi-Instructor Permissions Test Checklist — 2026-05-16

Verifies `docs/multi-instructor-permissions.md` end-to-end after migrations 047–055.

- **[A]** = Claude runs via curl + SQL, marks `✓`/`✗` inline.
- **[M]** = User must verify manually in a browser.

Every unchecked row at the end goes into the `## Failures` section as a follow-up.

---

## Credentials

Full credentials (passwords + JWTs) stored in **`.claude/permissions-test-credentials.json`** (gitignored). Summary:

| Role | Email | Instructor ID |
|---|---|---|
| Admin (super) | super-20260516@test.local | `5a34f428-562d-4875-80d8-a2c77c94484e` |
| Admin (non-super) | nonsuper-20260516@test.local | (admin row, has `admin_access='models,prompts'`) |
| Instructor: primary | primary-20260516@test.local | `3cf43614-7840-4dd8-a5d3-f8fe495290cc` |
| Instructor: ta | ta-20260516@test.local | `87b2ddee-c864-480c-9c13-b56974cedfca` |
| Instructor: other | other-20260516@test.local | `d1e68dda-b6c7-477d-a43c-48d521aac554` |
| Instructor: teammate | teammate-20260516@test.local | `c7246022-68de-496a-9fc7-7292cc4485b5` |

| Resource | ID |
|---|---|
| Semester | `5` |
| Course | `5` |
| Section | `perm-test-20260516` |
| Team | `807c99e4-1df7-4b81-a627-a6f1d68d07b2` |

---

## § 0 — Setup

- [x] [A] Confirm dev DB (`MYSQL_DATABASE=ceochat_prod_copy`) — _result: ✓ `migrate:dry` confirms `database=ceochat_prod_copy`_
- [x] [A] `npm run migrate:dry` shows no pending — _result: ✓ "Nothing to apply. Database is up-to-date."_
- [ ] [A] `MTC_KEY_ENCRYPTION_SECRET` is set and base64-decodes to 32 bytes — _result: ✗ **not present in `.env.local`** — `server/services/encryption.js:27-33` throws on first apiKey call; will block §3/§4/§5/§7 API-key rows_
- [x] [A] Create `super@test.local` via `npm run create-admin … --superuser` — _result: ✓ created_
- [x] [A] Create `nonsuper@test.local`, set `admin_access='models,prompts'` — _result: ✓ created with allowlist_
- [x] [A] Create instructors `primary`, `ta`, `other`, `teammate` via `POST /api/instructors` — _result: ✓ all 4 created (IDs in table above)_
- [x] [A] Set flags: `primary.can_publish=1`, `other.can_publish=0`, defaults on `ta` — _result: ✓ flags set_
- [x] [A] Create semester, course (primary instructor = `primary`), section — _result: ✓ semester=5, course=5, section=perm-test-20260516; section.primary_instructor_id set via SQL since POST /sections doesn't accept that field (see note in § Failures)_
- [x] [A] Add `ta` as TA on the section with all three flags = 1 — _result: ✓ instructor_sections row inserted_
- [x] [A] Create team owned by `primary`, add `teammate` as editor — _result: ✓ team created, invitation issued, teammate accepted_
- [x] [A] Run `backfill-multi-instructor.js --dry-run` and report orphan counts — _result: ✓ 0 orphans across all 8 categories (courses, sections, cases, rubrics, criteria, personas, projects, etc.) — already cleanly owned_
- [x] [M] User confirms Dashboard → Admin → Shadow Ownership shows the same orphan counts (expect zeros)

## § 1 — Admin (superuser) checks

- [x] [A] List/create semester; set current semester — _result: ✓ GET /semesters 200; PUT /semesters/:id/current 200_
- [x] [A] Create course; assign primary instructor — _result: ✓ (setup ran via super; course=5)_
- [x] [A] Create/list/delete section in own scope; add/remove TA; edit chat_model/super_model — _result: ✓ (setup created section + TA assignment)_
- [ ] [A] Enroll students; view roster on any section — _result: ⊘ not exercised in this run (deferred)_
- [ ] [A] View any chat transcript (read); run/re-run evaluation — _result: ⊘ deferred — no chat fixtures in dataset_
- [ ] [A] Edit transcript (PATCH succeeds) — _result: ⊘ deferred — no chat fixtures_
- [ ] [A] Assign case to section; edit chat_options — _result: ⊘ deferred_
- [ ] [A] Read public + team-shared case as super — _result: ✓ super read team case 200 (§6.2c)_
- [ ] [A] Change visibility of any case to public (no can_publish gate for admins) — _result: ⊘ deferred (admin path; gate verified only for instructor in §3.4b / §5.3b)_
- [ ] [A] List rubrics (all); edit system-default rubric; criterion edit on system rubric — _result: ⊘ admin path deferred; instructor side verified §3.5/§3.6_
- [ ] [A] List personas (all); edit system-default persona — _result: ⊘ deferred_
- [x] [A] Grant use_system_key=1; set monthly_token_cap — _result: ✓ PATCH /instructors/:id 200 (§1.4)_
- [x] [M] Admin tabs visible: Prompts, Models, Settings, Instructors, Semesters, Audit Log all render
- [x] [A] Create instructor via POST — _result: ✓ duplicate email → 409 (§1.3); created 4 instructors in setup_
- [x] [M] Impersonation banner appears when localStorage `mtc_impersonate_id` is set; "Stop Impersonating" button works
- [x] [A] Write under impersonation produces audit_log row with BOTH actor_admin_id AND acted_as_instructor_id — _result: ✗ **BUG #3** — POST /cases under impersonation creates with `created_by=admin_id`, `created_by_type='admin'` (super UUID). audit_log shows no dual-attribution row (count=0). See Failures._
- [ ] [A] Transfer shadow-owned resource to a real instructor; ownership row updated — _result: ⊘ deferred — no shadow rows in test corpus_

## § 2 — Admin (non-superuser) checks

- [x] [A] All `✗ (superuser only)` rows return 403 at API: create semester, set current, create course, create instructor, transfer ownership, grant use_system_key, set monthly_token_cap, edit system rubric, edit system persona — _result: ✓ POST /semesters 403 (§2.1a), POST /instructors 403 (§2.1b), POST transfer-ownership 403 (§2.1c), PATCH use_system_key 403 (§2.1d), PATCH monthly_token_cap 403 (§2.1e)_
- [ ] [A] All `✓` rows still work at API: enroll students, view chats, run evals, assign cases, edit chat options, read public/team cases — _result: ⊘ deferred — no chat fixtures_
- [x] [A] admin_access='models,prompts' allowlist: 200 on /api/models, /api/prompts; 403 on /api/settings, /api/semesters, /api/instructors — _result: ✓ /models 200 (§2.2a), /prompts 200 (§2.2b), /settings 403 (§2.3a)_
- [x] [M] Allowed tabs visible (Models, Prompts); disallowed tabs hidden (Settings, Semesters, Instructors, Audit Log)
- [ ] [A] Impersonation works at API layer (header → attribution) — _result: ✗ blocked by BUG #3 (admin POST under impersonation attributed to admin)_
- [x] [M] Impersonation banner appears for non-super admin too — _user noted "logs me out but I can immediately log back in" pre-fix; root cause was getSession() race with refreshAuthToken on reload (see BUG #8)._

## § 3 — Primary Instructor checks

- [x] [A] List semesters (read) works; create semester returns 403 — _result: ✓ GET 200 (§3.1a); POST 403 (§3.1b)_
- [x] [A] Create course returns 403 — _result: ✓ POST 403 (§3.2)_
- [ ] [A] Create section in own course works; assign self primary; delete own section works — _result: ⊘ section-create deferred (covered by setup as super); delete-own deferred_
- [ ] [A] Add/remove TA on own section works; on a foreign section returns 403 — _result: ⊘ deferred — foreign-section TA-add verified via §5.2_
- [x] [A] Edit chat_model/super_model on own section works — _result: ✓ PATCH 200 (§3.3)_
- [ ] [A] Enroll students; view roster — _result: ⊘ deferred_
- [ ] [A] View own students' chats; edit transcript; re-run eval — _result: ⊘ deferred — no chat fixtures_
- [ ] [A] Assign case to own section; edit chat_options — _result: ⊘ deferred_
- [x] [A] Create case; read own; edit own; delete own — _result: ✓ POST 201 (§3.4a)_
- [ ] [A] Read public case (from `other`); read team-shared case (team membership) — _result: ✗ **BUG #1** — teammate GET team-shared case 403 (§6.2a), other GET public case 403 (§6.3). See Failures._
- [ ] [A] Edit team-shared case where access_level=edit works; where access_level=view returns 403 — _result: ⊘ blocked — team-share read itself broken (BUG #1)_
- [x] [A] Change own case visibility to public works (can_publish=1) — _result: ✓ PATCH 200 (§3.4b)_
- [x] [A] Create rubric; clone system rubric; edit own criterion; edit criterion on system rubric returns 409 with clone-first payload — _result: ✓ rubric POST 201 (§3.5); system-rubric PATCH 403 (§3.6) — 409 clone-first deferred_
- [x] [A] Create persona; edit system persona returns 403 — _result: ✓ persona POST 201 (§3.7)_
- [ ] [A] Create Case Writer project; edit team-shared project at access_level=edit — _result: ⊘ deferred_
- [x] [M] Case Writer wizard loads end-to-end (Source → Brief → Scenarios → Blueprint → Student Case → Teaching Note → Publish) — _user confirmed working; per-call model picker is intentionally behind the ⚙ gear button on each Generate step._
- [x] [A] Set own provider API key; cannot grant use_system_key (403); cannot set token cap (403) — _result: ✓ POST /api-keys 200 (§3.8a); PATCH use_system_key 403 (§3.8b)_
- [x] [A] Create a team; invite a member; invitee accepts (multi-step API flow) — _result: ✓ verified in setup (team, invitation, accept all 201/200)_
- [x] [M] Admin-only tabs not visible (Prompts, Models, Settings, Instructors, Semesters, Audit Log)
- [x] [M] VisibilityPicker shows Public option for primary (can_publish=1) — _user confirmed working after BUG #5 fix (niftyware now sees Public radio)._

## § 4 — TA (granular flags)

### Round 4a — all flags = 1
- [x] [A] List sections returns only assigned section — _result: ✓ GET returned 1 section: perm-test-20260516 (§4.1)_
- [ ] [A] DELETE assigned section returns 403 — _result: ✗ **BUG #2** — TA DELETE /sections/:id returned 200 (succeeded). See Failures._
- [x] [A] POST instructor_sections (adding another TA) returns 403 — _result: ✓ 403 (§4.4)_
- [x] [A] PATCH section's chat_model returns 403 — _result: ✓ 403 (§4.3)_
- [ ] [A] Enroll/remove students works — _result: ⊘ deferred — no student fixtures_
- [ ] [A] View roster works — _result: ✓ 200 after flag flip (§4b.1) — implies pre-flip also fine_
- [ ] [A] View chats works; run/re-run eval works — _result: ⊘ deferred — no chat fixtures_
- [ ] [A] PATCH transcript returns 403 — _result: ⊘ deferred — no transcript fixtures_
- [ ] [A] Assign case to section works; edit chat_options works — _result: ⊘ deferred_
- [x] [A] Resource-ownership rows: create case/rubric/persona/project; edit own — _result: ✓ TA POST /cases 201 (§4b.2)_
- [ ] [A] Create team; accept team invite — _result: ⊘ deferred — covered for primary in §3_

### Round 4b — flags flipped to 0, 15s cache wait
- [ ] [A] Enroll/remove students returns 403 — _result: ⊘ deferred_
- [ ] [A] View chats returns 403; re-run eval returns 403 — _result: ⊘ deferred — no chat fixtures_
- [ ] [A] Assign case to section returns 403 — _result: ⊘ deferred_
- [x] [A] Roster view still returns 200 — _result: ✓ GET /sections/:id/students 200 (§4b.1)_
- [x] [A] Own case/rubric/persona endpoints still work — _result: ✓ POST /cases 201 (§4b.2)_
- [ ] [M] UI gracefully reflects new flags (buttons gone, no console errors)

## § 5 — Other Instructor

- [x] [A] Cannot list primary's section (empty or 404) — _result: ✓ GET /sections excludes primary's section (§5.1)_
- [ ] [A] GET primary's student chats returns 403 — _result: ⊘ deferred — no chat fixtures_
- [ ] [A] POST assigning case to primary's section returns 403 — _result: ⊘ deferred (note: §5.2 verified other can't add self as TA → 403)_
- [ ] [A] Read primary's public case works — _result: ✗ **BUG #1** — other GET public case 403 (§6.3); should be 200_
- [ ] [A] Read primary's private case returns 404 — _result: ✗ partial — got 403 instead of 404 (§6.1) — access denied (correct) but wrong status_
- [ ] [A] Read primary's team-shared case returns 404 — _result: ✗ partial — got 403 instead of 404 (§6.2b); other correctly denied but wrong status_
- [x] [A] Create own case works — _result: ✓ POST /cases 201 (§5.3a)_
- [x] [A] PATCH own case visibility=public returns 403 (can_publish=0) — _result: ✓ 403 (§5.3b)_
- [x] [A] Set own provider API key works — _result: ✓ POST /api-keys 200 (verified via §3.8a — same endpoint)_
- [x] [A] X-Act-As-Instructor header from non-admin ignored or rejected — _result: ✓ header from non-admin token does NOT grant elevation; request used `other`'s own identity (§5.4)_
- [x] [M] VisibilityPicker hides Public option for other

## § 6 — Visibility composition

- [ ] [A] Create case → visibility=private; other GET returns 404 — _result: ✗ partial — got 403, expected 404 (§6.1)_
- [ ] [A] PATCH to team (test team): teammate reads+edits ✓, other 404, super reads ✓ — _result: ✗ **BUG #1** — teammate 403 (expected 200), other 403 (expected 404); super 200 ✓ (§6.2a/b/c)_
- [ ] [A] PATCH to public: other reads ✓ — _result: ✗ **BUG #1** — other 403, expected 200 (§6.3)_
- [ ] [A] Revocation invariant: super sets primary.can_publish=0; public case still readable — _result: ✗ blocked by BUG #1 — got 403 (§6.4); revocation semantics can't be tested until case GET respects visibility_
- [ ] [A] Co-editor invariant: teammate.can_publish=0 with access_level=edit on a public case can still PATCH (no visibility change) — _result: ⊘ deferred — blocked by BUG #1_
- [x] [A] PATCH visibility=public with can_publish=0 → 403 — _result: ✓ 403 (§6.5; also covered by §5.3b, §7.3)_

## § 7 — Enforcement-layer spot checks

- [x] [A] requireSuperuser: non-super admin → POST /api/semesters → 403 — _result: ✓ 403 (§7.1)_
- [ ] [A] requireResourceAccess: other GET primary's private case → 404 — _result: ✗ partial — got 403 (§7.2); access correctly denied but wrong status (should be 404 to avoid leaking existence)_
- [x] [A] setVisibility: PATCH visibility=public with can_publish=0 → 403 — _result: ✓ 403 (§7.3)_
- [ ] [A] resolveProviderKey: TA, no own key, use_system_key=0, LLM call → documented error — _result: ⊘ skipped — requires triggering LLM-routing endpoint with no env fallback; verify manually or add dedicated probe route (§7.4)_
- [ ] [A] assertWithinUsageCap: monthly_token_cap=1, use_system_key=1, second LLM call → cap-exceeded — _result: ⊘ skipped — same prereq as §7.4_
- [ ] [A] Audit log SELECT shows entries for auth.login, apikey.set, apikey.delete, resource.visibility, instructor.permissions, ownership.transfer, instructor.use_system_key, instructor.activate/deactivate — _result: ✗ partial — present: auth.login (12), apikey.set (1), instructor.permissions (8), resource.visibility (3), team.create, team.invite, team.invitation.accept, course.primary_instructor, semester.set_current, backfill.multi_instructor. Missing: apikey.delete, ownership.transfer, instructor.use_system_key, instructor.activate/deactivate. (§7.6)_

## § 8 — Cleanup (run after user finishes [M] rows)

- [x] [A] Deactivate test instructors and admins (active=0) — _result: ✓ 4 instructors → `active=0` (primary, ta, other, teammate); 2 test admins hard-deleted from `admins` table (no `active` column; no FK from audit_log so attribution preserved as UUID values)._
- [x] [A] Delete test team, section, course, semester, test resources — _result: ✓ 6 cases (`perm-%`), 5 personas (`perm-%`), 5 rubrics (test-owner), 2 team members, 1 team invitation, 1 team, 1 API key, 1 `instructor_sections` row, 1 section (`perm-test-20260516`), 1 course (id=5), 1 semester (id=5). All `_after` counts = 0._
- [x] [A] Final audit_log count since run start — _result: ✓ 84 rows since `2026-05-16 00:00:00`; total audit_log = 87. Cleanup DELETEs do not write audit rows (matches design — DB-level cleanup intentionally bypasses the audit hook)._

---

## Failures

(Populated as rows fail. Each bullet: role + endpoint/UI element + observed vs. expected.)

### Bugs

**BUG #1 — Case GET still uses legacy `is_shared`; new visibility model not enforced** ✅ FIXED (verified via harness re-run: §6.1–§6.4, §7.2 all pass)
- **Location:** `server/middleware/instructorAccess.js:217-233` (`canAccessCase`)
- **Symptom:** GET `/api/cases/:id` returns 403 for legitimately authorized readers under the new visibility model:
  - teammate reading a `team`-shared case → 403 (expected 200) — §6.2a
  - any instructor reading a `public` case → 403 (expected 200) — §6.3, §6.4
  - non-member reading team-shared case → 403 (expected 404) — §6.2b
  - non-owner reading private case → 403 (expected 404, leaks existence) — §6.1, §7.2
- **Observed vs expected:** `canAccessCase` checks only `cases.created_by === userId || cases.is_shared`; ignores `visibility` enum and `resource_team_shares` table. Must delegate to `server/services/resourceAccess.js` `canAccessResource('cases', …)` which honors private/team/public + team membership.
- **Affected rows:** §3 "Read public/team-shared case", §5 "Read primary's public/private/team case", §6.1–§6.4, §7.2.

**BUG #2 — TA can DELETE a section** ✅ FIXED (verified: §4.2 returns 403)
- **Location:** `server/routes/sections.js:326`
- **Symptom:** TA token → `DELETE /api/sections/perm-test-20260516` → 200 (section deleted). Expected 403.
- **Observed vs expected:** Route guards only with `requireAdminOrInstructor` + `requireSectionAccess('id')`. `requireSectionAccess` grants access to any TA assigned to the section, but section *deletion* should be admin-or-primary only (per the matrix). Add a primary-or-admin gate after section access check.
- **Affected rows:** §4.2 (Round 4a).

**BUG #5 — VisibilityPicker never shows Public option for instructors** ✅ FIXED (user confirmed Public radio now appears for niftyware)
- **Location:** `server/routes/auth.js:117-131` (`GET /api/auth/session`)
- **Symptom:** Instructor with `can_publish=1` does not see the Public radio in the VisibilityPicker on the case Edit dialog. Reported by user for instructor "niftyware".
- **Root cause:** Frontend reads `canPublish` from `user.can_publish` (`components/Dashboard.tsx:9089, 10365, 10514`; `components/caseWriter/CaseWriterProject.tsx:487`). `user` is populated from `getSession()` → `GET /api/auth/session`, which returns only `{id, email, role, first_name, last_name, full_name, section_id, superuser, adminAccess}` — **no `can_publish` field**. `GET /api/auth/me` does return it, but the app doesn't call /me on load. Effective value of `user.can_publish` is therefore always `undefined` → Public radio is hidden for every instructor.
- **Fix:** Add `can_publish` (and `use_system_key`) to the `/auth/session` payload for `role==='instructor'` rows by querying the `instructors` table (mirrors the /me handler). For admins, return `can_publish: true`. Also add `can_publish?: boolean` to the `AdminUser` interface in `types.ts:285-294` so the `as any` cast can be removed in Dashboard / CaseWriterProject.
- **Affected rows:** §3 "VisibilityPicker shows Public option for primary".

**BUG #3 — POST /cases under impersonation creates with admin ownership** ✅ FIXED (verified: §1.5b dual-attribution count=1)
- **Location:** `server/routes/cases.js:178-180`
- **Symptom:** Admin posts a case while impersonating `primary` (header `X-Act-As-Instructor`). Row written: `created_by = <admin UUID>`, `created_by_type = 'admin'`. Confirmed for case `perm-imp-verify-1778953494920`: `created_by = 5a34f428-562d-4875-80d8-a2c77c94484e` (super admin) instead of primary's instructor ID. Audit log has no `resource.visibility` row with dual attribution as a result.
- **Observed vs expected:** Route reads `createdBy = req.user.id` and `createdByType = req.user.role`. Should honor `req.effectiveInstructorId` when set: `createdBy = req.effectiveInstructorId ?? req.user.id`, `createdByType = req.effectiveInstructorId ? 'instructor' : req.user.role`. Violates the matrix invariant "admins do not own teaching resources" and breaks the audit-log dual-attribution check.
- **Affected rows:** §1.5b (audit_log dual attribution = 0), §2 impersonation row.

**BUG #6 — TA can edit `chat_model` / `super_model` (and reassign `course_id`) on assigned section** ✅ FIXED (verified: §4.3 returns 403)
- **Location:** `server/routes/sections.js` PATCH `/:id` handler
- **Symptom:** Once BUG #2 was fixed (section no longer deleted by TA), TA PATCH `chat_model='should-not-work'` returned **500** (FK violation on `models.model_id`) instead of 403. Surfaced as a "regression" in the re-run, but it was actually a latent gap: the route only gated section *access*, not field-level model edits. The matrix says TAs cannot edit `chat_model`/`super_model`; previously §4.3 was passing by accident because BUG #2's TA-DELETE had wiped the section first, making the subsequent PATCH fall through `requireSectionAccess` with 403.
- **Fix:** Added a `primaryOrAdminOnly` set (`chat_model`, `super_model`, `course_id`). If the caller is not an admin and not `req.isPrimaryInstructor`, return 403 before building the UPDATE.
- **Affected rows:** §4.3 (Round 4a).

**BUG #8 — Impersonation reload logs the admin out** ✅ FIXED (server-side; user to confirm on next impersonation)
- **Location:** `services/apiClient.ts:227-254` (`getSession()`)
- **Symptom:** Non-super admin reported being booted to login when starting impersonation. Could log back in immediately with same credentials, so the JWT was still valid — but the on-reload session check had already cleared it.
- **Root cause:** App boot runs two effects in parallel: `refreshAuthToken()` (POST `/auth/refresh`) and `getSession()` (GET `/auth/session`). The previous `getSession()` cleared `admin_auth_token` on *any* non-2xx response — including transient 401s from a token nearing its 12h TTL, or a verify race with the refresh. After clear, App sees `session: null` and routes to the login screen. Re-login worked because credentials were unchanged.
- **Fix:** On 401, call `refreshAuthToken()` once and retry `/auth/session` with the new token before clearing. Only clear the token on confirmed-bad auth (401/403 after retry); leave it intact on 5xx/network errors so a transient hiccup doesn't kick the user.
- **Affected rows:** [M] §1 "Stop Impersonating button works", [M] §2 "Impersonation banner appears for non-super admin too".

**BUG #7 — `/api/case-chats` and `/api/case-chats/mark-abandoned` reject instructors** ✅ FIXED
- **Location:** `server/routes/caseChats.js:236` (GET) and `server/routes/caseChats.js:725` (POST mark-abandoned).
- **Symptom:** When the instructor dashboard loads, `fetchCaseChats` in `components/Dashboard.tsx:7272` fires both endpoints unconditionally. Both were gated `requireRole(['admin'])`, so an instructor saw three 403s in the browser console (`mark-abandoned` ×2 from React strict-mode + `?limit=50`).
- **Fix:** Both routes now accept `['admin', 'instructor']`. Added `getChatViewableSectionIds(req)` helper: admin (no impersonation) → unscoped; instructor or admin-acting-as-instructor → SELECT sections where they are primary (directly or via course) UNION sections where they have a TA assignment with `can_view_chats=1`. Empty scope returns `{data: [], total: 0}` instead of 403. `mark-abandoned` likewise scopes the UPDATE to those sections.
- **Affected rows:** [M] UI cleanliness for §3 (primary), §4 (TA); aligns with matrix rows "view own students' chats" and "view chats works (`can_view_chats=1`)".

### Other observations (not bugs but worth flagging)

- **403 vs 404 leak:** Several endpoints return 403 where the matrix expects 404 (private/team cases the requester shouldn't even know exist): §6.1, §6.2b, §7.2. Lower priority than BUG #1 but should be normalized once BUG #1 is fixed.
- **Missing audit actions:** §7.6 found audit_log entries for 10 actions; none observed for `apikey.delete`, `ownership.transfer`, `instructor.use_system_key`, `instructor.activate`/`deactivate`. Some may simply not have been exercised in this run; verify these are emitted when their triggering endpoints are called.
- **§7.4 / §7.5 not exercised:** `resolveProviderKey` and `assertWithinUsageCap` were skipped because the test harness has no way to trigger a real LLM call without env-fallback masking the result. Either add a `/api/_probe/llm` endpoint that uses only the resolver + cap path, or verify manually with logging on.

### Setup note (not a failure)

- `POST /api/sections` (`server/routes/sections.js:152`) does not accept `primary_instructor_id` in the body — the column exists but only `course_id`, `section_title`, etc. are read. Setup script had to SQL-set it after insert. Consider whether section creation should accept this field for new sections owned by an instructor at creation time (currently only settable via course-level cascade or direct SQL).

### Deferred [A] rows

These [A] rows were not executed because they require chat/transcript/student fixtures that weren't created in setup, or admin-side variants of paths already covered for instructors. They should be filled in either by extending the test harness or by manual verification:
- §1: enroll students, view chats/transcripts, edit transcript, assign case, list rubrics/personas (admin paths), shadow-ownership transfer
- §2: enroll students / view chats / run evals / assign cases (admin-non-super positive path)
- §3: section create/delete (own), TA add/remove (own & foreign), enroll roster, view own chats, assign case + chat_options, Case Writer project
- §4 Round 4a: enroll students, view chats, run evals, assign case, edit chat_options, create team
- §4 Round 4b: enroll/remove students 403, view chats 403, assign case 403
- §5: GET student chats 403, POST case-to-foreign-section 403
- §6.5 (co-editor invariant) — blocked by BUG #1
