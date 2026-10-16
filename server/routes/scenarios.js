import express from 'express';
import { pool } from '../db.js';
import { verifyToken } from '../middleware/auth.js';
import { requireAdminOrInstructor, requireCaseAccess, requireCaseReadAccess } from '../middleware/instructorAccess.js';
import scenarioPositionsRoutes from './scenarioPositions.js';
import { parseScenarioOverride, validateStudentSettings } from '../../utils/scenarioSettings.js';
import { writeScenarioSettings } from '../services/scenarioSettings.js';
import { draftStudentText } from '../services/scenarioDrafts.js';
import { resolveAvailablePersonas } from '../services/personaService.js';
import { buildVisibilityScope, getEffectiveInstructorId } from '../services/resourceAccess.js';
import { activityBehaviour } from '../services/activityTypes.js';
import { normalizeActivityType } from '../../utils/activityTypes.js';

const router = express.Router();

// Scenario writes follow the case: anyone who can edit the case (owner, team
// editor, admin) can manage its scenarios — the same rule as PATCH /api/cases/:id.
const canEditCase = [verifyToken, requireAdminOrInstructor, requireCaseAccess('caseId', 'edit')];
// Deleting a scenario needs the case's 'delete' right (owner or admin), as DELETE /api/cases/:id.
const canDeleteCase = [verifyToken, requireAdminOrInstructor, requireCaseAccess('caseId', 'delete')];
// Scenarios hold AI-only content (prompt instructions, arguments), so reads need an
// instructor or admin who can see or teaches the case. Students get them through
// their section's case list (GET /api/sections/:id/cases), never these routes.
const canReadCase = [verifyToken, requireCaseReadAccess('caseId')];

// Mount scenario positions routes
// Routes: /api/cases/:caseId/scenarios/:scenarioId/positions/*
router.use('/:caseId/scenarios/:scenarioId/positions', scenarioPositionsRoutes);

