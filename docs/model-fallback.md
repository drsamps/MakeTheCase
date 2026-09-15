# Chat model fallback (ranked default models)

When a student's chat model is rate-limited, overloaded, times out, or returns an empty reply,
the reply comes from the next working model in a ranked list instead of leaving the student at
"please wait 30 seconds". Results show which chats used a backup, so model comparisons can
exclude them.

Scope: **student chat turns only** (`POST /api/llm/chat`). Evaluations (supervisor model),
position inference, Case Writer and model tests are unchanged.

## Ranks: `models.default_model`

`default_model` is a **rank**, not a flag (migration 079 widened `TINYINT(1)` to `TINYINT`):

| Value | Meaning | Admin > Models shows |
|---|---|---|
| 0 | not a default | nothing |
| 1 | **the** default model (used when a section's Chat Model is "Default") | green **#1 Default** |
| 2, 3, … | backup defaults, tried in this order | gray **#2 Backup**, **#3 Backup** |

- The API exposes it as `default` (a number). Anything that needs "the default model" must test
  `=== 1` / `= 1` — **never truthiness**, because a backup is truthy too.
- Ranks are unique and gap-free. **Every change goes through `setDefaultRank(modelId, rank)`** in
  `server/routes/models.js`: it removes the model from the order, inserts it at `rank`, and
  renumbers 1..k in one transaction. Never write `default_model` directly.
- `PATCH /api/models/:id` takes `default_rank` (0 removes). The legacy boolean `default` still
  works: `true` → #1 (others shift down); `false` only clears the #1 model, so an old client
  saving a backup model's form can't erase its rank.
- Disabling a model removes it from the order. Deleting is blocked only for #1; deleting a
  backup renumbers the rest. A disabled model cannot be ranked.
- UI: the Default column in `components/models/ModelsList.tsx` (`DefaultRankBadge`: the badge, or
  a plain "Set" badge, is a button that opens a small menu of positions plus "Remove from
  defaults") and the
  "Default order" picker in the model edit modal (`Dashboard.tsx`). Helpers `defaultRank()` and
  `defaultRankLabel()` are exported from `ModelsList.tsx`.

## What happens on a chat turn

`server/services/chatFallback.js#chatWithFallback`, called by `/api/llm/chat`:

1. **Candidates:** the requested (section) chat model, then ranked models #1, #2, … (enabled
   only), skipping the requested model if it is also ranked.
2. **Breaker:** candidates whose circuit breaker is open move to the **end** of the list — they
   are not dropped. So if every backup is skipped (no key, no pricing) or fails, the section's
   own model is still tried; the breaker never refuses a reply another model couldn't give.
3. **Guard check:** before a backup is called, the same guards `chatWithLLM` runs (cost cap,
   pricing, instructor key for its vendor) are checked (`guardErrorFor`, memoized per turn).
4. **Attempts:** at most **3** per reply, inside a **50 s** budget. An attempt is capped at
   `min(30 s, remaining)` **only if a later candidate passes its guard check**; otherwise it gets
   all the remaining budget, so a slow model isn't cut short at 30 s for a backup that could never
   run. No new attempt starts with under 8 s left.
5. **What falls back (and counts toward the breaker):** transient errors only — HTTP 429, 408,
   5xx, Anthropic 529, network errors, OpenRouter's error-inside-a-200 body, an empty reply, and a
   4xx whose message says the **model id is gone** (`not a valid model`, `no endpoints found`,
   `model … not found`, …). Classified as `rate_limit` / `timeout` / `server_error` /
   `empty_reply` / `other`.
6. **What doesn't fall back:** any other 4xx (`isNonRetryable()` — context too long, bad
   parameters, bad or revoked key, no credit). Another attempt won't fix it, and hiding it behind
   a backup would conceal a broken key. On the requested model it is rethrown; on a backup the
   chain moves on. Neither counts toward the breaker. The attempt is still logged to
   `model_failures`.
7. **Guard errors are not failures:** `INSTRUCTOR_COST_CAP_EXCEEDED` stops the chain.
   `INSTRUCTOR_SETUP_INCOMPLETE` (no key for that vendor) or `MODEL_UNPRICED` skips a *backup*;
   on the *requested* model they are rethrown so the route keeps its 409 messages.
8. If every attempt fails, the last provider error is returned as a 500 and the student client's
   existing 25 s auto-retry runs.

