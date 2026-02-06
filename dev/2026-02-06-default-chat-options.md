The `defaultChatOptions` are hardcoded in **three places**:

## 1. **Frontend** - `components/Dashboard.tsx` (lines 489-511)

```typescript:489:511:components/Dashboard.tsx
  const defaultChatOptions = {
    hints_allowed: 3,
    free_hints: 1,
    ask_for_feedback: false,
    ask_save_transcript: false,
    allowed_personas: 'moderate,strict,liberal,leading,sycophantic',
    default_persona: 'moderate',
    show_case: true,
    show_timer: true,
    do_evaluation: true,
    show_evaluation_details: true,
    chatbot_personality: '',
    chat_repeats: 0,
    save_dead_transcripts: false,
    allow_repeat: false,
    timeout_chat: false,
    allow_finish_button: false,
    restart_chat: false,
    allow_exit: false,
    require_minimum_exchanges: 0,
    max_message_length: 0,
    disable_position_tracking: false
  };
```

**Used for:** The instructor dashboard's Chat Options UI when no data is available from the API.

---

## 2. **Frontend** - `App.tsx` (lines 127-139)

```typescript:127:139:App.tsx
  const defaultChatOptions = {
    hints_allowed: 3,
    free_hints: 1,
    ask_for_feedback: false,
    ask_save_transcript: false,
    allowed_personas: 'moderate,strict,liberal,leading,sycophantic',
    default_persona: 'moderate',
    allow_repeat: false,
    timeout_chat: false,
    allow_finish_button: false,
    restart_chat: false,
    allow_exit: false
  };
```

**Used for:** Fallback defaults in the student chat interface (when API returns no chat options).

**Note:** This one is **incomplete** - missing several fields like `show_case`, `show_timer`, `chat_repeats`, etc.

---

## 3. **Backend** - `server/routes/chatOptions.js` (lines 7-37)

```typescript:7:37:server/routes/chatOptions.js
const DEFAULT_CHAT_OPTIONS = {
  // Hints configuration
  hints_allowed: 3,
  free_hints: 1,
  // Feedback options
  ask_for_feedback: false,
  ask_save_transcript: false,
  // Persona options
  allowed_personas: 'moderate,strict,liberal,leading,sycophantic',
  default_persona: 'moderate',
  // Display and flow options
  show_case: true,
  show_timer: true,              // Show countdown timer during chat
  do_evaluation: true,
  show_evaluation_details: true, // Show full evaluation criteria vs just score
  // Chatbot personality customization
  chatbot_personality: '',
  // Multi-chat options
  chat_repeats: 0,           // 0 = one chat only, 1+ = can repeat N times
  save_dead_transcripts: false,  // Save transcripts for abandoned/canceled/killed chats
  // Chat control options
  allow_repeat: false,
  timeout_chat: false,
  allow_finish_button: false,
  restart_chat: false,
  allow_exit: false,
  require_minimum_exchanges: 0,  // 0 = no minimum, N = require N exchanges before "time is up"
  max_message_length: 0,         // 0 = unlimited, N = max N characters per message
  // Position tracking override (position config is now per-scenario)
  disable_position_tracking: false  // Override to disable scenario-level position tracking
};
```

**Used for:** Ultimate fallback when no defaults exist in the `chat_options_defaults` database table.

---

## Recommendation:

The **App.tsx** version (student-facing) should be updated to match the complete set of options to avoid missing fields when defaults aren't available from the database. Would you like me to update it?