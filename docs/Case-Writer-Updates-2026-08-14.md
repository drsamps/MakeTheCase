# Case Writer Updates — 2026-08-14

## The bug

An instructor pasted source material into a Case Writer project, checked **Approved**, and generated a Learning Brief. The document did not reach the model — only its title did. Confirmed from a prompt log on the dev machine:

```
<source_materials>
### Source: ESDI-4E_Chapters_1-3.pdf (uploaded_file)
Notes: Uploaded file: ESDI-4E_Chapters_1-3.pdf (1519040 bytes)
</source_materials>
```

**Cause.** `loadSourceMaterials()` selected `title`, `content_summary`, and `source_notes` — never `content`, the column holding pasted text and extracted file text. The only thing that populates `content_summary` is a manual **Summarize** click, so an approved-but-unsummarized reference produced a header with no body. This affected all six generators (brief, scenarios, blueprint, student case, teaching note, tweak), not just the Learning Brief. Migration 064's prompt meanwhile told the model that `<source_materials>` "contains text extracted from instructor-uploaded reference documents" — a claim the code had never made true.

A second, independent bug: the **Source Material** rail dot was hardcoded, `case 'source': return 'empty';`, so it was always a hollow circle no matter what was attached.

## What changed

### Migration 067 — `use_mode`

Each reference now declares how it feeds generation: `full_text` (default), `summary`, `summary_and_full_text`, chosen from a **Use in generation** dropdown next to the Approved checkbox. Existing rows were backfilled to `full_text` so nothing keeps silently contributing nothing.

The invariant that broke before is now explicit and tested: **no mode emits a `### Source:` header with no body.** `summary` falls back to full text when there is no summary (and says so), and a reference with nothing to contribute is skipped rather than emitted as a title line.

Output is capped — `REFERENCE_TEXT_CHAR_CAP` 60,000 per reference and `SOURCE_MATERIALS_TOTAL_CHAR_CAP` 150,000 across all approved references — with a visible `[truncated — showing first N of M characters]` marker, and `[omitted — N characters, exceeds the source material budget]` when the shared budget is already spent.

Each reference row now states in plain text what it will send, e.g. *"Sends full text — 109,942 chars (truncated to 60,000)"*, so "Approved" can never again quietly mean "sends nothing".

### Migrations 068-069 — choosing portions of a long document

Capping at 60,000 characters is blunt: on a textbook PDF it keeps the title page and table of contents and discards the chapter that matters. References therefore carry `outline`, `outline_hash`, `selection`, and per-step `selection_overrides`.

`server/services/referenceOutline.js` detects sections in tiers — markdown headings → plain-text heading heuristics → fixed ~5,000-char chunks. The chunk tier is load-bearing, not a corner case: PDFs go through `pdf-parse` + `cleanPdfText()`, which yields no headings and strips standalone page numbers. Post-processing is what makes tier 2 usable — rejecting lines that end like prose, absorbing sub-400-char sections (numbered list items), collapsing repeated running headers to their first occurrence, and splitting oversized sections into parts. The ESDI test document resolves into 11 sections with real chapter boundaries.

**Character offsets are the fragile part**, and there are two defences because one is not enough. Any write to `content` rebuilds the outline and clears both the selection and the per-step overrides; and `resolveSelectionRanges()` re-checks `outline_hash` at read time, falling back to the whole document rather than slicing at offsets that now point at the wrong text.

`components/caseWriter/ReferenceContentViewer.tsx` provides the picker: a **Sections** tab of checkboxes with per-section character counts and a running total against the cap, and an **Excerpts** tab where any passage can be selected and added. Section and excerpt ranges are merged before assembly, so an excerpt inside a selected section is not sent twice.

Per-step overrides are surfaced by `StepSourceScope.tsx` as a line under each step's Generate row — *"Source material for Learning Brief: 1 approved reference · ESDI-4E — 3 of 11 sections · 34,120 chars · Customize"*. An override that is only visible inside a modal in another pane makes an unexpectedly narrow output very hard to diagnose.

### Migration 070 — AI section suggestion

`case_writer.reference_section_select` backs a **✨ Suggest sections** button. Only the outline goes to the model — id, title, character count, and a 120-character opening snippet per section — never the document body, which keeps the call cheap on a 110,000-character document. It returns a suggestion and **saves nothing**: the picker pre-checks the boxes with a rationale and the instructor confirms. Section ids the model invents are dropped server-side.

Against the real ESDI reference with the teaching principle "Three regions of process control and their operational trade-offs", it selected Chapters 2 and 3 (52,116 chars, under the cap) and explicitly skipped front matter and Chapter 1.

### Rail dot

`railStatusFor('source')` now reflects reality: green when approved references exist, blue when references are attached but unapproved, hollow when there are none. References were lifted into `CaseWriterProject` so the dot is right before the pane is ever opened. Note that `StepRail` lets the active-pane `▶` mask the status glyph, so the green dot appears once you navigate away from Source Material — unchanged behavior, consistent across all steps.

### Summarize / Approved interaction

