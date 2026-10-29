# StudyChat: many activity types in MakeTheCase (implementation plan)

## Context

MakeTheCase was built for one activity: study a case, then argue with its protagonist. `dev/MTC-to-StudyChat-ideas.md` proposed a general **StudyChat** tool (EXPLAIN, DEBATE, PITCH, DEFEND, …, and types nobody has thought of yet).

Part of that note has already shipped (Oct 2026):

| Done | Where |
|---|---|
| The server builds the chat prompt, keeps the conversation, and grades it | `server/services/chatPrompt.js`, `chatTurns.js`, `routes/evaluations.js` |
| The type belongs to the case | `cases.activity_type` (migration 084) |
| A type registry | `utils/activityTypes.js` (traits) and `server/services/activityTypes.js#activityBehaviour` (builders) |
| Teach-back (EXPLAIN) as type #2 | `chatPromptTemplates.js`, `teachBackCoachPrompt.js`, `teachBack.js`, `teachBack.ts`, `TeachBackIntro.tsx` |
| Case default settings, packages, and the scenario settings JSON | `activityDefaults.js`, `activityPack/*`, `utils/scenarioSettings.js` |

**What still blocks "many types":**
- **A type is about 400 lines of hand-written code** (prompt, greeting, coach prompt, eval tweaks, notes, client copy), so only a developer can add one.
- **The student app branches on Teach-back about 20 times** (`teachBackMode ? TEACH_BACK_COPY.x() : '<case chat text>'`). Every type still gets case-chat wording in:
  - the feedback phases, Evaluation and ChatWindow
  - Issue Analytics speaker names
  - position inference
- **New types need primitives that don't exist yet:**
  - completion signalled by the AI
  - assigned positions
  - touchpoints
  - an explicit goal
  - the student's own work as material
- **Bugs found on the way:**
  - `instructor_notes` files reach students.
  - Grading never sees the scenario's protagonist or question.
  - Position inference after grading uses a legacy path that reads old settings, with a retired model.
  - The Teach-back word floor is enforced only in the browser.

**Decisions made with you (2026-10-29)**

| # | Decision |
|---|---|
| D1 | New activity types are **authored by admins as data** in the dashboard. Case chat and Teach-back stay locked in code (clonable). Developers add only engine features. |
| D2 | **Stay package-compatible with StudyChat-LTI**: custom type definitions travel in `.mtc.zip` packages. |
| D3 | First new types: **DEBATE, APPLY, LIKEN2ME, PITCH, ROLEPLAY, DEFEND**. |
| D4 | **Type-aware wording only.** Keep the MakeTheCase name. Each type supplies its own words, the dashboard says "Activities" where it means all types, and table names don't change. |
| D5 | When the AI signals that the goal is reached, **offer Finish / Keep talking**. An assignment option can make it end automatically. Minimum exchanges still apply. |
| D6 | DEFEND: **the student or the instructor uploads** the submission. Keep it minimal; it will be expanded later. |
| D7 | Editing a custom type works as **draft, then publish**. Each chat records the version it ran on, and old versions can be restored. |
| D8 | Touchpoints are **detected at grading**, **plus live in Monitor** for types that use the signal channel. |

---

## 1. The design in one picture

```
 ACTIVITY TYPE DEFINITION  (validated JSON)
   built-in: case_chat, teach_back      ─ JSON files in code, locked, clonable
   system:   debate, apply, pitch, …     ─ seeded DATA rows, locked, clonable, updated by seed script
   custom:   admin clones/edits          ─ DATA rows, draft → publish, versioned
     traits · prompt templates · greeting · grading framing · labels · student copy · option defaults
        │ rendered by
        ▼
 ACTIVITY ENGINE  utils/activityEngine/ — pure JS, no database imports, so StudyChat-LTI can copy it
   platform blocks (not editable): document wrapping and cache order, "student text is data",
   hint protocol, signal protocol, the grader's JSON output contract
        │ for
        ▼
 ACTIVITY (a case): documents · scenarios · positions · touchpoints · goal · default settings
        │ assigned to (unchanged)
        ▼
 ASSIGNMENT (section_cases, course versions, chat options) ─► CHAT (case_chats + type version)
```

