# AI Prompt Logging

Debug feature for capturing AI model calls (case chats and evaluations) to disk for analysis.

## Overview

When enabled, the system logs prompts and responses to text files in the `logs/` directory. This is useful for:
- Debugging AI behavior
- Analyzing prompt structure
- Troubleshooting evaluation issues

## Settings

Access via **Admin > Logging** tab. Four settings control logging behavior:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `log_case_chat_prompts` | integer | 0 | Countdown of chat turns to log |
| `log_evaluation_prompts` | integer | 0 | Countdown of evaluations to log |
| `max_log_files` | integer | 100 | Maximum files before logging stops |
| `log_with_full_case_context` | boolean | false | Include case content or hide it (chat/eval only — Case Writer always logs full data) |

### How Countdowns Work

- Set a value (e.g., 5) to enable logging
- Each logged prompt decrements the counter by 1
- When counter reaches 0, logging stops automatically
- This prevents accidental disk fill-up

## Log File Format

### Filename Pattern
```
{yyyy-mm-dd_hh-mm-ss}_{TYPE}-{studentId}-{caseId}-prompt.txt
```

Example: `2026-03-21_14-30-00_CHAT-cas_abc123-fed-ex-money-back-prompt.txt`

Three TYPE values are recognized: `CHAT`, `EVAL`, and `CASEWRITER`. For Case Writer logs, the `studentId` slot holds the project ID (with dashes stripped so UUIDs survive the parsing regex) and the `caseId` slot holds the step name (e.g. `teaching_brief`).

### File Contents
```
============================================================
CASE CHAT LOG
============================================================
Student ID: cas:abc123
Case ID: fed-ex-money-back
Model: gemini-2.0-flash
Timestamp: 2026-03-21T14:30:00.000Z
============================================================

=== PROMPT ===

[System prompt with case content hidden or shown based on settings]

=== RESPONSE ===

[Model's response text]
```

## Case Context Handling

Prompts contain case materials wrapped in `<context>` tags:

```
=== BUSINESS CASE DOCUMENT ===
<context type="case" file="case.md">
[case content here]
</context>
=== END BUSINESS CASE ===
```

When `log_with_full_case_context` is **false** (default), the logged prompt shows:
```
<context type="case" file="case.md">NOT SHOWN IN THIS LOG</context>
```

This keeps logs smaller and avoids duplicating copyrighted case materials.

## Admin UI Features

The Logging tab provides:
- **Settings panel**: Edit countdown values and toggle full context
- **Refresh button**: Reload settings and file list
- **Filter buttons**: Show All / Chat / Eval / Case Writer
- **File list**: Sortable table with timestamps, types, sizes
- **Multi-select**: Checkbox to select multiple files
- **Delete**: Remove selected log files
- **View**: Click a file to see contents inline
- **Download**: Save selected file to disk

## Case Writer per-call logging (admin opt-in)

Case Writer Generate prompts use a different mechanism from chat/eval — they are **not** countdown-driven. Instead, an admin checks "Log this prompt with data" inside the (i) prompt-viewer modal on a given step; the *next* Generate run for that step is logged, then the flag auto-clears.

- **Trigger:** request body field `log_this_prompt: true`, set by the frontend from a per-`use` `localStorage` flag (`cw_log_prompt:<use>`). The frontend deletes the key in a `finally` block so the flag is consumed exactly once.
- **Admin gate:** server-side check `req.user?.role === 'admin'` inside `maybeLogCaseWriterPrompt`. A forged request from a non-admin produces no log file.
- **Data redaction:** `logCaseWriterPrompt` does **not** call `stripCaseContentIfNeeded` — the rendered prompt (with `{source_materials}`, `{learning_brief}`, etc. fully expanded) is logged verbatim. `max_log_files` is still honored.
- **Coverage:** all six Generate endpoints — `/generate/brief`, `/generate/scenarios`, `/generate/blueprint`, `/generate/student-case`, `/generate/teaching-note`, `/extract-publish-fields`.
- **Token usage:** populated for all four providers (openai, openrouter, anthropic, google) because `generateOutlineWithLLM` now returns `cacheMetrics` in its `meta`, matching what `callLLM` already did.

See `docs/Case-Writer-Updates-2026-05-21.md` §7 for full design notes.

## File Location

Logs are stored in the project root:
```
MakeTheCase/
  logs/
    2026-03-21_14-30-00_CHAT-xxx-yyy-prompt.txt
    2026-03-21_14-25-00_EVAL-xxx-zzz-prompt.txt
    error_log.txt  (if errors occurred)
```

## Error Handling

- Logging errors do not affect student experience
- Errors are written to `logs/error_log.txt`
- If `max_log_files` limit is reached, new logs are blocked (error logged)
- Invalid filename characters (`:`, `/`, etc.) are replaced with `_`

## API Endpoints

For programmatic access (requires admin auth with 'settings' permission):

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/logs` | GET | List log files (query: `?filter=chat`, `?filter=eval`, or `?filter=casewriter`) |
| `/api/logs/settings` | GET | Get current logging settings |
| `/api/logs/settings` | PATCH | Update logging settings |
| `/api/logs/:filename` | GET | Read log file content |
| `/api/logs/:filename` | DELETE | Delete single log file |
| `/api/logs/delete-batch` | POST | Delete multiple files (body: `{filenames: [...]}`) |

## Implementation Files

- `server/services/promptLogger.js` - Core logging service
- `server/routes/logs.js` - Admin API endpoints
- `components/LoggingManager.tsx` - Admin UI component
- `server/migrations/024_add_prompt_logging_settings.sql` - Database settings
