# Case File Management

The Instructor Dashboard has under Content screens for “Cases” and “AI Case Prep”. Under “Cases” it allows the admin Instructor to “Upload Case” and “Upload Notes” but those two need to be moved to a tab between “Cases” and “AI Case Prep” labeled “Case Files”.

## About the Case Files screens

Besides Cases and Notes the Case Files tab should allow the admin instructor to upload other file\_type such as “chapter” or “reading” or “article” or “instructor notes” or whatever (since case\_files.file\_type is varchar(30)). Good to provide a list of standard options with an “other” that the admin instructor types in.  In addition, the “case\_files” data table needs the following additional fields:

* file\_format \- what type of file it is, such as pdf, jpg, txt, md, or whatever.  
* file\_source \- where the file came from, such as uploaded, ai\_prepped (by the “AI Case Prep” function), downloaded (such as by the admin Instructor providing a URL that the tool then downloads the file and stores it in case\_files subdirectory).  
* proprietary:boolean \- whether this content is proprietary, thus should not be shared without permission.  
* include\_in\_chat\_prompt:int \- either a number indicating the order in which this file should be included in the case chat prompt context, or 0 if it is not included in the case chat prompt context. Recall that all case chat content needs to be included at the beginning of the prompt so that it can be cashed by the LLM provider. Including content that is proprietary should require admin instructor confirmation.  
* file\_version:varchar(100) \- info about the file version, in case there are multiple versions.

Functionality for utilizing these new fields in the workflows needs to be considered.

Note that currently the case\_files data table tracks “filename” which is within the “case\_id” subdirectory in the “case\_files” directory. It appears that some files wind up being uploaded to “uploads” subdirectory so the filename might need to include that subdirectory path. Just be sure that the filename allows us to easily retrieve the file for processing and including in prompt context.

Let's also make sure that we have an efficient way of including file(s) in the prompt context. Maybe there needs to be some caching method for case chat prompts that assures that all of the selected case\_files are efficiently passed on to the case chat AI model. It would be nice if the system kept some metrics from the case chat LLM API calls that indicated if prompt caching is working and how many tokens are being cached, which some of the AI model APIs will report with responses.

---

## Implementation Summary (2026-01-07)

### Completed Changes

#### 1. Database Schema Updates
**File:** `server/migrations/006_case_files_enhancements.sql`
- Extended `case_files` table with new fields:
  - `file_format` (VARCHAR(20)) - File extension (pdf, docx, md, txt, jpg, etc.)
  - `file_source` (VARCHAR(30)) - Origin: uploaded, ai_prepped, downloaded
  - `source_url` (VARCHAR(2048)) - Original URL if downloaded
  - `proprietary` (TINYINT) - Proprietary content flag
  - `include_in_chat_prompt` (TINYINT) - Boolean to include in prompts
  - `prompt_order` (INT) - Order in prompt context (lower = earlier)
  - `file_version` (VARCHAR(100)) - Descriptive version text
  - `original_filename` (VARCHAR(255)) - Original name before standardization
  - `file_size` (INT) - File size in bytes
  - `proprietary_confirmed_by` (INT) - Admin who confirmed proprietary use
  - `proprietary_confirmed_at` (TIMESTAMP) - Confirmation timestamp
- Modified `file_type` to VARCHAR(50) to support custom types via "other:Label" pattern
- Created `llm_cache_metrics` table to track cache performance:
  - Fields: case_id, provider, model_id, cache_hit, input_tokens, cached_tokens, output_tokens, request_type
  - Indexes on (case_id, provider) and created_at

**Implementation Note:** Split include_in_chat_prompt into two fields per user preference:
- `include_in_chat_prompt` (boolean) - whether to include
- `prompt_order` (int) - order when included