// GET /api/cases/:caseId/scenarios - List all scenarios for a case
router.get('/:caseId/scenarios', ...canReadCase, async (req, res) => {
  try {
    const { caseId } = req.params;
    const { enabled } = req.query;

    let query = `
      SELECT id, case_id, scenario_name, protagonist, protagonist_initials, protagonist_role,
             chat_topic, chat_question, prompt_instructions, chat_time_limit, chat_time_warning,
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
router.get('/:caseId/scenarios/:id', ...canReadCase, async (req, res) => {
  try {
    const { caseId, id } = req.params;

    const [rows] = await pool.execute(
      `SELECT id, case_id, scenario_name, protagonist, protagonist_initials, protagonist_role,
              chat_topic, chat_question, prompt_instructions, chat_time_limit, chat_time_warning,
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

// POST /api/cases/:caseId/scenarios - Create new scenario (case editors)
router.post('/:caseId/scenarios', ...canEditCase, async (req, res) => {
  try {
    const { caseId } = req.params;
    const {
      scenario_name, protagonist, protagonist_initials, protagonist_role,
      chat_topic, chat_question, prompt_instructions, chat_time_limit, chat_time_warning,
      arguments_for, arguments_against, chat_options_override,
      sort_order, enabled, student_settings
    } = req.body;

    // Student-visible text (situation, per-audience intro and opening) is a subtree of
    // chat_options_override, validated by the shared registry (utils/scenarioSettings.js).
    const studentSettings = validateStudentSettings(student_settings);
    if (studentSettings.error) {
      return res.status(400).json({ data: null, error: { message: studentSettings.error } });
    }

    // Validate required fields
    if (!scenario_name || !protagonist || !protagonist_initials || !chat_question) {
      return res.status(400).json({
        data: null,
        error: { message: 'scenario_name, protagonist, protagonist_initials, and chat_question are required' }
      });
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

    // The row and its student text are saved together, so a failed settings write cannot leave
    // a scenario behind that a second Save would duplicate.
    const conn = await pool.getConnection();
    let insertId;
    try {
      await conn.beginTransaction();
      const [result] = await conn.execute(
        `INSERT INTO case_scenarios
         (case_id, scenario_name, protagonist, protagonist_initials, protagonist_role,
          chat_topic, chat_question, prompt_instructions, chat_time_limit, chat_time_warning,
          arguments_for, arguments_against, chat_options_override, sort_order, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          caseId,
          scenario_name,
          protagonist,
          protagonist_initials,
          protagonist_role || null,
          chat_topic || null,
          chat_question,
          prompt_instructions || null,
          chat_time_limit || 0,
          chat_time_warning || 5,
          arguments_for || null,
          arguments_against || null,
          // `student` arrives only as student_settings (validated), never inside this.
          (() => {
            const { student, ...rest } = chat_options_override && typeof chat_options_override === 'object' ? chat_options_override : {};
            return Object.keys(rest).length > 0 ? JSON.stringify(rest) : null;
          })(),
          finalSortOrder,
          enabled !== false ? 1 : 0
        ]
      );
      insertId = result.insertId;
      if (student_settings !== undefined) {
        await writeScenarioSettings(insertId, 'student', studentSettings.value, conn);
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    // Return created scenario
    const [rows] = await pool.execute(
      `SELECT id, case_id, scenario_name, protagonist, protagonist_initials, protagonist_role,
              chat_topic, chat_question, prompt_instructions, chat_time_limit, chat_time_warning,
              arguments_for, arguments_against, chat_options_override,
              sort_order, enabled, created_at, updated_at
       FROM case_scenarios WHERE id = ?`,
      [insertId]
    );

    res.status(201).json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error creating scenario:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// POST /api/cases/:caseId/scenario-drafts - "Draft with AI" in the scenario editor (case
// editors; activity types whose greeting uses saved openings, i.e. teach-back). Drafts an intro
// line and an opening for each audience from the fields being edited (the scenario need not be
// saved yet). Saves nothing: the instructor edits the drafts and saves them as student_settings.
// Billed to the caller's weekly AI cap. Only audiences the caller can see (GET /api/personas) are
// drafted: persona instructions go into the prompt, so a private one must not be reachable here.
// Body: { scenario_name, chat_question, situation?, persona_ids? } (default: every visible audience)
router.post('/:caseId/scenario-drafts', ...canEditCase, async (req, res) => {
  try {
    const { caseId } = req.params;
    const { scenario_name, chat_question, situation, persona_ids } = req.body || {};
    const topic = typeof chat_question === 'string' ? chat_question.trim() : '';
    if (!topic) {
      return res.status(400).json({ data: null, error: { message: 'Enter the Chat Question (the topic) first.' } });
    }
    const checked = validateStudentSettings({ situation: typeof situation === 'string' ? situation : '' });
    if (checked.error) return res.status(400).json({ data: null, error: { message: checked.error } });

    const [cases] = await pool.execute('SELECT case_title, activity_type FROM cases WHERE case_id = ?', [caseId]);
    if (cases.length === 0) return res.status(404).json({ data: null, error: { message: 'Case not found' } });
    const activityType = normalizeActivityType(cases[0].activity_type);
    if (!activityBehaviour(activityType).savedOpenings) {
      return res.status(409).json({ data: null, error: { message: 'This activity type has no saved openings to draft.' } });
    }

    const scope = buildVisibilityScope(req, 'persona', 'p');
    const [visibleRows] = await pool.execute(`SELECT p.persona_id FROM personas p WHERE ${scope.whereSql}`, scope.params);
    const visible = new Set(visibleRows.map((r) => r.persona_id));
    let audiences = (await resolveAvailablePersonas(null, activityType)).filter((a) => visible.has(a.persona_id));
    if (Array.isArray(persona_ids) && persona_ids.length > 0) {
      const wanted = new Set(persona_ids);
      audiences = audiences.filter((a) => wanted.has(a.persona_id));
    }
    if (audiences.length === 0) {
      return res.status(409).json({ data: null, error: { message: 'There are no enabled audiences to draft for. Create them in Setup → Personas.' } });
    }

    const drafts = await draftStudentText({
      caseId,
      caseTitle: cases[0].case_title,
      scenarioName: typeof scenario_name === 'string' ? scenario_name.trim() : '',
      topic,
      situation: checked.value?.situation || '',
      audiences,
      instructorId: getEffectiveInstructorId(req),
    });
    res.json({ data: drafts, error: null });
  } catch (error) {
    if (error?.code === 'INSTRUCTOR_COST_CAP_EXCEEDED') {
      return res.status(429).json({ data: null, error: { code: error.code, message: 'You have reached your weekly AI usage cap, so drafts are unavailable until Monday. You can still type the openings yourself.' } });
    }
    console.error('Error drafting scenario text:', error);
    res.status(error?.status || 500).json({ data: null, error: { message: `Could not draft openings: ${error.message}` } });
  }
});

// Registered before PATCH /:caseId/scenarios/:id, which would otherwise capture
// "reorder" as an :id.
// PATCH /api/cases/:caseId/scenarios/reorder - Reorder scenarios (case editors)
router.patch('/:caseId/scenarios/reorder', ...canEditCase, async (req, res) => {
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

    // Update sort_order for each scenario, all or nothing
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (let i = 0; i < order.length; i++) {
        await conn.execute(
          'UPDATE case_scenarios SET sort_order = ? WHERE id = ?',
          [i, order[i]]
        );
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    // Return updated scenarios
    const [rows] = await pool.execute(
      `SELECT id, case_id, scenario_name, protagonist, protagonist_initials, protagonist_role,
              chat_topic, chat_question, prompt_instructions, chat_time_limit, chat_time_warning,
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

// PATCH /api/cases/:caseId/scenarios/:id - Update scenario (case editors)
router.patch('/:caseId/scenarios/:id', ...canEditCase, async (req, res) => {
  try {
    const { caseId, id } = req.params;
    const { student_settings, ...updates } = req.body;

    // Written separately, as a merge into chat_options_override (services/scenarioSettings.js),
    // so it can never replace the rest of that document.
    const hasStudentSettings = student_settings !== undefined;
    const studentSettings = validateStudentSettings(student_settings);
    if (studentSettings.error) {
      return res.status(400).json({ data: null, error: { message: studentSettings.error } });
    }

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
      'chat_topic', 'chat_question', 'prompt_instructions', 'chat_time_limit', 'chat_time_warning',
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
          // The `student` subtree is never written this way; it is kept from the stored value
          // below (or replaced by student_settings).
          const { student, ...rest } = value && typeof value === 'object' ? value : {};
          params.push(value && Object.keys(rest).length > 0 ? JSON.stringify(rest) : null);
        } else if (key === 'chat_time_limit' || key === 'chat_time_warning' || key === 'sort_order') {
          params.push(value ?? 0);
        } else {
          params.push(value === '' ? null : value);
        }
      }
    }

    if (setClauses.length === 0 && !hasStudentSettings) {
      return res.status(400).json({ data: null, error: { message: 'No valid fields to update' } });
    }

    params.push(id);

    // A whole chat_options_override sent without student_settings keeps the stored student text.
    const keepStudent = 'chat_options_override' in updates && !hasStudentSettings;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      let storedStudent = null;
      if (keepStudent) {
        const [current] = await conn.execute('SELECT chat_options_override FROM case_scenarios WHERE id = ? FOR UPDATE', [id]);
        storedStudent = validateStudentSettings(parseScenarioOverride(current[0]?.chat_options_override)?.student).value;
      }
      if (setClauses.length > 0) {
        await conn.execute(`UPDATE case_scenarios SET ${setClauses.join(', ')} WHERE id = ?`, params);
      }
      if (hasStudentSettings || storedStudent) {
        await writeScenarioSettings(id, 'student', hasStudentSettings ? studentSettings.value : storedStudent, conn);
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    // Return updated scenario
    const [rows] = await pool.execute(
      `SELECT id, case_id, scenario_name, protagonist, protagonist_initials, protagonist_role,
              chat_topic, chat_question, prompt_instructions, chat_time_limit, chat_time_warning,
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

// DELETE /api/cases/:caseId/scenarios/:id - Delete scenario (case owner or admin)
router.delete('/:caseId/scenarios/:id', ...canDeleteCase, async (req, res) => {
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

// PATCH /api/cases/:caseId/scenarios/:id/toggle - Toggle enabled status (case editors)
router.patch('/:caseId/scenarios/:id/toggle', ...canEditCase, async (req, res) => {
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
              chat_topic, chat_question, prompt_instructions, chat_time_limit, chat_time_warning,
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
