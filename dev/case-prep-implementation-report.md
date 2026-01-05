# Case Prep & Prompt Management Implementation Report

**Date**: 2025-01-04
**Status**: Backend Complete, Frontend In Progress
**Developer**: Claude Code

---

## Executive Summary

This report documents the implementation of three major features for the MakeTheCase Instructor Dashboard:

1. **Case Prep Tab** - Upload and AI-process case documents and notes into structured markdown outlines
2. **Prompts Tab** - Manage AI prompt templates with versioning
3. **Settings Tab** - Configure which prompt versions are active for each use case

### Implementation Status

✅ **COMPLETE**: Database schema, backend services, API routes
⏳ **IN PROGRESS**: Frontend Dashboard tabs
⏸️ **PENDING**: End-to-end testing, frontend package installation

---

## Database Changes

### New Tables Created

#### 1. `ai_prompts` Table
Stores all AI prompt templates with versioning capability.

**Columns**:
- `id` (INT, AUTO_INCREMENT, PK) - Unique identifier
- `use` (VARCHAR(50)) - Where prompt is used (e.g., 'case_outline_generation', 'notes_cleanup')
- `version` (VARCHAR(50)) - Version identifier (e.g., 'default', 'aggressive', 'for-claude')
- `description` (TEXT) - Human-readable description
- `prompt_template` (TEXT) - The actual prompt with {placeholder} variables
- `enabled` (TINYINT(1)) - Whether prompt is available
- `created_at` (TIMESTAMP) - Creation timestamp
- `updated_at` (TIMESTAMP) - Last update timestamp

**Indexes**:
- UNIQUE KEY `unique_use_version` (`use`, `version`)
- KEY `idx_use_enabled` (`use`, `enabled`)

**Seed Data** (3 default prompts):
1. `case_outline_generation` / `default` - Standard case outline with detailed structure
2. `case_outline_generation` / `aggressive` - Critical analysis with assumption questioning
3. `notes_cleanup` / `default` - Clean and structure teaching notes

#### 2. `settings` Table
Key-value store for application configuration.

**Columns**:
- `setting_key` (VARCHAR(100), PK) - Unique setting identifier
- `setting_value` (TEXT) - Setting value
- `description` (TEXT) - Description of setting purpose
- `updated_at` (TIMESTAMP) - Last update timestamp

**Seed Data** (2 default settings):
1. `active_prompt_case_outline_generation` = `'default'`
2. `active_prompt_notes_cleanup` = `'default'`

#### 3. Extended `case_files` Table
Added columns to track AI processing status.

**New Columns**:
- `processing_status` (ENUM: 'pending', 'processing', 'completed', 'failed') - Status of AI outline generation
- `processing_model` (VARCHAR(255)) - Model ID used for processing
- `processing_error` (TEXT) - Error message if processing failed
- `outline_content` (LONGTEXT) - AI-generated outline in markdown
- `processed_at` (TIMESTAMP) - When outline was generated

**New Index**:
- KEY `idx_processing_status` (`case_id`, `processing_status`)

### Migration Files

**File**: `server/migrations/001_case_prep_and_prompts.sql`
**Executed**: Yes, using `server/scripts/run-migration-direct.js`
**Verification**: ✅ All tables created, 3 prompts + 2 settings inserted

---

## Backend Implementation

### New NPM Packages Installed

- **mammoth@1.6.0** - Word document (.docx) to markdown conversion

### New Backend Services

#### 1. `server/services/fileConverter.js`
Handles conversion of PDF and Word documents to clean text/markdown.

**Functions**:
- `convertPdfToText(filePath)` - Extract text from PDF using pdf-parse
- `convertDocxToMarkdown(filePath)` - Convert DOCX to markdown using mammoth
- `convertDocxToText(filePath)` - Fallback: DOCX to plain text
- `cleanPdfText(text)` - Fix common PDF issues (extra spaces, headers/footers)
- `detectAndRemoveHeadersFooters(text, minRepeat)` - Remove repeating page headers/footers
- `convertFile(filePath, fileExtension)` - Full conversion pipeline
- `validateFileSize(filePath, maxSizeBytes)` - Check file size limits

