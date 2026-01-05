/**
 * Prompts Routes
 * CRUD operations for AI prompt template management
 */

import express from 'express';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import {
  getAllPrompts,
  getAllPromptsForUse,
  getPromptById,
  createPrompt,
  updatePrompt,
  deletePrompt,
  getAllPromptUses
} from '../services/promptService.js';

const router = express.Router();

// GET /api/prompts - Get all prompts (optionally filtered by use)
router.get('/', verifyToken, requireRole(['admin']), requirePermission('prompts'), async (req, res) => {
  try {
    const { use } = req.query;

    const prompts = await getAllPrompts(use || null);

    res.json({
      data: prompts,
      error: null
    });

  } catch (error) {
    console.error('Error fetching prompts:', error);
    res.status(500).json({
      data: null,
      error: { message: error.message }
    });
  }
});

// GET /api/prompts/uses - Get all unique prompt use cases
router.get('/uses', verifyToken, requireRole(['admin']), requirePermission('prompts'), async (req, res) => {
  try {
    const uses = await getAllPromptUses();

    res.json({
      data: uses,
      error: null
    });

  } catch (error) {
    console.error('Error fetching prompt uses:', error);
    res.status(500).json({
      data: null,
      error: { message: error.message }
    });
  }
});

// GET /api/prompts/:id - Get single prompt by ID
router.get('/:id', verifyToken, requireRole(['admin']), requirePermission('prompts'), async (req, res) => {
  try {
    const { id } = req.params;

    const prompt = await getPromptById(parseInt(id));

    res.json({
      data: prompt,
      error: null
    });

  } catch (error) {
    console.error('Error fetching prompt:', error);
    const status = error.message.includes('not found') ? 404 : 500;
    res.status(status).json({
      data: null,
      error: { message: error.message }
    });
  }
});

// POST /api/prompts - Create new prompt version
router.post('/', verifyToken, requireRole(['admin']), requirePermission('prompts'), async (req, res) => {
  try {
    const { use, version, description, prompt_template } = req.body;

    if (!use || !version || !prompt_template) {
      return res.status(400).json({
        data: null,
        error: { message: 'use, version, and prompt_template are required' }
      });
    }

    const prompt = await createPrompt({
      use,
      version,
      description,
      prompt_template
    });

    res.status(201).json({
      data: prompt,
      error: null
    });

  } catch (error) {
    console.error('Error creating prompt:', error);
    const status = error.message.includes('already exists') ? 409 : 500;
    res.status(status).json({
      data: null,
      error: { message: error.message }
    });
  }
});

// PATCH /api/prompts/:id - Update existing prompt
router.patch('/:id', verifyToken, requireRole(['admin']), requirePermission('prompts'), async (req, res) => {
  try {
    const { id } = req.params;
    const { description, prompt_template, enabled } = req.body;

    if (description === undefined && prompt_template === undefined && enabled === undefined) {
      return res.status(400).json({
        data: null,
        error: { message: 'At least one field (description, prompt_template, enabled) must be provided' }
      });
    }

    const prompt = await updatePrompt(parseInt(id), {
      description,
      prompt_template,
      enabled
    });

    res.json({
      data: prompt,
      error: null
    });

  } catch (error) {
    console.error('Error updating prompt:', error);
    const status = error.message.includes('not found') ? 404 : 500;
    res.status(status).json({
      data: null,
      error: { message: error.message }
    });
  }
});

// DELETE /api/prompts/:id - Delete (disable) prompt
router.delete('/:id', verifyToken, requireRole(['admin']), requirePermission('prompts'), async (req, res) => {
  try {
    const { id } = req.params;

    await deletePrompt(parseInt(id));

    res.json({
      data: { success: true },
      error: null
    });

  } catch (error) {
    console.error('Error deleting prompt:', error);
    const status = error.message.includes('active') ? 400 :
                   error.message.includes('not found') ? 404 : 500;
    res.status(status).json({
      data: null,
      error: { message: error.message }
    });
  }
});

export default router;
