# StudyChat: progress and handoff

The plan is in [StudyChat-plan.md](StudyChat-plan.md); decisions D1–D8 are in its Context section. This file says where the work stands and what to do next. **Update it at the end of every session.**

Last updated: 2026-10-29 (evening), on the desktop with MySQL (MSB-SSAMPSON20).

## Where things stand

- **Branch:** `studychat`, created from `reading-import` at `3b1c7d9`. `reading-import` is not merged into local `main`, so `studychat` contains its commits too. Nothing is pushed.
- **Phase 0 (fixes): committed and verified on the dev database** (see "Phase 0 verification" below). Two small fixes came out of it and are committed.
- Phases 1–6: not started. Phase 1 waits for your go-ahead.

### What Phase 0 changed

| Fix | Files |
|---|---|
| `instructor_notes` no longer sent to students. `/llm/case-data` returns a student copy of the supplementary text without AI-only roles; the AI prompt is unchanged | new `utils/documentRoles.js`; `server/routes/llm.js#loadCaseData`; `caseFiles.js`, `activityPack/format.js` and `import.js` use the shared role list |
| Grading sees the scenario (protagonist, question). `/run`, `/re-evaluate` and `/preview-prompt` use `loadChatContext()` case data via `gradingCaseData()`. **This deliberately changes the case-chat coach prompt** ("the case protagonist" → the real name) | `server/routes/evaluations.js` |
| One position-inference path. After grading, `inferPositionsFromChat` runs when `section_cases.position_capture_method = 'ai_inferred'`. The model comes from the section's supervisor model. The broken legacy `inferPositionFromTranscript` (it read the dropped `cases.arguments_*`) is deleted, along with `server/test-position-inference.js` | `positionInference.js`, `evaluations.js` |
| Issue Analytics names the AI correctly for Teach-back (the chosen audience, not the scenario placeholder). The name comes from SQL built by `aiSpeakerNameSql()` / `aiSpeakerJoinsSql()`; column alias `ai_speaker` | `server/services/activityTypes.js`; `issueAnalytics/common.js`, `runner.js`, `scope.js`, `view.js` |
| Teach-back opening word floor enforced on the server: 400 `OPENING_TOO_SHORT`. The page shows the same reply as its own check. New behaviour flag `openingWordFloor` | `llm.js`, `activityTypes.js`, `App.tsx` |
| `chat_repeats` resolved through the defaults chain (it used to read only the assignment's own options) | `server/routes/caseChats.js` |
| Teach-back wording for the later feedback messages; Evaluation's hint note follows `free_hints` | `teachBack.ts`, `App.tsx`, `components/Evaluation.tsx` |
| Dead code removed | `CEOPersona` enum (`types.ts`), `components/ScenarioSelector.tsx`, `services/transcriptService.ts` |

Checks that passed without a database:
- `npm run typecheck` (0 errors)
- `check-chat-prompt.js` (13/13)
- `check-activity-pack.js` (31/31 offline)
- every changed server module loads

### Phase 0 verification (2026-10-29, dev `ceochat` on localhost)

| Check | Result |
|---|---|
| `npm run typecheck`, `check-chat-prompt.js` | 0 errors; 13/13 |
| `check-activity-pack.js --db` | 37/37, round trip included |
| `npm run migrate:dry` | nothing pending |
| Collation of the new Issue Analytics joins | no risk: `case_chats.persona`, `personas.persona_id`, `cases.case_id` and the name columns are all `utf8mb4_unicode_ci`; the joins run on all 367 chats. The 185 chats with no speaker name are legacy chats with no scenario, as before |
| Student `/llm/case-data` on a case with an `instructor_notes` file | notes absent, supplementary reading present, no teaching note. Staff get both. The AI chat prompt still contains the notes |
| Teach-back short opening | the page refuses it without a request; a direct POST gets 400 `OPENING_TOO_SHORT`; a stale page (server floor raised after load) shows the audience's refusal reply |
| Teach-back graded end to end | 3 criteria scored; with `position_capture_method = 'ai_inferred'`, `position_inferred_at` was set using the section's model (gpt-5-mini) |
| Teach-back transcript and Issue Analytics | transcript turns, the speaker SQL, a real run (estimate, run, transcript view) all name the audience ("Sam, a curious beginner"), not the scenario placeholder |
| Case chat graded, then admin Preview prompt | names Kent Beck (7 times), never "the case protagonist", and includes the scenario question. The Issue Analytics estimate for that case still reuses 6 of 8 cached transcripts, so case-chat wording did not change the cache key |
| Evaluation page (Teach-back) | renders; hint note reads from `free_hints` |

Not checked on screen: the Teach-back wording in the feedback phases (`ask_for_feedback` was off in the test assignment). It is copy only and passes typecheck.

**Fixed during verification** (second commit):
- `POST /api/case-chats/:id/infer-position` (admin) still defaulted to `gemini-1.5-flash`. It now defaults to the section's supervisor model, like grading.
- On a server `OPENING_TOO_SHORT`, the page quoted its own word count. The error now carries the server's `min_words` (`services/llmService.ts`), and the page uses it.

**Found, not fixed (decide later):**
1. **`chat_repeats` does nothing for students.** Only `GET /api/case-chats/check-repeats` reads it, and no client calls that endpoint; `POST /case-chats` does not enforce it. Whether a student can chat again is decided by `evaluations.allow_rechat` (and `allow_repeat`). So Phase 0's fix to that endpoint has no visible effect. Either enforce it (server at chat start + the case list) or drop the option. **Question for you.**
2. **AI-inferred assignments still ask the student for a final position.** `App.tsx` `shouldShowFinalPosition` checks tracking and change tracking but not the capture method. Fix with the positions work in Phase 3 (assigned positions touch the same code).
3. `inferPositionsFromChat` joins `transcripts` without pinning the newest row (Issue Analytics pins it). Harmless unless a chat has duplicate transcript rows; fix when that file is next touched.

## Your to-do list on the other computer

1. **Before opening anything:** check that OneDrive has finished syncing (the cloud icon shows no pending changes). Right-click the `MakeTheCase` folder → **Always keep on this device**.
2. Open a terminal in the `MakeTheCase` folder and check that git sees the work:
   ```
   git status
   git log --oneline -3
   ```
   You should be on branch `studychat`, the top commit should be "StudyChat Phase 0…", and the working tree should be clean apart from `dev/MTC-to-StudyChat-ideas.md` (yours, never committed). If git reports errors about the index, OneDrive had not finished; wait and try again.
3. Run `npm install`, then `npm run typecheck`.
4. Make sure MySQL is running and `.env.local` points at the dev `ceochat` database.
5. Open **Claude Code Desktop** on the `MakeTheCase` folder and paste:
   > Continue the StudyChat work. Read dev/StudyChat-plan.md and dev/StudyChat-progress.md, then do "Next steps for Claude" in the progress file, starting with verifying Phase 0 on the dev database.
6. Answer its questions. Approve the plan when it reaches Phase 1.
7. **Work on one computer at a time.** Close Claude Code and let OneDrive sync before switching machines: a `.git` folder edited on two computers at once can be corrupted.

## Next steps for Claude

### A. Verify Phase 0 (dev database `ceochat` on localhost) — DONE 2026-10-29

Kept for the record; results are in "Phase 0 verification" above.

1. `node server/scripts/check-activity-pack.js --db` must pass all checks, including the round trip. On the laptop it failed only because MySQL was unreachable (ECONNREFUSED).
2. `npm run migrate:dry`: Phase 0 added no migration, so nothing should be pending from this work.
3. **Collation risk (untested):** run one Issue Analytics query, or at least the joins on their own. They now `LEFT JOIN personas ai_persona ON ai_persona.persona_id = cc.persona`, and `case_chats.persona` and `personas.persona_id` may have different collations ("Illegal mix of collations"). If they do, add `COLLATE utf8mb4_unicode_ci` in `aiSpeakerJoinsSql()`.
4. `npm run dev:all`, then use a dev student token (`server/scripts/dev-student-token.js`):
   - A **case chat** to grading. The Preview prompt (admin) shows the scenario protagonist's name, not "the case protagonist".
   - A **Teach-back** chat:
     - A short first message is refused (the page's check). Also confirm that the server refuses a direct short POST with `OPENING_TOO_SHORT`.
     - Grade it. With `position_capture_method = 'ai_inferred'`, check that `case_chats.position_inferred_at` gets set.
   - As a student, `/api/llm/case-data/<case>` for a case that has an `instructor_notes` file: its text must not appear. As staff, it does.
   - An Issue Analytics run (or a transcript view) on a Teach-back case shows the audience name.
5. Fix anything found, update this file, and commit.

### B. Phase 1 (engine; no visible change)

Follow the plan's §3 and the Phase 1 section. Capture the extended goldens **after** Phase 0 (Phase 0 changed the coach prompt on purpose). Keep the hand builders until engine output = hand-builder output = golden.

### C. Later phases

2: type storage, packages, minimal admin flow. 3: DEBATE, APPLY, LIKEN2ME. 4: PITCH, ROLEPLAY (signals, touchpoints). 5: full admin editor. 6: DEFEND (minimal). Each phase gets its own migration (next free number: **090**). Open questions for the user are at the end of the plan (LIKEN2ME privacy, multi-sided debates, showing the goal, simulated students).

## Practical notes (learned the hard way)

- **Line endings are mixed.** Some files are CRLF (`server/routes/llm.js`, `evaluations.js`, `caseFiles.js`, `caseChats.js`, `activityPack/format.js`); others are LF. Script edits must normalise to LF, edit, then restore CRLF. The Edit tool handles it.
- **Shell heredocs eat backslashes.** A Node edit script in a heredoc turned `/\s+/` into `/s+/` (a word-count bug, caught in review). Use the Edit tool for anything containing regexes or backslashes, and re-read the diff.
- **Recursive `grep -r` over this OneDrive folder takes minutes** (it reads `case_files/`, `node_modules/`, …). Use the Grep tool, or restrict the paths.
- The machine-specific MySQL path is in `.claude/PLATFORM.md` (gitignored).
- **Live-test recipe that worked (desktop).** API: `SERVER_PORT=3011 node server/index.js`. Web: the `makethecase-test-3010` entry in `.claude/launch.json` (Vite on 3010 with `SERVER_PORT=3011`). Throwaway data: a `zz-studychat-1` student in `case-chat-testers` and a `zz-studychat-tb` Teach-back case (case, reading and `instructor_notes` files with `converted_text`, one scenario with two positions, an `ai_inferred` assignment). Delete the student and the case afterwards (cascades), plus any `issue_analysis_runs` for the case. Drive the API with `curl` and a token from `generateToken()`; set `student_auth_token` in the page for the browser.
- To let a test student chat again, set `evaluations.allow_rechat = TRUE`; `chat_repeats` is not read by the page.
- A chat session object in the page is created at chat start, so a hot reload of `services/llmService.ts` does not reach a chat already open: reload the page.
- Live AI cost of a full verification pass: a few cents (gpt-5-mini).
