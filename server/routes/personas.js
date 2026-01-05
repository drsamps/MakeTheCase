import express from 'express';
import { pool } from '../db.js';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';

const router = express.Router();

// GET /api/personas - List all personas (optionally filtered by enabled status)
router.get('/', async (req, res) => {
  try {
    const { enabled } = req.query;

    let query = 'SELECT * FROM personas';
    const params = [];

    if (enabled !== undefined) {
      query += ' WHERE enabled = ?';
      params.push(enabled === 'true' ? 1 : 0);
    }

    query += ' ORDER BY sort_order ASC, persona_id ASC';

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
router.post('/', verifyToken, requireRole(['admin']), requirePermission('personas'), async (req, res) => {
  try {
    const { persona_id, persona_name, description, instructions, enabled, sort_order } = req.body;

    if (!persona_id || !persona_name || !instructions) {
      return res.status(400).json({
        data: null,
        error: { message: 'persona_id, persona_name, and instructions are required' }
      });
    }

    // Validate persona_id format (alphanumeric and hyphens, max 30 chars)
    if (!/^[a-z0-9-]+$/.test(persona_id) || persona_id.length > 30) {
      return res.status(400).json({
        data: null,
        error: { message: 'persona_id must be lowercase alphanumeric with hyphens, max 30 characters' }
      });
    }

    // Check if persona_id already exists
    const [existing] = await pool.execute(
      'SELECT persona_id FROM personas WHERE persona_id = ?',
      [persona_id]
    );

    if (existing.length > 0) {
      return res.status(409).json({ data: null, error: { message: 'Persona ID already exists' } });
    }

    await pool.execute(
      `INSERT INTO personas (persona_id, persona_name, description, instructions, enabled, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        persona_id,
        persona_name,
        description || null,
        instructions,
        enabled !== undefined ? (enabled ? 1 : 0) : 1,
        sort_order || 0
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

// PATCH /api/personas/:personaId - Update a persona (admin only)
router.patch('/:personaId', verifyToken, requireRole(['admin']), requirePermission('personas'), async (req, res) => {
  try {
    const { personaId } = req.params;
    const { persona_name, description, instructions, enabled, sort_order } = req.body;

    // Check if persona exists
    const [existing] = await pool.execute(
      'SELECT persona_id FROM personas WHERE persona_id = ?',
      [personaId]
    );

    if (existing.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Persona not found' } });
    }

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

// DELETE /api/personas/:personaId - Delete a persona (admin only)
router.delete('/:personaId', verifyToken, requireRole(['admin']), requirePermission('personas'), async (req, res) => {
  try {
    const { personaId } = req.params;

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

    res.json({ data: { deleted: true }, error: null });
  } catch (error) {
    console.error('Error deleting persona:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

export default router;