- **Why the new types are data, not code.** If DEBATE were code, StudyChat-LTI would need code for it too, and so would every other server. As data, any server with the engine can run any type a package brings. Only new *engine features* need code, and each one is guarded by a package capability token.
- **The test that the abstraction is right:** the engine reproduces today's case-chat and Teach-back prompts **byte for byte** (§3).

---

## 2. The activity type definition

The registry and validator live in `utils/activityEngine/validate.js`, shared by the server, the dashboard and packages. It follows the pattern of `utils/scenarioSettings.js`: it normalises, and it refuses unknown keys. Schema version 1:

| Part | Contents |
|---|---|
| identity | `key` (built-in/system: `[a-z_]+`; custom: `c_<slug>` plus a uid, so it can never collide with a future system type), `label`, `summary`, `based_on` |
| `traits` (**fixed for the life of a type key**; changing one means cloning to a new key) | `character`: `scenario` \| `persona`<br>`persona_kind`: `protagonist` \| `audience`<br>`positions`: `off` \| `optional` \| `required`<br>`capture_methods` allowed<br>`material`: `activity` \| `student_submission`<br>`ai_sees`: {case, supplementary, teaching_note, arguments, touchpoints}<br>`signals`: {complete, touchpoints}<br>`grading_extras`: {evidence, eval_inputs} |
| `prompt` | block headings and intro lines<br>`role` (the role-and-rules template)<br>`optional` wrappers (rendered only when the slot has a value)<br>`hints` zero/one/many<br>`final_turn_note`, `position_pick_note` |
| `greeting` | template<br>`saved_openings` (per-persona openings, as Teach-back has) |
| `grading` | framing template, default criteria, summary headings, `judge_student_words_only` |
| `labels` | UI words: `document` (Case/Reading), `ai_character` (Protagonist/Audience/Opponent/Investor), `question` (Chat question/Topic/Motion), persona picker title, … |
| `copy` | every student-facing sentence that varies by type: start row, intro-bar phrases, wrap-up and feedback prompts, hint refused, minimum not met, final-position prompt, evaluation headings |
| `chat_options` | `defaults` (partial: only keys this type needs), `hidden`, `extra` (type-only keys) |

**Slots and channels (the security rule).**
- Slots are snake_case: `{student_name} {ai_name} {ai_role} {case_title} {question} {topic} {goal} {situation} {scenario_instructions} {persona_instructions} {additional_instructions} {hint_rule} {position} {opposing_position} {touchpoints}`.
- Every template field belongs to a **channel**: `system`, `coach`, `model_note` or `student` (the greeting and copy).
- **AI-only slots** (teaching note, arguments, scenario instructions, persona instructions, touchpoints) are allowed only in `system` and `coach`.
- The validator rejects any `{…}` that is not allowed in that field's channel. It runs at save, at publish and at package install. This is what stops an admin template from putting the teaching note into a greeting.
- Rendering is a single pass, `renderOnce()` (moved to `utils/activityEngine/render.js`; `issueAnalytics/common.js` re-exports it). A `{…}` inside case, student or instructor text is therefore never expanded.
- Optional wrappers are rendered first, then passed as values to the outer pass.
- Length caps per field and in total. No HTML in student copy (rendered as sanitized Markdown).

**Code, not wording, stays in named resolvers** (`utils/activityEngine/resolvers.js`). A definition names a resolver; it does not reproduce its logic:
- the five legacy persona texts (used when a persona has no DB instructions), and the `{studentName}` / `{caseTitle}` substitution in persona text
- the situation trimming
- `introduceAudience`, `withoutFinalStop`, and the no-name rule in openings
- presence rules: trimmed vs. truthy, exactly as today
- the `numCriteria` count
- picked-position notes
- `teachBackIntroText`'s plural and conditional lines (it takes phrases from `copy`)
- the evaluation input shapers (`chosen_persona`, from `teachBack.js#teachBackEvalInputs`) and `verifyEvidence`