`POST .../summarize` still clears `approved_by_user` by design, so a new summary must be reviewed. That reset is now announced in the UI instead of silently unchecking the box and dropping the reference out of every prompt.

### Migrations 071-072 — the summary and the selection now describe the same portion

Reviewing the above surfaced a design flaw in what 067 and 068 had just shipped: the two controls silently ignored each other. `use_mode` chose the channel, `selection` chose which characters of the *text* channel were used — but the summarize route read the whole `content` column and never looked at `selection`. So an instructor could pick three chapters, switch to **Summary only**, and have the selection do nothing. Worse, **Summary + full text** placed a whole-document summary directly above three selected chapters inside a single `### Source:` block: two different scopes presented as one source.

The model is now what the names promise:

```
selection  ->  WHICH part of the document
use_mode   ->  HOW MUCH detail of that part
```

Summarize runs on the selection and records which selection it used in `summary_scope_hash`. `loadSourceMaterials` recomputes that key per step and only sends the summary when it matches; on mismatch it sends the selected text with `_(summary is out of date with the current selection — using the selected text)_`, and the UI shows a re-summarize prompt. A per-step override changes the scope, and there is only one summary per reference, so an overridden step falls back to text under `summary` mode — intentional, since the alternative is summarizing a portion that step is not using.

The scope key is derived from the selection plus `outline_hash` rather than the document body, so it can be computed on the list routes, which never load `content`. Editing `content` rebuilds `outline_hash`, so the summary is flagged stale automatically with no separate invalidation path.

Verified end-to-end on the real ESDI document: selecting the three Chapter 3 sections (27,972 chars of 109,942) and summarizing produced a summary about PCN Diagrams specifically, reported its scope back as *"3 of 11 sections selected by the instructor…"*, and reduced the block sent to generation to 2,187 characters. Changing the selection afterwards immediately flagged it stale and withheld it.

Migration 072 updates `case_writer.reference_summary` to match: it no longer asserts that `<content>` is the full document, takes a `{scope_note}` naming the selected sections, and asks for a caution when an excerpt begins or ends mid-argument. JSON output contract unchanged.

### Migration 073 — the Learning Brief's 💡 Hint was silently discarded

Reported separately, same root shape as the original bug: a control that looked live and did nothing. `MarkdownStepEditor` renders 💡 Hint for every step that can Generate, so the Learning Brief has always shown it — but the hint was dropped at three independent layers before reaching the model.

1. `CaseWriterProject.generateBrief()` built its request body from `opts` and forwarded only `log_this_prompt`, discarding `opts.revision_hint`.
2. `POST /generate/brief` destructured only `model_id` from `req.body`.
3. `case_writer.teaching_brief` had no `{revision_hint}` placeholder — the only enabled markdown generator prompt missing one.

All three are fixed. The prompt migration was rebuilt from the live template so the only change is the inserted `<revision_hint>` block; the *"Return ONLY a markdown document"* contract and the existing Guidance lines are byte-for-byte preserved.

Verified end-to-end: generating a brief with the hint *"set the case in a rural veterinary clinic and avoid all jargon"* produced a logged prompt containing the `<revision_hint>` block and a brief opening *"A fictional rural veterinary clinic faces a sudden mismatch between demand for care and the clinic's limited staff time…"*.

## Notes for future work

- The prompt-injection convention was extended to the new prompt: `{teaching_principle}`, `{case_context}`, `{document_title}`, and `{outline}` are XML-wrapped and marked as data. Section titles come from uploaded documents and are adversary-influenced.
- Reference `content` crosses to the browser from exactly one route, `GET .../references/:refId/content`. The list routes return `CHAR_LENGTH(content)` and compact counts; do not add `content` or the raw `outline` to them.
- ~~Link references still send only their URL. Fetching link contents remains unimplemented.~~ Implemented — see *Migration 074* below.
- The 💡 Hint button renders for any step with a Generate action, whether or not the route or prompt handles `revision_hint`. Wire the client handler, the route's `req.body` destructure, and the prompt placeholder together, or the control will look live and do nothing.
- `summary_scope_hash` must be written on every path that writes `content_summary`; a NULL hash is treated as untrusted and the summary will not be sent. Its derivation is duplicated in migration 071's SQL backfill, and the two must stay in sync.

---

## Migration 074 — fetching a link's page text

*Added 2026-08-15.*

The last instance of the pattern this whole document is about: a control that looked live and contributed nothing. An instructor could add source material by **Paste link**, check **Approved**, and the reference would send this to all six generators:

```
### Source: How to play pickleball (link)

URL: https://www.pickleheads.com/guides/how-to-play-pickleball
```

Two such rows existed on real projects in the dev database. The UI was at least honest about it — the row read *"Sends the URL only — link contents are not fetched yet"* — but honesty is not the same as working, and **Use in generation**, **Summarize**, and **Select portions** were all disabled for links.

### What changed