**Key Features**:
- Fixes "w o r d s" spacing issues common in PDFs
- Removes page numbers and headers/footers automatically
- Supports PDF, DOCX, MD, TXT formats
- 10MB file size limit enforcement

#### 2. `server/services/promptService.js`
Manages AI prompt templates with versioning and active version selection.

**Functions**:
- `getActivePrompt(use)` - Get active prompt version for a use case
- `getAllPrompts(use)` - Get all prompts (optionally filtered by use)
- `getAllPromptsForUse(use)` - Get all versions for a specific use
- `getPromptById(id)` - Get single prompt by ID
- `createPrompt(promptData)` - Create new prompt version
- `updatePrompt(id, updateData)` - Update existing prompt
- `deletePrompt(id)` - Soft delete (disable) prompt
- `setActivePrompt(use, version)` - Set active version for a use case
- `renderPrompt(template, variables)` - Replace {placeholders} with values
- `getAllPromptUses()` - Get list of unique use cases
- `getAllSettings()` - Get all settings as key-value object
- `getSetting(key)` - Get single setting value
- `updateSetting(key, value)` - Update setting value

**Key Features**:
- Validates prompt existence before setting as active
- Prevents deleting currently active prompts
- Template rendering with {variable} placeholder support
- Unique constraint on (use, version) combinations

#### 3. `server/services/llmRouter.js` (Extended)
Added new function for outline generation with higher token limits.

**New Function**:
- `generateOutlineWithLLM({modelId, prompt, config})` - Generate detailed outlines
  - Supports OpenAI, Anthropic, Google Gemini providers
  - 4096 max_tokens (vs 1024 for chat)
  - Respects temperature and reasoning_effort settings
  - Returns {text, meta} with provider and config info

### New API Routes

#### 1. `server/routes/casePrep.js`
Handles Case Prep file upload and AI processing workflow.

**Endpoints**:

**POST /api/case-prep/:caseId/upload**
- Upload PDF/DOCX/MD/TXT file for a case
- Requires admin authentication
- Saves to `/case_files/{caseId}/uploads/` directory
- Creates `case_files` record with `processing_status='pending'`
- Body params: `file_type` ('case' or 'notes'), file via multipart/form-data
- Returns: File record with id, filename, processing_status

**POST /api/case-prep/:caseId/process**
- Process uploaded file with AI to generate outline
- Requires admin authentication
- Workflow:
  1. Convert file to text (PDF/DOCX → text)
  2. Get active prompt template for file type
  3. Render prompt with file content
  4. Call LLM with model config
  5. Save outline to `outline_content`
  6. Update `processing_status='completed'`
- Body params: `file_id` (int), `model_id` (string)
- Returns: Updated file record with outline
- Error handling: Sets `processing_status='failed'` and stores error in `processing_error`

**GET /api/case-prep/:caseId/files**
- List all uploaded files for a case with processing status
- Requires admin authentication
- Returns: Array of file records ordered by created_at DESC

**PATCH /api/case-prep/files/:fileId/outline**
- Update outline content after manual editing
- Requires admin authentication
- Body params: `outline_content` (text)
- Returns: Updated file record

**GET /api/case-prep/files/:fileId/original**
- Download original uploaded file for preview
- Requires admin authentication
- Sets appropriate Content-Type based on file extension
- Returns: File stream with inline disposition

**GET /api/case-prep/files/:fileId/content**
- Get converted text content (not outline, just conversion)
- Requires admin authentication
- Returns: {text: converted content}

#### 2. `server/routes/prompts.js`
CRUD operations for AI prompt template management.

**Endpoints**:

**GET /api/prompts**
- Get all prompts (optionally filtered by `?use=case_outline_generation`)
- Requires admin authentication
- Returns prompts with `is_active` flag based on settings
- Returns: Array of prompts with metadata

**GET /api/prompts/uses**
- Get all unique prompt use cases
- Requires admin authentication
- Returns: Array of strings (use case names)

**GET /api/prompts/:id**
- Get single prompt by ID
- Requires admin authentication
- Returns: Prompt object
- 404 if not found