The template language stays logic-free, so admins have no if/else to get wrong.

---

## 3. Built-ins become definitions, proved byte for byte

1. **Capture goldens after the Phase 0 fixes.** Phase 0 changes the coach prompt on purpose. The capture covers:
   - system prompts (the existing 13 cases, plus whitespace-only `prompt_instructions`, and braces and `$&` inside case text)
   - greetings: case chat, Teach-back saved openings, template openings
   - coach prompts for both types: with and without a rubric, with a picked position, with free hints 0/1/2
   - final-turn and position-pick notes
   - student copy
2. `check-chat-prompt.js` becomes `check-activity-engine.js` (the old name stays as an alias). For one release it asserts **engine output = hand-builder output = golden**.
3. Switch `activityBehaviour` to the engine only when every golden passes. Delete `chatPromptTemplates.js`, `teachBackCoachPrompt.js` and the builder half of `promptBuilder.js` in the release after that.
4. The grader's JSON schema and hint-tally rules are platform blocks, never template text. An admin edit therefore cannot break `parseEvaluationResponse`, `buildCorrectionPrompt` or `evaluationNormalizer.js`.

---

## 4. Storage, versions, safety

- **Tables**:
  - `activity_types`: `type_key`, `uid`, `tier` (builtin/system/custom), `enabled`, `current_version_id`, `based_on`, `created_by`, timestamps.
  - `activity_type_versions`: `version_id`, `type_key`, `version_no`, `status` (draft/published/retired), `definition` JSON, `definition_sha256`, `notes`, `created_by`, `published_at`. `UNIQUE(type_key, version_no)`. Published rows are immutable, and **a version a chat references is never deleted**.
- **A case follows its type's current published version.** `case_chats.activity_type_version` and `evaluations.activity_type_version` record what ran:
  - a custom or system type records its version id
  - a built-in records `case_chat@<sha12 of the definition>`
  - every turn, `/run`, Re-evaluate and Preview use the chat's recorded version, so a publish mid-chat changes nothing for that chat
  - an unresolvable built-in sha falls back to the current built-in
- **Unknown or disabled type:**
  - New chats and grading get 409 `ACTIVITY_TYPE_UNAVAILABLE`.
  - Lists show "Unknown type" instead of returning a 500.
  - Only a **missing** value (legacy rows) means case chat. This is the lesson in `quizzer/activity_types.py`: a silent fallback produces a plausible wrong grade.
  - A disabled type still serves chats already in progress.
  - A type in use is never deleted, only disabled.
- **Who can do what:**
  - Admins with a new grantable `activity_types` permission (`utils/permissions.ts` `SUPERUSER_FUNCTIONS`, `server/middleware/permissions.js#requirePermission`; superusers always) create, edit, publish and restore types.
  - Instructors pick from published, enabled types on the case form.
- **Publishing** shows "used by N activities in M sections; chats started after this use the new version".

---

## 5. Completion and the signal channel

- **Built-ins keep "time is up"** byte for byte. The phrase match, Finish button, timer and Maximum Responses don't change.
- **Types with `signals.complete` or `signals.touchpoints`** get a platform rule: the AI ends a reply with `<studychat-signal>{"complete":true,"touchpoints":["cost"]}</studychat-signal>`, and only when something applies.
- **Parsing:** `utils/activityEngine/signals.js` parses and strips the block in `/api/llm/chat` before `appendTurns`. Replies aren't streamed, so this is safe.
  - Malformed blocks are dropped.
  - Any stray tag is neutralised in stored turns and transcripts, the way `formatTranscript` neutralises markers.
  - Signals are stored in `chat_turns.signals` JSON, never in `content`, so transcripts, grading and Issue Analytics never see them.