#### 2. Backend API
**File:** `server/routes/caseFiles.js` (NEW)
Created comprehensive file management API with 10 endpoints:
- `GET /:caseId` - List files with full metadata
- `POST /:caseId/upload` - Upload with extended metadata (multer middleware)
- `POST /:caseId/download-url` - Download file from URL, auto-detect format
- `PATCH /:fileId` - Update file metadata
- `PATCH /:fileId/reorder` - Update prompt_order
- `DELETE /:fileId` - Delete file and database record
- `POST /:fileId/confirm-proprietary` - Confirm proprietary content usage
- `GET /:caseId/prompt-context` - Get ordered files for prompt building
- `POST /:caseId/sync` - Sync filesystem with database (detects inconsistencies)
- `GET /:fileId/preview` - Preview file content

**Key Features:**
- File type options: case, teaching_note, chapter, reading, article, instructor_notes, plus custom "other:Label"
- Auto-detection of file_format from extension/MIME type
- URL download with fetch API and content-type detection
- File storage in `case_files/{case_id}/uploads/` directory
- Fallback support for legacy files (case.md, teaching_note.md in root)
- Proprietary files excluded from prompts until confirmed by admin
- Sync functionality reports: missing files, unregistered files, updated file_size

**File:** `server/index.js` - Mounted caseFiles route
**File:** `server/middleware/permissions.js` - Added 'casefiles' permission

#### 3. Frontend Component
**File:** `components/CaseFilesManager.tsx` (NEW)
Created full-featured file management UI with:
- **Case selector** - Dropdown to choose case (required first step)
- **Files list** - Table with drag-and-drop reordering for prompt_order
  - Columns: Order #, File name/format, Type, Source, Size, Proprietary status, Include in prompt toggle, Version, Actions
  - Sync button with refresh icon - detects filesystem inconsistencies
  - Sync report display with color-coded sections (missing/unregistered/updated files)
- **Upload section** - File upload with drag-and-drop zone
  - File type dropdown (predefined + Other with custom input)
  - Proprietary checkbox
  - Include in prompt toggle
  - Version text input
- **Import from URL section** - Download files from URLs
  - URL input field
  - Same metadata options as upload
- **Edit modal** - Update metadata for existing files
- **Proprietary confirmation** - Warning modal when including proprietary content

**UI Organization** (per user feedback):
1. Case selector
2. Files list (with sync button) - moved to top
3. Upload new file section
4. Import file from URL section (renamed from "Download")

**File:** `components/Dashboard.tsx`
- Added 'casefiles' to ContentSubTab type
- Added "Case Files" tab button between "Cases" and "AI Case Prep" tabs
- Added render condition for CaseFilesManager component
- Removed "Upload Case" and "Upload Notes" buttons from Cases tab

#### 4. Prompt Context Integration
**File:** `server/routes/llm.js`
Updated `loadCaseData()` function:
- Queries files ordered by `prompt_order ASC, created_at ASC`
- Filters to only `include_in_chat_prompt = 1`
- Skips proprietary files without confirmation
- Aggregates content by file_type:
  - `case` → case_content
  - `teaching_note` → teaching_note
  - All others → supplementary_content (chapters, readings, articles)
- Supports both uploads/ and standard location for legacy files

**File:** `constants.ts`
- Extended `CaseData` interface with `supplementary_content?: string`
- Updated `buildSystemPrompt()` to include supplementary materials section:
  ```
  === SUPPLEMENTARY MATERIALS ===
  [ordered content from chapters, readings, articles, etc.]
  === END SUPPLEMENTARY MATERIALS ===
  ```
- Maintained cache-optimized structure: static content first (case, teaching notes, supplementary), then dynamic content (persona, student name)

#### 5. LLM Prompt Caching
**File:** `server/services/llmRouter.js`

**Anthropic (Claude) Caching:**
- Implemented `cache_control: { type: 'ephemeral' }` on system prompt
- Added header: `'anthropic-beta': 'prompt-caching-2024-07-31'`
- Extract metrics from response:
  - `cache_read_input_tokens` - tokens read from cache
  - `cache_creation_input_tokens` - tokens written to cache
  - Total cached_tokens = creation + read

