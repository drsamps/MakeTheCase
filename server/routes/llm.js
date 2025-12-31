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
  } catch (e) {
    caseData.case_content = '';
  }
  
  // Load teaching note
  try {
    const notePath = path.join(CASE_FILES_DIR, caseId, 'teaching_note.md');
    caseData.teaching_note = await fs.readFile(notePath, 'utf-8');
  } catch (e) {
    caseData.teaching_note = '';
  }
  
  return caseData;
}

const router = express.Router();

// GET /api/llm/case-data/:caseId - Get case data for prompt building (content at top for caching)
router.get('/case-data/:caseId', async (req, res) => {
  try {
    const caseData = await loadCaseData(req.params.caseId);
    if (!caseData) {
      return res.status(404).json({ data: null, error: { message: 'Case not found' } });
    }
    res.json({ data: caseData, error: null });
  } catch (error) {
    console.error('Error loading case data:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
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