- **A student can talk the model into emitting the block**, so a signal only *offers* Finish. It never grades and never bypasses minimums.
  - New `POST /api/case-chats/:id/complete` enforces `require_minimum_exchanges` on the server (today that check is only in `App.tsx:960`).
  - It records `case_chats.completion_reason` (`time | max_exchanges | student | goal | instructor | canceled`).
  - "Goal reached" is kept on the chat row, so a page refresh still shows the bar.
- **Client:** a "Goal reached: Finish now / Keep talking" bar reuses the Maximum Responses ask bar. A new chat option, `end_on_goal` (default off), wraps up automatically.

---

## 6. New primitives

| Primitive | What | Storage | Notes |
|---|---|---|---|
| **Goal** | The learning objective, for the AI and the grader. Shown in the intro bar if the type's copy uses it | `cases.goal` TEXT | The generic coach framing also gets `{question}`, which today never reaches grading |
| **Assigned positions** | Capture method `assigned`. On `POST /case-chats` the **server** picks the side and ignores any position the client sends. The pick is balanced per assignment inside a transaction (fewest assigned first, ties broken by `sha256(seed:student_id:section_case)`), never `Math.random()`, so a retry gets the same side. The AI gets `{position}` and `{opposing_position}` | `'assigned'` added to three ENUMs: `section_cases.position_capture_method`, `course_case_versions.position_capture_method`, `case_chats.position_method` (also gains its missing `'none'`) | DEBATE needs exactly two positions per scenario. The scenario editor and the assignment refuse anything else |
| **Touchpoints** | Per scenario: `[{key, label, description}]`, AI-only | New `ai` subtree in `utils/scenarioSettings.js` (`validateAiSettings`; writer `SUBTREES` in `server/services/scenarioSettings.js`). `forStudent` already sends only `student` | Optional on every type, including the built-ins: the prompt text is added only when touchpoints exist, so prompts without them stay byte-identical |
| **Touchpoint hits** | Returned by the grader in the same call: `[{key, hit, evidence}]`. The evidence quote is checked verbatim against student turns (generalised `verifyEvidence`), then key and label are snapshotted | `evaluations.touchpoints` JSON | Results coverage; Issue Analytics seeds pass-3 themes from them |
| **Live touchpoints** | Types with `signals.touchpoints` report hits per turn | `chat_turns.signals` | Live checklist in Monitor |
| **Student submission** | Minimal (D6): the student uploads or pastes on the start screen, or the instructor uploads one per student. Converted by `server/services/fileConverter.js`, size-capped, and put in the **dynamic** part of the prompt as untrusted `<context type="student_submission">` | `student_submissions` (`id, section_id, case_id, student_id, uploaded_by, filename, converted_text, text_sha256, created_at`) | Never in packages. Add to the anonymize and backup notes |

**Persona kind:** keep the `audience-` id prefix for now. A `persona_kind` column would also change the package rule (`format.js:275`) and StudyChat-LTI, so it waits until a third kind is actually needed. That third kind would need a package token.

---

## 7. Chat options per type

- **Resolution order:** hardcoded → global default → section default → **type defaults (partial)** → case default settings → the assignment's own options.
  - This happens in `server/services/chatOptions.js#resolveChatOptions` / `getSectionCaseChatOptions`, which now receive the case's type.
  - Defaults are still **seeded once** when a case is attached (`activityDefaults.js`, `caseVersionSync.createCourseCase`, the `sectionCases.js` POST). Existing assignments never change underneath anyone.
  - The built-ins' type defaults are empty, so nothing changes for existing courses.
- **`teach_back_min_words` becomes `min_opening_words`**, enforced in `/api/llm/chat` with a 400 code. The old key stays readable as an alias.
  - `end_on_goal` and `min_opening_words` go into `DEFAULT_CHAT_OPTIONS`, so the package allow-list follows automatically.
  - Fix on the way: `caseChats.js:434-445` reads raw `chat_repeats` and skips the default chain.
