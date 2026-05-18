# Per-Instructor API Keys

In the multi-instructor model, every LLM call is billed to *someone's* provider key. By default that's the instructor who owns the section. Admins can opt specific instructors into the shared system key (the legacy env var key), and superusers can set a monthly token cap to keep that opt-in from getting expensive.

## The three resolution outcomes

```
                  resolveProviderKey(provider, instructorId)
                                  │
            ┌─────────────────────┼─────────────────────┐
            ▼                     ▼                     ▼
  instructorId is null    use_system_key = 1       enabled row in
  (legacy / system flow)  on instructors           instructor_api_keys
            │                     │                     │
            ▼                     ▼                     ▼
    process.env.<P>_API_KEY  process.env.<P>_API_KEY  decryptKey(blob)
            │                     │                     │
            └─────────────────────┴─────────────────────┘
                                  │
                                  ▼   if any path yields no key:
                          MissingInstructorKeyError
                          (code: 'INSTRUCTOR_SETUP_INCOMPLETE')
```

Resolution order is enforced in one place — `server/services/keyResolver.js`. Route code never touches `process.env.*_API_KEY` directly; it asks the resolver and lets the resolver decide.

## Storage and encryption

The `instructor_api_keys` table (migration 050):

```sql
CREATE TABLE instructor_api_keys (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  instructor_id CHAR(36) NOT NULL,
  provider ENUM('openai','anthropic','google','openrouter') NOT NULL,
  api_key_encrypted VARBINARY(1024) NOT NULL,
  key_hint VARCHAR(8) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  last_validated_at TIMESTAMP NULL,
  last_validation_error VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY u_instructor_provider (instructor_id, provider)
);
```

### Cipher

AES-256-GCM (`server/services/encryption.js`). Ciphertext layout on disk:

```
[ IV (12 bytes) | AUTH_TAG (16 bytes) | CIPHERTEXT (variable) ]
```

- Master key: `MTC_KEY_ENCRYPTION_SECRET` in `.env.local`. Required to decode to **exactly 32 raw bytes** (base64-encoded → 44 chars including padding). The module throws at first use if missing or the wrong length.
- Generate one with: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
- `keyHint(plaintext)` returns the last 4 characters — stored in `key_hint` and shown in the UI so instructors can tell which key is which.

### Plaintext discipline

Plaintext exists in exactly two places:
- In the encrypt/decrypt path inside `encryption.js`.
- In the request body when the instructor POSTs a new key.

It is never logged, never returned to the client after creation, never re-displayed. `GET /api/api-keys` returns `provider`, `key_hint`, `enabled`, validation timestamps — no blob, no plaintext.

### Losing `MTC_KEY_ENCRYPTION_SECRET`

If the secret is lost, every stored key blob is unrecoverable. Rotation = generate a new secret, restart the server, and ask every instructor to re-enter their keys. Document this in your deployment runbook; back up `.env.local` somewhere safe but separate from the database.

## Routes

All paths are under `/api/api-keys` (`server/routes/apiKeys.js`). All require `verifyToken` + `requireAdminOrInstructor`. The "caller's instructor id" is:

- The token's `id` when `role='instructor'`.
- `req.effectiveInstructorId` (from `X-Act-As-Instructor`) when `role='admin'` and impersonating.
- Otherwise the route returns **400** ("admins must impersonate an instructor to view their keys").

| Method | Path | Body / Effect |
|---|---|---|
| `GET` | `/api/api-keys` | List caller's keys: `{instructorId, useSystemKey, keys: [{provider, key_hint, enabled, last_validated_at, last_validation_error, created_at, updated_at}]}` |
| `POST` | `/api/api-keys` | `{provider, apiKey}` — encrypts and upserts. `apiKey` must be a string ≥ 8 chars. Re-POSTing overwrites the existing row and clears `last_validated_at`. |
| `DELETE` | `/api/api-keys/:provider` | Removes the row. |
| `PATCH` | `/api/api-keys/:provider/enabled` | `{enabled: boolean}` — toggle without deleting the blob. Disabled keys are skipped by `resolveProviderKey`. |
| `POST` | `/api/api-keys/:provider/test` | Optional smoke test against the provider. |
| `POST` | `/api/api-keys/admin/use-system-key/:instructorId` | **Superuser only.** `{enable: boolean}` — flips `instructors.use_system_key`. Refuses system accounts. |

Every mutating route writes an `audit_log` entry: `apikey.set`, `apikey.delete`, `instructor.use_system_key`.

### Allowed providers

