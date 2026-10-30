# StudyChat: progress and handoff

The plan is in [StudyChat-plan.md](StudyChat-plan.md); decisions D1–D8 are in its Context section. This file says where the work stands and what to do next. **Update it at the end of every session.**

Last updated: 2026-10-30 (Phase 2), on the desktop with MySQL (MSB-SSAMPSON20).

## Where things stand

- **Branch:** `studychat`, created from `reading-import` at `3b1c7d9`. `reading-import` is not merged into local `main`, so `studychat` contains its commits too. Nothing is pushed.
- **Phase 0 (fixes): committed and verified on the dev database** (see "Phase 0 verification" below).
- **Phase 1 (the engine): committed and verified on the dev database** (see "Phase 1" below). Migration 090 is applied on the dev `ceochat`, not on production.
- **Phase 2 (types as data, admin screen, packages): committed and verified on the dev database** (see "Phase 2" below). Migration 091 is applied on the dev `ceochat`, not on production.
- **Phase 3 (DEBATE, APPLY, LIKEN2ME): committed and verified on the dev database** (see "Phase 3" below). Migration 092 is applied on the dev `ceochat`, not on production. Run `npm run seed-activity-types` after migrating, then restart the server.

### Phase 3: what changed

| Part | Files |
|---|---|
| Migration 092: `'assigned'` on three ENUMs (`'none'` also on `case_chats.position_method`), `cases.goal` | `server/migrations/092_assigned_positions_and_goal.sql` |
| The server picks the side at chat start, in a transaction holding the assignment's row lock: same side on retry, else fewest students, ties by `sha256(position:student:section_case)`. Any position in the request is ignored; a student cannot PATCH an assigned side | `server/services/sideAssignment.js`, `routes/caseChats.js` |
| Rules by trait: capture method must be one the type lists (so `assigned` can't reach a built-in), `assigned` needs sides on every scenario, a two-sided type refuses a third enabled position. Checked on save and again at chat start | `server/services/positionRules.js`, `sectionCases.js`, `courseCases.js`, `scenarioPositions.js` |
| A type with `positions: required` starts with tracking on and its first capture method when the case has no defaults of its own (copied once) | `activityDefaults.js#caseDefaultsForCaller` |
| Engine: slots `{goal} {position} {opposing_position}`, grading slots `{question} {goal} {student_position} {opposing_position}`, `greeting.template_assigned`, optional traits `personal` and `two_sided`, optional copy `personal_notice`, optional intro lines `goal` and `assigned_side`, eval input `type_criteria` (the type's own criteria unless the assignment names a rubric). **All optional and absent from the built-ins, so their version tags and goldens are unchanged** | `utils/activityEngine/*`, `teachBack.js#typeCriteriaInputs` |
| `personal` trait: notice before the chat; names hidden by default in Results, Positions, Monitor and transcripts, with a "Show names" checkbox; an Issue Analytics run must be turned on per run (`allow_personal`) | `server/services/personalActivity.js`, `analytics.js`, `sectionCases.js`, `transcripts.js`, `issueAnalytics.js`, `Analytics.tsx`, `LiveSessionMonitor.tsx`, `IssueAnalytics.tsx`, `App.tsx` |
| Goal: case form field, for the AI and grader; students see it only through the intro bar of a type with a `goal` line (returned by `POST /case-chats`, stripped from `/llm/case-data`). Packages carry it behind `activity:goal` | `cases.js`, `Dashboard.tsx`, `llm.js`, `activityPack/*` |
| Package tokens per feature: `positions:assigned`, `positions:two_sided`, `trait:personal`, `grading:type_criteria` | `activityPack/capabilities.js` |
| Scenario editor fields by trait (character fields, saved openings, positions, arguments, the type's own start row and labels). Capture method pickers list only the type's methods | `ScenarioManager.tsx`, `CaseVersionEditor.tsx`, `Dashboard.tsx`, `services/activityTypeList.ts` |
| Fixed: AI-inferred, instructor-recorded and "none" assignments no longer ask the student for a final position (Phase 0's finding 2) | `App.tsx` |
| System types: `debate`, `apply`, `liken_to_me` (the key can't hold a digit, so not `liken2me`), an `audience-mentor` persona, three public starter rubrics. `npm run seed-activity-types`; never overwrites; `--force` publishes a new version | `server/scripts/seed-activity-types.js`, `seeds/systemActivityTypes.js`, `activityTypeStore.js#seedSystemType` |

### Phase 3 verification (2026-10-30, dev `ceochat`)

| Check | Result |
|---|---|
| `typecheck` | 0 errors |
| `check-activity-engine.js --db` | 919/919; built-in versions unchanged |
| `check-activity-definitions.js` | 27/27 (10 new) |
| `check-activity-pack.js --db` | 50/50 |
| API, against the running server (46 steps, real gpt-5-mini turns and grading) | case chat refuses `assigned`; four students starting at once split 2/2; a cancelled chat's retry keeps the side and ignores a position sent by the client; PATCH refused; third position refused; student rows and `/llm/case-data` carry no templates, arguments or goal; each type answered and graded on 3 of its own criteria; evaluation records `debate@v1`; names hidden and revealed in Results, transcripts and Monitor; Issue Analytics refuses a run until turned on; package carries goal, definition and tokens |
| Browser | Student: Liken to Me notice and mentor picker, Debate intro bar with goal and assigned side, greeting. Instructor: Liken to Me scenario editor shows its own labels and no character or position fields |

**Found while testing, fixed:** the intro bar named the picked persona ("You'll debate Moderate") on scenario-character types; a missing full stop in the Debate greeting.

### Phase 3: decisions for your review

1. **Name hiding is a default, not an access rule.** It covers Results (with its CSV), Positions, Monitor, the transcript modal and Issue Analytics. Not covered: admin-only chat lists in `caseChats.js` (`GET /`, `/:id`, position distribution) and the prompt logs. In transcripts it replaces the student's full and first names; a nickname or a relative's name stays.
2. **Sorting and searching Results by name still use the real name**, so a sort order could hint at identity. Left as is.
3. **`assigned` never asks for a final position.** The side isn't the student's opinion, so "has your position changed?" doesn't fit. A later option could ask for their own view.
4. **Starter rubrics are optional.** With no rubric on the assignment, the type's own built-in criteria grade the chat (`type_criteria`), never the case-chat system default.
5. **LIKEN2ME gets a distress line in its prompt** (encourage them to talk to someone they trust or a campus counselor). You didn't ask for this; please check the wording suits BYU.
6. **Scenario editor change for Teach-back too:** the protagonist fields are now hidden for persona-character types (a placeholder is stored, as the columns are required). Existing values are kept.

### Phase 2: what changed

| Part | Files |
|---|---|
| Migration 091: `activity_types` (key, uid, tier builtin/system/custom, enabled, current version, based_on) and `activity_type_versions` (draft / published / retired, definition JSON, content sha256). Rows for the two built-ins | `server/migrations/091_activity_types.sql` |
| The store: built-ins plus data types in one in-memory registry, loaded before `listen`, reloaded on every write. Clone, save draft (validated; traits fixed once published), discard, publish, restore into draft, enable/disable, delete when unused; package install planning | `server/services/activityTypeStore.js` |
| Behaviours cached by version; a chat runs and is graded on its recorded version (`behaviourForChat`); unknown or unpublished types throw 409 `ACTIVITY_TYPE_UNAVAILABLE`; a disabled type serves chats in progress but starts none; `activityCacheVersion` returns the version for data types | `server/services/activityTypes.js`, `chatPrompt.js` (`ctx.behaviour`), `llm.js`, `caseChats.js`, `evaluations.js` |
| Server code reads traits from the store instead of the static table (personas, Issue Analytics, scenarios, chat-option schema, case create/update) | `personaService.js`, `issueAnalytics/common.js`, `scenarios.js`, `chatOptions.js` route, `cases.js` |
| Routes: list (staff: published types; `?all=1` admin: drafts, usage), detail, clone, draft, preview, publish, restore, enable, delete. Permission `activity_types` (grantable; superusers always) | `server/routes/activityTypes.js`, `middleware/permissions.js`, `utils/permissions.ts`, `InstructorManager.tsx` |
| Admin > Activity Types: list with usage, Clone, a sectioned form over every text field plus a JSON tab, Preview on a real case/scenario/persona (no AI call), Publish (shows usage), Enable/Disable, History with Restore, Delete | `components/ActivityTypeManager.tsx`, `Dashboard.tsx` |
| Dashboard reads labels, traits and the case form's type picker from the server list; persona-kind checks use the type's trait, not `teach_back`. The student page reads traits from its activity view | `services/activityTypeList.ts`, `teachBack.ts`, `Dashboard.tsx`, `CaseVersionEditor.tsx`, `ScenarioManager.tsx`, `CasePackages.tsx`, `App.tsx` |
| Packages carry data types as `activity_types.json` (token `activity_definition:1`, manifest checksum, validated on install, built-in keys refused). Install reuses same content, else creates a disabled draft under its key or a deterministic `c_<slug>_<sha8>`; only an admin may install a package that creates a type; the review shows each definition in full. Copy to a custom type carries its definition | `activityPack/capabilities.js`, `format.js`, `zip.js`, `export.js`, `import.js`, `index.js`, `CasePackages.tsx` |
| Checks: `check-activity-definitions.js` (17: AI-only and unknown slots, oversize, HTML, unknown/missing keys, unsupported features, key length, traits change); `check-activity-pack.js` +12 (custom type in a package, missing definition, checksum, built-in key, newer schema token; on the DB: instructor refused, admin installs a disabled draft, reinstall reuses, other content gets a new key) | `server/scripts/` |

### Phase 2 verification (2026-10-30, dev `ceochat`)

| Check | Result |
|---|---|
| `typecheck`, `npm run build` | 0 errors; builds; no prompt template text in the student bundle |
| `check-activity-engine.js --db` | 919/919 (built-in output unchanged; versions unchanged: `case_chat@e79517f4eda9`, `teach_back@cc1b4bef6145`) |
| `check-activity-definitions.js` | 17/17 |
| `check-activity-pack.js --db` | 50/50 |
| API, against the running server (26 steps, no AI calls) | list, students refused, built-in locked, clone, validation refusals, draft, preview on a real case, enable refused before publish, publish v1, case refused on a disabled type, case set after enabling, student row carries the custom view, a chat starts on v1, publish v2: the running chat still resolves to v1 and a new chat gets v2, traits change refused, restore v1 into the draft, disabled type refuses new chats, in-use type cannot be deleted, usage counts, unknown type refuses chats while the student list still loads, cleanup through the API |
| Browser | Admin > Activity Types: clone Teach-back, edit a copy string in the form, save, preview (reporter audience on a real case), publish, enable; the case form's picker lists the new type; as a student, the case shows the audience picker (traits from the view) and ending the chat shows the edited farewell |

**Found while testing:** the registry is in memory, so a row changed directly in the database is not seen until the server restarts (CLAUDE.md says so; every real write goes through the store).

### Phase 1: what changed

| Part | Files |
|---|---|
| The engine, pure JS: one-pass rendering with optional wrappers, named resolvers, system prompt (platform document blocks), greeting, coach prompt (platform task list and JSON contract), student copy and intro bar, the student view, the schema-v1 validator with channels | `utils/activityEngine/` (`render.js`, `resolvers.js`, `prompt.js`, `greeting.js`, `grading.js`, `copy.js`, `view.js`, `validate.js`, `index.js`) |
| Built-in definitions | `utils/activityEngine/builtins/case_chat.json`, `teach_back.json`, `index.js` |
| `activityBehaviour` is now an adapter over the engine (same shape; adds `definition`, `version`, `studentView`). The hand builders moved to `legacyActivityBuilders.js` and are kept one release for the triple check | `server/services/activityTypes.js`, `server/services/legacyActivityBuilders.js` |
| Goldens captured from the hand builders after Phase 0: 22 system prompts (the old 13 plus whitespace-only instructions, braces and `$&`, every persona, every optional block), 8 greetings, 12 coach prompts (with and without rubric, 0/1/2 free hints, picked position, missing fields), both notes, 63 copy strings, 7 intro bars. The old `chat-prompt-golden.json` is folded in | `server/scripts/check-activity-engine.js`, `fixtures/activity-engine-golden.json`; `check-chat-prompt.js` is an alias |
| Student page reads every type-specific sentence from the activity's copy. `TEACH_BACK_COPY`, `teachBackIntroText` and `TeachBackIntro.tsx` are gone; `teachBack.ts` keeps the audience helpers | `services/activityCopy.ts`, `components/ActivityIntro.tsx`, `App.tsx`, `ChatWindow.tsx` (no Kent Beck default), `Evaluation.tsx` (headings from the view), `CriteriaCoverage.tsx`, `teachBack.ts` |
| The student view is on student case rows, pinned in the `POST /case-chats` response, and on `GET /evaluations/:id` (staff viewer) | `sectionCases.js#forStudent`, `caseChats.js`, `evaluations.js` |
| Migration 090: `case_chats.activity_type_version`, `evaluations.activity_type_version`, written at chat start and at grading (`case_chat@e79517f4eda9`, `teach_back@cc1b4bef6145` today) | `server/migrations/090_activity_type_version.sql` |
| Chat options: type-defaults layer (empty for the built-ins), `min_opening_words` with `teach_back_min_words` still read, `GET /chat-options/schema?activity_type=` drops the keys a type hides | `chatOptions.js`, `utils/openingWords.js`, `routes/chatOptions.js`, `llm.js`, `CaseVersionEditor.tsx`, `Dashboard.tsx`, `types.ts` |
| Issue Analytics cache key hook (adds nothing for built-ins) | `issueAnalytics/common.js#extractCacheTag`, `runner.js`, `scope.js`, `activityTypes.js#activityCacheVersion` |
| CLAUDE.md: new "Activity engine" section; prompt and chat-option notes updated | `CLAUDE.md` |

### Phase 1 verification (2026-10-30, dev `ceochat`)

| Check | Result |
|---|---|
| `check-activity-engine.js` | 181/181 offline; with `--db`, 909/909 (150 real chats: system prompt and greeting for two names; 46 real coach prompts at 0/1/2 free hints) |
| `check-activity-pack.js --db`, `typecheck`, `npm run build` | 37/37; 0 errors; builds |
| Student bundle | no prompt template text and none of the old inline copy (`dist/assets/*.js` scanned) |
| Student case rows | carry the view, no templates; schema filter: case chat hides the floor field, Teach-back shows it, an unknown type gets 400 |
| Word floor | default 15; old key `teach_back_min_words: 40` is honoured; `min_opening_words` wins when both are set |
| Case chat in the browser | start rows, picker, avatar tooltip and minimum-exchanges reply word for word as before; graded via API; chat and evaluation record `case_chat@e79517f4eda9` |
| Teach-back in the browser, end to end | intro bar, counter, position prompt, opening-floor reply, limit bar, every feedback-phase message (this closes Phase 0's unverified item), final-position block, evaluation headings and coverage strip; chat and evaluation record `teach_back@cc1b4bef6145`; `GET /evaluations/:id` carries the view |

### Phase 1: decisions (settled with you 2026-10-30)

1. **Saved Issue Analytics notes stay valid for the built-ins.** The plan said to include the type version in the pass-1 cache key. Built-in wording never reaches the Issue Analytics prompts, so doing that would only discard paid-for results. `extractCacheTag` adds a hash of the type version **only for types defined as data** (Phase 2). *Approved.*
2. **`utils/activityTypes.js` keeps its small static table** instead of deriving from the definitions: deriving would bundle the prompt templates into the student page. The engine check asserts the table agrees with the definitions.
3. **The recorded version is not yet used to pick the definition.** Each built-in has one version, so every turn and grade already runs on it. Resolving by the recorded version belongs with the store in Phase 2.
4. **Teach-back avatar tooltip** now reads "Sam, a curious beginner, the listener you chose for … (AI model: …)" instead of repeating the name. Case chat's is unchanged. *Approved.*
5. Case chat gained three copy strings it never shows (`opening_too_short`, `persona_picker_empty`, `start_no_persona`), because every definition must have every key.
6. **Packages write the floor under its old name**, `teach_back_min_words` (`export.js#chatOptionsForPackage`), so older servers and StudyChat-LTI accept them; this server reads either name. Switch to `min_opening_words` in packages only behind a capability token. *Decided; done.*
7. **`chat_repeats` is enforced** (the Phase 0 question). One server rule, `server/services/chatAttempts.js`: a student gets 1 + `chat_repeats` graded chats, per scenario when the assignment uses scenarios (else per case); abandoned or cancelled chats do not count; Allow Repeat = no limit; the instructor's per-student re-chat always grants one more. `POST /api/case-chats` refuses with 409 `CHAT_LIMIT_REACHED`; the start screen reads `can_start_new` / `chats_left` from `GET /evaluations/check-completion?section_id=` and shows "N chats left", "✓ Completed" or "No Chats Left". This also fixes Allow Repeat not applying to scenarios, and a case with scenarios being blocked as a whole after one graded chat. The unused `GET /case-chats/check-repeats` endpoint is removed. The By-section options editor gained the "Allowed repeats" field (shown when Allow Repeat is off); option descriptions and the Chat Options help say the rule. Verified live: 9 rule steps against the server (limit, cancelled chats, repeats, re-chat, Allow Repeat, defaults) and the start-screen labels. *Decided; done.*

Found, not fixed: a hint request sent as the first Teach-back message gets the opening-floor reply, not the hint reply (the floor is checked first; unchanged from before).

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
1. ~~**`chat_repeats` does nothing for students.**~~ Resolved 2026-10-30: enforced; see "Phase 1: decisions", item 7.
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

### B. Phase 1 (engine) — DONE 2026-10-30

Results are in "Phase 1" above. Before production: run migration 090 (`npm run migrate` on the server).

### C. Phase 2 (type storage, packages, minimal admin flow) — DONE 2026-10-30

Results are in "Phase 2" above. Before production: run migrations 090 and 091.

### D. Phase 3: DEBATE, APPLY, LIKEN2ME — DONE 2026-10-30

Results are in "Phase 3" above. Notes for later phases:
- `validate.js` still refuses `signals`, `touchpoints`, `chat_options.extra` and any `material` but `activity` ("not supported by this server yet"). Lift each with its phase, and give it a token in `capabilities.js#FEATURE_TOKENS`.
- A new optional definition key must stay absent from the built-ins: their version tag is the hash of the JSON.
- Delete the hand builders (`legacyActivityBuilders.js`, `chatPromptTemplates.js`, `teachBackCoachPrompt.js`, the builder in `promptBuilder.js`) in the release after Phase 1 ships, and drop the "hand" comparisons from the check.

### E. Later phases

4: PITCH, ROLEPLAY (signals, touchpoints). 5: full admin editor. 6: DEFEND (minimal). Each phase gets its own migration (next free number: **092**). Open questions for the user are at the end of the plan (LIKEN2ME privacy, multi-sided debates, showing the goal, simulated students).

## Practical notes (learned the hard way)

- **Line endings are mixed.** Some files are CRLF (`server/routes/llm.js`, `evaluations.js`, `caseFiles.js`, `caseChats.js`, `activityPack/format.js`); others are LF. Script edits must normalise to LF, edit, then restore CRLF. The Edit tool handles it.
- **Shell heredocs eat backslashes.** A Node edit script in a heredoc turned `/\s+/` into `/s+/` (a word-count bug, caught in review). Use the Edit tool for anything containing regexes or backslashes, and re-read the diff.
- **Recursive `grep -r` over this OneDrive folder takes minutes** (it reads `case_files/`, `node_modules/`, …). Use the Grep tool, or restrict the paths.
- The machine-specific MySQL path is in `.claude/PLATFORM.md` (gitignored).
- **Live-test recipe that worked (desktop).** API: the `makethecase-test-api-3011` entry in `.claude/launch.json`. Web: the `makethecase-test-3010` entry (Vite on 3010 with `SERVER_PORT=3011`). Throwaway data: a `zz-studychat-1` student in `case-chat-testers` and a `zz-studychat-tb` Teach-back case (case, reading and `instructor_notes` files with `converted_text`, one scenario with two positions, an `ai_inferred` assignment). Delete the student and the case afterwards (cascades), plus any `issue_analysis_runs` for the case. Drive the API with `curl` and a token from `generateToken()`; set `student_auth_token` in the page for the browser.
- To let a test student chat again, set `evaluations.allow_rechat = TRUE`; `chat_repeats` is not read by the page.
- A chat session object in the page is created at chat start, so a hot reload of `services/llmService.ts` does not reach a chat already open: reload the page.
- Live AI cost of a full verification pass: a few cents (gpt-5-mini).
