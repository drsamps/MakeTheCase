# Build the student chat prompt on the server

Status: **built 2026-10-09 (prompt, Phase 3a) and 2026-10-10 (conversation and grading, [Phase 3b](#phase-3b-the-server-keeps-and-grades-the-conversation))** of [`security-student-data-access.md`](security-student-data-access.md). Not yet deployed.

## Why

Until 2026-10-09 the student's browser built the whole chat system prompt and sent it to `/api/llm/chat`:

- `App.tsx#startConversation` merged the scenario's `prompt_instructions` and the position `arguments_for` / `arguments_against` into `caseData`.
- `services/llmService.ts#createChatSession` turned that into a prompt with `buildSystemPrompt` (`constants.ts`) or `buildTeachBackSystemPrompt` (`teachBackPrompt.ts`).
- `server/routes/llm.js` `POST /chat` passed the `systemPrompt` it received straight to the model.

So every AI-only field had to reach the browser: the teaching note, scenario instructions, argument framework and persona instructions. A student could read all of it in the network tab, and could send any prompt they liked.

## Decisions (made 2026-10-09)

1. **Student name: the browser sends it with each message.** No migration. The server cleans it before it goes into the prompt (`chatPrompt.js#sanitizeStudentName`): letters, marks, digits, spaces, apostrophes, periods and hyphens only, whitespace collapsed, at most 40 characters, `Student` when empty. That strips prompt markers (`===`), tags and `{placeholders}`.
2. **Outdated pages are refused right away.** A `/api/llm/chat` request that still carries `systemPrompt` gets 409 `CLIENT_OUTDATED`, "This page was updated. Please refresh it to continue." A student mid-chat during the deploy loses that chat, so deploy outside class hours.
3. **Supplementary materials stay visible to students.** `/api/llm/case-data` keeps sending `supplementary_content`; only the teaching note is removed. Whether to show supplementary materials in the case panel is a separate question.

## What was built

- **Templates:** `server/services/chatPromptTemplates.js` holds `buildSystemPrompt` (case chat) and `buildTeachBackSystemPrompt`, ported from the browser. They live on the server only: the browser no longer needs them, so the plan's shared `utils/` module was unnecessary. `constants.ts` keeps only `CaseData` and `DEFAULT_CASE_DATA`; `teachBackPrompt.ts` is deleted.
- **Byte-for-byte check:** `node server/scripts/check-chat-prompt.js` compares the templates against `server/scripts/fixtures/chat-prompt-golden.json`. That file holds 12 input sets and the exact strings the original TypeScript builders produced for them (captured before the move): both modes, every built-in persona, a custom persona, scenario instructions, both/one/no arguments, teaching note present, empty and whitespace-only, supplementary present and whitespace-only, personality, `freeHints` 0/1/2/3. A deliberate wording change must update the fixture in the same commit.
- **Loader:** `server/services/chatPrompt.js#buildChatSystemPrompt(chat, studentName)` reads the `case_chats` row and gathers what `App.tsx` used to: `loadCaseData`, the chat's scenario, the starting position's arguments (overriding the scenario's), the assignment's resolved chat options (`server/services/chatOptions.js`, moved out of `sectionCases.js`), and the persona row, looked up only in the assignment's allowed list. Teach-back swaps the audience persona in as the listener.
- **`POST /api/llm/chat`** takes `{ caseChatId, studentName, message, messageAt, history }`. Students only, on their own chat. The model and case come from the chat record; the billed instructor comes from the token's student and that case.
- **`POST /api/case-chats`** chooses the chat model itself: the section's chat model, else the default model, else the first enabled one (what the browser used to choose). The body's `chat_model` is ignored.
- **A chat needs its record.** Starting a chat shows an error if `POST /case-chats` fails (it used to carry on untracked), and **Restart Chat now creates a new chat record**. Before, a restarted chat had no record at all.
- **What students receive:**
  - `/api/llm/case-data`: no `teaching_note`.
  - `GET /api/sections/:id/cases`: `sectionCases.js#forStudent` removes scenario `prompt_instructions`, position `arguments_for` / `arguments_against`, persona `instructions` and `chat_options.chatbot_personality`.
  - `GET /api/sections/:id/active-case` was open with no login and returned the same AI-only fields. Nothing calls it, so it now needs a login and uses `forStudent` too.
  - Staff still get full rows.

### Two deliberate changes in what the AI sees

- **Scenario-level arguments are now included.** The student cases route never selected `case_scenarios.arguments_for` / `arguments_against`, so the browser silently dropped them; only position arguments ever reached the AI. On the dev copy (2026-10-09), 6 scenarios have scenario-level arguments.
- **A position picked in the chat now applies.** With explicit position capture, the browser built the prompt before the student picked a position and never rebuilt it, so position arguments applied only when the position was chosen on the start screen. The server reads `case_chats.initial_position_id` on every turn.

Everything else matches the browser's prompt byte for byte.

## How it was checked (2026-10-09, dev)

- `check-chat-prompt.js`: 12/12 golden cases match.
- API checks (scratch script, 20/20):
  - an old-shape request gets 409 `CLIENT_OUTDATED`; another student's chat gets 404;
  - the student payloads carry no `prompt_instructions`, arguments, persona `instructions` or `chatbot_personality`, while staff payloads still do;
  - `/llm/case-data` has no `teaching_note` for students;
  - `active-case` gets 401 without a login;
  - a new chat's model comes from the section, not the body.
- Browser, as a dev student (`server/scripts/dev-student-token.js`):
  - a Zipcar case chat with an opening position, Restart (new record, chat continues), four exchanges, Finish, final position and evaluation;
  - a Teach-back chat ("Your grandmother") that replied in character.

  The server-built prompts were inspected for both: the case chat had the position's arguments and the student's name; Teach-back had the listener line and "Who You Are", and no teaching note or arguments.
- Not yet done: compare prompt logs before and after for the same chat setup, and watch the cache-hit rate in Monitor → AI Usage over the next days.

## Phase 3b: the server keeps and grades the conversation

Built 2026-10-10. Before it, the browser sent the whole conversation with every turn and again for grading, then saved the score and the transcript itself, so a signed-in student could invent what the model saw, what was graded, their score and the transcript instructors read.

**Decision (2026-10-10): the server writes the transcript.** It always matches what was graded and cannot be faked. The cost: the browser-only lines are no longer in it. Those are the canned feedback questions and the student's answers (still saved on the evaluation as `helpful` / `liked` / `improve`), the "finish" message and wrap-up, and refused-hint, minimum-exchange and too-short warnings.

- **`chat_turns` (migration 082)** holds each chat's conversation. Turn 0 is the AI's greeting; after it come the student/AI pairs the model actually answered. `server/services/chatTurns.js` lists and appends turns (locking the chat row so a double send cannot collide), shapes them for the model and the grader, and writes the transcript.
- **`POST /api/case-chats`** takes `student_name`, writes the greeting as turn 0 (`chatPrompt.js#buildGreeting`, moved from `App.tsx` and `teachBack.ts`) and returns it as `data.greeting`; the browser shows that text.
- **`POST /api/llm/chat`** takes `{ caseChatId, studentName, message }`. It sends the model the stored turns, then appends the exchange and rewrites the transcript (when `auto_save_transcript` is not false). A failed turn stores nothing. A completed, cancelled or killed chat gets 409 `CHAT_ENDED`.
- **`POST /api/evaluations/run`** takes `{ case_chat_id, feedback: { helpful, liked, improve }, share_transcript }`. Steps:
  1. It grades the stored turns, using the section's supervisor model (`services/modelChoice.js`) and the assignment's rubric (else the default).
  2. It saves the evaluation row, with the cleaned feedback, and marks the chat completed.
  3. It writes the final transcript, using the browser's old rule: save when auto-save is on, the assignment always saves, or the student agreed to share.
  4. It runs AI position inference in the background.

  A chat that already has an evaluation gets 409 `ALREADY_EVALUATED`. A request with `chatHistory` gets 409 `CLIENT_OUTDATED`.
- **Removed or restricted:**
  - `POST /api/evaluations` is removed; its position-inference code is now `inferPositionAfterEvaluation()`.
  - `POST /api/transcripts` and `PUT /api/transcripts/chat/:id` are admin-only.
  - The browser's `buildTranscript()`, auto-save, evaluation insert and rubric fetch are gone.

**Grading changes that follow from grading the stored turns.** Only exchanges the model answered are graded. The browser used to send everything on screen, including feedback answers (where "hint" in an answer was counted as a hint request) and refused hint requests. `free_hints` now comes from the resolved chat options (assignment, else section or global default), as the chat prompt already did; `/run` used to read only the assignment's own options.

**Checked (dev, 2026-10-10):**
- API checks (10/10):
  - the greeting is returned and stored as turn 0, with the name cleaned;
  - old-shape `/run` gets 409, and `/run` with no student turns gets 400;
  - removed `POST /evaluations` gets 404;
  - a student's transcript POST or PUT gets 403;
  - a cancelled chat gets `CHAT_ENDED`, and a graded chat gets `ALREADY_EVALUATED`.
- Browser, a full Zipcar case chat:
  - an opening position, a hint, three explanations, feedback (5, liked, improve), final position and grading;
  - the database then held 9 turns, the evaluation (score 7, feedback, section supervisor model, rubric 1), status `completed`, and a transcript built from the turns with markers and timing;
  - the browser sent no transcript or evaluation writes.
- Teach-back greeting from the server: "Hi Scott, I'm your grandmother. …", the same as the old browser text.
