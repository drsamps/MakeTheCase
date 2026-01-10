## Chat Option improvement

The Instructor Dashboard "Case Assignments" has various "Chat Options" including
* hints
* Show case content in left panel
* Run evaluation after chat
* Ask for feedback at end of chat
* Ask to save anonymized transcript
* Default Persona
* Chatbot Personality (additional instructions)
Chat Control Options
* Allow students to repeat the chat multiple times
* Auto-end chat when time limit expires
* Allow students to restart the chat
* Provide exit button to leave chat
First, identify if each of these has actually been implemented in the code or if code adjustments are necessary.

Next, identify how these chat options might be organized into useful categories.

Then, identify what other chat options might be useful that I should consider adding.

Finally, since there are so many chat options, provide any recommendations for ways of improving the way chat options are coded and stored in the system, to allow them to be robust, extensible, and well documented. This may include creating a new "Chat Options" subscreen format.

Do not make any of these recommended changes but store the details at the end of this dev/2026-01-08-plan-chat-option-improvements.md file.

==============

Here is Claude's plan:
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
 Chat Options Analysis and Improvement Plan

 Task Summary

 Analyze current chat options implementation and provide recommendations for organization, new options, and code improvements.

 ---
 1. Implementation Status of Current Chat Options

 Fully Implemented (14 options)
 ┌─────────────────────┬──────────────┬────────────┬────────┐
 │       Option        │     Type     │  Default   │ Status │
 ├─────────────────────┼──────────────┼────────────┼────────┤
 │ hints_allowed       │ number       │ 3          │ FULL   │
 ├─────────────────────┼──────────────┼────────────┼────────┤
 │ free_hints          │ number       │ 1          │ FULL   │
 ├─────────────────────┼──────────────┼────────────┼────────┤
 │ ask_for_feedback    │ boolean      │ false      │ FULL   │
 ├─────────────────────┼──────────────┼────────────┼────────┤
 │ ask_save_transcript │ boolean      │ false      │ FULL   │
 ├─────────────────────┼──────────────┼────────────┼────────┤
 │ allowed_personas    │ string (CSV) │ all 5      │ FULL   │
 ├─────────────────────┼──────────────┼────────────┼────────┤
 │ default_persona     │ string       │ 'moderate' │ FULL   │
 ├─────────────────────┼──────────────┼────────────┼────────┤
 │ show_case           │ boolean      │ true       │ FULL   │
 ├─────────────────────┼──────────────┼────────────┼────────┤
 │ do_evaluation       │ boolean      │ true       │ FULL   │
 ├─────────────────────┼──────────────┼────────────┼────────┤
 │ chatbot_personality │ string       │ ''         │ FULL   │
 ├─────────────────────┼──────────────┼────────────┼────────┤
 │ chat_repeats        │ number       │ 0          │ FULL   │
 ├─────────────────────┼──────────────┼────────────┼────────┤
 │ allow_repeat        │ boolean      │ false      │ FULL   │
 ├─────────────────────┼──────────────┼────────────┼────────┤
 │ timeout_chat        │ boolean      │ false      │ FULL   │
 ├─────────────────────┼──────────────┼────────────┼────────┤
 │ restart_chat        │ boolean      │ false      │ FULL   │
 ├─────────────────────┼──────────────┼────────────┼────────┤
 │ allow_exit          │ boolean      │ false      │ FULL   │
 └─────────────────────┴──────────────┴────────────┴────────┘
 Partially Implemented (1 option)
 ┌───────────────────────┬─────────┬──────────────────────────────────────────────┐
 │        Option         │ Status  │                    Issue                     │
 ├───────────────────────┼─────────┼──────────────────────────────────────────────┤
 │ save_dead_transcripts │ PARTIAL │ Schema defined, minimal frontend integration │
 └───────────────────────┴─────────┴──────────────────────────────────────────────┘
 Conclusion: All listed chat options ARE implemented. The save_dead_transcripts option has backend support but limited usage.

 ---
 2. Recommended Category Organization

 Category A: Hint Settings

 - hints_allowed - Maximum number of hints
 - free_hints - Hints without score penalty

 Category B: Persona & AI Behavior

 - allowed_personas - Available personas for selection
 - default_persona - Pre-selected persona
 - chatbot_personality - Additional AI instructions

 Category C: Display Options

 - show_case - Show case content in left panel

 Category D: Chat Flow Control

 - allow_repeat - Allow repeating chat multiple times
 - timeout_chat - Auto-end when time expires
 - restart_chat - Allow restart during chat
 - allow_exit - Provide exit button
 - chat_repeats - Number of allowed repeats (legacy, overlaps with allow_repeat)

 Category E: Post-Chat Options

 - do_evaluation - Run AI supervisor evaluation
 - ask_for_feedback - Request student feedback
 - ask_save_transcript - Request transcript sharing permission

 Category F: Advanced/Admin

 - save_dead_transcripts - Save abandoned chat transcripts

 ---
 3. Suggested New Chat Options to Consider

 High Priority Additions

 1. require_minimum_exchanges (number, default: 3)
   - Require minimum N back-and-forth exchanges before allowing "time is up"
   - Prevents students from immediately ending chat
 2. show_timer (boolean, default: true)
   - Toggle visibility of countdown timer
   - Some instructors may want pressure-free environment
 3. allow_scenario_change (boolean, default: false)
   - Allow changing scenario mid-chat vs locked to initial selection
   - Currently hardcoded behavior
 4. max_message_length (number, default: 0=unlimited)
   - Limit student message length to encourage concise communication
   - Pedagogically useful for teaching brevity
 5. show_evaluation_details (boolean, default: true)
   - Toggle whether full evaluation criteria shown vs just score
   - Privacy/anxiety considerations

 Medium Priority Additions

 6. enable_notes (boolean, default: false)
   - Allow student to take notes during chat (saved but not evaluated)
 7. show_message_count (boolean, default: false)
   - Display running count of exchanges
 8. require_case_read (boolean, default: false)
   - Track/require that student scrolled through case before starting
 9. allow_model_selection (boolean, default: false)
   - Let students choose AI model (currently instructor-controlled)
 10. cool_down_period (number, minutes, default: 0)
   - Enforce waiting period between repeat attempts

 Lower Priority / Future Consideration

 11. enable_audio_mode (boolean, default: false)
   - Voice input/output option (future feature)
 12. collaborative_mode (boolean, default: false)
   - Allow multiple students in same chat (team exercise)
 13. instructor_observe (boolean, default: false)
   - Allow real-time instructor observation

 ---
 4. Code & Architecture Recommendations

 Current State Assessment

 - Chat options stored as JSON in section_cases.chat_options
 - Types defined in types.ts (ChatOptions interface)
 - Schema/defaults in server/routes/chatOptions.js
 - UI in Dashboard.tsx (~100 lines of toggles/inputs)
 - Logic scattered across App.tsx

 Recommended Improvements

 A. Create Centralized Chat Options Schema

 File: shared/chatOptionsSchema.ts

 export const CHAT_OPTION_SCHEMA = {
   hints: {
     label: 'Hint Settings',
     options: {
       hints_allowed: {
         type: 'number',
         label: 'Maximum Hints',
         default: 3,
         min: 0,
         max: 10,
         description: 'Maximum number of hints a student can request'
       },
       free_hints: {
         type: 'number',
         label: 'Free Hints',
         default: 1,
         min: 0,
         max: 10,
         description: 'Hints without score penalty'
       }
     }
   },
   persona: {
     label: 'Persona & AI Behavior',
     options: {
       allowed_personas: {
         type: 'multiselect',
         label: 'Available Personas',
         default: ['moderate','strict','liberal','leading','sycophantic'],
         description: 'Which personas students can choose from'
       },
       // ... etc
     }
   }
   // ... other categories
 };

 B. Schema-Driven UI Component

 File: components/ChatOptionsEditor.tsx

 - Renders form dynamically from schema
 - Supports collapsible category sections
 - Validates inputs against schema constraints
 - Shows descriptions as tooltips/help text
 - Single source of truth for UI

 C. Validation Layer

 File: shared/chatOptionsValidator.ts

 export function validateChatOptions(options: Partial<ChatOptions>): ValidationResult {
   // Validate against schema
   // Return errors/warnings
 }

 export function mergeChatOptions(custom: Partial<ChatOptions>): ChatOptions {
   // Merge with defaults, validate, return complete object
 }

 D. Migration Strategy

 1. Create shared/ directory for code shared between frontend/backend
 2. Move ChatOptions type to shared location
 3. Create schema definition
 4. Build ChatOptionsEditor component
 5. Update Dashboard to use new component
 6. Add validation to API endpoints
 7. Add migration for any new options

 E. Documentation

 Create docs/chat-options-reference.md with:
 - All options listed with descriptions
 - Category organization
 - Example configurations for common use cases
 - Version history of additions

 ---
 5. Implementation Steps

 1. Phase 1: Schema Definition (no breaking changes)
   - Create shared/chatOptionsSchema.ts
   - Create shared/chatOptionsValidator.ts
   - Update types.ts to import from shared
 2. Phase 2: UI Component (no breaking changes)
   - Create components/ChatOptionsEditor.tsx
   - Add collapsible category sections
   - Replace Dashboard.tsx inline editor with new component
 3. Phase 3: Validation (no breaking changes)
   - Add server-side validation
   - Add default value merging
 4. Phase 4: New Options (database migration)
   - Add new columns/defaults
   - Implement new behaviors
   - Update UI schema

 ---
 Files to Modify

 - types.ts - Update ChatOptions interface
 - server/routes/chatOptions.js - Update schema/defaults
 - components/Dashboard.tsx - Replace inline editor
 - App.tsx - Implement new option behaviors

 Files to Create

 - shared/chatOptionsSchema.ts - Centralized schema
 - shared/chatOptionsValidator.ts - Validation logic
 - components/ChatOptionsEditor.tsx - Dynamic form component
 - docs/chat-options-reference.md - Documentation

 ---
 Verification

 After implementation:
 1. Test each chat option toggle in instructor Dashboard
 2. Verify option persistence across page reloads
 3. Test student-facing behavior for each option
 4. Run existing test suite
 5. Test with various option combinations
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

