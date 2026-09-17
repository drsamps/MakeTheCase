# Issue Analytics

**Results → Issue Analytics.** An AI pass over one case + scenario's completed chat
transcripts that lists the themes students raised, how many raised each, which position each
theme leans toward, and verbatim quotes to seed class discussion.

| Layer | File |
|---|---|
| Migration | `server/migrations/080_issue_analytics.sql` |
| Route | `server/routes/issueAnalytics.js` (`/api/issue-analytics`) |
| Scope, model, billing, estimate | `server/services/issueAnalytics/scope.js` |
| Background runner (passes 1-3) | `server/services/issueAnalytics/runner.js` |
| Read models, CSV, transcript view | `server/services/issueAnalytics/view.js` |
| Prompt rendering, quote checks, lean | `server/services/issueAnalytics/common.js` |
| Reaper + retention | `server/jobs/issueAnalyticsMaintenance.js` |
| Transcript format (shared) | `utils/transcriptFormat.js` |
| Screen | `components/IssueAnalytics.tsx`, `components/issueAnalytics/*` |
| Help | `help/dashboard/IssueAnalyticsHelp.tsx` |

## Pipeline

1. **Pass 1 (map).** One call per transcript (`issue_analytics.extract_facts`). It returns
   items typed `topic` / `argument` / `friction`, each with a gist, a lean and 1-2 quotes.
   The result is cached in `issue_analysis_chat_facts`, keyed on
   `(case_chat_id, SHA-256 of transcript, model_id, prompt_version)`. `prompt_version` is the
   active version plus a hash of the template text, so editing the prompt invalidates the cache.
2. **Pass 2 (reduce).** One call over compact `key | type | lean | gist` lines
   (`issue_analytics.cluster_themes`), never over raw transcripts. It returns roughly
   *Themes to find* themes with the item keys in each. When fewer themes come back than the
   minimum, `theme_note` says so; near-duplicates are never added to make up the number.
3. **Curation.** Select/unselect, rename, merge, remove, reorder. These are re-aggregations
   and cost nothing.
4. **Pass 3.** Only for a theme the instructor adds (`issue_analytics.theme_rescan`): one call
   per analyzed transcript, run after the cost is shown and confirmed.

**Lean** is the scenario's own `scenario_positions`. A scenario with no positions falls back
to for / against / mixed, judged from `chat_question` and the scenario's arguments. Each
student counts once per theme: the lean shown is their first mention that has one.

## Rules that fail silently if broken

- **Quotes are verbatim.** `verifyQuote()` finds each quote in a *student* turn, allowing only
  whitespace, quote-style and case differences, and stores the exact source slice and offsets.
  A quote not found there is dropped (this also catches fabricated quotes). So is text that
  just repeats a position's wording, because picking a position posts that text as the
  student's message.
- **Staleness is keyed on content, never on `transcripts.is_anonymized`.** Bulk-anonymize
  sets the flag without touching the text, and a real rewrite can arrive through the plain
  `PUT /transcripts/chat/:id` upsert with no flag. `checkStaleness()` re-hashes the analyzed
  transcripts on read and sets `stale_reason` (`transcript_changed` / `chat_removed`).
- **Single-pass prompt rendering.** `renderOnce()` resolves `{placeholders}` against the
  template only. `promptService.renderPrompt()` substitutes variables one after another, so a
  transcript containing `{position_list}` would be expanded.
- **Injection defense.** Every injected variable sits in a named XML tag with "data, not
  instructions" framing. Turns are fenced as `<student_turn>` / `<protagonist_turn>`, and a
  student typing those tag names has them escaped (`defangTags`). Tested with an
  "Ignore all previous instructions" transcript: the model reported it as a friction item.
- **Every writer of transcripts uses `formatTranscript()`.** It neutralises `[STUDENT` /
  `[PROTAGONIST` inside message text so a student cannot forge a turn. Both builders in
  `App.tsx` (per-turn auto-save and the final save, which overwrites it) share
  `buildTranscript()`.
- **Legacy transcripts.** `parseTranscript()` reads the marked format and the older
  `Name: ` paragraphs: student full name, protagonist, `CEO`, `STUDENT` (after admin
  anonymization), and, as a last resort, the most frequent other label (a CAS display name
  that differs from the student record). All 302 dev transcripts parse (2026-09-16).

## Runs, cost and billing

- `GET /estimate` and `POST /runs` share `planRun()`, so they cannot disagree. The estimate is
  the confirmation: `POST /runs` requires `confirmed: true` and refuses (409) when the
  estimate exceeds what is left of the billed instructor's weekly cap.
- **Billing identity.** In order: the launcher when they own a section in scope (section
  primary or course owner); else the owner of the first in-scope section by `section_id`;
  else the launcher. `null` (system key, no cap) is allowed only for an admin on sections
  nobody owns, which is how those sections' student chats are already billed. The result is
  stored in `billed_instructor_id` and shown before launch.