- **The schema becomes type-aware:** `GET /api/chat-options/schema?activity_type=` applies the type's `hidden` and `extra` keys, replacing the per-field `activity_types` filter.
  - `CaseVersionEditor` is already schema-driven.
  - The hand-coded `Dashboard.tsx#renderChatOptionsTab` hides the same keys.
- **Section-level writers:** every new section-level writer (assigned capture, type defaults) goes through `requireSectionCaseManager` + `guardFollowedCaseSettings` on the server and `fetchSectionCaseSetting()` on the client (CLAUDE.md).

---

## 8. Wording reaches the client from the server

- **A student-safe `activity` object.** A whitelist function, `studentActivityView(definition)`, produces `{type, version, traits, labels, copy}` and never templates. It is added:
  - to student rows in `sectionCases.js#forStudent`
  - to the `POST /api/case-chats` response, from the pinned version, so the copy can't change mid-chat

  Staff read full definitions from `GET /api/activity-types`.
- **New `services/activityCopy.ts`** — `copyFor(activity, key, vars)`, filling slots with the same single-pass rule. It replaces every `teachBackMode` ternary and `TEACH_BACK_COPY`. `teachBack.ts` shrinks to the `audience-` helpers.
- **Student screens:**
  - `App.tsx`: start rows, persona picker, wrap-up and feedback phases, hint and minimum messages, position prompts
  - `ChatWindow.tsx`: tooltip and position prompt; no Kent Beck default
  - `Evaluation.tsx`: headings; free hints come from the options, not "one free hint"
  - `BusinessCase.tsx`: label
  - `TeachBackIntro.tsx` becomes `ActivityIntro.tsx`
- **Server wording:**
  - `positionInference.js`: its prompt takes the type's labels, and its model comes from the section (`services/modelChoice.js`) instead of `gemini-1.5-flash`.
  - Issue Analytics, prompt logs and transcript labels: a shared `aiSpeakerName(ctx)` (`chatPrompt.js`, which replaces `protagonistLabel`) used by `issueAnalytics/common.js`, `view.js`, `runner.js` and `scope.js`.
  - Transcript markers stay `[STUDENT …]` / `[PROTAGONIST …]`. They are a parsing contract (`utils/transcriptFormat.js`), not wording.
- **Dashboard:**
  - "Cases" becomes "Activities" on headers that mean all types.
  - `ScenarioManager.tsx` shows fields by trait: character fields are required only when `character: scenario`; arguments only when `ai_sees.arguments`; situation and openings when `saved_openings`; touchpoints; the two-position rule for `assigned`.
  - `CourseAssignments.tsx` gets the type badge.
  - `CaseVersionEditor.tsx` hides position settings when `positions: off`.

---

## 9. Packages carry types (D2)

- **Manifest.** A package whose activities use a system or custom type adds `activity_types.json`, holding the published definition and its sha256. The `plan_hash` covers it.
- **Capability tokens** (`capabilities.js`):
  - `activity_definition:1`, the schema version
  - one token per engine feature a definition uses: `signals:complete`, `signals:touchpoints`, `positions:assigned`, `material:student_submission`, `scenario_settings:ai`
  - built-ins keep `activity_type:case_chat` and `activity_type:teach_back`
  - an older server refuses the package (fail closed)
- **Install:**
  - Every definition goes through the same validator, channel rule included.
  - A type with the same key and the same sha is reused.
  - A same key with a different sha installs under a new custom key, never overwriting.
  - A new type is created **disabled, as a draft**, and only an admin may install it. An instructor gets a clear refusal.
  - The install plan shows every template in full (rule 7: package text is untrusted).
- **StudyChat-LTI** adopts the engine by copying `utils/activityEngine/` and the golden check, the same way it copied the builders.

