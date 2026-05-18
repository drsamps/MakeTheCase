import express from 'express';
import { pool } from '../db.js';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { requireAdminOrInstructor } from '../middleware/instructorAccess.js';
import { buildVisibilityScope, canAccessResource } from '../services/resourceAccess.js';
import { setVisibility } from '../services/visibilityWrites.js';
import * as rubricService from '../services/rubricService.js';

const router = express.Router();

// GET /api/rubric-criteria - List criteria visible to caller (system + own + team + public).
router.get('/', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const { enabled } = req.query;
    const enabledOnly = enabled !== 'false';

    const scope = buildVisibilityScope(req, 'rubric_criteria', 'rc');
    let query = `SELECT rc.* FROM rubric_criteria rc WHERE ${scope.whereSql}`;
    const params = [...scope.params];
    if (enabledOnly) query += ' AND rc.enabled = 1';
    query += ' ORDER BY rc.is_system_default DESC, rc.name';

    const [criteria] = await pool.execute(query, params);
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

// POST /api/rubric-criteria - Create new criterion (admin or instructor; private by default)
router.post('/', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const { criteria_id, name, question_text, max_points, scoring_guide, prompt_text } = req.body;

    if (!criteria_id || !name || !question_text) {
      return res.status(400).json({
        data: null,
        error: { message: 'criteria_id, name, and question_text are required' }
      });
    }

    if (!/^[a-z0-9_]+$/.test(criteria_id) || criteria_id.length > 50) {
      return res.status(400).json({
        data: null,
        error: { message: 'criteria_id must be lowercase alphanumeric with underscores, max 50 characters' }
      });
    }

    if (max_points !== undefined && (max_points < 1 || max_points > 100)) {
      return res.status(400).json({
        data: null,
        error: { message: 'max_points must be between 1 and 100' }
      });
    }

    const effectiveId = req.effectiveInstructorId || req.user?.id || null;
    const createdByType = req.user.role === 'admin' && !req.effectiveInstructorId ? 'admin' : 'instructor';

    const scoringGuideJson = scoring_guide
      ? (typeof scoring_guide === 'string' ? scoring_guide : JSON.stringify(scoring_guide))
      : null;

    try {
      await pool.execute(
        `INSERT INTO rubric_criteria
           (criteria_id, name, question_text, max_points, scoring_guide, prompt_text,
            is_system_default, created_by, created_by_type, visibility, enabled)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 'private', 1)`,
        [criteria_id, name, question_text, max_points || 5, scoringGuideJson, prompt_text || null,
         effectiveId, createdByType]
      );
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({
          data: null, error: { message: `Criterion already exists with criteria_id: ${criteria_id}` }
        });
      }
      throw e;
    }

    const created = await rubricService.getCriterionById(criteria_id);
    res.status(201).json({ data: created, error: null });
  } catch (error) {
    console.error('Error creating criterion:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// POST /api/rubric-criteria/:criteriaId/clone - Clone for caller's library (new id)
router.post('/:criteriaId/clone', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const { criteriaId } = req.params;
    const access = await canAccessResource(req, 'rubric_criteria', criteriaId, 'view');
    if (!access.allowed) {
      return res.status(access.reason === 'not_found' ? 404 : 403).json({
        data: null, error: { message: access.reason }
      });
    }
    const effectiveId = req.effectiveInstructorId || req.user?.id || null;
    const createdByType = req.user.role === 'admin' && !req.effectiveInstructorId ? 'admin' : 'instructor';
    const instructorShort = (effectiveId || 'me').toString().replace(/[^a-z0-9]/gi, '').slice(0, 6).toLowerCase() || 'me';
    const criterion = await rubricService.cloneCriterion(criteriaId, {
      created_by: effectiveId,
      created_by_type: createdByType,
      instructorShort,
    });
    res.status(201).json({ data: criterion, error: null });
  } catch (error) {
    console.error('Error cloning criterion:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PATCH /api/rubric-criteria/:criteriaId/visibility - Set Private/Team/Public
router.patch('/:criteriaId/visibility', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const { criteriaId } = req.params;
    const access = await canAccessResource(req, 'rubric_criteria', criteriaId, 'share');
    if (!access.allowed) {
      return res.status(access.reason === 'not_found' ? 404 : 403).json({
        data: null, error: { message: access.reason }
      });
    }
    const result = await setVisibility(req, 'rubric_criteria', criteriaId, req.body || {});
    if (!result.ok) {
      return res.status(result.status || 400).json({ data: null, error: { message: result.error } });
    }
    res.json({ data: { criteria_id: criteriaId, visibility: req.body.visibility }, error: null });
  } catch (error) {
    console.error('Error setting criterion visibility:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PATCH /api/rubric-criteria/:criteriaId - Update criterion (owner or admin)
router.patch('/:criteriaId', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const { criteriaId } = req.params;
    const { name, question_text, max_points, scoring_guide, prompt_text, enabled } = req.body;

    const access = await canAccessResource(req, 'rubric_criteria', criteriaId, 'edit');
    if (!access.allowed) {
      if (access.reason === 'not_found') {
        return res.status(404).json({ data: null, error: { message: 'Criterion not found' } });
      }
      // Hint for system-default criteria: clone first
      if (access.row?.is_system_default) {
        return res.status(409).json({
          data: null,
          error: {
            code: 'SYSTEM_DEFAULT_READONLY',
            message: 'System-default criteria are read-only. Clone this criterion to your own library to edit it.',
          },
        });
      }
      return res.status(403).json({ data: null, error: { message: access.reason } });
    }
    const existing = access.row;

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

// DELETE /api/rubric-criteria/:criteriaId - Delete criterion (owner or admin)
router.delete('/:criteriaId', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const { criteriaId } = req.params;

    const access = await canAccessResource(req, 'rubric_criteria', criteriaId, 'delete');
    if (!access.allowed) {
      return res.status(access.reason === 'not_found' ? 404 : 403).json({
        data: null, error: { message: access.reason }
      });
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
