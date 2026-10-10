# Case File Text Caching

## Problem

When a PDF or DOCX case document is uploaded, the app needs to include its text content in LLM prompts for chats and evaluations. Previously, the original binary file was stored on disk and re-parsed (via `pdf-parse` or `mammoth`) every time `loadCaseData()` was called -- on every chat start, every evaluation, every re-evaluation, and every prompt preview. For large PDFs this added unnecessary latency and CPU cost.

## Solution

The `case_files` table now has two columns added by migration `025_add_converted_text_cache.sql`:

- **`converted_text`** (`LONGTEXT`) -- cached text extraction from the uploaded file
- **`converted_at`** (`TIMESTAMP`) -- when the conversion was last performed

### How it works

```
Upload/Download  ──>  convertFile()  ──>  Store text in converted_text column
                                            │
Student starts chat  ──>  loadCaseData()    │
                             │              │
                    converted_text != NULL? ─┘
                        │           │
                       Yes          No (legacy file)
                        │           │
                  Use cached text   convertFile() from disk
                        │           then backfill converted_text
                        │           │
                        └─── Build prompt ───>  LLM call
```

### Convert on upload

When a file is uploaded via the Case Files manager (`POST /api/case-files/:caseId/upload`) or downloaded from a URL (`POST /api/case-files/:caseId/download-url`), the server immediately runs `convertFile()` and stores the result in `converted_text`. This means the text is ready before any student ever starts a chat.

### Lazy backfill for legacy files

Files uploaded before this feature was added have `converted_text = NULL`. When `loadFileContent()` encounters a NULL cache, it falls back to the original disk-based conversion and then writes the result back to the database (fire-and-forget, non-blocking). The first access pays the conversion cost; all subsequent accesses use the cached text.

### Admin reconvert

Admins can force re-extraction from the original file via:
- **API**: `POST /api/case-files/:fileId/reconvert`
- **UI**: The "Reconvert" link in the Case Files table (shown for PDF/DOCX/DOC files)

This is useful if the conversion logic is improved or if the original extraction had issues.

### Admin text viewer/editor

Admins can view and edit the extracted text via:
- **API**: `GET /api/case-files/:fileId/converted-text` and `PUT /api/case-files/:fileId/converted-text`
- **UI**: The "Text" link in the Case Files table opens a modal where the instructor can:
  - View the full extracted text with character count and conversion timestamp
  - Edit the text to fix PDF extraction artifacts (e.g., broken tables, garbled characters)
  - Save edits back to the database
  - Re-extract from the original file if needed

If no text has been extracted yet, the modal shows a notice with a "Convert to Text" button.

## Web pages and pasted text (migration 083)

Content > Case Files → **Add from web page** fetches a URL, shows the text for review, and saves it only when the instructor clicks Save. **Paste text instead** uses the same review window for pages that can't be fetched.

- **Two calls, nothing stored on preview.** `POST /api/case-files/:caseId/fetch-url` with `{ url, preview: true }` returns `{ kind, title, text, degraded, final_url, content_type }`; the same route without `preview` saves the reviewed `text`. `POST /:caseId/paste` saves pasted text (`file_source = 'pasted'`, optional `source_url`).
- **Every fetch goes through `server/services/caseFileFetch.js` → `urlFetcher.js#fetchUrlBytes`**, which blocks internal addresses on every redirect hop and pins the checked address (see the case-writer skill). Never fetch a URL in `caseFiles.js` any other way; the old `download-url` route used plain `fetch()` and was removed.
- **Web pages become Markdown** (Readability's article HTML → `turndown` + GFM tables). Infoboxes and layout tables become `Label: value` lines; images are dropped; links are kept only as absolute http(s). Pages with under 200 characters of article text fall back to body text and return `degraded: true`, which the UI shows as a warning. Case Writer keeps its own plain-text extraction.
- **What is stored.** Web pages and pasted text are text only: `file_source` `web` / `pasted`, `file_format = 'md'`, and a placeholder `filename` that never exists on disk (Sync skips these rows). PDF / DOCX / text URLs keep the original in `uploads/` (`file_source = 'downloaded'`); the save call fetches the bytes once more for that. `source_url`, `fetched_final_url`, `fetched_content_type` and `fetched_at` record the fetch.
- **Re-fetch** (`POST /:fileId/refetch`) works on any row with a `source_url`, including old URL imports that saved raw HTML with no text; it turns them into `web` rows.
- **Revert and the edited flag.** `converted_text_original` keeps the first extraction; `PUT /converted-text` fills it with `COALESCE` before overwriting (MySQL applies `SET` left to right) and sets `text_edited_at` unless the text matches the original. Re-extract and Re-fetch reset both. `POST /:fileId/revert-text` copies the original back.
- **Downloads.** `GET /:fileId/download` sends the original (always as an attachment, `nosniff`; the path comes only from the DB row and must stay inside the case folder). `GET /:fileId/download-text` sends the current text, which is what the AI reads. Both need view access to the case.
- **On/off:** the `case_files_url_fetch_enabled` setting (default `1`) gates fetch and re-fetch; `GET /api/case-files/config/web-fetch` tells the UI. Paste always works.

## Orphaned Outline Fix

A related fix was made to `loadCaseData()` in `server/routes/llm.js`. Previously, AI-generated outlines (from Case Prep) were only included in prompts as children of their parent file. If the parent file had `include_in_chat_prompt = 0` (e.g., the instructor wanted to use only the outline, not the raw case), the outline was silently dropped.

Now, outlines whose parent is excluded from the prompt are included as standalone content. The outline query JOINs to the parent to determine the correct content category (`case_content`, `teaching_note`, or `supplementary_content`).

## Key Files

| File | Role |
|------|------|
| `server/migrations/025_add_converted_text_cache.sql` | Adds `converted_text` and `converted_at` columns |
| `server/services/fileConverter.js` | Core conversion logic (`convertFile`, `convertPdfToText`, etc.) |
| `server/routes/caseFiles.js` | Upload, fetch/paste, re-fetch, revert, download, reconvert, text view/edit endpoints |
| `server/services/caseFileFetch.js` | URL → Markdown (web pages) or bytes + text (PDF/DOCX), via `urlFetcher.js` |
| `server/migrations/083_case_files_web_fetch.sql` | Fetch columns, `converted_text_original`, `text_edited_at`, `case_files_url_fetch_enabled` |
| `server/routes/llm.js` | `loadFileContent()` with cache + backfill, `loadCaseData()` with orphan outline fix |
| `components/CaseFilesManager.tsx` | Admin UI for Text, Reconvert, Download, Visit, and other file actions |
| `components/caseFiles/WebFetchModal.tsx`, `TextEditorPanel.tsx` | Fetch/paste review window; shared editor with Preview |
| `services/apiClient.ts` | Frontend API client (includes `api.put()` method) |
