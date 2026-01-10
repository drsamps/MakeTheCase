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
    console.log(`[loadFileContent] Found file at: ${uploadsPath}`);
    const ext = path.extname(filename);
    const { text } = await convertFile(uploadsPath, ext);
    console.log(`[loadFileContent] Converted ${filename}: ${text ? text.length + ' chars' : 'empty'}`);
    return text;
  } catch (e) {
    console.log(`[loadFileContent] File not in uploads or conversion failed for ${filename}:`, e.message);
    // Not in uploads, try standard location for legacy files
  }

  // Try standard location for case.md or teaching_note.md
  if (fileType === 'case' || fileType === 'teaching_note') {
    const standardPath = path.join(CASE_FILES_DIR, caseId, `${fileType}.md`);
    try {
      const content = await fs.readFile(standardPath, 'utf-8');
      console.log(`[loadFileContent] Loaded from standard path: ${standardPath}`);
      return content;
    } catch (e) {
      console.log(`[loadFileContent] Standard path not found: ${standardPath}`);
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
  let [baseFiles] = await pool.execute(
    `SELECT id, filename, file_type, file_format, proprietary, proprietary_confirmed_by,
            include_in_chat_prompt, prompt_order
     FROM case_files
     WHERE case_id = ? AND include_in_chat_prompt = 1 AND is_outline = 0
     ORDER BY prompt_order ASC, created_at ASC`,
    [caseId]
  );

  const [outlineFiles] = await pool.execute(
    `SELECT id, parent_file_id, filename, file_type, file_format, include_in_chat_prompt,
            prompt_order, is_latest_outline, outline_content
     FROM case_files
     WHERE case_id = ? AND include_in_chat_prompt = 1 AND is_outline = 1 AND is_latest_outline = 1
     ORDER BY prompt_order ASC, created_at ASC`,
    [caseId]
  );

  // Fallback: if nothing is explicitly marked include_in_chat_prompt, pull the first available case file
  if (baseFiles.length === 0) {
    console.log(`[loadCaseData] No files with include_in_chat_prompt=1 found for ${caseId}, trying fallback...`);
    
    // First try file_type='case'
    let [fallbackCaseFiles] = await pool.execute(
      `SELECT id, filename, file_type, file_format, proprietary, proprietary_confirmed_by,
              include_in_chat_prompt, prompt_order
       FROM case_files
       WHERE case_id = ? AND file_type = 'case' AND is_outline = 0
       ORDER BY prompt_order ASC, created_at ASC
       LIMIT 1`,
      [caseId]
    );
    
    // If still nothing, try ANY file for this case (might be uploaded with wrong type)
    if (fallbackCaseFiles.length === 0) {
      console.log(`[loadCaseData] No file_type='case' found, trying any file for ${caseId}...`);
      [fallbackCaseFiles] = await pool.execute(
        `SELECT id, filename, file_type, file_format, proprietary, proprietary_confirmed_by,
                include_in_chat_prompt, prompt_order
         FROM case_files
         WHERE case_id = ? AND is_outline = 0
         ORDER BY prompt_order ASC, created_at ASC`,
        [caseId]
      );
      console.log(`[loadCaseData] Found ${fallbackCaseFiles.length} files for ${caseId}:`, 
        fallbackCaseFiles.map(f => `${f.filename} (type: ${f.file_type})`));
    }
    
    baseFiles = fallbackCaseFiles;
  }

  if (baseFiles.length > 0) {
    // Organize outlines by parent
    const outlinesByParent = outlineFiles.reduce((acc, outline) => {
      if (!acc[outline.parent_file_id]) acc[outline.parent_file_id] = [];
      acc[outline.parent_file_id].push(outline);
      return acc;
    }, {});

    // Load content from each file in order, then its outlines immediately after
    for (const file of baseFiles) {
      // Skip proprietary files without confirmation
      if (file.proprietary && !file.proprietary_confirmed_by) {
        console.warn(`[loadCaseData] Skipping unconfirmed proprietary file: ${file.filename}`);
        continue;
      }

      try {
        const content = await loadFileContent(caseId, file.filename, file.file_type);
        if (content) {
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
        }
      } catch (e) {
        console.error(`[loadCaseData] Failed to load file ${file.filename}:`, e.message);
      }

      // Append outlines tied to this file, if any
      const outlines = outlinesByParent[file.id] || [];
      for (const outline of outlines) {
        try {
          const outlineContent =
            (await loadFileContent(caseId, outline.filename, outline.file_type)) ||
            outline.outline_content ||
            '';
          if (!outlineContent) continue;

          const outlineLabel = `=== OUTLINE FOR ${file.filename} ===`;

          if (file.file_type === 'case') {
            caseData.case_content += `\n\n${outlineLabel}\n${outlineContent}`;
          } else if (file.file_type === 'teaching_note') {
            caseData.teaching_note += `\n\n${outlineLabel}\n${outlineContent}`;
          } else {
            const typeLabel = file.file_type.startsWith('other:')
              ? file.file_type.substring(6)
              : file.file_type.replace('_', ' ').toUpperCase();
            caseData.supplementary_content +=
              `\n\n=== ${typeLabel}: ${file.filename} ===\n${outlineLabel}\n${outlineContent}`;
          }
        } catch (e) {
          console.error(`[loadCaseData] Failed to load outline ${outline.filename}:`, e.message);
        }
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
      // Check what files exist in the database for this case
      const [dbFiles] = await pool.execute(
        'SELECT filename, file_type, include_in_chat_prompt, proprietary, proprietary_confirmed_by FROM case_files WHERE case_id = ?',
        [caseId]
      );
      console.error(`[case-data] Case content is empty for: ${caseId}`);
      console.error(`[case-data] Files in database:`, dbFiles);
      
      let errorMsg = `No case content found for "${caseId}". `;
      if (dbFiles.length === 0) {
        errorMsg += 'No files have been uploaded. Please upload case files via the Case Files manager.';
      } else {
        // Check if files are blocked due to proprietary status
        const proprietaryUnconfirmed = dbFiles.filter(f => f.proprietary && !f.proprietary_confirmed_by);
        if (proprietaryUnconfirmed.length > 0) {
          errorMsg += `Found ${dbFiles.length} file(s) but ${proprietaryUnconfirmed.length} are marked as proprietary and require admin confirmation in the Case Files manager before they can be used.`;
        } else {
          errorMsg += `Found ${dbFiles.length} file(s) in database but none could be loaded. Check that files have file_type='case' and include_in_chat_prompt=1, or verify the file exists on disk.`;
        }
      }
      
      return res.status(500).json({ 
        data: null, 
        error: { message: errorMsg } 
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
    const { modelId, systemPrompt, history, message, caseId } = req.body || {};
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
      config: { ...modelConfig, caseId },  // Include caseId for metrics tracking
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

