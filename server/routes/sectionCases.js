import express from 'express';
import { pool } from '../db.js';
import { verifyToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

// GET /api/sections/:sectionId/cases - List cases assigned to a section
router.get('/:sectionId/cases', async (req, res) => {
  try {
    const { sectionId } = req.params;

    const [rows] = await pool.execute(
      `SELECT sc.id, sc.section_id, sc.case_id, sc.active, sc.chat_options, sc.created_at,
              sc.open_date, sc.close_date, sc.manual_status,
              sc.selection_mode, sc.require_order, sc.use_scenarios,
              c.case_title, c.protagonist, c.protagonist_initials, c.chat_topic, c.chat_question, c.enabled as case_enabled
       FROM section_cases sc
       JOIN cases c ON sc.case_id = c.case_id
       WHERE sc.section_id = ?
       ORDER BY sc.active DESC, sc.created_at DESC`,
      [sectionId]
    );

    // For cases that use scenarios, fetch the assigned scenarios (enabled only)
    const withScenarios = await Promise.all(
      rows.map(async (row) => {
        const parsedChatOptions = typeof row.chat_options === 'string'
          ? (() => {
              try { return JSON.parse(row.chat_options); } catch { return row.chat_options; }
            })()
          : row.chat_options;

        if (!row.use_scenarios) {
          return { ...row, chat_options: parsedChatOptions };
        }

        const [scenarios] = await pool.execute(
          `SELECT scs.id as assignment_id, scs.scenario_id, scs.enabled, scs.sort_order,
                  cs.scenario_name, cs.protagonist, cs.protagonist_initials, cs.protagonist_role,
                  cs.chat_topic, cs.chat_question, cs.chat_time_limit, cs.chat_time_warning,
                  cs.chat_options_override
           FROM section_case_scenarios scs
           JOIN case_scenarios cs ON scs.scenario_id = cs.id
           WHERE scs.section_case_id = ? AND scs.enabled = TRUE AND cs.enabled = TRUE
           ORDER BY scs.sort_order ASC`,
          [row.id]
        );

        return {
          ...row,
          chat_options: parsedChatOptions,
          scenarios
        };
      })
    );

    res.json({ data: withScenarios, error: null });
  } catch (error) {
    console.error('Error fetching section cases:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// Helper function to check if a case is currently available based on scheduling
function isCaseAvailable(openDate, closeDate, manualStatus) {
  const now = new Date();

  // Manual override takes precedence
  if (manualStatus === 'manually_opened') {
    return { available: true, reason: null };
  }
  if (manualStatus === 'manually_closed') {
    return { available: false, reason: 'This case has been manually closed by the instructor.' };
  }

  // Auto mode: check dates
  if (openDate && new Date(openDate) > now) {
    return {
      available: false,
      reason: `This case will open on ${new Date(openDate).toLocaleString()}.`
    };
  }
  if (closeDate && new Date(closeDate) < now) {
    return {
      available: false,
      reason: `This case closed on ${new Date(closeDate).toLocaleString()}.`
    };
  }

  return { available: true, reason: null };
}

// GET /api/sections/:sectionId/active-case - Get the currently active case for a section (used by students)
router.get('/:sectionId/active-case', async (req, res) => {
  try {
    const { sectionId } = req.params;
    const { student_id } = req.query; // Optional: to check scenario completion

    const [rows] = await pool.execute(
      `SELECT sc.id, sc.section_id, sc.case_id, sc.chat_options,
              sc.open_date, sc.close_date, sc.manual_status,
              sc.selection_mode, sc.require_order, sc.use_scenarios,
              c.case_title, c.protagonist, c.protagonist_initials, c.chat_topic, c.chat_question
       FROM section_cases sc
       JOIN cases c ON sc.case_id = c.case_id
       WHERE sc.section_id = ? AND sc.active = TRUE AND c.enabled = TRUE
       LIMIT 1`,
      [sectionId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'No active case found for this section' } });
    }

    // Check if case is currently available based on scheduling
    const caseData = rows[0];
    const availability = isCaseAvailable(caseData.open_date, caseData.close_date, caseData.manual_status);

    // If use_scenarios is enabled, fetch available scenarios
    let scenarios = [];
    if (caseData.use_scenarios) {
      const [scenarioRows] = await pool.execute(
        `SELECT scs.id as assignment_id, scs.scenario_id, scs.enabled, scs.sort_order,
                cs.scenario_name, cs.protagonist, cs.protagonist_initials, cs.protagonist_role,
                cs.chat_topic, cs.chat_question, cs.chat_time_limit, cs.chat_time_warning,
                cs.chat_options_override
         FROM section_case_scenarios scs
         JOIN case_scenarios cs ON scs.scenario_id = cs.id
         WHERE scs.section_case_id = ? AND scs.enabled = TRUE AND cs.enabled = TRUE
         ORDER BY scs.sort_order ASC`,
        [caseData.id]
      );
      scenarios = scenarioRows;

      // If student_id provided, check completion status for each scenario
      if (student_id && scenarios.length > 0) {
        const [completedChats] = await pool.execute(
          `SELECT scenario_id, COUNT(*) as completed_count
           FROM case_chats
           WHERE student_id = ? AND case_id = ? AND status = 'completed' AND scenario_id IS NOT NULL
           GROUP BY scenario_id`,
          [student_id, caseData.case_id]
        );

        const completedMap = new Map(completedChats.map(c => [c.scenario_id, c.completed_count]));

        scenarios = scenarios.map(s => ({
          ...s,
          completed: completedMap.has(s.scenario_id),
          completed_count: completedMap.get(s.scenario_id) || 0
        }));
      }
    }

    res.json({
      data: {
        ...caseData,
        is_available: availability.available,
        availability_message: availability.reason,
        scenarios: scenarios
      },
      error: null
    });
  } catch (error) {
    console.error('Error fetching active case:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// POST /api/sections/:sectionId/cases - Assign a case to a section (admin only)
router.post('/:sectionId/cases', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { sectionId } = req.params;
    const { case_id, active, chat_options, open_date, close_date, manual_status } = req.body;

    if (!case_id) {
      return res.status(400).json({ data: null, error: { message: 'case_id is required' } });
    }

    // Check if section exists
    const [sections] = await pool.execute('SELECT section_id FROM sections WHERE section_id = ?', [sectionId]);
    if (sections.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Section not found' } });
    }

    // Check if case exists
    const [cases] = await pool.execute('SELECT case_id FROM cases WHERE case_id = ?', [case_id]);
    if (cases.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Case not found' } });
    }

    // Check if assignment already exists
    const [existing] = await pool.execute(
      'SELECT id FROM section_cases WHERE section_id = ? AND case_id = ?',
      [sectionId, case_id]
    );
    if (existing.length > 0) {
      return res.status(409).json({ data: null, error: { message: 'Case is already assigned to this section' } });
    }

    // If setting this case as active, deactivate all others first
    if (active) {
      await pool.execute(
        'UPDATE section_cases SET active = FALSE WHERE section_id = ?',
        [sectionId]
      );
    }

    // Insert the assignment with scheduling fields
    const chatOptionsJson = chat_options ? JSON.stringify(chat_options) : null;
    await pool.execute(
      `INSERT INTO section_cases (section_id, case_id, active, chat_options, open_date, close_date, manual_status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        sectionId,
        case_id,
        active ? 1 : 0,
        chatOptionsJson,
        open_date || null,
        close_date || null,
        manual_status || 'auto'
      ]
    );

    // Return the created assignment with case details
    const [rows] = await pool.execute(
      `SELECT sc.id, sc.section_id, sc.case_id, sc.active, sc.chat_options, sc.created_at,
              sc.open_date, sc.close_date, sc.manual_status,
              c.case_title, c.protagonist, c.protagonist_initials
       FROM section_cases sc
       JOIN cases c ON sc.case_id = c.case_id
       WHERE sc.section_id = ? AND sc.case_id = ?`,
      [sectionId, case_id]
    );

    res.status(201).json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error assigning case to section:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// DELETE /api/sections/:sectionId/cases/:caseId - Remove case from section (admin only)
router.delete('/:sectionId/cases/:caseId', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { sectionId, caseId } = req.params;
    
    const [existing] = await pool.execute(
      'SELECT id FROM section_cases WHERE section_id = ? AND case_id = ?',
      [sectionId, caseId]
    );
    
    if (existing.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Case assignment not found' } });
    }
    
    await pool.execute(
      'DELETE FROM section_cases WHERE section_id = ? AND case_id = ?',
      [sectionId, caseId]
    );
    
    res.json({ data: { deleted: true }, error: null });
  } catch (error) {
    console.error('Error removing case from section:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PATCH /api/sections/:sectionId/cases/:caseId/activate - Set this case as active (admin only)
router.patch('/:sectionId/cases/:caseId/activate', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { sectionId, caseId } = req.params;
    
    // Check if assignment exists
    const [existing] = await pool.execute(
      'SELECT id FROM section_cases WHERE section_id = ? AND case_id = ?',
      [sectionId, caseId]
    );
    
    if (existing.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Case assignment not found' } });
    }
    
    // Deactivate all cases for this section
    await pool.execute(
      'UPDATE section_cases SET active = FALSE WHERE section_id = ?',
      [sectionId]
    );
    
    // Activate the specified case
    await pool.execute(
      'UPDATE section_cases SET active = TRUE WHERE section_id = ? AND case_id = ?',
      [sectionId, caseId]
    );
    
    // Return updated assignment
    const [rows] = await pool.execute(
      `SELECT sc.id, sc.section_id, sc.case_id, sc.active, sc.chat_options, sc.created_at,
              sc.open_date, sc.close_date, sc.manual_status,
              c.case_title, c.protagonist, c.protagonist_initials
       FROM section_cases sc
       JOIN cases c ON sc.case_id = c.case_id
       WHERE sc.section_id = ? AND sc.case_id = ?`,
      [sectionId, caseId]
    );

    res.json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error activating case:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PATCH /api/sections/:sectionId/cases/:caseId/deactivate - Deactivate a case (admin only)
router.patch('/:sectionId/cases/:caseId/deactivate', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { sectionId, caseId } = req.params;
    
    await pool.execute(
      'UPDATE section_cases SET active = FALSE WHERE section_id = ? AND case_id = ?',
      [sectionId, caseId]
    );
    
    const [rows] = await pool.execute(
      `SELECT sc.id, sc.section_id, sc.case_id, sc.active, sc.chat_options, sc.created_at,
              sc.open_date, sc.close_date, sc.manual_status,
              c.case_title, c.protagonist, c.protagonist_initials
       FROM section_cases sc
       JOIN cases c ON sc.case_id = c.case_id
       WHERE sc.section_id = ? AND sc.case_id = ?`,
      [sectionId, caseId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Case assignment not found' } });
    }

    res.json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error deactivating case:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PATCH /api/sections/:sectionId/cases/:caseId/options - Update chat_options (admin only) - Phase 2
router.patch('/:sectionId/cases/:caseId/options', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { sectionId, caseId } = req.params;
    const { chat_options } = req.body;

    // Validate chat_options structure (basic validation)
    if (chat_options !== null && typeof chat_options !== 'object') {
      return res.status(400).json({ data: null, error: { message: 'chat_options must be an object or null' } });
    }

    const chatOptionsJson = chat_options ? JSON.stringify(chat_options) : null;

    await pool.execute(
      'UPDATE section_cases SET chat_options = ? WHERE section_id = ? AND case_id = ?',
      [chatOptionsJson, sectionId, caseId]
    );

    const [rows] = await pool.execute(
      `SELECT sc.id, sc.section_id, sc.case_id, sc.active, sc.chat_options, sc.created_at,
              sc.open_date, sc.close_date, sc.manual_status,
              c.case_title, c.protagonist, c.protagonist_initials
       FROM section_cases sc
       JOIN cases c ON sc.case_id = c.case_id
       WHERE sc.section_id = ? AND sc.case_id = ?`,
      [sectionId, caseId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Case assignment not found' } });
    }

    res.json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error updating chat options:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PATCH /api/sections/:sectionId/cases/:caseId/scheduling - Update scheduling (admin only)
router.patch('/:sectionId/cases/:caseId/scheduling', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { sectionId, caseId } = req.params;
    const { open_date, close_date, manual_status } = req.body;

    // Validate manual_status if provided
    if (manual_status && !['auto', 'manually_opened', 'manually_closed'].includes(manual_status)) {
      return res.status(400).json({
        data: null,
        error: { message: 'manual_status must be "auto", "manually_opened", or "manually_closed"' }
      });
    }

    // Check if assignment exists
    const [existing] = await pool.execute(
      'SELECT id FROM section_cases WHERE section_id = ? AND case_id = ?',
      [sectionId, caseId]
    );

    if (existing.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Case assignment not found' } });
    }

    // Build update query dynamically
    const updates = [];
    const params = [];

    if (open_date !== undefined) {
      updates.push('open_date = ?');
      params.push(open_date || null);
    }
    if (close_date !== undefined) {
      updates.push('close_date = ?');
      params.push(close_date || null);
    }
    if (manual_status !== undefined) {
      updates.push('manual_status = ?');
      params.push(manual_status);
    }

    if (updates.length === 0) {
      return res.status(400).json({ data: null, error: { message: 'No scheduling fields to update' } });
    }

    params.push(sectionId, caseId);

    await pool.execute(
      `UPDATE section_cases SET ${updates.join(', ')} WHERE section_id = ? AND case_id = ?`,
      params
    );

    // Return updated assignment
    const [rows] = await pool.execute(
      `SELECT sc.id, sc.section_id, sc.case_id, sc.active, sc.chat_options, sc.created_at,
              sc.open_date, sc.close_date, sc.manual_status,
              c.case_title, c.protagonist, c.protagonist_initials
       FROM section_cases sc
       JOIN cases c ON sc.case_id = c.case_id
       WHERE sc.section_id = ? AND sc.case_id = ?`,
      [sectionId, caseId]
    );

    res.json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error updating scheduling:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// =====================================================
// SCENARIO ASSIGNMENT ENDPOINTS
// =====================================================

// GET /api/sections/:sectionId/cases/:caseId/scenarios - List scenarios assigned to this section-case
router.get('/:sectionId/cases/:caseId/scenarios', async (req, res) => {
  try {
    const { sectionId, caseId } = req.params;

    // Get the section_case id
    const [sectionCase] = await pool.execute(
      'SELECT id, selection_mode, require_order, use_scenarios FROM section_cases WHERE section_id = ? AND case_id = ?',
      [sectionId, caseId]
    );

    if (sectionCase.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Case assignment not found' } });
    }

    const sectionCaseId = sectionCase[0].id;

    // Get assigned scenarios with full scenario details
    const [rows] = await pool.execute(
      `SELECT scs.id, scs.section_case_id, scs.scenario_id, scs.enabled, scs.sort_order, scs.created_at,
              cs.scenario_name, cs.protagonist, cs.protagonist_initials, cs.protagonist_role,
              cs.chat_topic, cs.chat_question, cs.chat_time_limit, cs.chat_time_warning,
              cs.arguments_for, cs.arguments_against, cs.chat_options_override,
              cs.enabled as scenario_enabled
       FROM section_case_scenarios scs
       JOIN case_scenarios cs ON scs.scenario_id = cs.id
       WHERE scs.section_case_id = ?
       ORDER BY scs.sort_order ASC, scs.id ASC`,
      [sectionCaseId]
    );

    res.json({
      data: {
        section_case_id: sectionCaseId,
        selection_mode: sectionCase[0].selection_mode,
        require_order: sectionCase[0].require_order,
        use_scenarios: sectionCase[0].use_scenarios,
        scenarios: rows
      },
      error: null
    });
  } catch (error) {
    console.error('Error fetching section case scenarios:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// POST /api/sections/:sectionId/cases/:caseId/scenarios - Assign scenarios to section-case (admin only)
router.post('/:sectionId/cases/:caseId/scenarios', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { sectionId, caseId } = req.params;
    const { scenario_ids } = req.body; // Array of scenario IDs to assign

    if (!Array.isArray(scenario_ids) || scenario_ids.length === 0) {
      return res.status(400).json({
        data: null,
        error: { message: 'scenario_ids must be a non-empty array' }
      });
    }

    // Get the section_case id
    const [sectionCase] = await pool.execute(
      'SELECT id FROM section_cases WHERE section_id = ? AND case_id = ?',
      [sectionId, caseId]
    );

    if (sectionCase.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Case assignment not found' } });
    }

    const sectionCaseId = sectionCase[0].id;

    // Verify all scenarios belong to this case
    const placeholders = scenario_ids.map(() => '?').join(',');
    const [scenarios] = await pool.execute(
      `SELECT id FROM case_scenarios WHERE case_id = ? AND id IN (${placeholders})`,
      [caseId, ...scenario_ids]
    );

    if (scenarios.length !== scenario_ids.length) {
      return res.status(400).json({
        data: null,
        error: { message: 'Some scenario IDs do not belong to this case' }
      });
    }

    // Get current max sort_order
    const [maxOrder] = await pool.execute(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 as next_order FROM section_case_scenarios WHERE section_case_id = ?',
      [sectionCaseId]
    );
    let sortOrder = maxOrder[0].next_order;

    // Insert new assignments (skip if already exists)
    const inserted = [];
    for (const scenarioId of scenario_ids) {
      try {
        await pool.execute(
          'INSERT INTO section_case_scenarios (section_case_id, scenario_id, enabled, sort_order) VALUES (?, ?, TRUE, ?)',
          [sectionCaseId, scenarioId, sortOrder++]
        );
        inserted.push(scenarioId);
      } catch (err) {
        // Skip duplicate entries
        if (err.code !== 'ER_DUP_ENTRY') throw err;
      }
    }

    // Enable use_scenarios for this section_case
    await pool.execute(
      'UPDATE section_cases SET use_scenarios = TRUE WHERE id = ?',
      [sectionCaseId]
    );

    // Return updated scenarios list
    const [rows] = await pool.execute(
      `SELECT scs.id, scs.section_case_id, scs.scenario_id, scs.enabled, scs.sort_order,
              cs.scenario_name, cs.protagonist, cs.protagonist_initials
       FROM section_case_scenarios scs
       JOIN case_scenarios cs ON scs.scenario_id = cs.id
       WHERE scs.section_case_id = ?
       ORDER BY scs.sort_order ASC`,
      [sectionCaseId]
    );

    res.status(201).json({ data: { inserted: inserted.length, scenarios: rows }, error: null });
  } catch (error) {
    console.error('Error assigning scenarios:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// DELETE /api/sections/:sectionId/cases/:caseId/scenarios/:scenarioId - Remove scenario from section-case (admin only)
router.delete('/:sectionId/cases/:caseId/scenarios/:scenarioId', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { sectionId, caseId, scenarioId } = req.params;

    // Get the section_case id
    const [sectionCase] = await pool.execute(
      'SELECT id FROM section_cases WHERE section_id = ? AND case_id = ?',
      [sectionId, caseId]
    );

    if (sectionCase.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Case assignment not found' } });
    }

    const sectionCaseId = sectionCase[0].id;

    const [result] = await pool.execute(
      'DELETE FROM section_case_scenarios WHERE section_case_id = ? AND scenario_id = ?',
      [sectionCaseId, scenarioId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ data: null, error: { message: 'Scenario assignment not found' } });
    }

    // Check if there are any remaining scenarios; if not, disable use_scenarios
    const [remaining] = await pool.execute(
      'SELECT COUNT(*) as count FROM section_case_scenarios WHERE section_case_id = ?',
      [sectionCaseId]
    );

    if (remaining[0].count === 0) {
      await pool.execute(
        'UPDATE section_cases SET use_scenarios = FALSE WHERE id = ?',
        [sectionCaseId]
      );
    }

    res.json({ data: { deleted: true }, error: null });
  } catch (error) {
    console.error('Error removing scenario:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PATCH /api/sections/:sectionId/cases/:caseId/scenarios/:scenarioId/toggle - Toggle scenario enabled (admin only)
router.patch('/:sectionId/cases/:caseId/scenarios/:scenarioId/toggle', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { sectionId, caseId, scenarioId } = req.params;

    // Get the section_case id
    const [sectionCase] = await pool.execute(
      'SELECT id FROM section_cases WHERE section_id = ? AND case_id = ?',
      [sectionId, caseId]
    );

    if (sectionCase.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Case assignment not found' } });
    }

    const sectionCaseId = sectionCase[0].id;

    // Get current enabled state
    const [current] = await pool.execute(
      'SELECT id, enabled FROM section_case_scenarios WHERE section_case_id = ? AND scenario_id = ?',
      [sectionCaseId, scenarioId]
    );

    if (current.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Scenario assignment not found' } });
    }

    const newEnabled = !current[0].enabled;

    await pool.execute(
      'UPDATE section_case_scenarios SET enabled = ? WHERE id = ?',
      [newEnabled ? 1 : 0, current[0].id]
    );

    res.json({ data: { id: current[0].id, enabled: newEnabled }, error: null });
  } catch (error) {
    console.error('Error toggling scenario:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PATCH /api/sections/:sectionId/cases/:caseId/selection-mode - Update selection mode settings (admin only)
router.patch('/:sectionId/cases/:caseId/selection-mode', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { sectionId, caseId } = req.params;
    const { selection_mode, require_order } = req.body;

    // Validate selection_mode
    if (selection_mode && !['student_choice', 'all_required'].includes(selection_mode)) {
      return res.status(400).json({
        data: null,
        error: { message: 'selection_mode must be "student_choice" or "all_required"' }
      });
    }

    // Check if assignment exists
    const [existing] = await pool.execute(
      'SELECT id FROM section_cases WHERE section_id = ? AND case_id = ?',
      [sectionId, caseId]
    );

    if (existing.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Case assignment not found' } });
    }

    // Build update query
    const updates = [];
    const params = [];

    if (selection_mode !== undefined) {
      updates.push('selection_mode = ?');
      params.push(selection_mode);
    }
    if (require_order !== undefined) {
      updates.push('require_order = ?');
      params.push(require_order ? 1 : 0);
    }

    if (updates.length === 0) {
      return res.status(400).json({ data: null, error: { message: 'No fields to update' } });
    }

    params.push(sectionId, caseId);

    await pool.execute(
      `UPDATE section_cases SET ${updates.join(', ')} WHERE section_id = ? AND case_id = ?`,
      params
    );

    // Return updated data
    const [rows] = await pool.execute(
      `SELECT sc.id, sc.section_id, sc.case_id, sc.selection_mode, sc.require_order, sc.use_scenarios
       FROM section_cases sc
       WHERE sc.section_id = ? AND sc.case_id = ?`,
      [sectionId, caseId]
    );

    res.json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error updating selection mode:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PATCH /api/sections/:sectionId/cases/:caseId/scenarios/reorder - Reorder scenarios (admin only)
router.patch('/:sectionId/cases/:caseId/scenarios/reorder', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { sectionId, caseId } = req.params;
    const { order } = req.body; // Array of scenario IDs in desired order

    if (!Array.isArray(order) || order.length === 0) {
      return res.status(400).json({
        data: null,
        error: { message: 'order must be a non-empty array of scenario IDs' }
      });
    }

    // Get the section_case id
    const [sectionCase] = await pool.execute(
      'SELECT id FROM section_cases WHERE section_id = ? AND case_id = ?',
      [sectionId, caseId]
    );

    if (sectionCase.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Case assignment not found' } });
    }

    const sectionCaseId = sectionCase[0].id;

    // Update sort_order for each scenario
    for (let i = 0; i < order.length; i++) {
      await pool.execute(
        'UPDATE section_case_scenarios SET sort_order = ? WHERE section_case_id = ? AND scenario_id = ?',
        [i, sectionCaseId, order[i]]
      );
    }

    // Return updated scenarios
    const [rows] = await pool.execute(
      `SELECT scs.id, scs.scenario_id, scs.enabled, scs.sort_order,
              cs.scenario_name, cs.protagonist
       FROM section_case_scenarios scs
       JOIN case_scenarios cs ON scs.scenario_id = cs.id
       WHERE scs.section_case_id = ?
       ORDER BY scs.sort_order ASC`,
      [sectionCaseId]
    );

    res.json({ data: rows, error: null });
  } catch (error) {
    console.error('Error reordering scenarios:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// POST /api/sections/:targetSectionId/cases/copy-from/:sourceSectionId
// Copy case assignments from one section to another
router.post('/:targetSectionId/cases/copy-from/:sourceSectionId', verifyToken, requireRole(['admin']), async (req, res) => {
  const { targetSectionId, sourceSectionId } = req.params;
  const { copy_options = true, copy_scenarios = true, copy_scheduling = true } = req.body;

  if (targetSectionId === sourceSectionId) {
    return res.status(400).json({
      data: null,
      error: { message: 'Cannot copy cases to the same section' }
    });
  }

  try {
    // Verify both sections exist
    const [sections] = await pool.execute(
      'SELECT section_id FROM sections WHERE section_id IN (?, ?)',
      [targetSectionId, sourceSectionId]
    );

    if (sections.length < 2) {
      return res.status(404).json({
        data: null,
        error: { message: 'One or both sections not found' }
      });
    }

    // Get all cases from source section with their settings
    const [sourceCases] = await pool.execute(
      `SELECT sc.case_id, sc.chat_options, sc.open_date, sc.close_date, sc.manual_status,
              sc.selection_mode, sc.require_order, sc.use_scenarios, sc.id as source_section_case_id,
              c.case_title
       FROM section_cases sc
       JOIN cases c ON sc.case_id = c.case_id
       WHERE sc.section_id = ?`,
      [sourceSectionId]
    );

    if (sourceCases.length === 0) {
      return res.status(400).json({
        data: null,
        error: { message: 'No cases assigned to source section' }
      });
    }

    // Get cases already assigned to target section
    const [existingCases] = await pool.execute(
      'SELECT case_id FROM section_cases WHERE section_id = ?',
      [targetSectionId]
    );
    const existingCaseIds = new Set(existingCases.map(c => c.case_id));

    const results = {
      copied: 0,
      skipped: 0,
      details: []
    };

    for (const sourceCase of sourceCases) {
      // Skip if case already assigned to target section
      if (existingCaseIds.has(sourceCase.case_id)) {
        results.skipped++;
        results.details.push({
          case_id: sourceCase.case_id,
          case_title: sourceCase.case_title,
          status: 'skipped',
          reason: 'Already assigned to target section'
        });
        continue;
      }

      // Build insert values based on copy options
      const chatOptions = copy_options ? sourceCase.chat_options : null;
      const openDate = copy_scheduling ? sourceCase.open_date : null;
      const closeDate = copy_scheduling ? sourceCase.close_date : null;
      const manualStatus = copy_scheduling ? sourceCase.manual_status : 'auto';
      const selectionMode = copy_scenarios ? sourceCase.selection_mode : 'student_choice';
      const requireOrder = copy_scenarios ? sourceCase.require_order : false;
      const useScenarios = copy_scenarios ? sourceCase.use_scenarios : false;

      // Insert the new section-case assignment
      const [insertResult] = await pool.execute(
        `INSERT INTO section_cases (section_id, case_id, active, chat_options, open_date, close_date, manual_status, selection_mode, require_order, use_scenarios)
         VALUES (?, ?, FALSE, ?, ?, ?, ?, ?, ?, ?)`,
        [targetSectionId, sourceCase.case_id, chatOptions ? JSON.stringify(chatOptions) : null, openDate, closeDate, manualStatus, selectionMode, requireOrder, useScenarios]
      );

      const newSectionCaseId = insertResult.insertId;

      // Copy scenario assignments if requested
      let scenariosCopied = 0;
      if (copy_scenarios && useScenarios) {
        const [sourceScenarios] = await pool.execute(
          'SELECT scenario_id, enabled, sort_order FROM section_case_scenarios WHERE section_case_id = ?',
          [sourceCase.source_section_case_id]
        );

        for (const scenario of sourceScenarios) {
          try {
            await pool.execute(
              'INSERT INTO section_case_scenarios (section_case_id, scenario_id, enabled, sort_order) VALUES (?, ?, ?, ?)',
              [newSectionCaseId, scenario.scenario_id, scenario.enabled, scenario.sort_order]
            );
            scenariosCopied++;
          } catch (err) {
            // Skip duplicate or invalid scenario assignments
            console.error('Error copying scenario:', err.message);
          }
        }
      }

      results.copied++;
      results.details.push({
        case_id: sourceCase.case_id,
        case_title: sourceCase.case_title,
        status: 'copied',
        options_copied: copy_options,
        scheduling_copied: copy_scheduling,
        scenarios_copied: scenariosCopied
      });
    }

    res.json({
      data: results,
      message: `Copied ${results.copied} case(s), skipped ${results.skipped} already assigned`,
      error: null
    });
  } catch (error) {
    console.error('Error copying case assignments:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

export default router;
