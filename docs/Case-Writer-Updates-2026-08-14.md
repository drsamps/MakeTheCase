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
- Link references still send only their URL. Fetching link contents remains unimplemented.
- The 💡 Hint button renders for any step with a Generate action, whether or not the route or prompt handles `revision_hint`. Wire the client handler, the route's `req.body` destructure, and the prompt placeholder together, or the control will look live and do nothing.
- `summary_scope_hash` must be written on every path that writes `content_summary`; a NULL hash is treated as untrusted and the summary will not be sent. Its derivation is duplicated in migration 071's SQL backfill, and the two must stay in sync.
