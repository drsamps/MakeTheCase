/**
 * Settings Routes
 * Manage application configuration settings
 */

import express from 'express';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import {
  getAllSettings,
  getSetting,
  updateSetting,
  setActivePrompt
} from '../services/promptService.js';

const router = express.Router();

// GET /api/settings - Get all settings
router.get('/', verifyToken, requireRole(['admin']), requirePermission('settings'), async (req, res) => {
  try {
    const settings = await getAllSettings();

    res.json({
      data: settings,
      error: null
    });

  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({
      data: null,
      error: { message: error.message }
    });
  }
});

// GET /api/settings/:key - Get single setting value
router.get('/:key', verifyToken, requireRole(['admin']), requirePermission('settings'), async (req, res) => {
  try {
    const { key } = req.params;

    const value = await getSetting(key);

    if (value === null) {
      return res.status(404).json({
        data: null,
        error: { message: 'Setting not found' }
      });
    }

    res.json({
      data: { key, value },
      error: null
    });

  } catch (error) {
    console.error('Error fetching setting:', error);
    res.status(500).json({
      data: null,
      error: { message: error.message }
    });
  }
});

// PATCH /api/settings/:key - Update setting value
router.patch('/:key', verifyToken, requireRole(['admin']), requirePermission('settings'), async (req, res) => {
  try {
    const { key } = req.params;
    const { setting_value } = req.body;

    if (setting_value === undefined) {
      return res.status(400).json({
        data: null,
        error: { message: 'setting_value is required' }
      });
    }

    // Special handling for active prompt settings
    if (key.startsWith('active_prompt_')) {
      const use = key.replace('active_prompt_', '');
      await setActivePrompt(use, setting_value);
    } else {
      await updateSetting(key, setting_value);
    }

    const value = await getSetting(key);

    res.json({
      data: { key, value },
      error: null
    });

  } catch (error) {
    console.error('Error updating setting:', error);
    const status = error.message.includes('Invalid prompt') ? 400 : 500;
    res.status(status).json({
      data: null,
      error: { message: error.message }
    });
  }
});

export default router;
