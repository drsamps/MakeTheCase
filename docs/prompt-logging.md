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
| `log_with_full_case_context` | boolean | false | Include case content or hide it |

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
- **Filter buttons**: Show All / Chat only / Eval only
- **File list**: Sortable table with timestamps, types, sizes
- **Multi-select**: Checkbox to select multiple files
- **Delete**: Remove selected log files
- **View**: Click a file to see contents inline
- **Download**: Save selected file to disk

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
| `/api/logs` | GET | List log files (query: `?filter=chat` or `?filter=eval`) |
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