**POST /api/prompts**
- Create new prompt version
- Requires admin authentication
- Body params: `use`, `version`, `description`, `prompt_template`
- Returns: Created prompt with ID
- 409 if (use, version) combination already exists

**PATCH /api/prompts/:id**
- Update existing prompt (description, template, enabled flag)
- Requires admin authentication
- Cannot change use or version (must create new)
- Body params: `description`, `prompt_template`, `enabled` (all optional)
- Returns: Updated prompt
- 404 if not found

**DELETE /api/prompts/:id**
- Soft delete (disable) prompt
- Requires admin authentication
- Cannot delete if it's the currently active version
- Returns: {success: true}
- 400 if trying to delete active prompt
- 404 if not found

#### 3. `server/routes/settings.js`
Manage application configuration settings.

**Endpoints**:

**GET /api/settings**
- Get all settings as key-value pairs
- Requires admin authentication
- Returns: Object {setting_key: {value, description}}

**GET /api/settings/:key**
- Get single setting value
- Requires admin authentication
- Returns: {key, value}
- 404 if not found

**PATCH /api/settings/:key**
- Update setting value
- Requires admin authentication
- Special handling for `active_prompt_*` settings (validates prompt exists)
- Body params: `setting_value`
- Returns: {key, value}
- 400 if invalid prompt version specified

### Route Registration

**File**: `server/index.js`
**Added**:
```javascript
import casePrepRoutes from './routes/casePrep.js';
import promptsRoutes from './routes/prompts.js';
import settingsRoutes from './routes/settings.js';

app.use('/api/case-prep', casePrepRoutes);
app.use('/api/prompts', promptsRoutes);
app.use('/api/settings', settingsRoutes);
```

---

## File Storage Structure

```
/case_files/
├── {case_id}/
│   ├── uploads/                      # New: Original uploaded files
│   │   ├── case-{timestamp}.pdf
│   │   ├── notes-{timestamp}.docx
│   │   └── ...
│   ├── case.md                       # Existing: Final case document
│   └── teaching_note.md              # Existing: Final teaching note
```

**New Directory**: `/case_files/{case_id}/uploads/`
**Purpose**: Store original uploaded files separately from final processed files
**Naming**: `{basename}-{timestamp}{ext}` to avoid conflicts

---

## API Workflow Example

### Case Prep Workflow

```
1. Admin selects case and uploads PDF file
   POST /api/case-prep/malawis-pizza/upload
   Body: {file_type: 'case'}, File: malawis-case.pdf
   Response: {id: 42, filename: 'malawis-case-1704400000000.pdf', processing_status: 'pending'}

2. Admin triggers AI processing with selected model
   POST /api/case-prep/malawis-pizza/process
   Body: {file_id: 42, model_id: 'claude-opus-4'}
   Processing:
     - Convert PDF to text → "Malawi's Pizza is a family-owned..."
     - Get active prompt → case_outline_generation/default
     - Render prompt → "You are a business case expert. Convert the following..."
     - Call LLM → Generates markdown outline
     - Save outline_content
     - Set processing_status = 'completed'
   Response: {id: 42, outline_content: '## Overview\n...', processing_status: 'completed'}

3. Admin views original PDF and outline side-by-side
   GET /api/case-prep/files/42/original → Returns PDF stream
   GET /api/case-prep/malawis-pizza/files → Returns [{id: 42, outline_content: '...'}]

4. Admin edits outline manually
   PATCH /api/case-prep/files/42/outline
   Body: {outline_content: '## Updated Overview\n...'}
   Response: {id: 42, outline_content: '## Updated Overview\n...'}

5. Admin wants to re-process with different model
   POST /api/case-prep/malawis-pizza/process
   Body: {file_id: 42, model_id: 'gpt-4'}
   → Overwrites outline_content with new AI-generated version
```

### Prompt Management Workflow