---

## 10. Phases

Each phase ships on its own, with its own migration (new tables arrive with the code that reads them). Case chat and Teach-back must look and grade exactly as before at the end of every phase, apart from Phase 0's deliberate fixes.

### Phase 0: fixes (no new concepts)
- **`utils/documentRoles.js`.** `documentAudience(role)` returns `student`, `ai_only` or `instructor_only`; `instructor_notes` is `ai_only`.
  - `loadCaseData` keeps the AI prompt exactly as it is, but builds the student-visible supplementary text without `ai_only` roles. `/llm/case-data` returns only that text.
  - Also used by `caseFiles.js`, `activityPack/import.js:298` and `format.js`.
- **Grading context.** `/evaluations/run` (line 219), `/re-evaluate` and `/preview-prompt` use `loadChatContext()` case data, which includes the scenario protagonist and question. This deliberately changes the case-chat coach prompt where it fell back to "the case protagonist".
- **Position inference.**
  - `inferPositionAfterEvaluation` calls `shouldInferPositions` + `inferPositionsFromChat`, which read the `section_cases` settings.
  - Remove `inferPositionFromTranscript` and its reads of the legacy override.
  - Take the model from the section.
- **Speaker name.** Add `aiSpeakerName(ctx)` and use it in Issue Analytics (the Teach-back audience name instead of the scenario placeholder).
- **Server checks.** Enforce the Teach-back word floor on the server. Read `chat_repeats` through the default chain.
- **Copy.** Add the missing Teach-back feedback-phase copy. Make Evaluation's free-hint text follow `free_hints`.
- **Dead code.** Remove the `CEOPersona` enum, `ScenarioSelector.tsx` and `services/transcriptService.ts`.
- **Verify.**
  - `check-chat-prompt.js` is unchanged.
  - `check-activity-pack.js --db` passes.
  - `typecheck` reports 0 errors.
  - The student `/llm/case-data` payload has no instructor notes.
  - A Teach-back chat graded end to end gets an inferred position.

### Phase 1: the engine, with the built-ins as definitions (no visible change)
- **Goldens first.** Extend them (§3), then add `server/scripts/check-activity-engine.js`.
- **New engine module** `utils/activityEngine/`, pure with no `db` import:
  - `render.js` — `renderOnce`, wrappers, channels
  - `resolvers.js`
  - `validate.js`
  - `prompt.js`, `greeting.js`, `grading.js`
  - `builtins/case_chat.json`, `builtins/teach_back.json`
- **`server/services/activityTypes.js#activityBehaviour`** becomes an adapter over the engine with the same shape. Callers don't change: `chatPrompt.js`, `llm.js`, `evaluations.js`, `scenarios.js`.
- **`utils/activityTypes.js`** derives traits from the definitions.
- **Client.** Add `studentActivityView` in `forStudent` and `POST /case-chats`. Add `services/activityCopy.ts`. App.tsx, ChatWindow, Evaluation and `ActivityIntro.tsx` read the copy. `TEACH_BACK_COPY` is deleted.
- **Chat options.** Add the type-default layer (empty for the built-ins), `min_opening_words`, and the `?activity_type=` schema parameter.
- **Migration 090.** Add `case_chats.activity_type_version` and `evaluations.activity_type_version`, written in the `caseChats.js` POST and in `/run`. Include the type version in the Issue Analytics prompt hash, so a changed type definition never reuses stale cached facts.
- **Verify.** Goldens are triple-equal. Run one case chat and one Teach-back as a dev student (`server/scripts/dev-student-token.js`). Prompt logs (Admin → Logging) are identical to the ones captured before. Student screens read the same.