## Implementation Summary (2026-01-08)

The following changes were implemented:

### 1. Collapsible Categories with Expand/Collapse All

Added collapsible category sections to the Chat Options tab in the Dashboard:
- **Hints** - hints_allowed, free_hints
- **Display & Flow** - show_case, show_timer, do_evaluation, show_evaluation_details, ask_for_feedback, ask_save_transcript
- **Persona** - default_persona
- **Custom Instructions** - chatbot_personality
- **Chat Controls** - allow_repeat, timeout_chat, restart_chat, allow_exit, require_minimum_exchanges, max_message_length
- **Advanced** - disable_position_tracking

Features:
- Each category has a clickable header to expand/collapse
- "Expand All" and "Collapse All" buttons at the top
- Triangle indicators show expanded/collapsed state

### 2. Four New Chat Options Implemented

#### 2.1 `show_timer` (boolean, default: true)
- Toggle visibility of countdown timer during chat
- Implemented in: `App.tsx` (conditionally renders ChatTimer)
- Dashboard control: Checkbox in Display & Flow section

#### 2.2 `require_minimum_exchanges` (number, default: 0)
- Require N exchanges before allowing "time is up"
- When student tries to end chat early, CEO responds asking to continue
- Implemented in: `App.tsx` (handleSendMessage function)
- Dashboard control: Number input in Chat Controls section

