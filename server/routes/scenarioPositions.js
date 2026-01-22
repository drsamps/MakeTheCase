import express from 'express';
import { pool } from '../db.js';
import { verifyToken, requireRole } from '../middleware/auth.js';

const router = express.Router({ mergeParams: true });

// GET /api/cases/:caseId/scenarios/:scenarioId/positions - List all positions for a scenario
router.get('/', async (req, res) => {
  try {
    const { scenarioId } = req.params;
    const { enabled } = req.query;

    let query = `
      SELECT position_id, scenario_id, position_name, position, position_order,
             arguments_for, arguments_against, position_enabled,
             created_at, updated_at
      FROM scenario_positions
      WHERE scenario_id = ?
    `;
    const params = [scenarioId];

    if (enabled !== undefined) {
      query += ' AND position_enabled = ?';
      params.push(enabled === 'true' ? 1 : 0);
    }

    query += ' ORDER BY position_order ASC, position_id ASC';

    const [rows] = await pool.execute(query, params);
    res.json({ data: rows, error: null });
  } catch (error) {
    console.error('Error fetching positions:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/cases/:caseId/scenarios/:scenarioId/positions/:positionId - Get single position
router.get('/:positionId', async (req, res) => {
  try {
    const { scenarioId, positionId } = req.params;

    const [rows] = await pool.execute(
      `SELECT position_id, scenario_id, position_name, position, position_order,
              arguments_for, arguments_against, position_enabled,
              created_at, updated_at
       FROM scenario_positions
       WHERE scenario_id = ? AND position_id = ?`,
      [scenarioId, positionId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Position not found' } });
    }

    res.json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error fetching position:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// POST /api/cases/:caseId/scenarios/:scenarioId/positions - Create new position (admin only)
router.post('/', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { caseId, scenarioId } = req.params;
    const {
      position_name, position, position_order,
      arguments_for, arguments_against, position_enabled
    } = req.body;

    // Validate required fields
    if (!position_name || !position) {
      return res.status(400).json({
        data: null,
        error: { message: 'position_name and position are required' }
      });
    }

    // Check if scenario exists and belongs to the case
    const [scenarioRows] = await pool.execute(
      'SELECT id FROM case_scenarios WHERE id = ? AND case_id = ?',
      [scenarioId, caseId]
    );
    if (scenarioRows.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Scenario not found' } });
    }

    // Check for duplicate position_name
    const [existingName] = await pool.execute(
      'SELECT position_id FROM scenario_positions WHERE scenario_id = ? AND position_name = ?',
      [scenarioId, position_name]
    );
    if (existingName.length > 0) {
      return res.status(409).json({
        data: null,
        error: { message: `A position with name "${position_name}" already exists for this scenario` }
      });
    }

    // Get max position_order if not specified
    let finalOrder = position_order;
    if (finalOrder === undefined || finalOrder === null) {
      const [maxOrder] = await pool.execute(
        'SELECT COALESCE(MAX(position_order), -1) + 1 as next_order FROM scenario_positions WHERE scenario_id = ?',
        [scenarioId]
      );
      finalOrder = maxOrder[0].next_order;
    }

    const [result] = await pool.execute(
      `INSERT INTO scenario_positions
       (scenario_id, position_name, position, position_order, arguments_for, arguments_against, position_enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        scenarioId,
        position_name,
        position,
        finalOrder,
        arguments_for || null,
        arguments_against || null,
        position_enabled !== false ? 1 : 0
      ]
    );

    // Return created position
    const [rows] = await pool.execute(
      `SELECT position_id, scenario_id, position_name, position, position_order,
              arguments_for, arguments_against, position_enabled,
              created_at, updated_at
       FROM scenario_positions WHERE position_id = ?`,
      [result.insertId]
    );

    res.status(201).json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error creating position:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PATCH /api/cases/:caseId/scenarios/:scenarioId/positions/:positionId - Update position (admin only)
router.patch('/:positionId', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { scenarioId, positionId } = req.params;
    const updates = req.body;

    // Check if position exists
    const [existing] = await pool.execute(
      'SELECT position_id, position_name FROM scenario_positions WHERE scenario_id = ? AND position_id = ?',
      [scenarioId, positionId]
    );
    if (existing.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Position not found' } });
    }

    // Check for duplicate position_name if changing name
    if (updates.position_name && updates.position_name !== existing[0].position_name) {
      const [duplicateName] = await pool.execute(
        'SELECT position_id FROM scenario_positions WHERE scenario_id = ? AND position_name = ? AND position_id != ?',
        [scenarioId, updates.position_name, positionId]
      );
      if (duplicateName.length > 0) {
        return res.status(409).json({
          data: null,
          error: { message: `A position with name "${updates.position_name}" already exists for this scenario` }
        });
      }
    }

    const allowedFields = [
      'position_name', 'position', 'position_order',
      'arguments_for', 'arguments_against', 'position_enabled'
    ];

    const setClauses = [];
    const params = [];

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        setClauses.push(`${key} = ?`);
        if (key === 'position_enabled') {
          params.push(value ? 1 : 0);
        } else if (key === 'position_order') {
          params.push(value ?? 0);
        } else {
          params.push(value === '' ? null : value);
        }
      }
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ data: null, error: { message: 'No valid fields to update' } });
    }

    params.push(positionId);

    await pool.execute(`UPDATE scenario_positions SET ${setClauses.join(', ')} WHERE position_id = ?`, params);

    // Return updated position
    const [rows] = await pool.execute(
      `SELECT position_id, scenario_id, position_name, position, position_order,
              arguments_for, arguments_against, position_enabled,
              created_at, updated_at
       FROM scenario_positions WHERE position_id = ?`,
      [positionId]
    );

    res.json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error updating position:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// DELETE /api/cases/:caseId/scenarios/:scenarioId/positions/:positionId - Delete position (admin only)
router.delete('/:positionId', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { scenarioId, positionId } = req.params;

    // Check if position exists
    const [existing] = await pool.execute(
      'SELECT position_id, position_name FROM scenario_positions WHERE scenario_id = ? AND position_id = ?',
      [scenarioId, positionId]
    );
    if (existing.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Position not found' } });
    }

    // Check if there are chats using this position
    const [chats] = await pool.execute(
      'SELECT COUNT(*) as count FROM case_chats WHERE initial_position_id = ? OR final_position_id = ?',
      [positionId, positionId]
    );
    if (chats[0].count > 0) {
      return res.status(409).json({
        data: null,
        error: { message: `Cannot delete position: it has ${chats[0].count} chat(s) associated with it.` }
      });
    }

    // Check if position is assigned to any section_case_positions
    const [assignments] = await pool.execute(
      'SELECT id FROM section_case_positions WHERE position_id = ?',
      [positionId]
    );
    if (assignments.length > 0) {
      // Just delete the assignments - they're per-section overrides
      await pool.execute('DELETE FROM section_case_positions WHERE position_id = ?', [positionId]);
    }

    await pool.execute('DELETE FROM scenario_positions WHERE position_id = ?', [positionId]);

    res.json({ data: { deleted: true, position_name: existing[0].position_name }, error: null });
  } catch (error) {
    console.error('Error deleting position:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PATCH /api/cases/:caseId/scenarios/:scenarioId/positions/reorder - Reorder positions (admin only)
router.patch('/reorder', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { scenarioId } = req.params;
    const { order } = req.body; // Array of position IDs in desired order

    if (!Array.isArray(order) || order.length === 0) {
      return res.status(400).json({
        data: null,
        error: { message: 'order must be a non-empty array of position IDs' }
      });
    }

    // Verify all positions belong to this scenario
    const [positions] = await pool.execute(
      'SELECT position_id FROM scenario_positions WHERE scenario_id = ?',
      [scenarioId]
    );
    const positionIds = new Set(positions.map(p => p.position_id));

    for (const id of order) {
      if (!positionIds.has(id)) {
        return res.status(400).json({
          data: null,
          error: { message: `Position ID ${id} does not belong to this scenario` }
        });
      }
    }

    // Update position_order for each position
    for (let i = 0; i < order.length; i++) {
      await pool.execute(
        'UPDATE scenario_positions SET position_order = ? WHERE position_id = ?',
        [i, order[i]]
      );
    }

    // Return updated positions
    const [rows] = await pool.execute(
      `SELECT position_id, scenario_id, position_name, position, position_order,
              arguments_for, arguments_against, position_enabled,
              created_at, updated_at
       FROM scenario_positions
       WHERE scenario_id = ?
       ORDER BY position_order ASC`,
      [scenarioId]
    );

    res.json({ data: rows, error: null });
  } catch (error) {
    console.error('Error reordering positions:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PATCH /api/cases/:caseId/scenarios/:scenarioId/positions/:positionId/toggle - Toggle enabled status (admin only)
router.patch('/:positionId/toggle', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { scenarioId, positionId } = req.params;

    // Check if position exists and get current status
    const [existing] = await pool.execute(
      'SELECT position_id, position_enabled FROM scenario_positions WHERE scenario_id = ? AND position_id = ?',
      [scenarioId, positionId]
    );
    if (existing.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Position not found' } });
    }

    const newEnabled = !existing[0].position_enabled;

    await pool.execute(
      'UPDATE scenario_positions SET position_enabled = ? WHERE position_id = ?',
      [newEnabled ? 1 : 0, positionId]
    );

    // Return updated position
    const [rows] = await pool.execute(
      `SELECT position_id, scenario_id, position_name, position, position_order,
              arguments_for, arguments_against, position_enabled,
              created_at, updated_at
       FROM scenario_positions WHERE position_id = ?`,
      [positionId]
    );

    res.json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error toggling position:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// POST /api/cases/:caseId/scenarios/:scenarioId/positions/copy - Copy positions from another scenario (admin only)
router.post('/copy', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { caseId, scenarioId } = req.params;
    const { source_scenario_id, include_arguments } = req.body;

    if (!source_scenario_id) {
      return res.status(400).json({
        data: null,
        error: { message: 'source_scenario_id is required' }
      });
    }

    // Check if target scenario exists and belongs to the case
    const [targetScenario] = await pool.execute(
      'SELECT id FROM case_scenarios WHERE id = ? AND case_id = ?',
      [scenarioId, caseId]
    );
    if (targetScenario.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Target scenario not found' } });
    }

    // Check if source scenario exists
    const [sourceScenario] = await pool.execute(
      'SELECT id FROM case_scenarios WHERE id = ?',
      [source_scenario_id]
    );
    if (sourceScenario.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Source scenario not found' } });
    }

    // Get positions from source scenario
    const [sourcePositions] = await pool.execute(
      `SELECT position_name, position, position_order, arguments_for, arguments_against, position_enabled
       FROM scenario_positions WHERE scenario_id = ? ORDER BY position_order ASC`,
      [source_scenario_id]
    );

    if (sourcePositions.length === 0) {
      return res.status(400).json({
        data: null,
        error: { message: 'Source scenario has no positions to copy' }
      });
    }

    // Get existing position names in target scenario to avoid duplicates
    const [existingPositions] = await pool.execute(
      'SELECT position_name FROM scenario_positions WHERE scenario_id = ?',
      [scenarioId]
    );
    const existingNames = new Set(existingPositions.map(p => p.position_name));

    // Copy positions
    let copiedCount = 0;
    let skippedCount = 0;
    for (const pos of sourcePositions) {
      if (existingNames.has(pos.position_name)) {
        skippedCount++;
        continue;
      }

      await pool.execute(
        `INSERT INTO scenario_positions
         (scenario_id, position_name, position, position_order, arguments_for, arguments_against, position_enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          scenarioId,
          pos.position_name,
          pos.position,
          pos.position_order,
          include_arguments ? pos.arguments_for : null,
          include_arguments ? pos.arguments_against : null,
          pos.position_enabled
        ]
      );
      copiedCount++;
    }

    // Return all positions for the target scenario
    const [rows] = await pool.execute(
      `SELECT position_id, scenario_id, position_name, position, position_order,
              arguments_for, arguments_against, position_enabled,
              created_at, updated_at
       FROM scenario_positions
       WHERE scenario_id = ?
       ORDER BY position_order ASC`,
      [scenarioId]
    );

    res.json({
      data: rows,
      error: null,
      message: `Copied ${copiedCount} position(s)${skippedCount > 0 ? `, skipped ${skippedCount} duplicate(s)` : ''}`
    });
  } catch (error) {
    console.error('Error copying positions:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

export default router;
