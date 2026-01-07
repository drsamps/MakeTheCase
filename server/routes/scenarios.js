import express from 'express';
import { pool } from '../db.js';
import { verifyToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

// GET /api/cases/:caseId/scenarios - List all scenarios for a case
router.get('/:caseId/scenarios', async (req, res) => {
  try {
    const { caseId } = req.params;
    const { enabled } = req.query;

    let query = `
      SELECT id, case_id, scenario_name, protagonist, protagonist_initials, protagonist_role,
             chat_topic, chat_question, chat_time_limit, chat_time_warning,
             arguments_for, arguments_against, chat_options_override,
             sort_order, enabled, created_at, updated_at
      FROM case_scenarios
      WHERE case_id = ?
    `;
    const params = [caseId];

    if (enabled !== undefined) {
      query += ' AND enabled = ?';
      params.push(enabled === 'true' ? 1 : 0);
    }

    query += ' ORDER BY sort_order ASC, id ASC';

    const [rows] = await pool.execute(query, params);
    res.json({ data: rows, error: null });
  } catch (error) {
    console.error('Error fetching scenarios:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/cases/:caseId/scenarios/:id - Get single scenario
router.get('/:caseId/scenarios/:id', async (req, res) => {
  try {
    const { caseId, id } = req.params;

    const [rows] = await pool.execute(
      `SELECT id, case_id, scenario_name, protagonist, protagonist_initials, protagonist_role,
              chat_topic, chat_question, chat_time_limit, chat_time_warning,
              arguments_for, arguments_against, chat_options_override,
              sort_order, enabled, created_at, updated_at
       FROM case_scenarios
       WHERE case_id = ? AND id = ?`,
      [caseId, id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Scenario not found' } });
    }

    res.json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error fetching scenario:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// POST /api/cases/:caseId/scenarios - Create new scenario (admin only)
router.post('/:caseId/scenarios', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { caseId } = req.params;
    const {
      scenario_name, protagonist, protagonist_initials, protagonist_role,
      chat_topic, chat_question, chat_time_limit, chat_time_warning,
      arguments_for, arguments_against, chat_options_override,
      sort_order, enabled
    } = req.body;

    // Validate required fields
    if (!scenario_name || !protagonist || !protagonist_initials || !chat_question) {
      return res.status(400).json({
        data: null,
        error: { message: 'scenario_name, protagonist, protagonist_initials, and chat_question are required' }
      });
    }

    // Check if case exists
    const [caseRows] = await pool.execute('SELECT case_id FROM cases WHERE case_id = ?', [caseId]);
    if (caseRows.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Case not found' } });
    }

    // Get max sort_order if not specified
    let finalSortOrder = sort_order;
    if (finalSortOrder === undefined || finalSortOrder === null) {
      const [maxOrder] = await pool.execute(
        'SELECT COALESCE(MAX(sort_order), -1) + 1 as next_order FROM case_scenarios WHERE case_id = ?',
        [caseId]
      );
      finalSortOrder = maxOrder[0].next_order;
    }

    const [result] = await pool.execute(
      `INSERT INTO case_scenarios
       (case_id, scenario_name, protagonist, protagonist_initials, protagonist_role,
        chat_topic, chat_question, chat_time_limit, chat_time_warning,
        arguments_for, arguments_against, chat_options_override, sort_order, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        caseId,
        scenario_name,
        protagonist,
        protagonist_initials,
        protagonist_role || null,
        chat_topic || null,
        chat_question,
        chat_time_limit || 0,
        chat_time_warning || 5,
        arguments_for || null,
        arguments_against || null,
        chat_options_override ? JSON.stringify(chat_options_override) : null,
        finalSortOrder,
        enabled !== false ? 1 : 0
      ]
    );

    // Return created scenario
    const [rows] = await pool.execute(
      `SELECT id, case_id, scenario_name, protagonist, protagonist_initials, protagonist_role,
              chat_topic, chat_question, chat_time_limit, chat_time_warning,
              arguments_for, arguments_against, chat_options_override,
              sort_order, enabled, created_at, updated_at
       FROM case_scenarios WHERE id = ?`,
      [result.insertId]
    );

    res.status(201).json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error creating scenario:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PATCH /api/cases/:caseId/scenarios/:id - Update scenario (admin only)
router.patch('/:caseId/scenarios/:id', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { caseId, id } = req.params;
    const updates = req.body;

    // Check if scenario exists
    const [existing] = await pool.execute(
      'SELECT id FROM case_scenarios WHERE case_id = ? AND id = ?',
      [caseId, id]
    );
    if (existing.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Scenario not found' } });
    }

    const allowedFields = [
      'scenario_name', 'protagonist', 'protagonist_initials', 'protagonist_role',
      'chat_topic', 'chat_question', 'chat_time_limit', 'chat_time_warning',
      'arguments_for', 'arguments_against', 'chat_options_override',
      'sort_order', 'enabled'
    ];

    const setClauses = [];
    const params = [];

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        setClauses.push(`${key} = ?`);
        if (key === 'enabled') {
          params.push(value ? 1 : 0);
        } else if (key === 'chat_options_override') {
          params.push(value ? JSON.stringify(value) : null);
        } else if (key === 'chat_time_limit' || key === 'chat_time_warning' || key === 'sort_order') {
          params.push(value ?? 0);
        } else {
          params.push(value === '' ? null : value);
        }
      }
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ data: null, error: { message: 'No valid fields to update' } });
    }

    params.push(id);

    await pool.execute(`UPDATE case_scenarios SET ${setClauses.join(', ')} WHERE id = ?`, params);

    // Return updated scenario
    const [rows] = await pool.execute(
      `SELECT id, case_id, scenario_name, protagonist, protagonist_initials, protagonist_role,
              chat_topic, chat_question, chat_time_limit, chat_time_warning,
              arguments_for, arguments_against, chat_options_override,
              sort_order, enabled, created_at, updated_at
       FROM case_scenarios WHERE id = ?`,
      [id]
    );

    res.json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error updating scenario:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// DELETE /api/cases/:caseId/scenarios/:id - Delete scenario (admin only)
router.delete('/:caseId/scenarios/:id', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { caseId, id } = req.params;

    // Check if scenario exists
    const [existing] = await pool.execute(
      'SELECT id, scenario_name FROM case_scenarios WHERE case_id = ? AND id = ?',
      [caseId, id]
    );
    if (existing.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Scenario not found' } });
    }

    // Check if scenario is assigned to any sections
    const [assignments] = await pool.execute(
      'SELECT section_case_id FROM section_case_scenarios WHERE scenario_id = ?',
      [id]
    );
    if (assignments.length > 0) {
      return res.status(409).json({
        data: null,
        error: { message: `Cannot delete scenario: it is assigned to ${assignments.length} section(s). Remove assignments first.` }
      });
    }

    // Check if there are chats using this scenario
    const [chats] = await pool.execute(
      'SELECT COUNT(*) as count FROM case_chats WHERE scenario_id = ?',
      [id]
    );
    if (chats[0].count > 0) {
      return res.status(409).json({
        data: null,
        error: { message: `Cannot delete scenario: it has ${chats[0].count} chat(s) associated with it.` }
      });
    }

    await pool.execute('DELETE FROM case_scenarios WHERE id = ?', [id]);

    res.json({ data: { deleted: true, scenario_name: existing[0].scenario_name }, error: null });
  } catch (error) {
    console.error('Error deleting scenario:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PATCH /api/cases/:caseId/scenarios/reorder - Reorder scenarios (admin only)
router.patch('/:caseId/scenarios/reorder', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { caseId } = req.params;
    const { order } = req.body; // Array of scenario IDs in desired order

    if (!Array.isArray(order) || order.length === 0) {
      return res.status(400).json({
        data: null,
        error: { message: 'order must be a non-empty array of scenario IDs' }
      });
    }

    // Verify all scenarios belong to this case
    const [scenarios] = await pool.execute(
      'SELECT id FROM case_scenarios WHERE case_id = ?',
      [caseId]
    );
    const scenarioIds = new Set(scenarios.map(s => s.id));

    for (const id of order) {
      if (!scenarioIds.has(id)) {
        return res.status(400).json({
          data: null,
          error: { message: `Scenario ID ${id} does not belong to this case` }
        });
      }
    }

    // Update sort_order for each scenario
    for (let i = 0; i < order.length; i++) {
      await pool.execute(
        'UPDATE case_scenarios SET sort_order = ? WHERE id = ?',
        [i, order[i]]
      );
    }

    // Return updated scenarios
    const [rows] = await pool.execute(
      `SELECT id, case_id, scenario_name, protagonist, protagonist_initials, protagonist_role,
              chat_topic, chat_question, chat_time_limit, chat_time_warning,
              arguments_for, arguments_against, chat_options_override,
              sort_order, enabled, created_at, updated_at
       FROM case_scenarios
       WHERE case_id = ?
       ORDER BY sort_order ASC`,
      [caseId]
    );

    res.json({ data: rows, error: null });
  } catch (error) {
    console.error('Error reordering scenarios:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PATCH /api/cases/:caseId/scenarios/:id/toggle - Toggle enabled status (admin only)
router.patch('/:caseId/scenarios/:id/toggle', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { caseId, id } = req.params;

    // Check if scenario exists and get current status
    const [existing] = await pool.execute(
      'SELECT id, enabled FROM case_scenarios WHERE case_id = ? AND id = ?',
      [caseId, id]
    );
    if (existing.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Scenario not found' } });
    }

    const newEnabled = !existing[0].enabled;

    await pool.execute(
      'UPDATE case_scenarios SET enabled = ? WHERE id = ?',
      [newEnabled ? 1 : 0, id]
    );

    // Return updated scenario
    const [rows] = await pool.execute(
      `SELECT id, case_id, scenario_name, protagonist, protagonist_initials, protagonist_role,
              chat_topic, chat_question, chat_time_limit, chat_time_warning,
              arguments_for, arguments_against, chat_options_override,
              sort_order, enabled, created_at, updated_at
       FROM case_scenarios WHERE id = ?`,
      [id]
    );

    res.json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error toggling scenario:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

export default router;
