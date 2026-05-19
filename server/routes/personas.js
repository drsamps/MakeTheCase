import express from 'express';
import { pool } from '../db.js';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { requireAdminOrInstructor } from '../middleware/instructorAccess.js';
import { buildVisibilityScope, canAccessResource } from '../services/resourceAccess.js';
import { setVisibility } from '../services/visibilityWrites.js';
import { writeAudit } from '../services/auditLog.js';
import { clonePersona } from '../services/personaService.js';

const router = express.Router();

function systemReadonlyResponse() {
  return {
    data: null,
    error: {
      code: 'SYSTEM_DEFAULT_READONLY',
      message: 'Built-in personas are read-only. Clone this persona to create your own editable copy.',
    },
  };
}

// GET /api/personas - List personas visible to caller (system + own + team + public).
router.get('/', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const { enabled } = req.query;

    const scope = buildVisibilityScope(req, 'persona', 'p');
    let query = `SELECT p.* FROM personas p WHERE ${scope.whereSql}`;
    const params = [...scope.params];

    if (enabled !== undefined) {
      query += ' AND p.enabled = ?';
      params.push(enabled === 'true' ? 1 : 0);
    }

    query += ' ORDER BY p.is_system_default DESC, p.sort_order ASC, p.persona_id ASC';

    const [rows] = await pool.execute(query, params);
    res.json({ data: rows, error: null });
  } catch (error) {
    console.error('Error fetching personas:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/personas/:personaId - Get a single persona
router.get('/:personaId', async (req, res) => {
  try {
    const { personaId } = req.params;

    const [rows] = await pool.execute(
      'SELECT * FROM personas WHERE persona_id = ?',
      [personaId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Persona not found' } });
    }

    res.json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error fetching persona:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// POST /api/personas - Create a new persona (admin only)
router.post('/', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const { persona_id, persona_name, description, instructions, enabled, sort_order } = req.body;

    if (!persona_id || !persona_name || !instructions) {
      return res.status(400).json({
        data: null,
        error: { message: 'persona_id, persona_name, and instructions are required' }
      });
    }

    if (!/^[a-z0-9-]+$/.test(persona_id) || persona_id.length > 30) {
      return res.status(400).json({
        data: null,
        error: { message: 'persona_id must be lowercase alphanumeric with hyphens, max 30 characters' }
      });
    }

    const [existing] = await pool.execute(
      'SELECT persona_id FROM personas WHERE persona_id = ?',
      [persona_id]
    );

    if (existing.length > 0) {
      return res.status(409).json({ data: null, error: { message: 'Persona ID already exists' } });
    }

    const effectiveId = req.effectiveInstructorId || req.user?.id || null;
    const createdByType = req.user.role === 'admin' && !req.effectiveInstructorId ? 'admin' : 'instructor';

    await pool.execute(
      `INSERT INTO personas (persona_id, persona_name, description, instructions, enabled, sort_order,
                             created_by, created_by_type, visibility)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'private')`,
      [
        persona_id,
        persona_name,
        description || null,
        instructions,
        enabled !== undefined ? (enabled ? 1 : 0) : 1,
        sort_order || 0,
        effectiveId,
        createdByType
      ]
    );

    const [rows] = await pool.execute(
      'SELECT * FROM personas WHERE persona_id = ?',
      [persona_id]
    );

    res.status(201).json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error creating persona:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// POST /api/personas/:personaId/clone - Clone for caller's library (new id)
router.post('/:personaId/clone', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const { personaId } = req.params;
    const access = await canAccessResource(req, 'persona', personaId, 'view');
    if (!access.allowed) {
      return res.status(access.reason === 'not_found' ? 404 : 403).json({
        data: null, error: { message: access.reason }
      });
    }
    const effectiveId = req.effectiveInstructorId || req.user?.id || null;
    const createdByType = req.user.role === 'admin' && !req.effectiveInstructorId ? 'admin' : 'instructor';
    const instructorShort = (effectiveId || 'me').toString().replace(/[^a-z0-9]/gi, '').slice(0, 6).toLowerCase() || 'me';
    const persona = await clonePersona(personaId, {
      created_by: effectiveId,
      created_by_type: createdByType,
      instructorShort,
    });
    res.status(201).json({ data: persona, error: null });
  } catch (error) {
    console.error('Error cloning persona:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PATCH /api/personas/:personaId/visibility
router.patch('/:personaId/visibility', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const { personaId } = req.params;
    const access = await canAccessResource(req, 'persona', personaId, 'share');
    if (!access.allowed) {
      return res.status(access.reason === 'not_found' ? 404 : 403).json({
        data: null, error: { message: access.reason }
      });
    }
    const result = await setVisibility(req, 'persona', personaId, req.body || {});
    if (!result.ok) {
      return res.status(result.status || 400).json({ data: null, error: { message: result.error } });
    }
    res.json({ data: { persona_id: personaId, visibility: req.body.visibility }, error: null });
  } catch (error) {
    console.error('Error setting persona visibility:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PATCH /api/personas/:personaId - Update a persona (owner or admin)
router.patch('/:personaId', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const { personaId } = req.params;
    const access = await canAccessResource(req, 'persona', personaId, 'edit');
    if (!access.allowed) {
      if (access.reason === 'not_found') {
        return res.status(404).json({ data: null, error: { message: 'Persona not found' } });
      }
      if (access.row?.is_system_default) {
        return res.status(409).json(systemReadonlyResponse());
      }
      return res.status(403).json({ data: null, error: { message: access.reason } });
    }
    const { persona_name, description, instructions, enabled, sort_order } = req.body;

    // Build update query dynamically
    const updates = [];
    const params = [];

    if (persona_name !== undefined) {
      updates.push('persona_name = ?');
      params.push(persona_name);
    }
    if (description !== undefined) {
      updates.push('description = ?');
      params.push(description);
    }
    if (instructions !== undefined) {
      updates.push('instructions = ?');
      params.push(instructions);
    }
    if (enabled !== undefined) {
      updates.push('enabled = ?');
      params.push(enabled ? 1 : 0);
    }
    if (sort_order !== undefined) {
      updates.push('sort_order = ?');
      params.push(sort_order);
    }

    if (updates.length === 0) {
      return res.status(400).json({ data: null, error: { message: 'No fields to update' } });
    }

    params.push(personaId);

    await pool.execute(
      `UPDATE personas SET ${updates.join(', ')} WHERE persona_id = ?`,
      params
    );

    const [rows] = await pool.execute(
      'SELECT * FROM personas WHERE persona_id = ?',
      [personaId]
    );

    res.json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error updating persona:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// DELETE /api/personas/:personaId - Delete a persona (owner or admin)
router.delete('/:personaId', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const { personaId } = req.params;

    const access = await canAccessResource(req, 'persona', personaId, 'delete');
    if (!access.allowed) {
      if (access.reason === 'not_found') {
        return res.status(404).json({ data: null, error: { message: 'Persona not found' } });
      }
      if (access.row?.is_system_default) {
        return res.status(409).json(systemReadonlyResponse());
      }
      return res.status(403).json({ data: null, error: { message: access.reason } });
    }

    // Check if persona exists
    const [existing] = await pool.execute(
      'SELECT persona_id FROM personas WHERE persona_id = ?',
      [personaId]
    );

    if (existing.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Persona not found' } });
    }

    // Check if persona is in use by any students or evaluations
    const [studentsUsing] = await pool.execute(
      'SELECT COUNT(*) as count FROM students WHERE favorite_persona = ?',
      [personaId]
    );

    const [evalsUsing] = await pool.execute(
      'SELECT COUNT(*) as count FROM evaluations WHERE persona = ?',
      [personaId]
    );

    if (studentsUsing[0].count > 0 || evalsUsing[0].count > 0) {
      return res.status(409).json({
        data: null,
        error: {
          message: `Cannot delete persona: it is referenced by ${studentsUsing[0].count} student(s) and ${evalsUsing[0].count} evaluation(s). Consider disabling it instead.`
        }
      });
    }

    await pool.execute('DELETE FROM personas WHERE persona_id = ?', [personaId]);

    await writeAudit(req, { action: 'persona.delete', resourceType: 'persona', resourceId: personaId });

    res.json({ data: { deleted: true }, error: null });
  } catch (error) {
    console.error('Error deleting persona:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

export default router;
