# Plan: Close the unauthenticated student-data and AI routes

Status: **all phases built (2026-10-09/10), not yet deployed.** One gap remains: see [Not covered](#not-covered). Written 2026-09-15; revised 2026-10-09 against branch `teach-back` (`b2f29e7`).

- Done so far:
  - `GET /api/llm/case-data/:caseId` requires a login (`790a7bb`, 2026-10-02). That commit also locked the scenario and position reads, which are outside this plan.
  - Phase 1: the evaluation, transcript and case-chat reads require a staff login and are limited to the caller's sections.
  - Phase 2a: `/llm/chat` and `/evaluations/run` require a student token and the student's own chat; `/llm/eval` is gone; `server/scripts/dev-student-token.js` exists.
  - Phase 2b: every chat write requires the chat's owner (`server/middleware/chatOwner.js`), and the student comes from the token.
  - Phase 3a: the server builds the chat prompt; students no longer receive AI-only content (details in [`server-side-chat-prompt.md`](server-side-chat-prompt.md)).
  - Phase 3b: the server keeps the conversation (`chat_turns`, migration 082), grades its own copy, saves the evaluation itself and writes the transcript.
- Phase 3 is planned in its own doc, [`server-side-chat-prompt.md`](server-side-chat-prompt.md). This doc only gives its place in the order.

## Context

MakeTheCase's API gets a user's identity from a login token (JWT) checked by `verifyToken` in `server/middleware/auth.js`. The instructor dashboard's routes check it. Many of the routes the **student chat screen** uses do not, so they answer anyone who sends a request, with no login.

The checked-in production Apache config (`deployment/0002_443_makethecase.conf`) forwards `/makethecase/api` straight to Node with no login in front. If the live server matches that file, these routes are open to the whole internet, not just BYU.

**Intended outcome:**
1. Nobody can read student records without logging in (Phase 1).
2. Only a signed-in student can act on their own chats (Phase 2).
3. Content meant only for the AI (teaching notes, argument frameworks) never reaches the student's browser, and grades are built from the server's copy of the chat (Phase 3).

## The problem, in plain terms

Confirmed on the local dev server (a copy of production data) on 2026-09-14/15, with no login token. Re-checked in code on 2026-10-09: every row is still open except the case-data read.

| What anyone can do | How | Status 2026-10-09 |
|---|---|---|
| **Read every student's full chat transcript, with the student's name** | `GET /api/evaluations` lists every evaluation, including its `case_chat_id`. `GET /api/transcripts/chat/:caseChatId` then returns that transcript plus `student_name`. | **Open** |
| Read every evaluation: score, AI summary, criteria, student ID | `GET /api/evaluations`, `GET /api/evaluations/:id` | **Open** |
| Read any student's chat list by guessing their NetID | `GET /api/case-chats/student/cas:<netid>` | **Open** |
| Read any case's full text and its teaching note | `GET /api/llm/case-data/:caseId` | Login required (`790a7bb`). Any logged-in student can still read it; Phase 3 fixes that. |
| **Create an evaluation with any score** for any student, which also marks the chat completed | `POST /api/evaluations` | **Open** |
| Overwrite any chat's transcript, status or positions | `PUT /api/transcripts/chat/:id`, `PATCH /api/case-chats/:id/...` | **Open** |
| Use the AI as a free general-purpose chatbot, billed to an instructor | `POST /api/llm/chat` accepts any `systemPrompt` and a `studentId` and `caseId` from the body, which pick the billed instructor; `POST /api/evaluations/run`; `POST /api/llm/eval` | **Open** |

**Why each is a risk:**
- **Student privacy.** Transcripts, names and scores are student education records. At a U.S. university they are very likely covered by FERPA; BYU's privacy or compliance office can confirm. Exposing them publicly could require breach reporting, and it damages student trust. This is the most serious item.
- **Grade integrity.** A fake or changed evaluation looks exactly like a real one on the instructor's Results screen. Grades built on it can't be trusted.
- **Money and availability.** Anyone who finds the endpoint can run AI calls on an instructor's API keys. The weekly spending cap (`server/services/usageGuard.js`) limits the bill. But once someone uses it up, **real students are blocked** until Monday.
- **Teaching content.** Teaching notes may be licensed or proprietary, and they give away the answers. A logged-in student's browser still receives the teaching note, because the browser builds the AI prompt (Phase 3).

Note that UUID chat IDs don't protect anything: the open evaluations list hands them out.

## Before starting (all phases)

- **Check the live server,** read-only and without a login, from any machine:
  `curl -s -o /dev/null -w "%{http_code}\n" https://services.byu.edu/makethecase/api/evaluations`
  - `200` means production is exposed, so Phase 1 is urgent.
  - `401`/`403` means something in front of the app already blocks it. Still do the work, but it's less urgent.
- **Pick timing.** Phase 1 doesn't touch the student chat screen. Phases 2 and 3 do, so ship those when no assignment is due.
- **Line numbers below are from 2026-10-09.** Re-grep before editing; `App.tsx` moves often.

---

## Phase 1: Stop anonymous reading of student records (small, low risk)

**Effort:** about half a day including testing.
**Student-facing change:** none.
**Worst failure:** a dashboard screen shows no data. Nothing is lost, and reverting is easy.

### Server

1. **Share the access rule.** Move `getChatViewableSectionIds(req)` from `server/routes/caseChats.js:16` into `server/middleware/instructorAccess.js` and export it. It already encodes the right rule:
   - admins see everything (returns `null`, meaning no filter);
   - instructors see sections where they are primary or course owner;
   - TAs see sections where `instructor_sections.can_view_chats = 1`;
   - it honors admin "act as" impersonation.

   Import it back into `caseChats.js` (used at lines 275 and 788).
2. **Add `verifyToken, requireRole(['admin','instructor'])`** to these routes and limit instructors to their section IDs:
   - `server/routes/evaluations.js`:
     - `GET /` (line 40): evaluations have no `section_id`, so `JOIN case_chats cc ON cc.id = e.case_chat_id` and filter `cc.section_id IN (…)`. Keep the `student_id`/`student_ids`/`case_id` filters, qualified with `e.`.
     - `GET /:id` (line 558): return 404 when the evaluation's section is out of scope.
   - `server/routes/transcripts.js`: `GET /:id` (line 160), `GET /chat/:caseChatId` (line 195). Filter on the joined `cc.section_id`.
   - `server/routes/caseChats.js`: `GET /:id` (701), `GET /student/:studentId` (383), `GET /:id/positions` (1099), `GET /:id/should-infer` (1282). A grep on 2026-10-09 found no front-end callers of these (the only `case-chats/${id}` call in the dashboard is the admin DELETE); re-check before locking them down.
3. Follow the empty-scope pattern already at `caseChats.js:276` (return empty data, not an error).

**As built:** `instructorAccess.js` exports `getChatViewableSectionIds`, `isSectionInScope` and `canViewChat`. A record's section is `COALESCE(cc.section_id, st.section_id)`: the chat's section, else the student's enrolled section. Without the fallback, instructors would lose 99 Fall 2025 evaluations whose chats have no `section_id` and 10 evaluations with no case chat (dev copy, 2026-10-09). Admins without "act as" skip the joins and see everything as before.

### Client

4. **Evaluation tab.** `services/apiClient.ts` `isAdminContext()` (line 24): also treat `#evaluation/` as admin context. That tab is only opened from the dashboard (`components/Dashboard.tsx:7261`, `window.open('#evaluation/…')`). Then in `App.tsx:281` replace the bare `fetch(.../evaluations/${evaluationId})` with `api.get(...)` so the instructor's token is sent.
5. **No other client changes expected.** The other callers already use the `api` client, which sends the token:
   - `Dashboard.tsx` (section stats ~line 1240, student details)
   - `DashboardHome.tsx:122`
   - `Analytics.tsx` (evaluations at 627 and 697, transcripts at 543 and 685)

   After Phase 1, instructors' Home and Results counts include only their own sections. This is intended; today their browsers download everyone's evaluations.

### Verify Phase 1

- Without a token, each locked route returns 401. Use the same PowerShell `Invoke-WebRequest` checks used to find the problem, which report counts only.
- As an **admin:** Home, Courses → Sections student list, Results → Student Results (open a transcript and an evaluation), Monitor → Chats → "view evaluation" tab. All should show data as before.
- As an **instructor** with one section: the same screens show only that section.
- As a **TA** with and without `can_view_chats`: transcripts and evaluations appear or are hidden accordingly.
- Run a full **student chat** end to end and confirm nothing changed.
- `npx tsc --noEmit -p .` shows no new errors (baseline: 31, re-measured 2026-10-09).

---

## Phase 2: Require the student's login on the chat path (moderate, medium risk)

**Effort:** about a day.
**Student-facing change:** none if done right. A mistake blocks students mid-chat, so test the whole flow and ship at a quiet time.

Students always have a token, since they must sign in through CAS (`server/routes/cas.js:223` issues role `student`, with `id = 'cas:<netid>'` matching `students.id`). The server just isn't checking it, and the browser doesn't send it on most chat calls.

**Ship in two commits.** 2a is small and closes the second-biggest exposure (the open AI endpoint); 2b is the larger ownership work.

### Phase 2a: Log in to use the AI

1. `POST /api/llm/chat` (`server/routes/llm.js:344`):
   - add `verifyToken`;
   - for students, take `studentId` from `req.user.id`, not the body. It drives billing and scope in `resolveInstructorForStudentCase` / `resolveSectionForStudentCase`;
   - when `caseChatId` is sent, require ownership (inline check now, or the Phase 2b helper if 2b ships first).
2. `POST /api/evaluations/run` (`evaluations.js:136`): add `verifyToken`; require chat ownership when 2b lands.
3. **Remove `POST /api/llm/eval`** (`llm.js:406`). No callers as of 2026-10-09; grading goes through `/evaluations/run`. Re-grep first.
4. Client: export `getAuthHeaders()` from `services/apiClient.ts` (line 81; currently private) and add it to `services/llmService.ts` `/llm/chat` (line 60) and `/evaluations/run` (line 111).

Phase 3 still accepts `systemPrompt` from the browser after 2a, so a logged-in student can use the chat with a custom prompt within their instructor's cap. 2a stops anonymous use only.

**As built:** both routes take `requireRole(['student'])`. Staff never call them (the dashboard has no chat; staff reach the student screen through a CAS student login, which issues a student token), and a staff token would otherwise need its own billing rule. Ownership is checked now rather than waiting for 2b: `/llm/chat` 404s a `caseChatId` the student doesn't own, and `/evaluations/run` 404s a `case_chat_id` whose `student_id` isn't the caller. The body's `studentId` is ignored. The dev script below was added in 2a, since a student chat can't be tested without it.

### Phase 2b: Only the chat's owner can act on it

#### Server

1. **Ownership helper.** Add `requireChatOwner(paramName)` in `server/middleware/`:
   - Run `verifyToken`.
   - Load the `case_chats` row.
   - Allow a **student** only if `case_chats.student_id === req.user.id`.
   - Allow **staff** within `getChatViewableSectionIds` (from Phase 1).
   - Return 404 otherwise, so chat IDs can't be probed.
2. **Apply it:**
   - `server/routes/caseChats.js`: `PATCH /:id/activity`, `/:id/status`, `/:id/complete`, `/:id/position`, `/:id/initial-position`, `/:id/final-position`, `POST /:id/start-timer`, `GET /:id/time-remaining`.
   - `server/routes/transcripts.js`: `POST /` (line 13; owner from `case_chat_id` in the body), `PUT /chat/:caseChatId` (line 84).
3. **Use the token's identity, not IDs sent by the browser,** when the caller is a student:
   - `POST /api/case-chats` (`caseChats.js:36`): `student_id` comes from `req.user.id`. [`server-side-chat-prompt.md`](server-side-chat-prompt.md) step 4 relies on this.
   - `GET /api/case-chats/check-repeats/:studentId/:caseId`, `check-scenario-completion/:studentId/:caseId` and `GET /api/evaluations/check-completion/:studentId/:caseId`: require a login, and reject a student whose `:studentId` isn't their own.
   - `POST /api/evaluations` (`evaluations.js:636`): require the chat owner (via `case_chat_id`), and set `student_id` from the chat row.
   - `POST /api/evaluations/run`: require the chat owner.

#### Client

4. Add `getAuthHeaders()` (exported in 2a) to the headers of every bare `fetch` on the student path. Keep the existing `response.ok` handling; only headers change.
   - `App.tsx`, 13 calls:
     - `/evaluations/check-completion` ×2 (lines 555, 568)
     - `/case-chats` create (1462)
     - `activity` (777), `start-timer` (926)
     - `status` ×3 (1360, 1599, 1619)
     - `initial-position` (1234), `final-position` (1215)
     - `/transcripts/chat` ×2 (1059, 1327)
   - `components/ChatTimer.tsx:27`: `time-remaining`.
   - `/llm/case-data` (`App.tsx:718`) already sends the student token. It can switch to `getAuthHeaders()` for consistency.
   - `App.tsx:654` reads `/rubrics/:id` (or `/rubrics/default`), which is still open on the server. Rubrics aren't student records, so this plan leaves it alone; adding the header now costs nothing if it's locked later.

#### As built

- `requireChatOwner(name, source)` and `requireSelfStudent(param)` live in `server/middleware/chatOwner.js`. Each returns `[verifyToken, check]`.
- Staff pass `requireChatOwner` within their sections, as planned. No dashboard screen calls these write routes today.
- `POST /api/evaluations` adds `requireRole(['student'])` after the owner check, and takes `student_id` **and `case_id`** from the chat row.
- `POST /api/case-chats` is students only (`requireRole(['student'])`); the body's `student_id` is ignored.
- The three `check-*` routes use `requireSelfStudent`. Staff get 403 there: only the student screen calls `check-completion`, and nothing calls the other two.
- **Not added: an enrollment check on `POST /case-chats`.** A student can still open a chat in a section they aren't enrolled in, and `/evaluations/run` bills that section's instructor. On the dev copy, 33 of 173 chats from 2026 have no matching `student_sections` row, so requiring one would block real students. Work out why first (removed enrollments? legacy `students.section_id`?).

### What Phase 2 does *not* fix (say so when shipping)

A signed-in student can still:
- send their own made-up chat history to `/evaluations/run`;
- post their own evaluation score through the browser's developer tools;
- read the teaching note in developer tools;
- use `/llm/chat` with a custom prompt within their instructor's cap.

These all come from the browser building prompts and saving grades. Phase 3 fixes them.

### Verify Phase 2

- **Dev student login.** CAS is off in dev, so there's no normal way to sign in as a student. Add a dev-only script, `server/scripts/dev-student-token.js`:
  - It refuses to run when `NODE_ENV` is `production` or `CAS_REDIRECT_BASE_URL` isn't localhost. (`CAS_ENABLED` can't be the guard: it is `true` in this machine's dev `.env.local`.)
  - It calls `generateToken('cas:<existing test student>', email, 'student', {...})`.
  - It prints `http://localhost:3000/?token=…&role=student&fullName=…&email=…`, which `api.auth.applyCasCallbackFromUrl()` (`services/apiClient.ts:216`) already accepts.
- **As that student, run a full case chat:**
  - with a scenario;
  - choosing an opening position;
  - with a timer (start-timer, time-remaining, timeout);
  - with at least one hint;
  - through "time is up" → evaluation → feedback → saved evaluation;
  - with transcript auto-save.

  Also test cancel, restart and repeat. Check the browser console for 401/404s.
- **Also run a Teach-back chat** (`activity_mode` teach-back, `docs/teach-back-setup.md`) through to its evaluation. Teach-back has its own prompt and coach-prompt path in `llmService.ts` and `evaluations.js`.
- **Negative tests:** with student A's token, try student B's chat ID on each route (expect 404). Try no token (expect 401).
- **Instructor dashboard:** Monitor → Live/Chats, kill a chat, "mark abandoned", Results. All should still work.
- `npx tsc --noEmit -p .` shows no new errors.

---

## Phase 3: Keep AI-only content and grading on the server (larger)

**3a, built 2026-10-09: the server builds the prompt.** See [`server-side-chat-prompt.md`](server-side-chat-prompt.md) for the decisions and what was built.

**3b, built 2026-10-10: the server keeps and grades the conversation.** See [`server-side-chat-prompt.md`](server-side-chat-prompt.md) § Phase 3b. With it, everything listed under "What Phase 2 does not fix" is closed: the browser no longer sends a prompt, a conversation, a score or a transcript.

## Not covered

- **Enrollment isn't checked when a chat starts** (see Phase 2b § As built). A student can open a chat in a section they aren't enrolled in, which bills that section's instructor. Find out first why 33 of 173 chats from 2026 have no `student_sections` row.

---

## Order

1. Run the `curl` check against production.
2. **Phase 1** (one commit). Ship right away if production returned `200`.
3. **Phase 2a**, then **Phase 2b** (one commit each), outside class hours.
4. **Phase 3** per [`server-side-chat-prompt.md`](server-side-chat-prompt.md), after its decisions are made.

## Rollback

Each phase (and 2a/2b) is its own commit, so any one can be reverted with `git revert` without touching the others. Phases 1 and 2 don't change the database schema. Phase 3 may add a migration (see its doc).