```
1. Admin views all prompts
   GET /api/prompts
   Response: [
     {id: 1, use: 'case_outline_generation', version: 'default', is_active: true, ...},
     {id: 2, use: 'case_outline_generation', version: 'aggressive', is_active: false, ...},
     {id: 3, use: 'notes_cleanup', version: 'default', is_active: true, ...}
   ]

2. Admin creates new prompt version
   POST /api/prompts
   Body: {
     use: 'case_outline_generation',
     version: 'for-claude',
     description: 'Optimized for Claude models',
     prompt_template: 'You are a teaching case expert...\n{case_content}'
   }
   Response: {id: 4, ...}

3. Admin switches active version
   PATCH /api/settings/active_prompt_case_outline_generation
   Body: {setting_value: 'for-claude'}
   Response: {key: 'active_prompt_case_outline_generation', value: 'for-claude'}

4. Next case prep processing uses new active prompt
   POST /api/case-prep/malawis-pizza/process
   → Automatically uses 'for-claude' version
```

---

## Frontend Implementation (Pending)

### Required npm Packages

The following packages need to be installed for the frontend:

```bash
npm install react-pdf react-markdown
```

- **react-pdf** - For PDF viewing in the browser
- **react-markdown** - For rendering markdown preview

### Dashboard.tsx Modifications Needed

**File**: `components/Dashboard.tsx` (2840 lines)

#### 1. Type Definitions

```typescript
// Add to existing tab type
type TabType = 'sections' | 'models' | 'cases' | 'assignments' | 'personas' | 'chats' | 'caseprep' | 'prompts' | 'settings';

// New interfaces
interface CasePrepFile {
  id: number;
  case_id: string;
  filename: string;
  file_type: 'case' | 'notes';
  processing_status: 'pending' | 'processing' | 'completed' | 'failed';
  processing_model: string | null;
  processing_error: string | null;
  outline_content: string | null;
  processed_at: string | null;
  created_at: string;
}

interface Prompt {
  id: number;
  use: string;
  version: string;
  description: string;
  prompt_template: string;
  enabled: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
```

#### 2. State Variables

```typescript
// Case Prep state
const [selectedCaseForPrep, setSelectedCaseForPrep] = useState<string | null>(null);
const [prepFileType, setPrepFileType] = useState<'case' | 'notes'>('case');
const [prepSelectedModel, setPrepSelectedModel] = useState<string>('');
const [prepFiles, setPrepFiles] = useState<CasePrepFile[]>([]);
const [editingFile, setEditingFile] = useState<CasePrepFile | null>(null);
const [editingOutline, setEditingOutline] = useState<string>('');
const [isProcessing, setIsProcessing] = useState(false);

// Prompts state
const [promptsList, setPromptsList] = useState<Prompt[]>([]);
const [promptFilter, setPromptFilter] = useState<string>('all');
const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null);
const [promptForm, setPromptForm] = useState({
  use: '',
  version: '',
  description: '',
  prompt_template: '',
  enabled: true
});

// Settings state
const [settings, setSettings] = useState<Record<string, {value: string, description: string}>>({});
const [promptUses, setPromptUses] = useState<string[]>([]);
const [availableVersionsByUse, setAvailableVersionsByUse] = useState<Record<string, string[]>>({});
```

#### 3. Fetch Functions

```typescript
const fetchCasePrepFiles = async (caseId: string) => {
  const response = await api.get(`/case-prep/${caseId}/files`);
  if (response.data) {
    setPrepFiles(response.data);
  }
};

const fetchPrompts = async () => {
  const response = await api.get('/prompts');
  if (response.data) {
    setPromptsList(response.data);
  }
};

const fetchSettings = async () => {
  const response = await api.get('/settings');
  if (response.data) {
    setSettings(response.data);
  }
};

const fetchPromptUses = async () => {
  const response = await api.get('/prompts/uses');
  if (response.data) {
    setPromptUses(response.data);
  }
};
```

#### 4. Tab Buttons

Add to the tab navigation section (around line 700):

```tsx
<button
  onClick={() => handleTabChange('caseprep')}
  className={activeTab === 'caseprep' ? 'active' : ''}
>
  Case Prep
</button>
<button
  onClick={() => handleTabChange('prompts')}
  className={activeTab === 'prompts' ? 'active' : ''}
>
  Prompts
</button>
<button
  onClick={() => handleTabChange('settings')}
  className={activeTab === 'settings' ? 'active' : ''}
>
  Settings
</button>
```