### Phase 2: type storage, packages, and the minimal admin flow
- **Migration 091.** Create `activity_types` and `activity_type_versions`, with rows seeded for the two built-ins. Grant the `activity_types` permission.
- **`server/services/activityTypeStore.js`.** Built-ins plus the database, cached by version. Enforces the unknown-type refusal (`ACTIVITY_TYPE_UNAVAILABLE`).
- **`server/routes/activityTypes.js`.** List, clone, save draft (validator), preview the assembled prompt for a chosen case and scenario (reusing the Preview prompt flow), publish, restore.
- **Minimal UI.** Admin → Activity Types (`Dashboard.tsx` sub-tab, `components/ActivityTypeEditor.tsx`): list, Clone, a sectioned form with a raw-JSON fallback, Preview, Publish, history.
- **Case form.** The type picker reads `/api/activity-types`.
- **Packages.**
  - `capabilities.js`: tokens
  - `format.js`: validator
  - `export.js`: writes `activity_types.json`
  - `import.js`: reuse by sha; otherwise a new disabled draft, admin only
  - `components/CasePackages.tsx`: shows the definitions
- **New check script `check-activity-definitions.js`.** It must refuse an AI-only slot in a greeting, an unknown slot, oversize fields, and a traits change on a published key.
- **Extend `check-activity-pack.js`.** Add round trips with a custom type, a sha mismatch, an instructor installing a new type, and a missing feature token.

### Phase 3: DEBATE, APPLY, LIKEN2ME
- **Migration 092.** Add the `'assigned'` ENUM value (three columns, plus `'none'` on `case_chats.position_method`), and `cases.goal`.
- **Server-side side assignment.**
  - `caseChats.js` POST picks the side.
  - Add `{position}` / `{opposing_position}` / `{goal}` slots.
  - `activityDefaults.js#CAPTURE_METHODS`, `caseVersionSync.js` and the Assignments position settings offer `assigned` only when the type allows it.
- **UI.**
  - `ScenarioManager.tsx`: fields by trait.
  - Case form: a Goal field.
  - `ActivityIntro` shows the goal.
- **Seeded system types.** `npm run seed-activity-types` creates the data definitions (it never overwrites edited rows; `--force` exists, as with `seed-audiences`), plus starter rubrics:
  - **DEBATE**: the AI is the opponent; positions required, two per scenario, assigned or chosen; arguments on; ends on time or Maximum Responses.
  - **APPLY**: the AI is a client in a new situation (scenario character); the student acts as consultant; touchpoints optional.
  - **LIKEN2ME**: the AI is a reflective mentor (persona character); no positions; Finish button on by default. Privacy note below.
- **Verify.**
  - Assignment is deterministic: the same side on retry, and balanced across 4 dev students.
  - Each type works end to end through grading.

### Phase 4: PITCH and ROLEPLAY (signals and touchpoints)
- **Migration 093.**
  - `case_chats.completion_reason`
  - `case_chats.goal_reached_at`
  - `chat_turns.signals`
  - `evaluations.touchpoints`
- **Signals.**
  - `signals.js`: strip the block in `/api/llm/chat` and return `meta.signals`.
  - `POST /api/case-chats/:id/complete` enforces the minimum on the server.
  - App.tsx shows the Goal-reached bar.
  - Add the `end_on_goal` option.
  - `completion_reason` is written on every end path.
- **Touchpoints.**
  - The `ai` subtree, plus a `ScenarioManager.tsx` editor.
  - A hidden-guide block in the prompt.
  - The grader's output fields go into the platform block; update `evaluationNormalizer.js`.
  - Results coverage view in `components/Analytics.tsx`.
  - Issue Analytics pass-3 seeding in `issueAnalytics/runner.js`.
  - Monitor live checklist in `components/LiveSessionMonitor.tsx`.
- **Seeded types.**
  - **PITCH**: a skeptical investor or buyer; the touchpoints are its objections; the goal is a decision.
  - **ROLEPLAY**: a counterpart such as an upset customer; the goal is a resolution.
- **Verify.**
  - The signal never appears in `chat_turns.content`, transcripts or the student view.
  - A forged block typed by the student cannot end the chat below the minimum.
  - Touchpoints show live in Monitor and in Results after grading.

