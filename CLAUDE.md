# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**MakeTheCase** is an AI-powered interactive business case study teaching tool for undergraduate and MBA students. Students chat with AI-simulated case protagonists (e.g., a CEO) to practice case analysis and strategic thinking.

## Development Commands

```bash
npm run dev:all        # Run both frontend (3000) and backend (3001) concurrently
npm run dev            # Frontend only (Vite dev server, port 3000)
npm run server         # Backend only (Express, port 3001)
npm run server:watch   # Backend with nodemon auto-restart
npm run build          # Build frontend for production
npm run create-admin   # Create admin: node server/scripts/create-admin.js email password
npm run seed-malawis   # Seed sample case data
```

## Architecture

### Full-Stack Structure
- **Frontend**: React 19 + TypeScript + Tailwind CSS (Vite build)
- **Backend**: Node.js + Express.js (ES modules)
- **Database**: MySQL 8
- **AI Providers**: Google Gemini, OpenAI, Anthropic (auto-detected from model_id prefix)

### Key Directories
```
components/          # React components (TypeScript)
  └── ui/            # Reusable UI components (HelpTooltip, etc.)
services/            # Client-side API/LLM services
help/                # Help content files (editable separately from components)
  └── dashboard/     # Instructor dashboard help content
server/
  ├── routes/        # Express API endpoints (~20 route files)
  ├── services/      # Business logic (llmRouter.js, fileConverter.js)
  ├── migrations/    # SQL migrations (run in numerical order)
  ├── middleware/    # auth.js (JWT), permissions.ts
  └── db.js          # MySQL connection pool
case_files/          # Uploaded case documents organized by case_id
```

### API Communication
- Vite proxies `/api` to `http://localhost:3001/api` in development
- In production, the app runs at `/makethecase/` so API calls must use the correct base path
- JWT authentication via Bearer token in Authorization header
- Token stored in localStorage as `admin_auth_token` (admin) or `student_auth_token` (student)

**IMPORTANT: Making API calls in frontend code**
Always use `getApiBaseUrl()` from `services/apiClient.ts` for fetch calls:
```typescript
import { getApiBaseUrl } from '../services/apiClient';

// Correct - works in both dev and production
fetch(`${getApiBaseUrl()}/courses`, { ... })

// WRONG - breaks in production (missing /makethecase prefix)
fetch('/api/courses', { ... })
```
The `getApiBaseUrl()` function returns `/api` in development and `/makethecase/api` in production.

### Database Migrations
Run migrations in order after initial schema. Use the dev credentials (user: `claudecode@localhost`, password: `fordevonly`).

**MySQL full path on this machine:**
```bash
"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u claudecode -pfordevonly ceochat < server/migrations/018_example.sql
```

Example migration sequence:
```bash
"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u claudecode -pfordevonly ceochat < docs/mysql-database-structure-Oct2025.sql
"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u claudecode -pfordevonly ceochat < server/migrations/add_admin_auth.sql
# ... continue with numbered migrations in order
```

### MySQL Configuration - ONLY_FULL_GROUP_BY Mode

**CRITICAL:** This MySQL instance has `ONLY_FULL_GROUP_BY` enabled in `sql_mode`. When writing queries, follow these rules:

1. **GROUP BY with COALESCE/aliases:**
   - ❌ WRONG: `GROUP BY position_name` (using alias)
   - ✅ CORRECT: `GROUP BY cc.final_position, sp.position_name, cc.initial_position` (all columns in COALESCE)

2. **Example:**
```sql
-- WRONG - Will fail with ER_WRONG_FIELD_WITH_GROUP error
SELECT COALESCE(cc.final_position, sp.position_name) as position_name, COUNT(*)
FROM case_chats cc
LEFT JOIN scenario_positions sp ON cc.final_position_id = sp.position_id
GROUP BY position_name;  -- ❌ Can't group by alias

-- CORRECT - Groups by actual columns
SELECT COALESCE(cc.final_position, sp.position_name) as position_name, COUNT(*)
FROM case_chats cc
LEFT JOIN scenario_positions sp ON cc.final_position_id = sp.position_id
GROUP BY cc.final_position, sp.position_name;  -- ✅ Groups by all columns in COALESCE
```

3. **Why this matters:**
   - MySQL's `ONLY_FULL_GROUP_BY` enforces strict SQL standard compliance
   - All non-aggregated columns in SELECT must be in GROUP BY
   - When using `COALESCE()` or functions, include all component columns in GROUP BY
   - Cannot use column aliases in GROUP BY clause - must use actual column references

