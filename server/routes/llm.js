import express from 'express';
import { pool } from '../db.js';
import { chatWithLLM, evaluateWithLLM } from '../services/llmRouter.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { convertFile } from '../services/fileConverter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CASE_FILES_DIR = path.join(__dirname, '../../case_files');

async function getModelConfig(modelId) {
  const [rows] = await pool.execute(
    'SELECT model_id, temperature, reasoning_effort FROM models WHERE model_id = ?',
    [modelId]
  );
  return rows[0] || null;
}

// Helper: Load content from a file (handles different formats)
async function loadFileContent(caseId, filename, fileType) {
  // First try the uploads directory (new files)
  const uploadsPath = path.join(CASE_FILES_DIR, caseId, 'uploads', filename);
  try {
    await fs.access(uploadsPath);
    const ext = path.extname(filename);
    const { text } = await convertFile(uploadsPath, ext);
    return text;
  } catch (e) {
    // Not in uploads, try standard location for legacy files
  }

  // Try standard location for case.md or teaching_note.md
  if (fileType === 'case' || fileType === 'teaching_note') {
    const standardPath = path.join(CASE_FILES_DIR, caseId, `${fileType}.md`);
    try {
      return await fs.readFile(standardPath, 'utf-8');
    } catch (e) {
      // File not found
    }
  }

  return null;
}

// Load case data including markdown content for prompts
// Now uses ordered prompt context from case_files table
async function loadCaseData(caseId) {
  const [cases] = await pool.execute(
    `SELECT case_id, case_title, protagonist, protagonist_initials, chat_topic, chat_question
     FROM cases WHERE case_id = ?`,
    [caseId]
  );

  if (cases.length === 0) return null;

  const caseData = cases[0];
  caseData.case_content = '';
  caseData.teaching_note = '';
  caseData.supplementary_content = '';

  // Try to load files from database with ordering
  const [files] = await pool.execute(
    `SELECT id, filename, file_type, file_format, proprietary, proprietary_confirmed_by,
            include_in_chat_prompt, prompt_order
     FROM case_files
     WHERE case_id = ? AND include_in_chat_prompt = 1
     ORDER BY prompt_order ASC, created_at ASC`,
    [caseId]
  );

  if (files.length > 0) {
    // Load content from each file in order
    for (const file of files) {
      // Skip proprietary files without confirmation
      if (file.proprietary && !file.proprietary_confirmed_by) {
        console.warn(`[loadCaseData] Skipping unconfirmed proprietary file: ${file.filename}`);
        continue;
      }

      try {
        const content = await loadFileContent(caseId, file.filename, file.file_type);
        if (!content) continue;

        // Aggregate by file type
        if (file.file_type === 'case') {
          caseData.case_content += (caseData.case_content ? '\n\n' : '') + content;
        } else if (file.file_type === 'teaching_note') {
          caseData.teaching_note += (caseData.teaching_note ? '\n\n' : '') + content;
        } else {
          // Supplementary content (chapters, readings, articles, etc.)
          const typeLabel = file.file_type.startsWith('other:')
            ? file.file_type.substring(6)
            : file.file_type.replace('_', ' ').toUpperCase();
          caseData.supplementary_content +=
            `\n\n=== ${typeLabel}: ${file.filename} ===\n${content}`;
        }
      } catch (e) {
        console.error(`[loadCaseData] Failed to load file ${file.filename}:`, e.message);
      }
    }
  } else {
    // Fallback: Load from standard file locations (legacy behavior)
    try {
      const casePath = path.join(CASE_FILES_DIR, caseId, 'case.md');
      caseData.case_content = await fs.readFile(casePath, 'utf-8');
    } catch (e) {
      console.error(`[loadCaseData] Failed to read case file: ${path.join(CASE_FILES_DIR, caseId, 'case.md')}`, e.message);
    }

    try {
      const notePath = path.join(CASE_FILES_DIR, caseId, 'teaching_note.md');
      caseData.teaching_note = await fs.readFile(notePath, 'utf-8');
    } catch (e) {
      // Teaching note is optional
    }
  }

  if (!caseData.case_content || caseData.case_content.trim() === '') {
    console.warn(`[loadCaseData] No case content loaded for: ${caseId}`);
  }

  return caseData;
}

const router = express.Router();

// GET /api/llm/case-data/:caseId - Get case data for prompt building (content at top for caching)
router.get('/case-data/:caseId', async (req, res) => {
  const caseId = req.params.caseId;
  console.log(`[case-data] Loading case data for: ${caseId}`);
  
  try {
    const caseData = await loadCaseData(caseId);
    if (!caseData) {
      console.error(`[case-data] Case not found in database: ${caseId}`);
      return res.status(404).json({ data: null, error: { message: `Case "${caseId}" not found in database` } });
    }
    
    // Check if case content was loaded
    if (!caseData.case_content || caseData.case_content.trim() === '') {
      const casePath = path.join(CASE_FILES_DIR, caseId, 'case.md');
      console.error(`[case-data] Case content is empty. Expected file: ${casePath}`);
      return res.status(500).json({ 
        data: null, 
        error: { 
          message: `Case content file not found or empty. Expected: case_files/${caseId}/case.md` 
        } 
      });
    }
    
    console.log(`[case-data] Successfully loaded case: ${caseId} (${caseData.case_content.length} chars)`);
    res.json({ data: caseData, error: null });
  } catch (error) {
    console.error(`[case-data] Error loading case data for ${caseId}:`, error);
    console.error(`[case-data] CASE_FILES_DIR: ${CASE_FILES_DIR}`);
    console.error(`[case-data] Expected path: ${path.join(CASE_FILES_DIR, caseId, 'case.md')}`);
    res.status(500).json({ 
      data: null, 
      error: { 
        message: error.message || 'Failed to load case data. Check server logs for details.' 
      } 
    });
  }
});

router.post('/chat', async (req, res) => {
  try {
    const { modelId, systemPrompt, history, message } = req.body || {};
    if (!modelId || !systemPrompt || !message) {
      return res.status(400).json({ data: null, error: { message: 'modelId, systemPrompt, and message are required' } });
    }
    const modelConfig = await getModelConfig(modelId);
    if (!modelConfig) {
      return res.status(404).json({ data: null, error: { message: 'Model not found' } });
    }
    const { text, meta } = await chatWithLLM({
      modelId,
      systemPrompt,
      history: Array.isArray(history) ? history : [],
      message,
      config: modelConfig,
    });
    res.json({ data: { text, meta }, error: null });
  } catch (error) {
    console.error('LLM chat error:', error);
    res.status(500).json({ data: null, error: { message: error.message || 'LLM chat failed' } });
  }
});

router.post('/eval', async (req, res) => {
  try {
    const { modelId, prompt } = req.body || {};
    if (!modelId || !prompt) {
      return res.status(400).json({ data: null, error: { message: 'modelId and prompt are required' } });
    }
    const modelConfig = await getModelConfig(modelId);
    if (!modelConfig) {
      return res.status(404).json({ data: null, error: { message: 'Model not found' } });
    }
    const text = await evaluateWithLLM({ modelId, prompt, config: modelConfig });
    res.json({ data: text, error: null });
  } catch (error) {
    console.error('LLM eval error:', error);
    res.status(500).json({ data: null, error: { message: error.message || 'LLM evaluation failed' } });
  }
});

export default router;