#### 5. Tab Content Sections

Add conditional rendering for each new tab after the existing tab sections.

**Note**: Due to Dashboard.tsx's size (2840 lines), detailed implementation is deferred to follow-up work. The pattern should follow existing tabs (Cases, Personas, etc.) with similar structure:

- Filter/search controls
- List view with expandable details
- Modals for create/edit operations
- Loading states and error handling

---

## Testing Checklist

### Backend Testing

- [✅] Database migration executes successfully
- [✅] All new tables created with correct schema
- [✅] Seed data inserted correctly
- [ ] File upload endpoint accepts PDF/DOCX/TXT files
- [ ] File conversion works for all supported formats
- [ ] PDF spacing issues are cleaned correctly
- [ ] Headers/footers are removed from PDFs
- [ ] DOCX to markdown conversion preserves structure
- [ ] AI processing generates valid markdown outlines
- [ ] Outline editing updates database correctly
- [ ] Original file download works for all file types
- [ ] Prompts CRUD operations work correctly
- [ ] Active prompt switching updates settings
- [ ] Settings endpoints validate prompt existence
- [ ] Error handling works for failed conversions
- [ ] Error handling works for failed AI processing

### Frontend Testing (Pending)

- [ ] Case Prep tab displays correctly
- [ ] File upload UI works with drag-and-drop
- [ ] Model selector populates from models table
- [ ] Processing status updates in real-time
- [ ] Side-by-side editor shows original and outline
- [ ] PDF viewer displays PDFs correctly
- [ ] Markdown editor has live preview
- [ ] Re-process button triggers new AI generation
- [ ] Save button persists manual edits
- [ ] Prompts tab shows all prompts
- [ ] Prompt create/edit modal works
- [ ] Active status indicator displays correctly
- [ ] Settings tab shows all prompt uses
- [ ] Version dropdowns populate correctly
- [ ] Save settings persists to database

### Integration Testing (Pending)

- [ ] Upload PDF → Process → Edit → Save workflow
- [ ] Upload DOCX → Process → Edit → Save workflow
- [ ] Create prompt → Set active → Use in processing
- [ ] Switch active prompt → Verify next processing uses new prompt
- [ ] Re-process same file with different model
- [ ] Handle large files (close to 10MB limit)
- [ ] Handle malformed PDFs
- [ ] Handle corrupted DOCX files

---

## Known Limitations & Future Enhancements

### Current Limitations

1. **File Size**: 10MB limit may be restrictive for large case documents
2. **PDF Conversion**: Complex layouts with tables/images may not convert cleanly
3. **Token Limits**: Very long documents may exceed 4096 token output limit
4. **No Versioning**: Outline edits overwrite previous versions (no history)
5. **Single File Processing**: No batch processing of multiple files
6. **No Progress Indicators**: AI processing shows no progress percentage
7. **No Preview Before Processing**: Can't preview converted text before AI call

### Potential Enhancements

1. **Outline Versioning**: Track history of outline edits with rollback capability
2. **Batch Processing**: Process multiple files in parallel
3. **Progress Tracking**: Real-time progress for long AI operations
4. **Text Preview**: Show converted text before triggering AI processing
5. **Smart Chunking**: Split very large documents into sections for processing
6. **Quality Metrics**: Track conversion quality and AI output quality
7. **Template Variables**: Support more template variables (case metadata, etc.)
8. **Prompt Testing**: Test prompt templates without committing changes
9. **Export/Import Prompts**: Share prompt templates between environments
10. **Audit Log**: Track who changed which prompts and when

---

## Files Modified

### New Files Created

**Database**:
- `server/migrations/001_case_prep_and_prompts.sql` - Migration with schema changes

**Scripts**:
- `server/scripts/run-migration-direct.js` - Migration runner with direct credentials
- `server/scripts/run-case-prep-migration.js` - Original migration script (not used)

**Services**:
- `server/services/fileConverter.js` - PDF/Word conversion utilities
- `server/services/promptService.js` - Prompt management business logic

