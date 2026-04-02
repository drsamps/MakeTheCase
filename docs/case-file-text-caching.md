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

## Orphaned Outline Fix

A related fix was made to `loadCaseData()` in `server/routes/llm.js`. Previously, AI-generated outlines (from Case Prep) were only included in prompts as children of their parent file. If the parent file had `include_in_chat_prompt = 0` (e.g., the instructor wanted to use only the outline, not the raw case), the outline was silently dropped.

Now, outlines whose parent is excluded from the prompt are included as standalone content. The outline query JOINs to the parent to determine the correct content category (`case_content`, `teaching_note`, or `supplementary_content`).

## Key Files

| File | Role |
|------|------|
| `server/migrations/025_add_converted_text_cache.sql` | Adds `converted_text` and `converted_at` columns |
| `server/services/fileConverter.js` | Core conversion logic (`convertFile`, `convertPdfToText`, etc.) |
| `server/routes/caseFiles.js` | Upload, reconvert, text view/edit endpoints |
| `server/routes/llm.js` | `loadFileContent()` with cache + backfill, `loadCaseData()` with orphan outline fix |
| `components/CaseFilesManager.tsx` | Admin UI for Text, Reconvert, and other file actions |
| `services/apiClient.ts` | Frontend API client (includes `api.put()` method) |
