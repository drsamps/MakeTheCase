/**
 * Settings Routes
 *
 * Settings live in a (setting_key, scope, scope_id) table. Reads from this
 * top-level admin surface return the global row only. Instructor and section
 * overlays are written via explicit ?scope= query params, and the merged
 * resolved view is exposed at GET /merged for the instructor dashboard.
 */

import express from 'express';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import {
  getAllSettings,
  getSetting,
  getSettingForContext,
  getMergedSettings,
  updateSetting,
  setActivePrompt
} from '../services/promptService.js';

const router = express.Router();

function parseScope(req) {
  const scope = (req.query.scope || 'global').toString();
  const scopeId = (req.query.scope_id || '').toString();
  return { scope, scopeId };
}

// GET /api/settings - Global settings (admin)
router.get('/', verifyToken, requireRole(['admin']), requirePermission('settings'), async (req, res) => {
  try {
    const settings = await getAllSettings();
    res.json({ data: settings, error: null });
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/settings/merged?instructor_id=&section_id=
// Returns resolved overlay view. Available to any authenticated user — used
// by the instructor dashboard and student chat boot.
router.get('/merged', verifyToken, async (req, res) => {
  try {
    const instructorId = req.query.instructor_id ? String(req.query.instructor_id) : null;
    const sectionId = req.query.section_id ? String(req.query.section_id) : null;
    const merged = await getMergedSettings({ instructorId, sectionId });
    res.json({ data: merged, error: null });
  } catch (error) {
    console.error('Error fetching merged settings:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/settings/:key?scope=&scope_id=  (default: global)
router.get('/:key', verifyToken, requireRole(['admin']), requirePermission('settings'), async (req, res) => {
  try {
    const { key } = req.params;
    const { scope, scopeId } = parseScope(req);

    let value;
    if (scope === 'global') {
      value = await getSetting(key);
    } else {
      value = await getSettingForContext(key, {
        instructorId: scope === 'instructor' ? scopeId : null,
        sectionId: scope === 'section' ? scopeId : null,
      });
    }

    if (value === null) {
      return res.status(404).json({ data: null, error: { message: 'Setting not found' } });
    }
    res.json({ data: { key, scope, scope_id: scopeId, value }, error: null });
  } catch (error) {
    console.error('Error fetching setting:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PATCH /api/settings/:key?scope=&scope_id=
router.patch('/:key', verifyToken, requireRole(['admin']), requirePermission('settings'), async (req, res) => {
  try {
    const { key } = req.params;
    const { setting_value } = req.body;
    const { scope, scopeId } = parseScope(req);

    if (setting_value === undefined) {
      return res.status(400).json({ data: null, error: { message: 'setting_value is required' } });
    }

    if (key.startsWith('active_prompt_')) {
      const use = key.replace('active_prompt_', '');
      await setActivePrompt(use, setting_value);
    } else {
      await updateSetting(key, setting_value, { scope, scopeId });
    }

    const value = await getSetting(key);
    res.json({ data: { key, scope, scope_id: scopeId, value }, error: null });
  } catch (error) {
    console.error('Error updating setting:', error);
    const status = error.message.includes('Invalid prompt') ? 400 : 500;
    res.status(status).json({ data: null, error: { message: error.message } });
  }
});

export default router;
