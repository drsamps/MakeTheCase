# Case Prep & Prompt Management - Testing Guide

## Test Results Summary

### ✅ Core Services Testing (Automated)
All automated tests PASSED:
- **Prompt Service**: 4 prompt uses, active prompt retrieval, template rendering ✓
- **PDF Text Cleaner**: Text cleaning and formatting ✓
- **File Conversion**: Markdown file conversion ✓
- **Database Integration**: 8 prompts retrieved, proper organization ✓

### ✅ Infrastructure Status
- Backend server: Running on port 3001 ✓
- Frontend server: Running on port 3000 ✓
- Database: Connected with proper schema ✓
- Migrations: All applied successfully ✓

### 📋 Manual Testing Checklist

#### 1. Prompts Tab Testing
- [ ] Navigate to Dashboard → Prompts tab
- [ ] Verify all 8 prompts are displayed in table
- [ ] Test filtering by use (dropdown should show 4 uses)
- [ ] Click "Create Prompt" button
  - [ ] Create new prompt with use="test_use", version="v1"
  - [ ] Add description and template with {placeholder}
  - [ ] Save and verify it appears in table
- [ ] Click "Edit" on existing prompt
  - [ ] Modify description
  - [ ] Save and verify changes persist
- [ ] Verify "Delete" button is disabled for active prompts
- [ ] Enable/disable a non-active prompt

#### 2. Settings Tab Testing
- [ ] Navigate to Dashboard → Settings tab
- [ ] Verify 4 active prompt settings are displayed:
  - active_prompt_case_outline_generation
  - active_prompt_chat_evaluation
  - active_prompt_chat_system_prompt
  - active_prompt_notes_cleanup
- [ ] Change case_outline_generation from "default" to "aggressive"
- [ ] Verify "Modified" badge appears
- [ ] Click "Save Changes"
- [ ] Refresh page and verify change persists
- [ ] Test "Cancel Changes" button

#### 3. Case Prep Tab Testing

##### Setup
- [ ] Navigate to Dashboard → Case Prep tab
- [ ] Select "Malawi's Pizza Catering" from case dropdown
- [ ] Verify case loads successfully

##### File Upload - Text File
- [ ] Create a simple text file with case content
- [ ] Select file type: "Case Document"
- [ ] Choose a model (e.g., Claude Opus 4)
- [ ] Click "Upload & Process"
- [ ] Verify file appears in "Existing Files" section
- [ ] Verify processing status changes: pending → processing → completed
- [ ] Verify AI-generated outline appears

##### File Upload - PDF File
- [ ] Find or create a sample PDF (teaching notes)
- [ ] Select file type: "Teaching Notes"
- [ ] Upload and process
- [ ] Verify PDF text extraction works
- [ ] Check for common PDF issues (spacing, headers/footers)

##### Side-by-Side Editor
- [ ] Click "Edit" on processed file
- [ ] Verify modal opens with two panels
- [ ] Left panel: Original document content
- [ ] Right panel: Markdown outline editor
- [ ] Make changes to markdown
- [ ] Verify live preview updates
- [ ] Click "Save"
- [ ] Verify changes persist

##### Re-Process Feature
- [ ] Click "Edit" on existing file
- [ ] Click "Re-Process" button
- [ ] Select different model
- [ ] Verify new outline is generated
- [ ] Compare with previous version

#### 4. API Endpoint Testing (via Postman)

Import the collection from: `dev/MakeTheCase-CasePrep-API.postman_collection.json`

**Required Setup:**
1. Get admin JWT token (login via frontend)
2. Set environment variables:
   - `baseUrl`: http://localhost:3001
   - `authToken`: [your JWT token]
   - `caseId`: malawis-pizza
   - `fileId`: [from upload response]
   - `promptId`: [from prompts list]

**Test Endpoints:**
- [ ] GET /api/prompts
- [ ] GET /api/prompts/uses
- [ ] POST /api/prompts (create new)
- [ ] PATCH /api/prompts/:id (update)
- [ ] GET /api/settings
- [ ] PATCH /api/settings/:key
- [ ] POST /api/case-prep/:caseId/upload
- [ ] POST /api/case-prep/:caseId/process
- [ ] GET /api/case-prep/:caseId/files
- [ ] PATCH /api/case-prep/files/:fileId/outline

#### 5. Error Handling Testing
- [ ] Upload file larger than 10MB (should fail gracefully)
- [ ] Upload unsupported file type (should show error)
- [ ] Try to delete active prompt (should be prevented)
- [ ] Set invalid prompt version in settings (should validate)
- [ ] Upload file without selecting case (should show error)
- [ ] Process file without selecting model (should show error)