Defined in two places (kept in sync):
- `instructor_api_keys.provider` ENUM (migration 050).
- `ENV_KEY_BY_PROVIDER` in `keyResolver.js` — maps provider → env var name (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`). Note: `google` falls back to the legacy `API_KEY` env var if `GEMINI_API_KEY` is missing.

## How LLM calls pick up the right key

The chat path is the canonical example (`server/routes/llm.js` → `server/services/llmRouter.js`):

1. A `POST /api/llm/chat` arrives. The route doesn't know which provider to bill — it just has a `case_chat_id` (or `student_id`+`case_id` for the first turn).
2. `resolveInstructorForCaseChat(caseChatId)` (or `…ForStudentCase`) walks `case_chats → sections.primary_instructor_id`. Returns the instructor id, or `null` for legacy data with no primary instructor.
3. The instructor id is threaded into the LLM config and reaches `resolveProviderKey(provider, instructorId)`. The provider is auto-detected from the `model_id` prefix; the key resolver then picks env vs. encrypted blob per the diagram above.
4. `assertWithinUsageCap(instructorId)` runs *before* the LLM call (see below).
5. After the call, `trackCacheMetrics(..., instructorId)` writes the row to `llm_cache_metrics` with `instructor_id` stamped on it.

When step 3 throws `MissingInstructorKeyError`, the route catches it and returns **409 INSTRUCTOR_SETUP_INCOMPLETE** so the student UI can show "this section isn't ready yet — please tell your instructor."

## Monthly token cap (A1)

The risk with `use_system_key=1` is obvious: an instructor's classes start hammering the shared key. The cap exists to bound that.

**Decision A1 — implemented.** Cap is enforced only when `use_system_key=1`. BYO-key instructors are exempt because their spend is on their own card.

**Decision B (per-minute rate limit) — skipped.** Not implemented; revisit if abuse patterns appear.

### Schema

Migration 055 adds:

```sql
ALTER TABLE instructors
  ADD COLUMN monthly_token_cap BIGINT NULL DEFAULT NULL;

ALTER TABLE llm_cache_metrics
  ADD COLUMN instructor_id VARCHAR(64) NULL DEFAULT NULL AFTER case_id,
  ADD INDEX idx_llm_cache_instructor_month (instructor_id, created_at);
```

`monthly_token_cap = NULL` means "no cap" (the default).

### Service

`server/services/usageGuard.js`:

```js
getMonthlyUsage(instructorId) → { tokensUsed, cap, useSystemKey, capActive }
assertWithinUsageCap(instructorId)   // throws UsageCapExceededError if over
```

- `capActive` is true only when `useSystemKey=1` AND `cap > 0`. Otherwise `assertWithinUsageCap` is a no-op.
- `tokensUsed` = `SUM(input_tokens + cached_tokens + output_tokens)` for the current calendar month (server local time) from `llm_cache_metrics`, filtered by `instructor_id`.
- The query is keyed by `(instructor_id, created_at)` — that's what the index added in 055 is for.

### Enforcement point

Called twice per request — at the top of `chatWithLLM` and `evaluateWithLLM` in `llmRouter.js`. On throw, both `server/routes/llm.js` handlers translate it to:

```json
HTTP 409
{
  "data": null,
  "error": {
    "code": "INSTRUCTOR_USAGE_CAP_EXCEEDED",
    "message": "Monthly usage cap reached. Please contact your administrator.",
    "used": 1234567,
    "cap": 1000000
  }
}
```

### Setting and reading the cap

- `PATCH /api/instructors/:id` (**superuser only**) accepts `monthly_token_cap` along with `use_system_key`, `can_publish`, etc.
- `GET /api/instructors/:id/usage` returns `{tokensUsed, cap, useSystemKey, capActive}` for the admin UI.
- `components/InstructorManager.tsx` exposes the field in the edit modal under "Admin grants" and shows a `cap: …` badge on the list row.

### Edge cases

- A cap of `0` is treated as "no cap" (because `cap > 0` is the gate). If you want a hard block, set `1` not `0`.
- Setting `use_system_key=0` halfway through the month → cap stops being active immediately; usage is no longer counted against it (because the resolver now returns the instructor's own key, and the cap gate doesn't fire).
- Setting `use_system_key=1` halfway through the month → cap activates immediately, using the same month's existing `llm_cache_metrics` rows. So an instructor flipped on mid-month already starts with whatever they used earlier in the month.

## Section readiness probe

The student-facing chat-start endpoint needs to fail fast if the section's primary instructor lacks the keys they'll need. `keyResolver.js` exposes:

```js
checkSectionReadiness(sectionId) → { ready, missing, instructorId }
```

It looks up the section's `chat_model` and `super_model`, joins to `models.vendor` to find the providers needed, then probes `resolveProviderKey` for each. `ready=false` with `missing=['anthropic']` means "primary instructor has no Anthropic key (and is not opted into system key)."

Sections with `primary_instructor_id IS NULL` (legacy data) are treated as ready — they fall through to the env key path.

## Frontend (ApiKeysManager.tsx)

`components/ApiKeysManager.tsx` is the per-instructor key UI. For instructors, it operates on their own keys; for admins, it operates on the instructor they're impersonating (and prompts to pick one if not).

- Adding a key: provider dropdown + a single text input. Submits to `POST /api/api-keys`.
- Editing: there is no edit. POST overwrites the blob.
- Display: `provider — ✓ ending in …4chars — last validated 2026-05-02 12:01`.
- "Use system key" toggle: visible to superusers only; calls `POST /api/api-keys/admin/use-system-key/:instructorId`.

## Audit trail

Every key-related write goes through `writeAudit` (`server/services/auditLog.js`):

| Action | When |
|---|---|
| `apikey.set` | `POST /api/api-keys` (create or rotate). Details: `{provider, hint}`. |
| `apikey.delete` | `DELETE /api/api-keys/:provider`. |
| `instructor.use_system_key` | `POST /api/api-keys/admin/use-system-key/:id`. Details: `{enable}`. |

These complement the impersonation audit entries — when an admin rotates a key under impersonation, the row shows both `actor_admin_id` and `acted_as_instructor_id`. See `multi-instructor-impersonation.md`.

## Operational checklist

- [ ] `MTC_KEY_ENCRYPTION_SECRET` is set in `.env.local` AND backed up off-box.
- [ ] All four provider env vars (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`) are set for the system-key fallback path.
- [ ] At least one instructor with `use_system_key=1` exists for sections that lack their own keys (or accept the 409 setup-incomplete behavior).
- [ ] When granting `use_system_key=1`, also set a sane `monthly_token_cap` unless you trust the instructor's volume.
- [ ] Audit log is being written (`SELECT COUNT(*) FROM audit_log WHERE action LIKE 'apikey%'` should grow over time).
