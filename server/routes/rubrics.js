import express from 'express';
import { pool } from '../db.js';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { requireAdminOrInstructor } from '../middleware/instructorAccess.js';
import { buildVisibilityScope, canAccessResource } from '../services/resourceAccess.js';
import { setVisibility } from '../services/visibilityWrites.js';
import { writeAudit } from '../services/auditLog.js';
import * as rubricService from '../services/rubricService.js';

const router = express.Router();

// GET /api/rubrics - List all rubrics visible to the caller.
// Returns: system defaults + caller's own + team-shared + public.
router.get('/', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const { enabled, include_criteria } = req.query;
    const enabledOnly = enabled !== 'false';

    const scope = buildVisibilityScope(req, 'rubric', 'r');
    let query = `SELECT r.rubric_id, r.rubric_name, r.description, r.criteria_ids, r.total_points,
                        r.criteria_prompt, r.additional_prompt, r.prompt_stale, r.is_system_default,
                        r.created_by, r.created_by_type, r.visibility, r.enabled, r.created_at, r.updated_at
                 FROM rubrics r WHERE ${scope.whereSql}`;
    const params = [...scope.params];
    if (enabledOnly) {
      query += ' AND r.enabled = 1';
    }
    query += ' ORDER BY r.is_system_default DESC, r.rubric_name';
    const [rubrics] = await pool.execute(query, params);

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

// POST /api/rubrics - Create rubric (admin or instructor)
router.post('/', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const { rubric_name, description, criteria_ids, additional_prompt } = req.body;

    if (!rubric_name || !criteria_ids || !Array.isArray(criteria_ids) || criteria_ids.length === 0) {
      return res.status(400).json({
        data: null,
        error: { message: 'rubric_name and criteria_ids (non-empty array) are required' }
      });
    }

    const effectiveId = req.effectiveInstructorId || req.user?.id || null;
    const createdByType = req.user.role === 'admin' && !req.effectiveInstructorId ? 'admin' : 'instructor';

    const rubric = await rubricService.createRubric({
      rubric_name,
      description,
      criteria_ids,
      additional_prompt,
      created_by: effectiveId,
      created_by_type: createdByType,
      visibility: 'private'
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

// POST /api/rubrics/:rubricId/clone - Clone a rubric to the caller's library.
router.post('/:rubricId/clone', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const { rubricId } = req.params;
    const access = await canAccessResource(req, 'rubric', parseInt(rubricId, 10), 'view');
    if (!access.allowed) {
      return res.status(access.reason === 'not_found' ? 404 : 403).json({
        data: null, error: { message: access.reason }
      });
    }
    const effectiveId = req.effectiveInstructorId || req.user?.id || null;
    const createdByType = req.user.role === 'admin' && !req.effectiveInstructorId ? 'admin' : 'instructor';
    const rubric = await rubricService.cloneRubric(parseInt(rubricId, 10), {
      created_by: effectiveId,
      created_by_type: createdByType,
    });
    res.status(201).json({ data: rubric, error: null });
  } catch (error) {
    console.error('Error cloning rubric:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PATCH /api/rubrics/:rubricId/visibility - Set Private/Team/Public + team_ids.
router.patch('/:rubricId/visibility', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const { rubricId } = req.params;
    const access = await canAccessResource(req, 'rubric', parseInt(rubricId, 10), 'share');
    if (!access.allowed) {
      return res.status(access.reason === 'not_found' ? 404 : 403).json({
        data: null, error: { message: access.reason }
      });
    }
    const result = await setVisibility(req, 'rubric', parseInt(rubricId, 10), req.body || {});
    if (!result.ok) {
      return res.status(result.status || 400).json({ data: null, error: { message: result.error } });
    }
    res.json({ data: { rubric_id: parseInt(rubricId, 10), visibility: req.body.visibility }, error: null });
  } catch (error) {
    console.error('Error setting rubric visibility:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PATCH /api/rubrics/:rubricId - Update rubric (owner or admin)
router.patch('/:rubricId', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const { rubricId } = req.params;
    const access = await canAccessResource(req, 'rubric', parseInt(rubricId, 10), 'edit');
    if (!access.allowed) {
      return res.status(access.reason === 'not_found' ? 404 : 403).json({
        data: null, error: { message: access.reason }
      });
    }
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

// DELETE /api/rubrics/:rubricId - Delete rubric (owner or admin)
router.delete('/:rubricId', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const { rubricId } = req.params;
    const access = await canAccessResource(req, 'rubric', parseInt(rubricId, 10), 'delete');
    if (!access.allowed) {
      return res.status(access.reason === 'not_found' ? 404 : 403).json({
        data: null, error: { message: access.reason }
      });
    }

    await rubricService.deleteRubric(parseInt(rubricId, 10));

    await writeAudit(req, { action: 'rubric.delete', resourceType: 'rubric', resourceId: rubricId });

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