#### 6. Word Document Testing (.docx)
- [ ] Create or find a .docx file with:
  - Headings (H1, H2, H3)
  - Bold and italic text
  - Bullet points
  - Tables (optional)
- [ ] Upload via Case Prep tab
- [ ] Verify mammoth.js conversion preserves structure
- [ ] Check markdown formatting is correct

#### 7. Integration Testing
- [ ] Change active prompt in Settings tab
- [ ] Upload new file in Case Prep tab
- [ ] Verify new prompt version is used for processing
- [ ] Check generated outline reflects prompt changes

#### 8. Performance Testing
- [ ] Upload 5-page PDF
- [ ] Upload 20-page PDF
- [ ] Upload 50-page PDF (if available)
- [ ] Verify processing times are reasonable
- [ ] Check for memory issues or timeouts

## Known Issues & Limitations

1. **File Conversion:**
   - Very large PDFs (>50 pages) may hit token limits
   - Complex PDF layouts may not convert perfectly
   - Some Word formatting may be lost in conversion

2. **UI/UX:**
   - No progress bar during processing (just status changes)
   - Large outlines may take time to render in preview
   - File list doesn't auto-refresh (need manual refresh)

3. **Security:**
   - File size limit is 10MB (configurable in multer)
   - Only admin users can access these features
   - No virus scanning on uploads (consider adding)

## Sample Test Files

### Sample Text File: `test-case-document.txt`
```
Malawi's Pizza: Strategic Decision Case

Background:
John Malawi founded Malawi's Pizza in 1995 in downtown Springfield...

Current Situation:
The company is facing a critical decision regarding expansion...

Financial Data:
- Annual Revenue: $2.5M
- Operating Margin: 15%
- Cash on Hand: $500K

Key Questions:
1. Should Malawi's expand into catering?
2. What are the risks and opportunities?
3. How should funding be structured?
```

### Sample Teaching Notes: `test-teaching-notes.txt`
```
Teaching Note: Malawi's Pizza Catering Decision

Learning Objectives:
1. Analyze financial viability of business expansion
2. Evaluate competitive positioning in new market
3. Assess operational capacity and constraints

Discussion Questions:
- What are Malawi's core competencies?
- How does catering align with existing operations?
- What are the key success factors for the catering business?

Recommended Approach:
1. Start with financial analysis (20 minutes)
2. Discuss market opportunity (15 minutes)
3. Evaluate operational feasibility (15 minutes)
4. Make recommendation (10 minutes)
```

## Troubleshooting

### Issue: "No token provided" error
**Solution:** Ensure you're logged in as admin user. Check browser console for JWT token.

### Issue: File upload fails
**Solution:**
- Check file size (<10MB)
- Verify file format (PDF, .docx, .txt, .md)
- Check server logs for detailed error

### Issue: Processing stuck at "pending"
**Solution:**
- Check if AI model API keys are configured in .env.local
- Verify selected model is enabled
- Check server logs for API errors

### Issue: Markdown preview not rendering
**Solution:**
- Clear browser cache
- Check browser console for JavaScript errors
- Verify react-markdown package is installed

### Issue: PDF text is garbled
**Solution:**
- PDF may have images or complex layouts
- Try using "Re-Process" with different model
- Manually edit the extracted text in side-by-side editor

## Success Criteria

✅ All manual tests pass
✅ File upload and processing works for PDF, Word, and text files
✅ AI-generated outlines are coherent and well-structured
✅ Side-by-side editor allows editing and saves changes
✅ Prompt management allows creating, editing, and enabling/disabling prompts
✅ Settings tab allows switching active prompt versions
✅ Changes to active prompts reflect in subsequent processing

## Next Steps After Testing

1. Document any bugs found
2. Performance tune for large files if needed
3. Consider adding:
   - Progress indicators during processing
   - Batch upload capability
   - Export outline as PDF/Word
   - Version history for outlines
   - Diff view when re-processing

## Production Deployment Checklist

Before deploying to production Ubuntu server, refer to:
- `dev/DEPLOYMENT-UBUNTU.md` for complete deployment guide

Key items:
- [ ] Install Node.js 18+ and npm
- [ ] Install MySQL and create database
- [ ] Configure environment variables
- [ ] Run database migrations
- [ ] Install PM2 for process management
- [ ] Configure Nginx reverse proxy
- [ ] Set up SSL certificates (Let's Encrypt)
- [ ] Configure firewall rules
- [ ] Set up automated backups
- [ ] Configure monitoring and logging