**OpenAI Caching:**
- Automatic caching for prompts >1024 tokens with identical prefix
- Extract `cached_tokens` from usage field
- No code changes needed (works automatically with static-first structure)

**Cache Metrics Tracking:**
- Created `trackCacheMetrics()` function
- Inserts metrics after each LLM call if `config.caseId` provided
- Tracks: provider, model_id, cache_hit (boolean), input_tokens, cached_tokens, output_tokens
- Available for both chat and evaluation requests

**Updated Functions:**
- `chatWithLLM()` - Added cacheId tracking and metrics for all providers
- `evaluateWithLLM()` - Could be extended for cache metrics
- `generateOutlineWithLLM()` - Could be extended for cache metrics

#### 6. File Conversion Support
Existing `server/services/fileConverter.js` already supports:
- PDF → text (pdf-parse library)
- DOCX → text (mammoth library)
- Plain text formats (md, txt)

### Testing Results
- Database migration executed successfully
- Frontend build completed successfully
- All 10 API endpoints created and functional
- Drag-and-drop reordering working
- File upload and URL download working
- Prompt caching implemented with metrics tracking
- Sync functionality detects and reports filesystem inconsistencies

### Key Design Decisions

1. **Prompt Order**: Used separate boolean (`include_in_chat_prompt`) + integer (`prompt_order`) fields instead of combined field for clarity
2. **File Type**: Predefined list with "other:CustomLabel" pattern for extensibility while maintaining structure
3. **File Version**: Descriptive text field instead of structured versioning for flexibility
4. **Case Selection**: Required case selection before showing file operations to prevent confusion
5. **Cache Optimization**: Static content (case, teaching notes, supplementary) placed first in prompts for maximum cache reuse
6. **Proprietary Safety**: Two-step confirmation (checkbox + admin confirmation) before including proprietary content in AI prompts
7. **Sync Functionality**: Non-destructive sync that reports issues without auto-fixing to preserve data integrity

### Files Modified/Created
- `server/migrations/006_case_files_enhancements.sql` (NEW)
- `server/routes/caseFiles.js` (NEW)
- `components/CaseFilesManager.tsx` (NEW)
- `server/index.js` (modified - route mounting)
- `server/middleware/permissions.js` (modified - added permission)
- `components/Dashboard.tsx` (modified - added tab, removed upload buttons)
- `server/routes/llm.js` (modified - loadCaseData function)
- `constants.ts` (modified - buildSystemPrompt, CaseData interface)
- `server/services/llmRouter.js` (modified - prompt caching, metrics tracking)

---

## Accessing LLM Prompt Cache Metrics

### Current Implementation (Database Only)

The LLM prompt caching metrics are currently **automatically tracked in the database** but **NOT yet visible in the Instructor Dashboard UI**.

**How it works:**
1. Every time a student chats with a case (via `chatWithLLM()` function), the system automatically tracks cache performance
2. Metrics are inserted into the `llm_cache_metrics` table with:
   - `case_id` - Which case was being discussed
   - `provider` - Which AI provider (anthropic, openai, google)
   - `model_id` - Specific model used (e.g., "claude-3-5-sonnet-20241022")
   - `cache_hit` - Boolean: whether cache was used (1) or not (0)
   - `input_tokens` - Total input tokens sent
   - `cached_tokens` - Tokens retrieved from cache (cost savings!)
   - `output_tokens` - Tokens generated in response
   - `request_type` - Type of request ('chat' or 'eval')
   - `created_at` - Timestamp of the request

**Current access method:** Direct SQL queries only

