import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db.js';
import { verifyToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

// Valid status values
const VALID_STATUSES = ['started', 'in_progress', 'abandoned', 'canceled', 'killed', 'completed'];

// POST /api/case-chats - Create a new chat session
router.post('/', async (req, res) => {
  try {
    const { student_id, case_id, section_id, scenario_id, persona, chat_model } = req.body;

    if (!student_id || !case_id) {
      return res.status(400).json({
        data: null,
        error: { message: 'student_id and case_id are required' }
      });
    }

    const id = uuidv4();

    // If scenario_id provided, get the time limit from the scenario
    let timeLimitMinutes = null;
    if (scenario_id) {
      const [scenario] = await pool.execute(
        'SELECT chat_time_limit FROM case_scenarios WHERE id = ?',
        [scenario_id]
      );
      if (scenario.length > 0 && scenario[0].chat_time_limit > 0) {
        timeLimitMinutes = scenario[0].chat_time_limit;
      }
    }

    await pool.execute(
      `INSERT INTO case_chats (id, student_id, case_id, section_id, scenario_id, persona, chat_model, status, time_limit_minutes)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'started', ?)`,
      [id, student_id, case_id, section_id || null, scenario_id || null, persona || null, chat_model || null, timeLimitMinutes]
    );

    const [rows] = await pool.execute('SELECT * FROM case_chats WHERE id = ?', [id]);

    res.status(201).json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error creating case chat:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PATCH /api/case-chats/:id/activity - Update last_activity timestamp (heartbeat)
router.patch('/:id/activity', async (req, res) => {
  try {
    const { id } = req.params;

    const [existing] = await pool.execute('SELECT id, status FROM case_chats WHERE id = ?', [id]);

    if (existing.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Chat not found' } });
    }

    // Only update if chat is in an active state
    if (!['started', 'in_progress'].includes(existing[0].status)) {
      return res.status(400).json({
        data: null,
        error: { message: `Cannot update activity for chat with status '${existing[0].status}'` }
      });
    }

    // Update last_activity and set status to in_progress if it was started
    await pool.execute(
      `UPDATE case_chats SET last_activity = CURRENT_TIMESTAMP, status = 'in_progress' WHERE id = ?`,
      [id]
    );

    const [rows] = await pool.execute('SELECT * FROM case_chats WHERE id = ?', [id]);

    res.json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error updating chat activity:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PATCH /api/case-chats/:id/status - Update chat status
router.patch('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, hints_used, transcript } = req.body;

    if (!status || !VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        data: null,
        error: { message: `status must be one of: ${VALID_STATUSES.join(', ')}` }
      });
    }

    const [existing] = await pool.execute('SELECT id FROM case_chats WHERE id = ?', [id]);

    if (existing.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Chat not found' } });
    }

    const updates = ['status = ?'];
    const params = [status];

    // Set end_time for terminal states
    if (['abandoned', 'canceled', 'killed', 'completed'].includes(status)) {
      updates.push('end_time = CURRENT_TIMESTAMP');
    }

    if (hints_used !== undefined) {
      updates.push('hints_used = ?');
      params.push(hints_used);
    }

    if (transcript !== undefined) {
      updates.push('transcript = ?');
      params.push(transcript);
    }

    params.push(id);

    await pool.execute(`UPDATE case_chats SET ${updates.join(', ')} WHERE id = ?`, params);

    const [rows] = await pool.execute('SELECT * FROM case_chats WHERE id = ?', [id]);

    res.json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error updating chat status:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PATCH /api/case-chats/:id/complete - Complete chat and link to evaluation
router.patch('/:id/complete', async (req, res) => {
  try {
    const { id } = req.params;
    const { evaluation_id, hints_used, transcript } = req.body;

    const [existing] = await pool.execute('SELECT id FROM case_chats WHERE id = ?', [id]);

    if (existing.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Chat not found' } });
    }

    const updates = ["status = 'completed'", 'end_time = CURRENT_TIMESTAMP'];
    const params = [];

    if (evaluation_id) {
      updates.push('evaluation_id = ?');
      params.push(evaluation_id);
    }

    if (hints_used !== undefined) {
      updates.push('hints_used = ?');
      params.push(hints_used);
    }

    if (transcript !== undefined) {
      updates.push('transcript = ?');
      params.push(transcript);
    }

    params.push(id);

    await pool.execute(`UPDATE case_chats SET ${updates.join(', ')} WHERE id = ?`, params);

    const [rows] = await pool.execute('SELECT * FROM case_chats WHERE id = ?', [id]);

    res.json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error completing chat:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/case-chats - List chats with filters (admin only)
router.get('/', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { status, section_id, student_id, case_id } = req.query;
    let { limit = 100, offset = 0 } = req.query;

    // Ensure limit and offset are valid numbers
    limit = Math.max(1, parseInt(limit) || 100);
    offset = Math.max(0, parseInt(offset) || 0);

    let query = `
      SELECT cc.*,
             s.full_name as student_name,
             c.case_title,
             sec.section_title
      FROM case_chats cc
      LEFT JOIN students s ON cc.student_id = s.id
      LEFT JOIN cases c ON cc.case_id = c.case_id
      LEFT JOIN sections sec ON cc.section_id = sec.section_id
      WHERE 1=1
    `;
    const params = [];

    if (status && status !== 'all') {
      query += ' AND cc.status = ?';
      params.push(status);
    }

    if (section_id && section_id !== 'all') {
      query += ' AND cc.section_id = ?';
      params.push(section_id);
    }

    if (student_id) {
      query += ' AND cc.student_id = ?';
      params.push(student_id);
    }

    if (case_id) {
      query += ' AND cc.case_id = ?';
      params.push(case_id);
    }

    query += ' ORDER BY cc.start_time DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    // Using pool.query instead of pool.execute for queries with LIMIT placeholders
    // as some MySQL versions have issues with prepared statements and LIMIT.
    const [rows] = await pool.query(query, params);

    // Get total count for pagination
    let countQuery = 'SELECT COUNT(*) as total FROM case_chats cc WHERE 1=1';
    const countParams = [];

    if (status && status !== 'all') {
      countQuery += ' AND cc.status = ?';
      countParams.push(status);
    }
    if (section_id && section_id !== 'all') {
      countQuery += ' AND cc.section_id = ?';
      countParams.push(section_id);
    }
    if (student_id) {
      countQuery += ' AND cc.student_id = ?';
      countParams.push(student_id);
    }
    if (case_id) {
      countQuery += ' AND cc.case_id = ?';
      countParams.push(case_id);
    }

    const [countResult] = await pool.query(countQuery, countParams);

    res.json({
      data: rows,
      total: countResult[0]?.total || 0,
      limit,
      offset,
      error: null
    });
  } catch (error) {
    console.error('Error fetching case chats:', error);
    res.status(500).json({ 
      data: null, 
      error: { 
        message: error.message,
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      } 
    });
  }
});

// GET /api/case-chats/student/:studentId - Get a student's chats
router.get('/student/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;
    const { case_id } = req.query;

    let query = `
      SELECT cc.*, c.case_title
      FROM case_chats cc
      LEFT JOIN cases c ON cc.case_id = c.case_id
      WHERE cc.student_id = ?
    `;
    const params = [studentId];

    if (case_id) {
      query += ' AND cc.case_id = ?';
      params.push(case_id);
    }

    query += ' ORDER BY cc.start_time DESC';

    const [rows] = await pool.execute(query, params);

    res.json({ data: rows, error: null });
  } catch (error) {
    console.error('Error fetching student chats:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/case-chats/check-repeats/:studentId/:caseId - Check if student can start another chat
router.get('/check-repeats/:studentId/:caseId', async (req, res) => {
  try {
    const { studentId, caseId } = req.params;
    const { section_id } = req.query;

    // Get the chat_repeats setting from section_cases
    let chatRepeats = 0; // Default: no repeats allowed (single chat only)

    if (section_id) {
      const [sectionCase] = await pool.execute(
        'SELECT chat_options FROM section_cases WHERE section_id = ? AND case_id = ?',
        [section_id, caseId]
      );

      if (sectionCase.length > 0 && sectionCase[0].chat_options) {
        const options = typeof sectionCase[0].chat_options === 'string'
          ? JSON.parse(sectionCase[0].chat_options)
          : sectionCase[0].chat_options;
        chatRepeats = options.chat_repeats ?? 0;
      }
    }

    // Count completed chats for this student/case
    const [completedChats] = await pool.execute(
      `SELECT COUNT(*) as count FROM case_chats
       WHERE student_id = ? AND case_id = ? AND status = 'completed'`,
      [studentId, caseId]
    );

    // Check for any active (non-terminal) chats
    const [activeChats] = await pool.execute(
      `SELECT id, status FROM case_chats
       WHERE student_id = ? AND case_id = ? AND status IN ('started', 'in_progress')`,
      [studentId, caseId]
    );

    const completedCount = completedChats[0].count;
    const hasActiveChat = activeChats.length > 0;
    const maxChats = chatRepeats + 1; // chatRepeats = 0 means 1 chat allowed
    const canStartNew = !hasActiveChat && completedCount < maxChats;

    res.json({
      data: {
        can_start_new: canStartNew,
        completed_count: completedCount,
        max_chats: maxChats,
        has_active_chat: hasActiveChat,
        active_chat_id: hasActiveChat ? activeChats[0].id : null,
        chat_repeats: chatRepeats
      },
      error: null
    });
  } catch (error) {
    console.error('Error checking chat repeats:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/case-chats/:id - Get a single chat session
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await pool.execute(
      `SELECT cc.*, s.full_name as student_name, c.case_title, sec.section_title
       FROM case_chats cc
       LEFT JOIN students s ON cc.student_id = s.id
       LEFT JOIN cases c ON cc.case_id = c.case_id
       LEFT JOIN sections sec ON cc.section_id = sec.section_id
       WHERE cc.id = ?`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Chat not found' } });
    }

    res.json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error fetching case chat:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PATCH /api/case-chats/:id/kill - Kill a chat (admin only)
router.patch('/:id/kill', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;

    const [existing] = await pool.execute('SELECT id, status FROM case_chats WHERE id = ?', [id]);

    if (existing.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Chat not found' } });
    }

    // Can only kill active chats
    if (!['started', 'in_progress'].includes(existing[0].status)) {
      return res.status(400).json({
        data: null,
        error: { message: `Cannot kill chat with status '${existing[0].status}'` }
      });
    }

    await pool.execute(
      `UPDATE case_chats SET status = 'killed', end_time = CURRENT_TIMESTAMP WHERE id = ?`,
      [id]
    );

    const [rows] = await pool.execute('SELECT * FROM case_chats WHERE id = ?', [id]);

    res.json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error killing chat:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// DELETE /api/case-chats/:id - Delete a chat record (admin only)
router.delete('/:id', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;

    const [existing] = await pool.execute('SELECT id FROM case_chats WHERE id = ?', [id]);

    if (existing.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Chat not found' } });
    }

    await pool.execute('DELETE FROM case_chats WHERE id = ?', [id]);

    res.json({ data: { deleted: true }, error: null });
  } catch (error) {
    console.error('Error deleting chat:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// POST /api/case-chats/mark-abandoned - Mark old chats as abandoned (for background job)
router.post('/mark-abandoned', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { timeout_minutes = 60 } = req.body;
    const timeout = parseInt(timeout_minutes) || 60;

    const [result] = await pool.query(
      `UPDATE case_chats
       SET status = 'abandoned', end_time = CURRENT_TIMESTAMP
       WHERE status IN ('started', 'in_progress')
         AND last_activity < DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
      [timeout]
    );

    res.json({
      data: {
        affected_rows: result.affectedRows,
        message: `Marked ${result.affectedRows} chat(s) as abandoned`
      },
      error: null
    });
  } catch (error) {
    console.error('Error marking abandoned chats:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// =====================================================
// TIMER ENDPOINTS
// =====================================================

// POST /api/case-chats/:id/start-timer - Start the chat timer (call on first student message)
router.post('/:id/start-timer', async (req, res) => {
  try {
    const { id } = req.params;

    const [existing] = await pool.execute(
      'SELECT id, status, time_started, time_limit_minutes FROM case_chats WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Chat not found' } });
    }

    const chat = existing[0];

    // Only start timer if chat is active
    if (!['started', 'in_progress'].includes(chat.status)) {
      return res.status(400).json({
        data: null,
        error: { message: `Cannot start timer for chat with status '${chat.status}'` }
      });
    }

    // If timer already started, return current state
    if (chat.time_started) {
      const now = new Date();
      const startTime = new Date(chat.time_started);
      const elapsedMinutes = (now - startTime) / 60000;
      const remainingMinutes = chat.time_limit_minutes ? Math.max(0, chat.time_limit_minutes - elapsedMinutes) : null;

      return res.json({
        data: {
          time_started: chat.time_started,
          time_limit_minutes: chat.time_limit_minutes,
          elapsed_minutes: Math.round(elapsedMinutes * 10) / 10,
          remaining_minutes: remainingMinutes ? Math.round(remainingMinutes * 10) / 10 : null,
          already_started: true
        },
        error: null
      });
    }

    // Start the timer
    await pool.execute(
      `UPDATE case_chats SET time_started = CURRENT_TIMESTAMP, status = 'in_progress' WHERE id = ?`,
      [id]
    );

    const [updated] = await pool.execute('SELECT time_started, time_limit_minutes FROM case_chats WHERE id = ?', [id]);

    res.json({
      data: {
        time_started: updated[0].time_started,
        time_limit_minutes: updated[0].time_limit_minutes,
        elapsed_minutes: 0,
        remaining_minutes: updated[0].time_limit_minutes,
        already_started: false
      },
      error: null
    });
  } catch (error) {
    console.error('Error starting timer:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/case-chats/:id/time-remaining - Get remaining time for active chat
router.get('/:id/time-remaining', async (req, res) => {
  try {
    const { id } = req.params;

    const [existing] = await pool.execute(
      'SELECT id, status, time_started, time_limit_minutes FROM case_chats WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Chat not found' } });
    }

    const chat = existing[0];

    // No time limit set
    if (!chat.time_limit_minutes) {
      return res.json({
        data: {
          has_time_limit: false,
          time_limit_minutes: null,
          remaining_minutes: null,
          elapsed_minutes: null,
          expired: false
        },
        error: null
      });
    }

    // Timer not started yet
    if (!chat.time_started) {
      return res.json({
        data: {
          has_time_limit: true,
          time_limit_minutes: chat.time_limit_minutes,
          remaining_minutes: chat.time_limit_minutes,
          elapsed_minutes: 0,
          timer_started: false,
          expired: false
        },
        error: null
      });
    }

    // Calculate remaining time
    const now = new Date();
    const startTime = new Date(chat.time_started);
    const elapsedMinutes = (now - startTime) / 60000;
    const remainingMinutes = Math.max(0, chat.time_limit_minutes - elapsedMinutes);
    const expired = remainingMinutes <= 0;

    res.json({
      data: {
        has_time_limit: true,
        time_limit_minutes: chat.time_limit_minutes,
        time_started: chat.time_started,
        elapsed_minutes: Math.round(elapsedMinutes * 10) / 10,
        remaining_minutes: Math.round(remainingMinutes * 10) / 10,
        remaining_seconds: Math.round(remainingMinutes * 60),
        timer_started: true,
        expired: expired
      },
      error: null
    });
  } catch (error) {
    console.error('Error getting time remaining:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/case-chats/check-scenario-completion/:studentId/:caseId - Check which scenarios are completed
router.get('/check-scenario-completion/:studentId/:caseId', async (req, res) => {
  try {
    const { studentId, caseId } = req.params;
    const { section_id } = req.query;

    // Get all scenarios for this case
    let scenariosQuery = `
      SELECT cs.id as scenario_id, cs.scenario_name, cs.protagonist, cs.sort_order
      FROM case_scenarios cs
      WHERE cs.case_id = ? AND cs.enabled = TRUE
    `;
    const params = [caseId];

    // If section_id provided, only get assigned scenarios
    if (section_id) {
      scenariosQuery = `
        SELECT cs.id as scenario_id, cs.scenario_name, cs.protagonist, scs.sort_order
        FROM section_case_scenarios scs
        JOIN case_scenarios cs ON scs.scenario_id = cs.id
        JOIN section_cases sc ON scs.section_case_id = sc.id
        WHERE sc.section_id = ? AND sc.case_id = ? AND scs.enabled = TRUE AND cs.enabled = TRUE
        ORDER BY scs.sort_order ASC
      `;
      params.unshift(section_id);
    }

    const [scenarios] = await pool.execute(scenariosQuery, params);

    // Get completed chats for each scenario
    const [completedChats] = await pool.execute(
      `SELECT scenario_id, COUNT(*) as completed_count
       FROM case_chats
       WHERE student_id = ? AND case_id = ? AND status = 'completed' AND scenario_id IS NOT NULL
       GROUP BY scenario_id`,
      [studentId, caseId]
    );

    const completedMap = new Map(completedChats.map(c => [c.scenario_id, c.completed_count]));

    // Check for active chats
    const [activeChats] = await pool.execute(
      `SELECT scenario_id FROM case_chats
       WHERE student_id = ? AND case_id = ? AND status IN ('started', 'in_progress')`,
      [studentId, caseId]
    );

    const activeScenarioIds = new Set(activeChats.map(c => c.scenario_id));

    const scenariosWithStatus = scenarios.map(s => ({
      ...s,
      completed: completedMap.has(s.scenario_id),
      completed_count: completedMap.get(s.scenario_id) || 0,
      has_active_chat: activeScenarioIds.has(s.scenario_id)
    }));

    const completedCount = scenariosWithStatus.filter(s => s.completed).length;

    res.json({
      data: {
        scenarios: scenariosWithStatus,
        total_scenarios: scenarios.length,
        completed_count: completedCount,
        all_completed: completedCount >= scenarios.length
      },
      error: null
    });
  } catch (error) {
    console.error('Error checking scenario completion:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

export default router;
