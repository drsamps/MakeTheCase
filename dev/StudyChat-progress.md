# StudyChat: progress and handoff

The plan is in [StudyChat-plan.md](StudyChat-plan.md); decisions D1–D8 are in its Context section. This file says where the work stands and what to do next. **Update it at the end of every session.**

Last updated: 2026-10-29, on the laptop without MySQL (MSB-SSAMPSON18).

## Where things stand

- **Branch:** `studychat`, created from `reading-import` at `3b1c7d9`. `reading-import` is not merged into local `main`, so `studychat` contains its commits too. Nothing is pushed.
- **Phase 0 (fixes): coded and committed, NOT yet verified against a database.**
- Phases 1–6: not started.

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

### A. Verify Phase 0 (dev database `ceochat` on localhost)

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