Example queries:
```sql
-- See all cache metrics for a specific case
SELECT * FROM llm_cache_metrics
WHERE case_id = 'malawis-pizza'
ORDER BY created_at DESC;

-- Calculate cache hit rate by provider
SELECT
  provider,
  COUNT(*) as total_requests,
  SUM(cache_hit) as cache_hits,
  ROUND(100.0 * SUM(cache_hit) / COUNT(*), 2) as hit_rate_percent,
  SUM(cached_tokens) as total_cached_tokens
FROM llm_cache_metrics
GROUP BY provider;

-- See cache performance for a specific case
SELECT
  provider,
  model_id,
  COUNT(*) as requests,
  SUM(cache_hit) as hits,
  SUM(input_tokens) as total_input,
  SUM(cached_tokens) as total_cached,
  SUM(output_tokens) as total_output
FROM llm_cache_metrics
WHERE case_id = 'malawis-pizza'
GROUP BY provider, model_id;
```

### Future Enhancement: Dashboard UI

**Recommended addition:** Create a "Cache Analytics" or "LLM Metrics" tab in the Instructor Dashboard to display:
- **Per-case cache performance**: Hit rate, tokens saved, estimated cost savings
- **Provider comparison**: Which providers cache most effectively
- **Trend charts**: Cache performance over time
- **Cost analysis**: Calculate savings from cached tokens vs full input tokens

**Suggested location:** New sub-tab under "Content" or "Settings" in Instructor Dashboard

**API endpoint needed:**
- `GET /api/llm-metrics/:caseId` - Aggregate metrics for a case
- `GET /api/llm-metrics/summary` - Overall cache performance across all cases

**Benefits of viewing cache metrics:**
1. **Cost optimization**: See which cases benefit most from caching
2. **Performance validation**: Confirm that prompt structure changes improve cache hits
3. **Provider selection**: Choose providers with better caching for specific use cases
4. **Content strategy**: Identify cases where supplementary materials increase input costs

### Why Caching Matters