`POST /projects/:id/references/:refId/fetch` downloads the page, extracts its text into `content`, and rebuilds the outline. The whole downstream pipeline already keys off `content`, so **nothing else needed to change**: outline detection, section and excerpt selection, per-step overrides, `use_mode`, and summarization all work against a fetched link exactly as they do against pasted text. In the UI, the disable condition for those three controls stopped being `type === 'link'` and became a single derived predicate:

```ts
// A link with no fetched text has nothing to select, summarize, or scope.
const hasText = (r: CaseWriterReference) => !!r.content_length;
```

New columns record what was actually read: `fetched_at`, `fetched_content_type`, `fetched_final_url`. The final URL is stored separately rather than overwriting `link_url` — the instructor typed `link_url` and it should stay as typed, and showing *"Redirected to …"* makes a bounce to a login or consent wall visible rather than mysterious.

Like `POST .../summarize`, the route clears `approved_by_user`, for the same reason: the reference's contribution just went from a URL to 18,000 words about to feed five generation steps. The amber notice says so out loud — silently unchecking the box would drop the reference from every prompt with no visible signal, which is the failure mode this document exists to prevent.

Refetching is the same route called again. It overwrites `content`, so `refreshReferenceOutline()` clears the selection and the per-step overrides; the stored character offsets no longer point at the same words. Nothing auto-refetches — `fetched_at` is shown in the row and staleness is the instructor's call.

### The security part

The URL comes from an authenticated instructor, but the **server** makes the request, so it can reach whatever this host can reach: localhost, the private network, and the cloud metadata endpoint. `server/services/urlFetcher.js` is deliberately free of Express and DB imports so the policy can be exercised on its own.

Blocked: loopback, `0.0.0.0/8`, RFC1918, `169.254.0.0/16` (**including `169.254.169.254`**), CGNAT `100.64/10`, multicast, `::`, `::1`, `fe80::/10`, `fc00::/7`, `ff00::/8`. Non-`http(s)` schemes and embedded credentials are refused before any lookup. Every address a hostname resolves to is checked, not just the first — a host publishing both a public and a `127.0.0.1` A record is refused outright, since we do not control which one the socket picks.

Two details that a naive implementation gets wrong, and both were found by testing rather than by reading:

1. **IPv6 must be parsed, not pattern-matched.** `new URL()` normalizes `http://[::ffff:127.0.0.1]/` to `::ffff:7f00:1`, so a regex looking for a dotted quad inside a v6 literal sails right past it — the first version of `isBlockedAddress` allowed it. The address is now expanded into its eight 16-bit groups, and mapped, IPv4-compatible, and NAT64 (`64:ff9b::/96`) forms are unwrapped and re-checked against the v4 rules.
2. **The redirect loop is manual and re-validates on every hop.** The origin controls the `Location` header, so a pre-flight-only check is defeated by any open redirector. Verified against two real public ones: `https://postman-echo.com/redirect-to?url=http://127.0.0.1:3001/` and the same on `nghttp2.org` both return 422 *"Refusing to fetch 127.0.0.1:3001: loopback address"* — blocked at the second hop, before a connection is attempted.

Also: 20 s timeout, a 10 MB ceiling enforced on the running byte total rather than on `Content-Length` (which lies), and a maximum of 5 redirects.

### Extraction

HTML goes through `jsdom` + `@mozilla/readability` — the Firefox Reader Mode engine — which is what gets article prose instead of navigation menus. PDF and DOCX bodies are written to a temp file under `case_files/_cw-tmp/` and handed to the existing `convertFile()`, unlinked in a `finally`. `text/plain` and `text/markdown` are decoded directly. Anything else is refused with a message naming the type and pointing at **Upload file**.

HTML stores `format: 'text'` on purpose: Readability's `textContent` carries no `#` headings, so the plain-text heuristics tier is the right one for outline detection (in practice both test pages fell through to `chunks`).

When extraction yields under 200 characters the raw `<body>` text is stored instead and the row warns. The first version flagged this only when the fallback *won*, which meant a SPA shell whose `<nav>` yielded exactly 10 characters was stored silently — the flag now keys off the final length, which is the thing that actually matters.

**The error messages are most of the product.** Paywalls, bot blocks, and JS-rendered pages are the common failures, none are fixable server-side, and every thrown message therefore ends by telling the instructor to open the page and paste the text instead.

### Roll-out

Setting `case_writer_url_fetch_enabled`, **`'0'` by default**. With the flag off the route returns 403 and the button is absent; the client learns which from `GET /api/case-writer/config`, kept as its own route rather than a field bolted onto the reference list.

### Verified

Both real dev-database link references fetch clean article prose — 18,276 chars from the Gladly service-recovery post, 21,585 from the Pickleheads guide, no nav menus — and `loadSourceMaterials()` puts that prose inside `<source_materials>` in place of the old one-line URL stub. Every entry in the block table above returns 422 and stores nothing. A refetch over a planted selection cleared `selection` and `selection_overrides` and reported `summary_stale: true`, so a summary predating the refetch is withheld from generation rather than described as current. `https://www.irs.gov/pub/irs-pdf/fw9.pdf` extracts 37,466 chars through `convertFile` and leaves no temp file behind; a PNG is refused by name.