4. **ORDER BY can still use aliases** (unlike GROUP BY):
```sql
-- This is OK
SELECT COALESCE(cc.final_position, sp.position_name) as position_name
FROM ...
GROUP BY cc.final_position, sp.position_name
ORDER BY position_name;  -- ✅ ORDER BY can use alias
```

## Key Architectural Patterns

### Persona System
Five built-in protagonist personalities: Strict, Moderate, Liberal, Leading, Sycophantic. Custom personas stored in database. Personas are configurable per section-case assignment.

### Chat Options (per section-case)
JSON configuration stored in `section_cases.chat_options`: hints_allowed, free_hints, ask_for_feedback, ask_save_transcript, allowed_personas, default_persona, chatbot_personality, show_case, do_evaluation.

### Case File Organization
Cases stored in `case_files/{case_id}/` with:
- `case.md` - Student-facing case document
- `teaching_note.md` - AI-only content for evaluation and counter-arguments

### LLM Provider Routing
Provider auto-detected from model_id prefix in `server/services/llmRouter.js`:
- `gemini-*` → Google Gemini
- `gpt-*` or `o*` → OpenAI
- `claude-*` → Anthropic

### System Prompt Construction
Cache-optimized: static content (case, teaching note) placed first for LLM prompt caching. Three components: case document, teaching note (hidden from students), argument framework.

### Conversation Flow States
Defined in `types.ts` as `ConversationPhase` enum: PRE_CHAT → CHATTING → feedback phases → EVALUATION_LOADING → EVALUATING.

## Access Points
- Student view: `http://localhost:3000/`
- Instructor dashboard: `http://localhost:3000/#/admin` (or Ctrl+click header)

## Platform-Specific Notes

The `.claude/` directory (gitignored) contains machine-specific settings:
- **`.claude/settings.local.json`** - Dev credentials in `env` field (MYSQL_CLAUDE_USER, MYSQL_CLAUDE_PASSWORD)
- **`.claude/PLATFORM.md`** - Platform-specific guidance (Windows vs Linux shell commands, MySQL paths, etc.)

Check `.claude/PLATFORM.md` for this machine's MySQL path and shell conventions.

## Environment Configuration
Copy `env.local.example` to `.env.local` and configure:
- `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`
- `MYSQL_USER`, `MYSQL_PASSWORD`, `JWT_SECRET`
- `CAS_ENABLED` (false for local dev)

## UI Components

### HelpTooltip Component
Location: `components/ui/HelpTooltip.tsx`
Styles: `admin.css` (`.help-tooltip-*` classes)

A standardized help info component for providing contextual help throughout the instructor dashboard. Displays a circled "i" icon that opens a resizable popup when clicked.

**Features:**
- Scrollable content area
- Resizable popup (drag bottom-right corner to resize)
- Closes on click outside or Escape key

**Usage:**
```tsx
import HelpTooltip from './ui/HelpTooltip';
import { SomeFeatureHelp } from '../help/dashboard';

<HelpTooltip title="Feature Name">
  <SomeFeatureHelp />
</HelpTooltip>
```

### Help Content Files
Location: `help/dashboard/`

Help content is stored in separate TSX files for easy editing without modifying component code. Each file exports a React component containing the help text.

**Directory structure:**
```
help/
  └── dashboard/           # Instructor dashboard help content
      ├── index.ts         # Exports all help components
      ├── ChatOptionsHelp.tsx
      └── (future help files)
```

**To edit existing help content:**
1. Open the relevant file in `help/dashboard/` (e.g., `ChatOptionsHelp.tsx`)
2. Edit the JSX content using supported HTML elements
3. Save and rebuild

**To add new help content:**
1. Create a new file in `help/dashboard/` (e.g., `AssignmentsHelp.tsx`)
2. Export a React component with the help content
3. Add export to `help/dashboard/index.ts`
4. Import and use with `<HelpTooltip>` in the relevant component

**Supported HTML elements (styled via admin.css):**
- `<h4>` - Section headers within help content
- `<p>`, `<ul>`, `<ol>`, `<li>` - Standard text and lists
- `<strong>` - Bold/emphasized text
- `<code>` - Inline code snippets
- `<div className="help-callout">` - Highlighted tip/note box

**Example help file:**
```tsx
import React from 'react';

const MyFeatureHelp: React.FC = () => (
  <>
    <h4>Overview</h4>
    <p>Description of the feature...</p>

    <h4>How to Use</h4>
    <ul>
      <li><strong>Step 1</strong> - Do this first</li>
      <li><strong>Step 2</strong> - Then do this</li>
    </ul>

    <div className="help-callout">
      <strong>Tip:</strong> Helpful advice here
    </div>
  </>
);

export default MyFeatureHelp;
```