### Phase 5: the full admin editor
- **Editor.** Diff between versions. Preview with the fixture inputs. A **Test chat**, where the admin chats with a draft as a student. It is billed to the admin through `usageGuard` and is not recorded as a student chat.
- **Help.** `help/dashboard/ActivityTypesHelp.tsx`.
- **Docs.** `docs/activity-types.md`.
- **CLAUDE.md** section (§11).

### Phase 6: DEFEND (minimal, D6)
- **Migration 094.** Create `student_submissions`.
- **Start screen.** An upload or paste step when `material: student_submission`.
- **Instructor upload** from the Students screen.
- **Results** shows the submission beside the transcript.
- **Packages.** Add the `material:student_submission` token.
- **Seeded type.** **DEFEND**: the AI examiner asks about the submission; ends on turns or time.

### Later (not in this plan)
- **Activity Writer:** a type-aware Case Writer. Load the `case-writer` skill first.
- AI-simulated student test runs.
- Multi-stage chats.
- Character templates, and the link-or-copy template library (preliminary §3a).
- A `persona_kind` column.
- Updating installed packages in place.

---

## 11. Rules to add to CLAUDE.md (each fails silently if broken)

1. **Every prompt a type produces comes from `utils/activityEngine/`.** Never test a type key elsewhere; add a trait or a resolver instead.
2. **Built-in output is golden.** Run `node server/scripts/check-activity-engine.js` after touching the engine or a built-in. A deliberate change updates the fixture in the same commit.
3. **Templates render once (`renderOnce`), with snake_case slots.** A slot that is unknown in a field's channel is refused at save, publish and install, never ignored at render. AI-only slots never appear in `student` channel fields.
4. **An unknown type refuses** at chat start and at grading. Only a *missing* type means case chat.
5. **A chat runs and is graded on the type version it started with.** Traits are fixed for a type key; changing one requires a clone.
6. **Signals are stripped before storage.** A signal only offers Finish; minimums are enforced on the server.
7. **Students receive `studentActivityView()` only**, never templates.
8. **Touchpoint and evaluation results store key and label snapshots.**
9. **Every engine feature a definition can use needs a package capability token.**
10. **`utils/activityEngine/` has no database imports**, so StudyChat-LTI can copy it verbatim.

---

## Questions and ideas for you (none block Phase 0–2)

- **LIKEN2ME and personal content.** Students will write about their own lives, and today those transcripts go to Issue Analytics and appear in instructor views with names. I suggest a type trait, `personal: true`, that hides names by default everywhere, leaves Issue Analytics off unless the instructor turns it on, and shows students a one-line notice before the chat. OK?
- **DEBATE with more than two sides.** The plan limits DEBATE to two positions. Multi-sided debates would need an "opposes" map. Worth it later?
- **Idea: show the goal to students.** A one-line "In this activity you will…" from `cases.goal` in the intro bar for every type, case chat included. This is a visible change for existing courses, so it would be an opt-in chat option.
- **Idea: AI-simulated student runs** (Later list). When an admin publishes a type, run a weak and a strong simulated student through it and show both grades. This is the cheapest way to catch a broken template before students see it.

---

## Verification (every phase)

- Run `node server/scripts/check-activity-engine.js`. From Phase 2, also run `check-activity-definitions.js`.
- Run `node server/scripts/check-activity-pack.js --db`.
- `npm run typecheck` must report 0 errors.
- Run `npm run migrate:dry`, then `npm run migrate` on the dev `ceochat` database.
- With `npm run dev:all` and a dev student token, run one chat of each built-in type, plus each type added in that phase, through grading. Then check:
  - Results, Positions and Issue Analytics for those chats
  - the transcript markers
  - the student network payload, which must contain no teaching note, arguments, scenario instructions, persona instructions, templates or `instructor_notes`
