# Build the student chat prompt on the server

Status: **built 2026-10-09** (Phase 3a of [`security-student-data-access.md`](security-student-data-access.md)). Server-side grading and server-held history (Phase 3b) are not started; see [Still open](#still-open-phase-3b).

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

## Still open (Phase 3b)

Until these are built, a signed-in student can still invent the conversation the model sees, and post their own score:

- **Server-held conversation.** `/api/llm/chat` still accepts `history` from the browser. The server should store each turn (the `transcripts` row or a turns table) and send its own copy to the model.
- **Grade from the server's copy.** `POST /api/evaluations/run` should read the stored transcript and save the evaluation row itself. It should also take the supervisor model from the section, as `POST /case-chats` now does for the chat model. The browser would then submit only feedback (`helpful`, `liked`, `improve`) through a student-owned update, and `POST /api/evaluations` would stop accepting a score.
