# Chat Options Reference

This document describes all available chat options that can be configured per section-case assignment. These options customize the student chat experience for each case assigned to a course section.

## Options Overview

Chat options are stored in the `section_cases.chat_options` JSON column and configured through the **Assignments** tab in the Admin Dashboard.

---

## Hints Configuration

### `hints_allowed` (integer)
- **Default:** `3`
- **Range:** `0-10`
- **Description:** Maximum number of hints a student can request during the chat. Set to `0` to disable hints entirely.

### `free_hints` (integer)
- **Default:** `1`
- **Range:** `0-5`
- **Description:** Number of hints that don't count against the student's score. After using free hints, each additional hint incurs a score penalty.

---

## Feedback Options

### `ask_for_feedback` (boolean)
- **Default:** `false`
- **Description:** When enabled, students are asked to provide qualitative feedback at the end of their chat session. This includes questions about what they liked and what could be improved.

### `ask_save_transcript` (boolean)
- **Default:** `false`
- **Description:** When enabled, students are asked for permission to save an anonymized version of their chat transcript for research or quality improvement purposes.

---

## Display Options

### `show_case` (boolean)
- **Default:** `true`
- **Description:** Controls whether the case document is displayed in the left panel during the chat. When `false`, students must rely on their preparation and cannot reference the case during the conversation.

---

## Flow Options

### `do_evaluation` (boolean)
- **Default:** `true`
- **Description:** Controls whether the supervisor evaluation runs after the chat completes. When `false`, students go directly to a finish screen after ending the conversation, bypassing scoring and feedback from the AI evaluator.

---

## Persona Options

### `allowed_personas` (string, CSV)
- **Default:** `"moderate,strict,liberal,leading,sycophantic"`
- **Description:** A comma-separated list of persona IDs that students can choose from. Personas are loaded from the `personas` database table. Use the Personas tab to manage available personas.

### `default_persona` (string)
- **Default:** `"moderate"`
- **Description:** The persona that is pre-selected when a student starts a new chat. Must be one of the allowed personas.

---

## Personality Customization

### `chatbot_personality` (text)
- **Default:** `""` (empty string)
- **Description:** Additional AI instructions appended to the selected persona's instructions. Use this to customize the chatbot's behavior for specific assignments without creating a new persona.

**Example uses:**
- "Be more encouraging when the student struggles"
- "Focus heavily on financial analysis aspects of the case"
- "Use simpler language appropriate for undergraduate students"
- "Ask at least two follow-up questions before moving to new topics"

---

## API Endpoints

### Get Chat Options Schema
```
GET /api/chat-options/schema
```
Returns the complete schema with field definitions, types, defaults, and validation rules. Useful for building dynamic UI forms.

### Get Chat Options Defaults
```
GET /api/chat-options/defaults
```
Returns the default values for all chat options.

### Update Section-Case Chat Options
```
PATCH /api/sections/:sectionId/cases/:caseId/options
Content-Type: application/json

{
  "chat_options": {
    "hints_allowed": 5,
    "free_hints": 2,
    "show_case": false,
    "do_evaluation": true,
    ...
  }
}
```

---

## Database Schema

Chat options are stored as JSON in the `section_cases` table:

```sql
CREATE TABLE section_cases (
  id INT AUTO_INCREMENT PRIMARY KEY,
  section_id VARCHAR(20) NOT NULL,
  case_id VARCHAR(30) NOT NULL,
  active TINYINT(1) DEFAULT 0,
  chat_options JSON DEFAULT NULL,  -- Chat options stored here
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  -- ... foreign keys
);
```

When `chat_options` is `NULL`, the system uses default values from `/api/chat-options/defaults`.

---

## Version History

- **2025-01-03:** Initial version with all options documented
  - Added `show_case` option for hiding case content
  - Added `do_evaluation` option for skipping evaluation
  - Added `chatbot_personality` for custom AI instructions
  - Moved personas to database with full CRUD management
