# Follow-up: Teach-back audience restates a clicked position as if it were taught

Status: open. Found while screen-testing commit `efdc851` (branch `teach-back`, 2026-10-15).

## Problem

With position tracking on and **Student selects position**, the clicked position is posted as the
student's first message, in the instructor's wording. The audience treats it as a first
explanation and restates it back. In testing it replied "So if I've got this, you mean more
variable demand makes possible demand… spread out wider…" before asking for an explanation.
`docs/teach-back-setup.md` (*Tracking positions*) promises that the audience asks the student to
explain it.

## Why the current fix only half works

- `server/routes/llm.js` adds `TEACH_BACK_POSITION_PICK_NOTE` (`server/services/activityTypes.js`)
  to the clicked message for that one AI call. The audience did ask the student to explain "from
  the very beginning", but it still restated the position first.
- Rule 2 of the Teach-back system prompt (`server/services/chatPromptTemplates.js`, "Understanding
  is earned, and it arrives in stages") says: "After a first explanation… say what you took in,
  then ask about the piece that is still missing". That standing rule beats a one-time note.
- The position stays in the conversation history as a normal student message. Later replies kept
  building on it: the next reply restated the "wider range" idea that only the position contained.

## Recommended fix: add a rule to the Teach-back system prompt

1. In the Teach-back template (`chatPromptTemplates.js`), add a rule along these lines:
   *"A student message may be a position the student picked from a list rather than their own
   words. If so, it tells you where they stand, not what they understand. Do not restate it or
   treat any of its reasoning as explained. Ask them to explain why, and count as understood only
   what they explain in their own words."*
2. The rule needs to know which message was a click. Either:
   - **(a)** say it generically, so the template stays the same for every chat. Simplest, and the
     cache prefix stays shared.
   - **(b)** store a marker on the turn, e.g. a `chat_turns.kind = 'position_pick'` column via a
     migration, and label that turn in the history sent to the model. More precise, but more work.
3. The system prompt must stay byte-for-byte stable because it is the cache prefix. After editing,
   run `node server/scripts/check-chat-prompt.js`. It will fail, so update the expected strings in
   `server/scripts/fixtures/chat-prompt-golden.json` in the same commit.
4. Once the rule is in place, remove `TEACH_BACK_POSITION_PICK_NOTE` and the position-pick check
   in `llm.js`, or keep the note as a reinforcement.

## Cheaper option (likely still partial)

Strengthen only the note text in `activityTypes.js`, e.g. "Do not begin with 'So if I've got
this'". This needs no fixture change, but it doesn't fix later replies building on the position.

## How to verify

Use a Teach-back case with two positions, one of them long and containing reasoning, and
**Student selects position** on. Click the long position and check that the first reply asks for
an explanation without restating it. Then type a thin explanation and check that the next reply
doesn't credit reasoning that only the position contained.

## Already handled in efdc851, so don't redo it

- Grading ignores the position and never quotes it (`teachBackEvalInputs`, the coach prompt's
  dynamic part, `verifyEvidence`).
- Minimum Words ignores it (`Message.positionPick` in `App.tsx`).
- The timer starts on the click.
