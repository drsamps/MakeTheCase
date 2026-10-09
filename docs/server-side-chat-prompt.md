# Plan: build the student chat prompt on the server

Status: **planned, not started** (written 2026-10-02). Three decisions below must be made before building.

## Why

The student's browser builds the whole chat system prompt today and sends it to `/api/llm/chat`:

- `App.tsx#startConversation` merges the scenario's `prompt_instructions` and the scenario/position `arguments_for` / `arguments_against` into `caseData`.
- `services/llmService.ts#createChatSession` turns that into a prompt with `buildSystemPrompt` (`constants.ts`) or `buildTeachBackSystemPrompt` (`teachBackPrompt.ts`).
- `server/routes/llm.js` `POST /chat` passes the `systemPrompt` it receives straight to the model.

So every "AI-only" field has to reach the browser. That means the teaching note, supplementary materials, scenario instructions, argument framework and persona instructions. A student can read all of it in the network tab: in `GET /api/llm/case-data/:caseId`, in `GET /api/sections/:id/cases`, and in the body of every chat request.

What is already done (2026-10-02): those two GET routes and the dashboard-only scenario/position reads now require a login. Logged-in students can still read everything above. Only this rebuild fixes that.

### Comes after the login work in `security-student-data-access.md`

This is Phase 3 of [`security-student-data-access.md`](security-student-data-access.md). Its Phase 2 does the parts this plan relies on:
- Phase 2a: the login check on `/api/llm/chat`, `studentId` taken from the token, and removing `/api/llm/eval`;
- Phase 2b: `POST /case-chats` takes `student_id` from the token, and `requireChatOwner` checks the student owns the chat.

Two parts of that plan's Phase 3 are not built into the steps below yet. Add them before building:
- `POST /api/evaluations/run` grades the server's stored transcript and saves the evaluation itself; `POST /api/evaluations` stops accepting a score from the browser.
- The server stores the conversation, so `history` stops coming from the browser (step 3 still accepts it).

## Decide before building

1. **Where does the student's name come from?** It appears throughout the prompt ("You are … meeting with a junior business analyst, {name}"), and today it's the first name the student types at the start screen. It isn't stored anywhere.
   - **(a) Save it on the chat record (recommended).** Add a `student_display_name` column on `case_chats` (migration), written by `POST /case-chats`. Every turn then uses the same name, and the server owns the whole prompt.
   - **(b) The browser sends it with each message.** No migration, but the browser still supplies part of the prompt. The name would need length limits and stripping of prompt markers.
2. **Students mid-chat during the deploy.** Their open page still sends the old `{ systemPrompt, … }` body.
   - **(a) Accept the old shape briefly.** Keep accepting it (logged-in students only) for about a week, then remove it. No chat breaks, but the hole stays open for that week.
   - **(b) Refuse it right away (recommended if deploying outside class hours).** Reply 409 "This page was updated — please refresh." That student loses their current chat.
3. **Are supplementary materials meant for students to see?** Today they only go into the prompt (`=== SUPPLEMENTARY MATERIALS ===`), and the student never sees them on screen.
   - If they're **AI-only**, take them out of the student response like the teaching note.
   - If students **should** see them (exhibits, say), keep sending them and decide separately whether to show them in the case panel.

## Build steps

1. **One shared prompt builder.**
   - Move `buildSystemPrompt`, `buildTeachBackSystemPrompt`, `getPersonaInstructions` and `DEFAULT_PERSONA_INSTRUCTIONS` into a plain-JS `utils/chatPrompt.js` that server and browser can both import. `utils/transcriptFormat.js` already works this way.
   - Drop the legacy no-case fallback (`getSystemPrompt` + `DEFAULT_CASE_DATA` from `data/business_case`), or keep it only in the browser.
   - **Add a byte-for-byte test:** for a set of sample inputs, the old TypeScript builders and the new module must produce identical strings. Cover normal and teach-back modes, with/without scenario, position arguments, teaching note, supplementary content, custom persona and personality. Any difference breaks the provider prompt-cache prefix (`llmRouter.js` sets Anthropic `cache_control` on the system prompt) and makes old and new prompt logs hard to compare.
2. **Rebuild from the chat record on the server.** New `server/services/chatPrompt.js#buildChatSystemPrompt(caseChatId)`, which loads:
   - the `case_chats` row: `case_id`, `section_id`, `scenario_id`, `persona`, `initial_position_id`, plus the name if decision 1 is (a);
   - the section's `chat_options`, with section and global defaults applied. Move `resolveChatOptions` out of `routes/sectionCases.js` into a service so both can use it. This supplies `free_hints`, `chatbot_personality` and the activity mode (`resolveActivityMode`);
   - `loadCaseData(case_id)`, the `case_scenarios` row, and the starting position's arguments, which override the scenario's (same order as `App.tsx` today);
   - the persona row (`personaService.js`), including teach-back audience personas.

   Rebuilding every turn is fine at first, because `loadCaseData` reads cached `converted_text`. Add a short in-memory cache keyed by `caseChatId` only if timing shows a need.
3. **New chat request shape.**
   - `POST /api/llm/chat` takes `{ caseChatId, message, messageAt, history }` and requires `verifyToken`, `role === 'student'` and `case_chats.student_id === req.user.id`. Phase 2 of `security-student-data-access.md` adds the login and ownership checks first; this step adds the new body shape and the student-only role.
   - The model, case, section and billed instructor all come from the `case_chats` row, never the body. This also stops a browser from choosing who gets billed.
   - `chatFallback.js`, prompt logging (`promptLogger.js`) and hints need no changes, because they only see the finished prompt.
4. **Require the chat record.**
   - `App.tsx` `handleNameSubmit` currently continues when `POST /case-chats` fails ("chat tracking is optional"). Make that a visible error.
   - `POST /case-chats` takes `student_id` from the token, not the body (done in Phase 2b of `security-student-data-access.md`).
5. **Stop sending the hidden fields.**
   - `GET /api/llm/case-data/:caseId` for students: return only what the student sees (title, protagonist, role, question, `case_content` when `show_case` is on). Supplementary content depends on decision 3. Keep the full response for staff, or move it to a staff-only route.
   - `GET /api/sections/:id/cases` for `role === 'student'`: leave out `prompt_instructions`, `arguments_for` and `arguments_against` from scenarios and positions. Keep `position_name` and `position`, which the position picker shows.
   - Remove `prompt_instructions` / `arguments_*` from the browser's `CaseData` merge in `startConversation`.
6. **Deploy.** Follow decision 2. Deploy the browser bundle and the server together.

## How to check it works

- The byte-for-byte builder test passes.
- Dev chats work in normal and teach-back mode, including one scenario whose position has its own arguments.
- With Prompt Logging on, the before and after prompt logs for the same chat setup match.
- Monitor → AI Usage shows the same cache-hit rate over the following days.
- The browser network tab shows no teaching note, scenario instructions or arguments anywhere.
- A chat request with another student's `caseChatId` gets 403; one with no token gets 401.

## Docs to update when built

- `CLAUDE.md` § System Prompt Construction: the server builds the prompt; the browser never receives the hidden content.
- `docs/scenario-prompt-instructions-2026-04.md`: it says `constants.ts#buildSystemPrompt` reads `prompt_instructions`.
- `docs/multi-instructor-personas.md`: persona instructions passed into `buildSystemPrompt`.
