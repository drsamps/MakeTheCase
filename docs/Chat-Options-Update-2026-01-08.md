# New Chat Control Options - January 8, 2026

## Summary

Added four new chat control options to the Case Assignments configuration, giving instructors more fine-grained control over student chat sessions.

## New Chat Options

### 1. Allow Repeat (`allow_repeat`)
**Purpose**: Allow students to repeat the chat multiple times, even after completing it.

**Behavior**:
- When **enabled**: Students can start new chat sessions for the same case, even if they've already completed it and received an evaluation
- When **disabled**: Students can only complete the case once (unless the instructor manually enables "allow rechat" for a specific student's evaluation)

**Use Cases**:
- Practice cases where students benefit from multiple attempts
- Low-stakes assignments where repetition is encouraged
- Cases with multiple scenarios where students should try different approaches

**Database**: Stored in `section_cases.chat_options` JSON field as `allow_repeat` (boolean)

---

### 2. Timeout Chat (`timeout_chat`)
**Purpose**: Automatically end the chat when the time limit expires.

**Behavior**:
- When **enabled**: When the chat timer reaches zero, the system automatically submits "time is up" and proceeds to the feedback/evaluation phase
- When **disabled**: The timer shows the elapsed/remaining time, but does NOT automatically end the chat when time expires (student must manually submit "time is up")

**Use Cases**:
- Timed exams or assessments where strict time limits must be enforced
- Simulations of real-world time-constrained scenarios
- Cases where time management is part of the learning objective

**Technical Note**: Works in conjunction with scenario-based time limits (`case_scenarios.chat_time_limit`)

**Database**: Stored in `section_cases.chat_options` JSON field as `timeout_chat` (boolean)

---

### 3. Restart Chat (`restart_chat`)
**Purpose**: Allow students to restart the current chat session.

**Behavior**:
- When **enabled**: A "Restart Chat" button appears in the chat interface during active chats
- When clicked: Student is prompted to confirm, then the current chat is marked as "canceled" and a fresh chat session begins with the same case/scenario
- Previous chat progress is lost
- A new `case_chat` record is created

**Use Cases**:
- Cases where students may want to try a different approach mid-conversation
- Practice sessions where mistakes should be easily recoverable
- Cases with multiple valid strategies that students want to explore

**Database**: Stored in `section_cases.chat_options` JSON field as `restart_chat` (boolean)

---

### 4. Allow Exit (`allow_exit`)
**Purpose**: Provide an exit button for students to leave the chat before completing it.

**Behavior**:
- When **enabled**: An "Exit Chat" button appears in the chat interface during active chats
- When clicked: Student is prompted to confirm, then the chat is marked as "canceled" and they return to the case selection screen
- Chat progress is lost
- Student can start a new chat session (subject to `allow_repeat` and completion rules)

**Use Cases**:
- Optional practice cases where students should be able to opt out
- Cases where students might realize they need to study more before continuing
- Scenarios where student choice and autonomy is important

**Database**: Stored in `section_cases.chat_options` JSON field as `allow_exit` (boolean)

---

## Files Modified

### Type Definitions
**File**: `types.ts`
- Added four new fields to `ChatOptions` interface:
  - `allow_repeat: boolean`
  - `timeout_chat: boolean`
  - `restart_chat: boolean`
  - `allow_exit: boolean`

### Backend (No Changes Required)
- All new options are stored in existing `section_cases.chat_options` JSON field
- No database schema changes needed
- Existing API endpoints handle JSON fields dynamically

### Frontend - Dashboard
**File**: `components/Dashboard.tsx`

**Changes**:
1. Updated `defaultChatOptions` object (lines 288-302):
   - Added defaults for all four new options (all `false`)

2. Added UI controls in Case Assignment > Chat Options section (lines 2750-2789):
   - New "Chat Control Options" section with four checkboxes
   - Each checkbox is bound to the corresponding chat option
   - Labels clearly explain what each option does

### Frontend - Student Interface
**File**: `App.tsx`

**Changes**:

1. Updated `defaultChatOptions` object (lines 118-129):
   - Added defaults for all four new options

2. Added handler functions (lines 1081-1136):
   - `handleExitChat()`: Cancels current chat and returns to case selection
   - `handleRestartChat()`: Cancels current chat and immediately starts a new one

3. Modified timer auto-end behavior (lines 1527-1540):
   - `timeout_chat` option now controls whether timer auto-ends the chat
   - If `timeout_chat` is false, timer displays but doesn't auto-submit

4. Added chat control buttons (lines 1560-1582):
   - Buttons appear during CHATTING phase if options are enabled
   - "Restart Chat" button (blue) - only if `restart_chat` is enabled
   - "Exit Chat" button (red) - only if `allow_exit` is enabled
   - Both disabled while AI is responding

5. Modified completion checking logic (lines 1228-1238):
   - `allow_repeat` option now overrides completion status
   - Students can rechat if `allow_repeat` is true OR evaluation has `allow_rechat` enabled

## How to Use (Instructor Guide)

### Configuring Chat Options

1. Go to **Dashboard** > **Manage** > **Case Assignments**

2. Select the section you want to configure

3. Find the case in the list and click the **gear icon** (⚙️) to expand Chat Options

4. Scroll down to the **Chat Control Options** section

5. Check/uncheck the desired options:
   - ☑ **Allow students to repeat the chat multiple times** (allow_repeat)
   - ☑ **Auto-end chat when time limit expires** (timeout_chat)
   - ☑ **Allow students to restart the chat** (restart_chat)
   - ☑ **Provide exit button to leave chat** (allow_exit)

6. Click **Save Options**

### Recommended Configurations

**Practice/Low-Stakes Cases**:
- ✅ Allow Repeat
- ❌ Timeout Chat
- ✅ Restart Chat
- ✅ Allow Exit

**Timed Assessments**:
- ❌ Allow Repeat
- ✅ Timeout Chat
- ❌ Restart Chat
- ❌ Allow Exit

**Flexible Learning**:
- ✅ Allow Repeat
- ❌ Timeout Chat
- ✅ Restart Chat
- ✅ Allow Exit

**Formal Evaluation**:
- ❌ Allow Repeat
- ✅ Timeout Chat
- ❌ Restart Chat
- ❌ Allow Exit

## Student Experience

### Exit Chat Button
- Location: Bottom of chat interface, right side, red button
- Action: Confirms exit, marks chat as "canceled", returns to case selection
- Confirmation: "Are you sure you want to exit this chat? Your progress will be lost and you may need to start over."

### Restart Chat Button
- Location: Bottom of chat interface, right side, blue button
- Action: Confirms restart, marks current chat as "canceled", immediately starts fresh chat
- Confirmation: "Are you sure you want to restart this chat? All your current progress will be lost."

### Timeout Auto-End
- When enabled: Chat automatically submits "time is up" when timer reaches zero
- When disabled: Timer shows time but does not auto-end chat
- Student can manually type "time is up" or "time's up" to end chat

### Allow Repeat
- When enabled: "Start Chat" button remains active even after completing the case
- When disabled: "Case Already Completed" message appears instead of "Start Chat"
- Overrides completion status for that specific section-case assignment

## Technical Implementation Details

### Database Schema
No schema changes required. All options stored in existing JSON field:
```sql
section_cases.chat_options = {
  "hints_allowed": 3,
  "free_hints": 1,
  "ask_for_feedback": false,
  "ask_save_transcript": false,
  "allowed_personas": "moderate,strict,liberal,leading,sycophantic",
  "default_persona": "moderate",
  "show_case": true,
  "do_evaluation": true,
  "chatbot_personality": "",
  "allow_repeat": false,       // NEW
  "timeout_chat": false,        // NEW
  "restart_chat": false,        // NEW
  "allow_exit": false           // NEW
}
```

### API Impact
No new API endpoints required. Existing endpoints handle JSON fields:
- `GET /api/sections/:sectionId/cases` - Returns chat_options with new fields
- `PATCH /api/section-cases/:id` - Saves updated chat_options including new fields

### Chat Status Tracking
When student uses Exit or Restart buttons:
- Current `case_chat` record status set to `'canceled'`
- API endpoint: `PATCH /api/case-chats/:id/status`
- New chat session creates new `case_chat` record

### Completion Logic
```typescript
// Allow repeat if: allow_repeat is true OR evaluation has allow_rechat enabled
const allowRepeat = chatOptions?.allow_repeat ?? false;
const isCaseCompleted = selectedCaseStatus?.completed
  && !selectedCaseStatus?.allowRechat
  && !allowRepeat;
```

## Testing Checklist

- [x] Frontend builds successfully without errors
- [ ] Dashboard UI shows all four new options in Chat Options panel
- [ ] Saving chat options persists all four new fields to database
- [ ] Exit button appears only when `allow_exit` is enabled
- [ ] Restart button appears only when `restart_chat` is enabled
- [ ] Timeout auto-end works when `timeout_chat` is enabled
- [ ] Timeout does NOT auto-end when `timeout_chat` is disabled
- [ ] Students can rechat when `allow_repeat` is enabled
- [ ] Students blocked from rechat when `allow_repeat` and `allow_rechat` are both false
- [ ] Exit button cancels chat and returns to case selection
- [ ] Restart button cancels chat and starts new session
- [ ] All confirmation dialogs appear before destructive actions

## Next Steps

1. Test in development environment:
   ```bash
   npm run dev:all
   ```

2. Access dashboard at `http://localhost:3000/#/admin`

3. Configure a test case with each option enabled

4. Test student experience for each option

5. Verify database persists chat options correctly

6. Deploy to production after testing

---

**Date**: 2026-01-08
**Author**: Claude Code Assistant
**Version**: 1.0
**Status**: Ready for testing
