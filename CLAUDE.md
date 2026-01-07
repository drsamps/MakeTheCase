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
services/            # Client-side API/LLM services
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
- JWT authentication via Bearer token in Authorization header
- Token stored in localStorage as `auth_token`

### Database Migrations
Run migrations in order after initial schema. Use the dev credentials from `.claude/settings.local.json` (user: `claudecode@localhost`):
```bash
mysql -u claudecode -pdevonly ceochat < docs/mysql-database-structure-Oct2025.sql
mysql -u claudecode -pdevonly ceochat < server/migrations/add_admin_auth.sql
mysql -u claudecode -pdevonly ceochat < server/migrations/add_cases_tables.sql
mysql -u claudecode -pdevonly ceochat < server/migrations/001_case_prep_and_prompts.sql
# ... continue with 002, 003, 004, 005
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