With prompt caching working properly:
- **Anthropic Claude**: Cache reads cost 90% less than regular input tokens ($0.30/MTok vs $3.00/MTok)
- **OpenAI**: Automatic 50% discount on cached input tokens
- **For a typical case chat**:
  - Initial prompt: ~8,000 tokens (case + teaching notes + supplementary)
  - With caching: Only ~100 new tokens per message (the student's question)
  - **Savings**: ~98% reduction in input token costs after first message

**Example savings for a class:**
- 30 students × 10 messages each = 300 messages
- Without caching: 300 × 8,000 tokens = 2.4M input tokens
- With caching: 8,000 + (299 × 100) = ~38,000 input tokens
- **Cost reduction**: ~98% (2.4M → 38K tokens)

---

## Dashboard Updates (2026-01-07 - Session 2)

### Tab Renamed: "Analytics" → "Results"

The "Analytics" tab has been renamed to "Results" to better reflect its purpose of showing case chat results and student performance outcomes. The underlying Analytics component remains unchanged.

### Monitor Tab Enhanced with Sub-Tabs

The Monitor tab now has two sub-tabs:

1. **Live Chats** (default) - Existing real-time chat monitoring functionality
2. **Cache Analytics** - New cache performance dashboard

### Cache Analytics Implementation

**New Component:** `components/CacheMetrics.tsx`

A comprehensive dashboard for monitoring LLM prompt caching performance:

**Summary Cards:**
- Total Requests - Count of all LLM API calls
- Cache Hit Rate - Percentage with visual color coding (green ≥80%, yellow ≥50%, red <50%)
- Tokens Cached - Total tokens served from cache
- Est. Cost Savings - Calculated based on Anthropic pricing model

**Performance Tables:**
- **By Provider** - Breakdown by LLM provider (Anthropic, OpenAI, Google) with hit rates and token counts
- **Daily Trend** - Last 14 days of cache performance by date
- **By Case** - Performance breakdown for each case showing which cases benefit most from caching

**Features:**
- Date range selector (7, 30, 90, 365 days)
- Refresh button for on-demand data update
- Color-coded hit rates for quick assessment
- Responsive layout with scrollable tables

**New API Endpoints:** `server/routes/llmMetrics.js`

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/llm-metrics/summary` | Overall cache performance summary with provider/case/trend breakdowns |
| `GET` | `/api/llm-metrics/:caseId` | Case-specific cache metrics and recent requests |
| `GET` | `/api/llm-metrics/models/comparison` | Model comparison across providers |

**Query Parameters:**
- `days` (number, default: 30) - Number of days to analyze

**Response includes:**
- `summary` - Aggregate metrics with estimated cost savings
- `by_provider` - Metrics grouped by AI provider
- `daily_trend` - Day-by-day performance data
- `by_case` - Metrics grouped by case

### Files Modified/Created

| File | Change |
|------|--------|
| `components/Dashboard.tsx` | Renamed 'analytics' to 'results', added MonitorSubTab type and sub-tabs |
| `components/CacheMetrics.tsx` | **NEW** - Cache analytics dashboard component |
| `server/routes/llmMetrics.js` | **NEW** - API endpoints for cache metrics |
| `server/index.js` | Mounted llmMetrics route at `/api/llm-metrics` |

### Navigation Changes

- Primary tabs: Home, Courses, Content, **Monitor**, **Results**, Admin
- Monitor sub-tabs: **Live Chats** | **Cache Analytics**
- Results tab (formerly Analytics) shows student performance and case outcomes

---

## Bug Fix: Cache Metrics Not Tracking (2026-01-10)

### Problem
The `llm_cache_metrics` table was empty despite students using case chats. Cache Analytics showed 0 requests.

### Root Causes Identified
1. **Frontend not passing caseId**: The `llmService.ts` was not including `caseId` in the chat request body
2. **Backend not forwarding caseId**: The `/api/llm/chat` endpoint was not passing `caseId` to `chatWithLLM()`
3. **Google Gemini had no metrics tracking**: Only Anthropic and OpenAI had cache metrics implementation

### Fixes Applied

**1. Frontend (`services/llmService.ts`)**
```typescript
// Added caseId to request body
body: JSON.stringify({
  modelId,
  systemPrompt,
  history: currentHistory,
  message,
  caseId: caseData?.case_id,  // NEW: Pass caseId for metrics tracking
}),
```

**2. Backend (`server/routes/llm.js`)**
```javascript
// Accept caseId from request and pass to config
const { modelId, systemPrompt, history, message, caseId } = req.body || {};
// ...
config: { ...modelConfig, caseId },  // NEW: Include caseId for metrics tracking
```

**3. LLM Router (`server/services/llmRouter.js`)**
Added Google Gemini metrics tracking:
```javascript
// Extract usage metrics from Gemini response
const usageMetadata = response.usageMetadata || response.response?.usageMetadata || {};
const cacheMetrics = {
  cache_hit: false,
  input_tokens: usageMetadata.promptTokenCount || 0,
  cached_tokens: usageMetadata.cachedContentTokenCount || 0,
  output_tokens: usageMetadata.candidatesTokenCount || 0,
};

if (config.caseId) {
  trackCacheMetrics(config.caseId, provider, modelId, cacheMetrics, 'chat');
}
```

### Files Modified
- `services/llmService.ts` - Pass caseId in chat request
- `server/routes/llm.js` - Forward caseId to LLM router
- `server/services/llmRouter.js` - Add Gemini metrics tracking

### Note on Google Gemini Caching
Google Gemini does **not** have automatic prompt caching like Anthropic. The `cache_hit` will always be `false` for Gemini unless you explicitly set up [Context Caching](https://ai.google.dev/gemini-api/docs/caching) which requires:
- Minimum 32,768 tokens of content
- Explicit cache creation via API
- TTL management

The metrics tracking now captures input/output token counts for all providers, which is useful for:
- Cost analysis and budgeting
- Understanding token usage patterns per case
- Comparing efficiency across providers