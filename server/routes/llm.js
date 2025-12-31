import express from 'express';
import { pool } from '../db.js';
import { chatWithLLM, evaluateWithLLM } from '../services/llmRouter.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

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

// Load case data including markdown content for prompts
async function loadCaseData(caseId) {
  const [cases] = await pool.execute(
    `SELECT case_id, case_title, protagonist, protagonist_initials, chat_topic, chat_question
     FROM cases WHERE case_id = ?`,
    [caseId]
  );
  
  if (cases.length === 0) return null;
  
  const caseData = cases[0];
  
  // Load case content
  try {
    const casePath = path.join(CASE_FILES_DIR, caseId, 'case.md');
    caseData.case_content = await fs.readFile(casePath, 'utf-8');
    if (!caseData.case_content || caseData.case_content.trim() === '') {
      console.warn(`[loadCaseData] Case file is empty: ${casePath}`);
    }
  } catch (e) {
    console.error(`[loadCaseData] Failed to read case file: ${path.join(CASE_FILES_DIR, caseId, 'case.md')}`, e.message);
    caseData.case_content = '';
  }
  
  // Load teaching note
  try {
    const notePath = path.join(CASE_FILES_DIR, caseId, 'teaching_note.md');
    caseData.teaching_note = await fs.readFile(notePath, 'utf-8');
  } catch (e) {
    // Teaching note is optional, so we don't log an error if it's missing
    caseData.teaching_note = '';
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

