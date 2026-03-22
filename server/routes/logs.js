/**
 * Logs API Routes
 * Admin endpoints for viewing and managing AI prompt logs
 */

import express from 'express';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import {
  listLogFiles,
  readLogFile,
  deleteLogFile,
  deleteLogFiles,
  getLoggingSettings,
  updateLoggingSetting
} from '../services/promptLogger.js';

const router = express.Router();

// All routes require admin role and settings permission
const adminAuth = [verifyToken, requireRole(['admin']), requirePermission('settings')];

// GET /api/logs - List log files
router.get('/', ...adminAuth, async (req, res) => {
  try {
    const { filter } = req.query; // 'chat', 'eval', or undefined for all
    const files = await listLogFiles(filter || null);
    res.json({ data: files, error: null });
  } catch (error) {
    console.error('Error listing log files:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/logs/settings - Get logging settings
router.get('/settings', ...adminAuth, async (req, res) => {
  try {
    const settings = await getLoggingSettings();
    res.json({ data: settings, error: null });
  } catch (error) {
    console.error('Error getting logging settings:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PATCH /api/logs/settings - Update logging settings
router.patch('/settings', ...adminAuth, async (req, res) => {
  try {
    const updates = req.body;
    const validKeys = ['log_case_chat_prompts', 'log_evaluation_prompts', 'max_log_files', 'log_with_full_case_context'];

    for (const [key, value] of Object.entries(updates)) {
      if (!validKeys.includes(key)) {
        return res.status(400).json({ data: null, error: { message: `Invalid setting key: ${key}` } });
      }
      await updateLoggingSetting(key, value);
    }

    const settings = await getLoggingSettings();
    res.json({ data: settings, error: null });
  } catch (error) {
    console.error('Error updating logging settings:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/logs/:filename - Get log file content
router.get('/:filename', ...adminAuth, async (req, res) => {
  try {
    const content = await readLogFile(req.params.filename);
    res.json({ data: { content }, error: null });
  } catch (error) {
    console.error('Error reading log file:', error);
    const status = error.message === 'Invalid log filename' ? 400 : 500;
    res.status(status).json({ data: null, error: { message: error.message } });
  }
});

// DELETE /api/logs/:filename - Delete single log file
router.delete('/:filename', ...adminAuth, async (req, res) => {
  try {
    await deleteLogFile(req.params.filename);
    res.json({ data: { deleted: true }, error: null });
  } catch (error) {
    console.error('Error deleting log file:', error);
    const status = error.message === 'Invalid log filename' ? 400 : 500;
    res.status(status).json({ data: null, error: { message: error.message } });
  }
});

// POST /api/logs/delete-batch - Delete multiple log files
router.post('/delete-batch', ...adminAuth, async (req, res) => {
  try {
    const { filenames } = req.body;
    if (!Array.isArray(filenames) || filenames.length === 0) {
      return res.status(400).json({ data: null, error: { message: 'filenames array is required' } });
    }

    const result = await deleteLogFiles(filenames);
    res.json({ data: result, error: null });
  } catch (error) {
    console.error('Error batch deleting log files:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

export default router;