**Routes**:
- `server/routes/casePrep.js` - Case prep API endpoints
- `server/routes/prompts.js` - Prompts CRUD endpoints
- `server/routes/settings.js` - Settings management endpoints

**Documentation**:
- `dev/case-prep-implementation-report.md` - This file

### Files Modified

**Backend**:
- `server/index.js` - Registered 3 new routes
- `server/services/llmRouter.js` - Added `generateOutlineWithLLM()` function
- `package.json` - Added `mammoth` dependency

**Frontend** (Pending):
- `components/Dashboard.tsx` - To add 3 new tabs
- `package.json` - To add `react-pdf`, `react-markdown` dependencies

---

## Deployment Notes

### Database Migration

To apply the database changes to a production environment:

```bash
# Option 1: Using MySQL command line
mysql -u username -p database_name < server/migrations/001_case_prep_and_prompts.sql

# Option 2: Using the migration script
node server/scripts/run-migration-direct.js
# (Note: Update credentials in script for production)
```

### Environment Variables

No new environment variables required. Uses existing:
- `OPENAI_API_KEY` - For OpenAI models
- `ANTHROPIC_API_KEY` - For Anthropic models
- `GEMINI_API_KEY` - For Google Gemini models
- `MYSQL_*` - Database connection credentials

### File Permissions

Ensure the Node.js process has write permissions to:
- `/case_files/` directory and all subdirectories
- `/case_files/{case_id}/uploads/` directories (created dynamically)

### Security Considerations

1. **File Upload**: All uploads restricted to admin role via JWT middleware
2. **File Types**: Whitelist validation prevents upload of executable files
3. **File Size**: 10MB limit prevents DOS via large file uploads
4. **Path Traversal**: File paths sanitized via `path.join()` and case ID validation
5. **SQL Injection**: All queries use parameterized statements
6. **Prompt Injection**: User-provided prompts stored as-is; validate before rendering to LLM

---

## Support & Contact

For questions or issues with this implementation:

1. Check this documentation first
2. Review the plan file at `.claude/plans/rippling-brewing-beacon.md`
3. Test individual components (file converter, prompt service) in isolation
4. Verify database schema matches migration file

---

## Appendix: Default Prompts

### Case Outline Generation - Default

```
You are a business case analysis expert. Convert the following case document into a detailed markdown outline.

# Instructions:
- Create hierarchical structure with clear headings (use ##, ###, ####)
- Extract key facts, numbers, dates, and people
- Identify the main business problem or decision
- Summarize key data points and exhibits
- Note important quotes verbatim
- Preserve context and relationships between concepts
- Remove page numbers, headers, and footers
- Fix spacing issues (e.g., "w o r d s" should be "words")

# Case Document:
{case_content}

# Output Format:
Return ONLY the markdown outline with proper structure. No other commentary.
```

### Case Outline Generation - Aggressive

```
You are a critical business analyst. Analyze this case document and create a detailed markdown outline that questions assumptions and identifies gaps.

# Instructions:
- Create hierarchical structure with clear headings
- Extract ALL quantitative data and financial metrics
- Identify unstated assumptions explicitly
- Note missing information or data gaps
- Flag potential biases in the case narrative
- Question the framing of the business problem
- Highlight contradictions or inconsistencies
- Remove page numbers, headers, and footers
- Fix spacing issues (e.g., "w o r d s" should be "words")

# Case Document:
{case_content}

# Output Format:
Return ONLY the markdown outline with critical analysis integrated. No other commentary.
```

### Notes Cleanup - Default

```
You are a teaching case expert. Convert the following teaching note into a well-structured markdown document.

# Instructions:
- Organize by: Learning Objectives, Discussion Questions, Key Teaching Points, Suggested Answers
- Preserve pedagogical insights and instructor guidance
- Extract discussion questions verbatim
- Note suggested time allocations if present
- Highlight common student misconceptions if mentioned
- Preserve instructor notes and private comments
- Remove page numbers, headers, and footers
- Fix spacing issues (e.g., "w o r d s" should be "words")

# Teaching Note Document:
{notes_content}

# Output Format:
Return ONLY the markdown outline organized by sections. No other commentary.
```

---

**End of Report**
