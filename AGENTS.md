# AGENTS.md

Project guidance for Codex agents working in this repository.

Primary reference: [`CLAUDE.md`](./CLAUDE.md). Use it as the canonical project guide.

## Key Rules

- Use `getApiBaseUrl()` from `services/apiClient.ts` for frontend API calls.
- Do not hardcode `'/api/...'` in frontend fetches.
- Keep changes compatible with MySQL `ONLY_FULL_GROUP_BY`.
- Preserve existing architecture patterns in `components/`, `server/routes/`, and `server/services/`.

## Migrations

- Migration files live in `server/migrations/`.
- Numbered migrations should increment from the current highest number.
- Prefer idempotent SQL for column/index/constraint changes.
- For broad MySQL compatibility, avoid assuming `ADD COLUMN IF NOT EXISTS` support.
- Prefer `information_schema` checks (often via temporary stored procedures) before DDL.

Example run command on this machine (from `CLAUDE.md`):

```bash
"C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysql.exe" -u claudecode -pfordevonly ceochat < server/migrations/023_add_model_test_tracking.sql
```

## Practical Notes

- Backend API model management is in `server/routes/models.js`.
- Instructor Dashboard model UI is in `components/Dashboard.tsx`.
- Keep UI behavior data-driven from DB fields when possible so refresh reflects state.
- Admin sub-tab header action style (except Settings): use primary new-entry button first (e.g., `+ Add Model`) followed by an icon-only refresh button (circular arrow) on the upper-right.
