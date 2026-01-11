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
    const { student_id, case_id, section_id, scenario_id, persona, chat_model, initial_position, position_method } = req.body;

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
      `INSERT INTO case_chats (id, student_id, case_id, section_id, scenario_id, persona, chat_model, status, time_limit_minutes, initial_position, position_method)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'started', ?, ?, ?)`,
      [id, student_id, case_id, section_id || null, scenario_id || null, persona || null, chat_model || null, timeLimitMinutes, initial_position || null, position_method || null]
    );

    // Log initial position if provided
    if (initial_position && position_method) {
      await pool.execute(
        `INSERT INTO chat_position_logs (case_chat_id, position_type, position_value, recorded_by, notes)
         VALUES (?, 'initial', ?, ?, NULL)`,
        [id, initial_position, position_method === 'explicit' ? 'student' : 'instructor']
      );
    }

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

// ===== SPECIFIC ROUTES - Must come BEFORE generic /:id route =====

// GET /api/case-chats/analytics/positions - Get position distribution for a section/case (admin only)
router.get('/analytics/positions', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { section_id, case_id, scenario_id } = req.query;

    if (!section_id || !case_id) {
      return res.status(400).json({
        data: null,
        error: { message: 'section_id and case_id are required' }
      });
    }

    // Build query based on filters
    let query = `
      SELECT
        cc.initial_position,
        cc.final_position,
        cc.position_method,
        cc.student_id,
        s.full_name as student_name,
        cc.status
      FROM case_chats cc
      LEFT JOIN students s ON cc.student_id = s.id
      WHERE cc.section_id = ? AND cc.case_id = ?
        AND cc.initial_position IS NOT NULL
    `;
    const params = [section_id, case_id];

    if (scenario_id) {
      query += ' AND cc.scenario_id = ?';
      params.push(scenario_id);
    }

    query += ' ORDER BY cc.start_time DESC';

    const [rows] = await pool.execute(query, params);

    // Calculate distributions
    const initialDistribution = {};
    const finalDistribution = {};
    let changedCount = 0;
    let unchangedCount = 0;

    const studentsByPosition = {};

    rows.forEach(row => {
      // Initial position distribution
      if (row.initial_position) {
        initialDistribution[row.initial_position] = (initialDistribution[row.initial_position] || 0) + 1;

        // Track students by initial position
        if (!studentsByPosition[row.initial_position]) {
          studentsByPosition[row.initial_position] = [];
        }
        studentsByPosition[row.initial_position].push({
          id: row.student_id,
          name: row.student_name,
          changed: row.final_position !== null && row.final_position !== row.initial_position,
          final_position: row.final_position
        });
      }

      // Final position distribution
      if (row.final_position) {
        finalDistribution[row.final_position] = (finalDistribution[row.final_position] || 0) + 1;

        if (row.initial_position !== row.final_position) {
          changedCount++;
        } else {
          unchangedCount++;
        }
      } else if (row.initial_position) {
        // No final position yet, count as unchanged
        unchangedCount++;
      }
    });

    // Convert to arrays with percentages
    const total = rows.length || 1;
    const formatDistribution = (dist) => {
      return Object.entries(dist).map(([position, count]) => ({
        position,
        count,
        percentage: Math.round((count / total) * 100)
      })).sort((a, b) => b.count - a.count);
    };

    res.json({
      data: {
        total_with_positions: rows.length,
        initial_distribution: formatDistribution(initialDistribution),
        final_distribution: formatDistribution(finalDistribution),
        position_changes: {
          changed: changedCount,
          unchanged: unchangedCount,
          change_rate: total > 0 ? Math.round((changedCount / total) * 100) : 0
        },
        students_by_position: studentsByPosition
      },
      error: null
    });
  } catch (error) {
    console.error('Error fetching position analytics:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/case-chats/position-summaries - Get position summaries for all cases
router.get('/position-summaries', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const [casesWithChats] = await pool.execute(`
      SELECT DISTINCT cc.case_id
      FROM case_chats cc
      WHERE cc.status = 'completed'
    `);

    const summaries = {};

    for (const { case_id } of casesWithChats) {
      const [rows] = await pool.execute(`
        SELECT initial_position, final_position
        FROM case_chats
        WHERE case_id = ? AND status = 'completed'
      `, [case_id]);

      if (rows.length === 0) {
        summaries[case_id] = 'no positions tracked';
        continue;
      }

      // Count positions (using final if available, otherwise initial)
      const positionCounts = {};
      let noPositionCount = 0;

      rows.forEach(row => {
        const position = row.final_position || row.initial_position;
        if (position) {
          positionCounts[position] = (positionCounts[position] || 0) + 1;
        } else {
          noPositionCount++;
        }
      });

      // Build summary string
      const hasPositions = Object.keys(positionCounts).length > 0 || noPositionCount > 0;
      if (!hasPositions) {
        summaries[case_id] = 'no positions tracked';
      } else {
        const parts = Object.entries(positionCounts)
          .sort((a, b) => b[1] - a[1])
          .map(([pos, count]) => `${count} ${pos}`);

        if (noPositionCount > 0) {
          parts.push(`${noPositionCount} no position recorded`);
        }

        summaries[case_id] = parts.join(', ');
      }
    }

    res.json({ data: summaries, error: null });
  } catch (error) {
    console.error('Error fetching position summaries:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/case-chats/responses - Get all chat responses for a case with student details
router.get('/responses', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { section_id, case_id } = req.query;

    if (!case_id) {
      return res.status(400).json({
        data: null,
        error: { message: 'case_id is required' }
      });
    }

    let query = `
      SELECT
        cc.id,
        cc.student_id,
        s.full_name as student_name,
        cc.section_id,
        sec.section_title,
        cc.initial_position,
        cc.final_position,
        cc.status,
        cc.start_time,
        cc.end_time,
        e.transcript
      FROM case_chats cc
      LEFT JOIN students s ON cc.student_id = s.id
      LEFT JOIN sections sec ON cc.section_id = sec.section_id
      LEFT JOIN evaluations e ON cc.evaluation_id = e.id
      WHERE cc.case_id = ? AND cc.status = 'completed'
    `;
    const params = [case_id];

    if (section_id) {
      query += ' AND cc.section_id = ?';
      params.push(section_id);
    }

    query += ' ORDER BY cc.end_time DESC';

    console.log(`[GET /api/case-chats/responses] Querying case_id="${case_id}", section_id="${section_id || 'all'}"`);
    console.log(`[GET /api/case-chats/responses] Query: ${query}`);
    console.log(`[GET /api/case-chats/responses] Params:`, params);

    const [rows] = await pool.execute(query, params);

    console.log(`[GET /api/case-chats/responses] Found ${rows.length} responses`);
    if (rows.length > 0) {
      console.log(`[GET /api/case-chats/responses] Sample row:`, rows[0]);
    }

    res.json({ data: rows, error: null });
  } catch (error) {
    console.error('Error fetching chat responses:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// ===== END SPECIFIC ROUTES =====

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

// =====================================================
// POSITION TRACKING ENDPOINTS
// =====================================================

// PATCH /api/case-chats/:id/position - Set or update position for a chat
router.patch('/:id/position', async (req, res) => {
  try {
    const { id } = req.params;
    const { position_type, position_value, recorded_by, notes } = req.body;

    // Validate position_type
    if (!position_type || !['initial', 'final'].includes(position_type)) {
      return res.status(400).json({
        data: null,
        error: { message: "position_type must be 'initial' or 'final'" }
      });
    }

    if (!position_value) {
      return res.status(400).json({
        data: null,
        error: { message: 'position_value is required' }
      });
    }

    // Validate recorded_by
    const validRecordedBy = ['student', 'ai', 'instructor'];
    if (!recorded_by || !validRecordedBy.includes(recorded_by)) {
      return res.status(400).json({
        data: null,
        error: { message: `recorded_by must be one of: ${validRecordedBy.join(', ')}` }
      });
    }

    const [existing] = await pool.execute('SELECT id, position_method FROM case_chats WHERE id = ?', [id]);

    if (existing.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Chat not found' } });
    }

    // Update the appropriate position column
    const column = position_type === 'initial' ? 'initial_position' : 'final_position';
    const positionMethod = existing[0].position_method ||
      (recorded_by === 'student' ? 'explicit' : recorded_by === 'ai' ? 'ai_inferred' : 'instructor_manual');

    await pool.execute(
      `UPDATE case_chats SET ${column} = ?, position_method = ? WHERE id = ?`,
      [position_value, positionMethod, id]
    );

    // Insert into position logs
    await pool.execute(
      `INSERT INTO chat_position_logs (case_chat_id, position_type, position_value, recorded_by, notes)
       VALUES (?, ?, ?, ?, ?)`,
      [id, position_type, position_value, recorded_by, notes || null]
    );

    const [rows] = await pool.execute('SELECT * FROM case_chats WHERE id = ?', [id]);

    res.json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error updating chat position:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/case-chats/:id/positions - Get position history for a chat
router.get('/:id/positions', async (req, res) => {
  try {
    const { id } = req.params;

    const [chat] = await pool.execute(
      'SELECT id, initial_position, final_position, position_method FROM case_chats WHERE id = ?',
      [id]
    );

    if (chat.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Chat not found' } });
    }

    const [logs] = await pool.execute(
      'SELECT * FROM chat_position_logs WHERE case_chat_id = ? ORDER BY recorded_at ASC',
      [id]
    );

    res.json({
      data: {
        initial_position: chat[0].initial_position,
        final_position: chat[0].final_position,
        position_method: chat[0].position_method,
        position_changed: chat[0].initial_position !== chat[0].final_position &&
                         chat[0].final_position !== null,
        logs
      },
      error: null
    });
  } catch (error) {
    console.error('Error fetching chat positions:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

export default router;