#### 2.3 `max_message_length` (number, default: 0 = unlimited)
- Limit characters per student message
- Shows character count when limit is set
- Red border and disabled send button when over limit
- Implemented in: `MessageInput.tsx`
- Dashboard control: Number input in Chat Controls section

#### 2.4 `show_evaluation_details` (boolean, default: true)
- Toggle full evaluation criteria vs just overall score
- When false, hides individual criterion scores and feedback
- Implemented in: `Evaluation.tsx` (showDetails prop)
- Dashboard control: Checkbox in Display & Flow section

### Files Modified

| File | Changes |
|------|---------|
| `types.ts` | Added 4 new fields to ChatOptions interface |
| `server/routes/chatOptions.js` | Added defaults and schema for new options + chat_control category |
| `components/Dashboard.tsx` | Added collapsible categories, expand/collapse all, new option controls |
| `components/MessageInput.tsx` | Added maxMessageLength prop with character count display |
| `components/Evaluation.tsx` | Added showDetails prop to conditionally hide criteria |
| `App.tsx` | Implemented show_timer, require_minimum_exchanges, max_message_length behaviors |
| `help/dashboard/ChatOptionsHelp.tsx` | Updated documentation for all categories and options |

### Not Implemented (deferred for future)

- `allow_scenario_change`, `enable_notes`, `show_message_count`, `require_case_read`
- `allow_model_selection`, `cool_down_period`, `enable_audio_mode`
- `collaborative_mode`, `instructor_observe`
- Schema-driven UI component (ChatOptionsEditor.tsx) - collapsible categories added directly to Dashboard.tsx instead