# Case Writer — Updates, 2026-08-15

Follow-up to [2026-08-14](./Case-Writer-Updates-2026-08-14.md). Six findings from a
code review of that change set, all fixed and verified against the running dev
stack (`ceochat_prod_copy`).

## 1. The 💡 Hint and the prompt-log checkbox did nothing on the AI summary

The Source Material detail screen renders the summary in a `MarkdownStepEditor`,
and that component shows the Hint button and the admin "log this prompt with
data" checkbox for **any** step that supplies `onGenerate`. Both were thrown
away, at all three of the usual layers:

1. `ReferenceDetail.runSummarize(overrideModelId?)` declared a single parameter,
   so `MarkdownStepEditor.runGenerate()`'s second argument — the `opts` object
   carrying `revision_hint` and `log_this_prompt` — was dropped on the floor.
2. `POST /projects/:id/references/:refId/summarize` read only `model_id` from
   `req.body` and never called `maybeLogCaseWriterPrompt()`.
3. `case_writer.reference_summary` had no `{revision_hint}` placeholder.

This is the same failure migration 073 fixed for the Learning Brief, in a new
place, and it fails the same way: the control is visible, clicking it changes
nothing, and nothing errors. Migration 076 closes layer 3; the other two are
fixed in code. The admin case was slightly worse — the one-shot localStorage
flag was consumed in the `finally` block, so the badge cleared while no log was
ever written.

Unlike the four markdown generators, this prompt returns JSON. Migration 076
preserves the "Return ONLY a JSON object" instruction and the field shape
verbatim; only the XML-wrapped `<revision_hint>` block is new.

**Verified end to end.** Hint text typed into the UI reached the rendered prompt
(confirmed in the written log file), the model honoured it, and the localStorage
flag was consumed exactly once.

## 2. The SSRF check was not binding on the connection

`fetchFollowingRedirects()` called `assertUrlAllowed()` — which does its own
`dns.lookup` and classifies every returned address — then **discarded the
addresses** and called `fetch(current, …)`, which resolved the hostname again
independently. A host serving a one-second-TTL A record answers with a public
address on the validation lookup and `127.0.0.1` or `169.254.169.254` on the
fetch. The page body — cloud instance-metadata credentials, say — lands in
`case_writer_references.content` and renders back to the instructor. The comment
above the function claimed the per-hop re-validation covered "a DNS-rebinding
host". It did not.

Classifying an address the socket never uses proves nothing. The fix pins the
connection to the addresses that were actually checked, via `pinnedLookup()` and
the `lookup` option on the request. `fetch()` offers no way to do that, so
`urlFetcher.js` now uses `node:http`/`node:https` directly — no new dependency,
and `lookup` is a first-class Node option. SNI and certificate validation still
use the hostname from the URL; only address selection is pinned.

Consequent rewrites, all behaviour-preserving: `readBodyCapped()` reads an
`IncomingMessage` with the same `MAX_BYTES` running total (plus an inactivity
timer, which the old `AbortSignal.timeout` covered implicitly), and header/status
access moved to the Node shapes.

**Verified.** `lookup` is honoured (a request to `http://example.com:8123/` with
a pinned `127.0.0.1` reached a local listener with the `Host` header intact);
blocked literals and non-HTTP schemes still refuse; live HTTPS, a two-hop
redirect chain, and a `text/plain` body all still work; and re-fetching an
existing reference through the real route produced a byte-identical 21,585-char
extraction.

## 3. `download-original` was gated on `view`

`loadProject(id, req)` infers `'view'` on a GET, so any instructor who could see
a team-shared or public project could download the **original** uploaded PDF or
DOCX — not just the extracted text. The disclosure copy added on 08-14 promises
"the full text of every uploaded, pasted, or fetched reference" and says nothing
about original files.

The route now requires `'edit'`. This costs nothing in the UI: view-only callers
get the read-only document view (`can_edit === false`) and never reach the Source
Material pane the button lives in.

Gating the route alone would have been theatre, because `/references/import`
copied `upload_stored_path` across — copy into a project you own, then download
from there. The import now carries the upload linkage only when the caller could
have downloaded it from the source directly (`edit` on the source project);
otherwise both columns are NULL and the UI hides the option. The extracted text
still comes across in full — that is what generation uses and what the
disclosures promise. `case_file_id` is left alone; `download-original` never
reads it.

The disclosures were tightened to match on both sides (`VISIBILITY_DISCLOSURES`,
`help/dashboard/VisibilityHelp.tsx`).

**Verified.** Acting as an instructor with view-only access to another owner's
public project: `GET /projects/:id` → 200, `…/references/:refId/content` → 200,
`…/download-original` → **403**. Importing from that project produced a copy with
the full 109,942-char text and its outline intact but NULL `upload_*`; the same
import as an editor kept the filename.

## 4. Preview responses raced in the library picker

`openPreview()` set `previewId` synchronously and awaited the content fetch with
no cancellation or identity check. Previewing a 110k-char reference and then a
small one showed the small one, then let the large one's late response overwrite
it — reference A's body rendered under reference B's row. An error on the stale
request also called `setPreviewId(null)`, collapsing the panel the instructor was
actually looking at. A monotonic request token now discards superseded
responses; it is bumped on close too, so an in-flight request cannot re-open a
panel the instructor just dismissed.

**Verified** by firing both previews 30 ms apart: the panel kept the correct
(second) document.

## 5. `/references/import` was not transactional

Rows were inserted one at a time and any throw — oversized packet, deadlock,
dropped connection — escaped to `fail(res, 500)`. The client shows "Copy failed"
and does not reload, so already-inserted rows stay invisible until the next
refresh, and retrying duplicates them with doubled "Copied from project …"
provenance lines. The loop now runs in a transaction. The existing per-item
`skipped` reporting for unreadable or missing sources is unchanged — those are
expected outcomes, not failures.

## 6. The library route's `q` filter was dead code

The route built a `LIKE` clause from `req.query.q`, but the client only ever
called `listReferenceLibrary(projectId)` and filtered the `LIMIT 500` result set
in the browser. An admin's visibility scope is *every* reference on the platform,
so a title sitting at row 700 of `ORDER BY p.updated_at DESC` was never sent and
the picker reported "Nothing matches that search."

Search is now sent to the server, debounced 300 ms, with the client-side filter
kept as a narrowing pass so typing stays responsive between ticks. The server
clause gained owner name (as the `COALESCE(...)` expression — MySQL will not take
a SELECT alias in `WHERE`) so it covers the same four fields the client filter
does. The empty state keys off the query rather than `items.length`.

**Verified** through the UI and directly: `q=pickle` returns the two pickleball
references, `q=John` returns the four owned by John Doe.

## Also

`CaseWriterProject.doExport()` still inlined its own copy of `saveBlob()` even
though `download.ts` says it is shared by the export pane. It now imports it.

## Notes

- `npm run migrate` currently fails on `057_feedback_context_screen.sql`
  ("Duplicate column name 'context_screen'") — that migration was applied outside
  the tracker at some point. Unrelated to this work, but it means new migrations
  need `--only NNN` until someone reconciles it with `--mark-applied`.
- `server/scripts/mark-abandoned-chats.js` has five pre-existing parse errors
  under `tsc --noEmit`. Also unrelated; everything TS/TSX is clean.
