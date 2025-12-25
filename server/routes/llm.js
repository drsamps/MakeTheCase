import express from 'express';
import { pool } from '../db.js';
import { chatWithLLM, evaluateWithLLM } from '../services/llmRouter.js';

async function getModelConfig(modelId) {
  const [rows] = await pool.execute(
    'SELECT model_id, temperature, reasoning_effort FROM models WHERE model_id = ?',
    [modelId]
  );
  return rows[0] || null;
}

const router = express.Router();

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

