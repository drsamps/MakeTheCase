import express from 'express';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import * as rubricService from '../services/rubricService.js';

const router = express.Router();

// GET /api/rubrics - List all rubrics
router.get('/', async (req, res) => {
  try {
    const { enabled, include_criteria } = req.query;
    const enabledOnly = enabled !== 'false';

    const rubrics = await rubricService.getAllRubrics(enabledOnly);

    // Optionally include resolved criteria for each rubric
    if (include_criteria === 'true') {
      for (const rubric of rubrics) {
        rubric.criteria = await rubricService.getCriteriaForRubric(rubric.criteria_ids);
      }
    }

    res.json({ data: rubrics, error: null });
  } catch (error) {
    console.error('Error fetching rubrics:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/rubrics/default - Get the system default rubric
router.get('/default', async (req, res) => {
  try {
    const rubric = await rubricService.getDefaultRubric();

    if (!rubric) {
      return res.status(404).json({ data: null, error: { message: 'No default rubric found' } });
    }

    res.json({ data: rubric, error: null });
  } catch (error) {
    console.error('Error fetching default rubric:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/rubrics/:rubricId - Get rubric with resolved criteria
router.get('/:rubricId', async (req, res) => {
  try {
    const { rubricId } = req.params;

    const rubric = await rubricService.getRubricById(parseInt(rubricId, 10));

    if (!rubric) {
      return res.status(404).json({ data: null, error: { message: 'Rubric not found' } });
    }

    res.json({ data: rubric, error: null });
  } catch (error) {
    console.error('Error fetching rubric:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/rubrics/:rubricId/usage - Get assignments using this rubric
router.get('/:rubricId/usage', async (req, res) => {
  try {
    const { rubricId } = req.params;

    const assignments = await rubricService.getAssignmentsUsingRubric(parseInt(rubricId, 10));

    res.json({ data: assignments, error: null });
  } catch (error) {
    console.error('Error fetching rubric usage:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// POST /api/rubrics - Create rubric (admin only)
router.post('/', verifyToken, requireRole(['admin']), requirePermission('rubrics'), async (req, res) => {
  try {
    const { rubric_name, description, criteria_ids, additional_prompt } = req.body;

    if (!rubric_name || !criteria_ids || !Array.isArray(criteria_ids) || criteria_ids.length === 0) {
      return res.status(400).json({
        data: null,
        error: { message: 'rubric_name and criteria_ids (non-empty array) are required' }
      });
    }

    const rubric = await rubricService.createRubric({
      rubric_name,
      description,
      criteria_ids,
      additional_prompt,
      created_by: req.user?.id || null
    });

    res.status(201).json({ data: rubric, error: null });
  } catch (error) {
    console.error('Error creating rubric:', error);
    if (error.message.includes('Invalid criteria_ids')) {
      return res.status(400).json({ data: null, error: { message: error.message } });
    }
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PATCH /api/rubrics/:rubricId - Update rubric (admin only)
router.patch('/:rubricId', verifyToken, requireRole(['admin']), requirePermission('rubrics'), async (req, res) => {
  try {
    const { rubricId } = req.params;
    const { rubric_name, description, criteria_ids, additional_prompt, enabled } = req.body;

    const rubric = await rubricService.updateRubric(parseInt(rubricId, 10), {
      rubric_name,
      description,
      criteria_ids,
      additional_prompt,
      enabled
    });

    res.json({ data: rubric, error: null });
  } catch (error) {
    console.error('Error updating rubric:', error);
    if (error.message.includes('not found')) {
      return res.status(404).json({ data: null, error: { message: error.message } });
    }
    if (error.message.includes('Invalid criteria_ids') || error.message.includes('Cannot disable')) {
      return res.status(400).json({ data: null, error: { message: error.message } });
    }
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PATCH /api/rubrics/:rubricId/set-default - Set rubric as system default (admin only)
router.patch('/:rubricId/set-default', verifyToken, requireRole(['admin']), requirePermission('rubrics'), async (req, res) => {
  try {
    const { rubricId } = req.params;

    const rubric = await rubricService.setDefaultRubric(parseInt(rubricId, 10));

    res.json({ data: rubric, error: null });
  } catch (error) {
    console.error('Error setting default rubric:', error);
    if (error.message.includes('not found')) {
      return res.status(404).json({ data: null, error: { message: error.message } });
    }
    if (error.message.includes('Cannot set disabled')) {
      return res.status(400).json({ data: null, error: { message: error.message } });
    }
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PATCH /api/rubrics/:rubricId/regenerate - Regenerate criteria_prompt cache (admin only)
router.patch('/:rubricId/regenerate', verifyToken, requireRole(['admin']), requirePermission('rubrics'), async (req, res) => {
  try {
    const { rubricId } = req.params;

    const rubric = await rubricService.regenerateRubricPrompt(parseInt(rubricId, 10));

    res.json({ data: rubric, error: null });
  } catch (error) {
    console.error('Error regenerating rubric prompt:', error);
    if (error.message.includes('not found')) {
      return res.status(404).json({ data: null, error: { message: error.message } });
    }
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// DELETE /api/rubrics/:rubricId - Delete rubric (admin only)
router.delete('/:rubricId', verifyToken, requireRole(['admin']), requirePermission('rubrics'), async (req, res) => {
  try {
    const { rubricId } = req.params;

    await rubricService.deleteRubric(parseInt(rubricId, 10));

    res.json({ data: { success: true }, error: null });
  } catch (error) {
    console.error('Error deleting rubric:', error);
    if (error.message.includes('not found')) {
      return res.status(404).json({ data: null, error: { message: error.message } });
    }
    if (error.message.includes('Cannot delete') || error.message.includes('used by')) {
      return res.status(409).json({ data: null, error: { message: error.message } });
    }
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

export default router;
