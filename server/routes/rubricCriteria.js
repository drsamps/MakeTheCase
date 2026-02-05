import express from 'express';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import * as rubricService from '../services/rubricService.js';

const router = express.Router();

// GET /api/rubric-criteria - List all criteria
router.get('/', async (req, res) => {
  try {
    const { enabled } = req.query;
    const enabledOnly = enabled !== 'false';

    const criteria = await rubricService.getAllCriteria(enabledOnly);
    res.json({ data: criteria, error: null });
  } catch (error) {
    console.error('Error fetching criteria:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/rubric-criteria/:criteriaId - Get a single criterion by criteria_id
router.get('/:criteriaId', async (req, res) => {
  try {
    const { criteriaId } = req.params;

    const criterion = await rubricService.getCriterionById(criteriaId);

    if (!criterion) {
      return res.status(404).json({ data: null, error: { message: 'Criterion not found' } });
    }

    res.json({ data: criterion, error: null });
  } catch (error) {
    console.error('Error fetching criterion:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/rubric-criteria/:criteriaId/usage - List rubrics using this criterion
router.get('/:criteriaId/usage', async (req, res) => {
  try {
    const { criteriaId } = req.params;

    const rubrics = await rubricService.getRubricsUsingCriterion(criteriaId);
    res.json({ data: rubrics, error: null });
  } catch (error) {
    console.error('Error fetching criterion usage:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// POST /api/rubric-criteria - Create new criterion (admin only)
router.post('/', verifyToken, requireRole(['admin']), requirePermission('rubrics'), async (req, res) => {
  try {
    const { criteria_id, name, question_text, max_points, scoring_guide, prompt_text } = req.body;

    if (!criteria_id || !name || !question_text) {
      return res.status(400).json({
        data: null,
        error: { message: 'criteria_id, name, and question_text are required' }
      });
    }

    // Validate criteria_id format (lowercase alphanumeric with underscores, max 50 chars)
    if (!/^[a-z0-9_]+$/.test(criteria_id) || criteria_id.length > 50) {
      return res.status(400).json({
        data: null,
        error: { message: 'criteria_id must be lowercase alphanumeric with underscores, max 50 characters' }
      });
    }

    // Validate max_points if provided
    if (max_points !== undefined && (max_points < 1 || max_points > 100)) {
      return res.status(400).json({
        data: null,
        error: { message: 'max_points must be between 1 and 100' }
      });
    }

    const criterion = await rubricService.createCriterion({
      criteria_id,
      name,
      question_text,
      max_points: max_points || 5,
      scoring_guide,
      prompt_text,
      created_by: req.user?.id || null
    });

    res.status(201).json({ data: criterion, error: null });
  } catch (error) {
    console.error('Error creating criterion:', error);
    if (error.message.includes('already exists')) {
      return res.status(409).json({ data: null, error: { message: error.message } });
    }
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PATCH /api/rubric-criteria/:criteriaId - Update criterion (admin only)
router.patch('/:criteriaId', verifyToken, requireRole(['admin']), requirePermission('rubrics'), async (req, res) => {
  try {
    const { criteriaId } = req.params;
    const { name, question_text, max_points, scoring_guide, prompt_text, enabled } = req.body;

    // Check if criterion exists
    const existing = await rubricService.getCriterionById(criteriaId);
    if (!existing) {
      return res.status(404).json({ data: null, error: { message: 'Criterion not found' } });
    }

    // Validate max_points if provided
    if (max_points !== undefined && (max_points < 1 || max_points > 100)) {
      return res.status(400).json({
        data: null,
        error: { message: 'max_points must be between 1 and 100' }
      });
    }

    const result = await rubricService.updateCriterion(criteriaId, {
      name,
      question_text,
      max_points,
      scoring_guide,
      prompt_text,
      enabled
    });

    res.json({
      data: result.criterion,
      affectedRubrics: result.affectedRubrics,
      error: null
    });
  } catch (error) {
    console.error('Error updating criterion:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// DELETE /api/rubric-criteria/:criteriaId - Delete criterion (admin only)
router.delete('/:criteriaId', verifyToken, requireRole(['admin']), requirePermission('rubrics'), async (req, res) => {
  try {
    const { criteriaId } = req.params;

    // Check if criterion exists
    const existing = await rubricService.getCriterionById(criteriaId);
    if (!existing) {
      return res.status(404).json({ data: null, error: { message: 'Criterion not found' } });
    }

    await rubricService.deleteCriterion(criteriaId);
    res.json({ data: { success: true }, error: null });
  } catch (error) {
    console.error('Error deleting criterion:', error);
    if (error.message.includes('used by rubrics')) {
      return res.status(409).json({ data: null, error: { message: error.message } });
    }
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

export default router;