**Why 50 s:** Apache proxies `/makethecase/api` with no `ProxyTimeout`, so requests over its
default 60 s fail. Raise the budget only together with the proxy timeout.

### Circuit breaker

In memory (PM2 runs a single instance — `ecosystem.config.cjs`), keyed by
`model_id|instructor_id`: **3 failures within 5 minutes** skip that model for **10 minutes**.
After a cooldown the model is tried again, and its first new failure re-opens the breaker at
once. A success clears it. The breaker resets when the server restarts. Constants are at the
top of `chatFallback.js`; `CHAT_FALLBACK_ATTEMPT_TIMEOUT_MS` overrides the 30 s attempt timeout
for testing.

### Provider errors

`chatWithLLM` in `server/services/llmRouter.js` accepts `config.signal`, throws provider errors
with `.status` and `.provider` (`providerError()`), and throws `code: 'EMPTY_REPLY'` for an empty
reply. For Gemini the signal goes in the **chat-level** config: a per-message config replaces the
chat config (dropping the system prompt) instead of merging with it. `callOpenRouter` (shared by
all three router functions) now throws when OpenRouter returns 200 with an `error` body.

## What gets recorded

- **`case_chats.chat_model`** — unchanged: the model assigned when the chat started.
- **`case_chats.backup_models_used`** (JSON, migration 079) — **NULL unless a backup answered**.
  Otherwise a count of replies per backup model, e.g. `{"qwen/qwen3.6-flash": 3}`. Written by
  `recordBackupReply()` in `server/routes/llm.js` only when the answering model differs from the
  requested one, matched on `id` **and** `student_id`. The client sends `caseChatId` with each
  chat turn (`services/llmService.ts`).
- **`model_failures`** (migration 079) — one row per failed attempt: model, `error_kind`,
  `http_status`, message, section/instructor/chat, and `served_by_model_id` (the model that
  finally answered, NULL if none did). Written fire-and-forget. **Kept 90 days:** the daily job
  `server/jobs/pruneModelFailures.js` (started in `server/index.js`, first run 30 s after boot)
  deletes older rows in batches, matching the AI Usage panel's longest period. Its last run
  (time, rows removed, failure) is returned as `modelFailuresCleanup` by `GET /api/usage` and
  shown under the failures table; it resets on restart. The table stays in database backups.
- **`model_usage`** — records every model that answered, as before. It also records every call
  **abandoned at the attempt timeout** (`trackAbandonedChat()` in `llmRouter.js`), because the
  provider may still finish and bill it. No usage comes back for those, so the row is an
  estimate: input tokens ≈ prompt characters / 4, costed at `cpm_input`; output is not counted;
  `raw_usage` is `{"abandoned": true, "estimated_input_tokens": N}`. This keeps the weekly cap and
  AI Usage from undercounting during the overloads this feature exists for.

## Where to see it

- **Student chat header** — "AI model: X (backup)" when the latest reply came from a backup.
- **Results** (`components/Analytics.tsx`, `GET /api/analytics/results`):
  - Columns **Model** (`chat_model`) and **Backup** (amber "Backup ×N" badge; tooltip lists the
    backup models and reply counts). Both are sortable and included in CSV export
    (Model, Backup Replies, Backup Models).
  - Filters **Chat Model** (`chat_models=`) and **Backup Model** (`backup=used|none`). They apply
    to the summary statistics too, so Model + "No backup used" gives a clean per-model score.
  - Summary **Performance by Chat Model** (`summary.modelBreakdown`): chats, completions, average
    score, backup chats, and average score over chats with no backup.
- **Monitor → AI Usage** (`components/AiUsagePanel.tsx`, `GET /api/usage` → `modelFailures`):
  failures per model by kind, how many a backup answered, how many went unanswered, last failure.

## Testing locally

1. Add an enabled, priced model with a bogus id (e.g. `zz-test/does-not-exist`, vendor
   OpenRouter) and make it a test section's chat model, or POST `/api/llm/chat` with it.
2. Chat: the reply comes from #1, a `model_failures` row appears, and
   `case_chats.backup_models_used` counts the reply. From the 4th turn the log shows
   `[ChatFallback] skipping … (breaker open)`.
3. Timeout path: rank a second model #2, set `CHAT_FALLBACK_ATTEMPT_TIMEOUT_MS=1` and chat with
   #1 — the attempt times out and #2 answers.