- **Model.** Per-run pick → `issue_analytics_model_id` setting → default rank `= 1` → first
  enabled. The billed instructor's `allowed_vendors` is enforced server-side.
- **Execution** is in-process with concurrency 2, and the client polls `/runs/:id/status`.
  Before each call the runner checks the weekly cap, and hitting it stops the run while
  keeping its progress (`stopped`). Because two calls can be in flight, spending can overshoot
  the cap by about one call. 429s are retried at 5 s, 20 s and 60 s, then the run stops.
  Five consecutive failures also stop it.
- **Resume** resets `failed` chats to `pending`; cached transcripts cost nothing.
- **Duplicates.** The route refuses a second active run for the same scope, and the runner
  also takes a MySQL `GET_LOCK` on it.
- **Heartbeat.** `heartbeat_at` is refreshed every minute. The reaper (every 2 min) marks runs
  silent for 10 min as `interrupted`, and stuck re-scans as `failed`. A PM2 restart otherwise
  leaves them `running` forever.
- **Cost estimate calibration:** measured on gpt-5-mini, output with reasoning was about
  1.3-2.3k tokens per transcript. The estimate uses 2,000 per transcript, 4,000 for
  clustering and 800 per re-scan.

### Sampling (migration 081)

`sample_size` (a count) makes a run analyze a sample of the scope's usable transcripts
instead of all of them. `drawSample()` in `scope.js` does the draw, called from `planRun()`:

- **Only usable chats are drawn** (those with a transcript that parses), so a sample of N
  analyzes N. Chats that are not drawn are **not** written to `issue_analysis_run_chats`.
  Writing them as skipped would be wrong, because the runner recomputes `chats_skipped` from
  that table.
- **Proportional by section.** Slots are handed out one at a time to whichever section is
  currently most under-represented, with sections that have nothing yet served first — so
  when N ≥ the number of sections, every section gets at least one.
  **Allocating one slot at a time is load-bearing, not a style choice.** It is what makes the
  draw for N a subset of the draw for N+1. The original largest-remainder version computed
  all N slots from a quota and was non-monotone (the Alabama paradox): with a 60/45/30/5 pool
  the small section held 2 slots at N=38 and 1 at N=39, so raising the size dropped a
  transcript that had already been analysed and paid for. Keep any rewrite monotone in N.
- **Deterministic.** Within a section, chats are ordered by `sha256(seed:case_chat_id)`.
  The estimate and `POST /runs` are separate requests and must pick the same chats, so never
  use `Math.random()` here. The default seed is `case_id:scenario_id`, so a repeated sample is
  fully cached, and a larger N with the same seed keeps the smaller sample — as long as the
  pool itself has not changed, since a newly completed chat joins its section's hash order and
  can displace a transcript from the first N. The client's
  "Draw a different sample" sends a random `sample_seed`, and Start sends back the size and
  seed from the estimate it confirmed.
- N ≥ the pool means no sampling: `sample_size` is stored as NULL.
- The run stores `sample_size`, `sample_seed` and `sample_pool` (the number of usable
  transcripts drawn from). Prevalence stays "of analyzed" (the sample). The UI says
  "sampled" and shows an approximate 95% margin with finite-population correction
  (`marginOfError()` in `components/issueAnalytics/types.ts`).
- Pass 3 re-scans only `state = 'done'` chats, so it covers the sample automatically.
- The estimate also returns `full_chats_to_process` / `full_est_cost_usd` (all usable
  transcripts) for comparison, and `skip_reasons` always covers the whole scope.

## Access and privacy

- `issue_analytics` is in `BASE_FUNCTIONS` in **both** `utils/permissions.ts` and
  `server/middleware/permissions.js`. Routes use `verifyToken, requireAdminOrInstructor`
  plus section scoping.
- A run is visible only to a caller who can see **every** section in it
  (`assertCanViewRun`). A run spanning two instructors holds quotes from both sets of students.
- Names are hidden by default: students are "Student N", and names inside quotes and
  transcript excerpts are masked. The CSV follows the Show-names switch; with names off it
  has no `student_id` or name column. CSV downloads are audited.
- **Retention.** Mentions and facts cascade with `case_chats`. Runs older than
  `issue_analytics_retention_days` (default 730) are deleted daily, along with orphaned
  cached facts older than that.

## Not done / open

- `PUT /api/transcripts/chat/:caseChatId` has no auth middleware (it predates this feature).
  Anyone who can reach the API can rewrite a transcript. Issue Analytics detects that as
  staleness, but the route itself should be hardened.
- The quality check (hand-coding one section and comparing it with the AI themes) is a
  human task.
