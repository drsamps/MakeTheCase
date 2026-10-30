import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db.js';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { inferPositionsFromChat, shouldInferPositions } from '../services/positionInference.js';
import { checkSectionReadiness } from '../services/keyResolver.js';
import { getChatViewableSectionIds, canViewChat } from '../middleware/instructorAccess.js';
import { requireChatOwner, requireSelfStudent } from '../middleware/chatOwner.js';
import { resolveSectionModel } from '../services/modelChoice.js';
import { loadChatContext, buildGreeting, sanitizeStudentName } from '../services/chatPrompt.js';
import { appendTurns } from '../services/chatTurns.js';
import { isTypeUsable } from '../services/activityTypes.js';
import { typeTraits } from '../services/activityTypeStore.js';
import { assignSide, offeredPositions } from '../services/sideAssignment.js';
import { latestSubmission } from '../services/studentSubmissions.js';
import { assertCanComplete, recordCompletionReason, CompletionError } from '../services/chatCompletion.js';
import { chatAttemptStatus } from '../services/chatAttempts.js';

const router = express.Router();

// Valid status values
const VALID_STATUSES = ['started', 'in_progress', 'abandoned', 'canceled', 'killed', 'completed', 'evaluation_failed'];

// POST /api/case-chats - Create a new chat session (students only). The student comes from the
// token and the chat model from the section (services/modelChoice.js), never from the body.
// Also writes the AI's greeting as turn 0 of the server's copy (services/chatTurns.js) and
// returns it as data.greeting for the browser to show. student_name is the first name the
// greeting uses (cleaned like every name that reaches the prompt).
router.post('/', verifyToken, requireRole(['student']), async (req, res) => {
  let txn = null;
  try {
    const { case_id, section_id, scenario_id, persona, initial_position, initial_position_id, position_method, student_name } = req.body;
    const student_id = req.user.id;

    if (!case_id) {
      return res.status(400).json({
        data: null,
        error: { message: 'case_id is required' }
      });
    }

    if (section_id) {
      const readiness = await checkSectionReadiness(section_id);
      if (!readiness.ready) {
        return res.status(409).json({
          data: null,
          error: {
            code: 'INSTRUCTOR_SETUP_INCOMPLETE',
            message: "This section isn't ready yet — your instructor still needs to finish setup. Please check back later.",
            missing_providers: readiness.missing
          }
        });
      }
    }

    // The case's activity type must be usable for a NEW chat: known, published and enabled. A
    // disabled type still serves chats already in progress (activityTypeStore.js).
    const [typeRows] = await pool.execute('SELECT activity_type FROM cases WHERE case_id = ?', [case_id]);
    if (typeRows.length && !isTypeUsable(typeRows[0].activity_type)) {
      return res.status(409).json({
        data: null,
        error: { code: 'ACTIVITY_TYPE_UNAVAILABLE', message: 'This activity is not available right now. Please tell your instructor.' },
      });
    }

    // Chats allowed on this assignment (chat_repeats, allow_repeat, re-chat): services/chatAttempts.js.
    // Checked here as well as on the start screen, so a stale page cannot start one more.
    const attempts = await chatAttemptStatus({
      studentId: student_id, sectionId: section_id || null, caseId: case_id, scenarioId: scenario_id || null,
    });
    if (!attempts.can_start_new) {
      return res.status(409).json({
        data: null,
        error: {
          code: 'CHAT_LIMIT_REACHED',
          message: attempts.scope === 'scenario'
            ? 'You have used all your chats for this scenario.'
            : 'You have used all your chats for this activity.',
          chats_used: attempts.chats_used,
          chats_allowed: attempts.chats_allowed,
        },
      });
    }

    const id = uuidv4();
    const chat_model = await resolveSectionModel(section_id, 'chat_model');

    // Capture method 'assigned': the server picks the side (services/sideAssignment.js) and any
    // position in the request is ignored. The row lock is held until the chat is inserted, so
    // students starting at the same moment are balanced one after the other.
    let assigned = null;
    const startTraits = typeTraits(typeRows[0]?.activity_type);
    // A type that requires positions cannot run without them. Refused here, in words, rather than
    // run a debate with no sides.
    if (section_id && startTraits?.positions === 'required') {
      const [requiredRows] = await pool.execute(
        'SELECT id, position_tracking_enabled, position_capture_method FROM section_cases WHERE section_id = ? AND case_id = ?',
        [section_id, case_id]
      );
      const row = requiredRows[0];
      const usable = row && row.position_tracking_enabled && ['assigned', 'explicit'].includes(row.position_capture_method);
      const count = usable && scenario_id ? (await offeredPositions(pool, row.id, scenario_id)).length : 0;
      if (count < 2 || (startTraits.two_sided && count !== 2)) {
        return res.status(409).json({
          data: null,
          error: { code: 'POSITIONS_NOT_READY', message: 'This activity is not ready: its positions are not set up. Please tell your instructor.' },
        });
      }
    }
    // The student's own work, for a type that takes it. The chat pins this one.
    let submissionId = null;
    if (startTraits?.material === 'student_submission') {
      const submission = section_id ? await latestSubmission(section_id, case_id, student_id) : null;
      if (!submission) {
        return res.status(409).json({ data: null, error: { code: 'SUBMISSION_REQUIRED', message: 'Add your work before you start this chat.' } });
      }
      submissionId = submission.id;
    }
    if (section_id && scenario_id) {
      const traits = startTraits;
      if (traits?.capture_methods?.includes('assigned')) {
        const [assignRows] = await pool.execute(
          'SELECT id, position_tracking_enabled, position_capture_method FROM section_cases WHERE section_id = ? AND case_id = ?',
          [section_id, case_id]
        );
        if (assignRows[0]?.position_capture_method === 'assigned' && assignRows[0].position_tracking_enabled) {
          txn = await pool.getConnection();
          await txn.beginTransaction();
          await txn.execute('SELECT id FROM section_cases WHERE id = ? FOR UPDATE', [assignRows[0].id]);
          assigned = await assignSide(txn, {
            sectionCaseId: assignRows[0].id, sectionId: section_id, caseId: case_id, scenarioId: scenario_id,
            studentId: student_id, twoSided: Boolean(traits.two_sided),
          });
        }
      }
    }
    const startPositionId = assigned ? assigned.position_id : (initial_position_id || null);
    const startPositionMethod = assigned ? 'assigned' : (position_method || null);

    // Built before the insert so a case that cannot load refuses the chat instead of leaving a
    // record with no greeting.
    const context = await loadChatContext({
      id, case_id, section_id: section_id || null, scenario_id: scenario_id || null,
      persona: persona || null, initial_position_id: startPositionId, position_method: startPositionMethod, submission_id: submissionId,
    });
    const greeting = buildGreeting(context, sanitizeStudentName(student_name));
    // The type version this chat runs on (migration 090), and the student copy from it, so the
    // page's wording cannot change mid-chat.
    const activity = context.behaviour;

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

    // Get position_name from scenario_positions if initial_position_id is provided
    let positionName = assigned ? assigned.position_name : (initial_position || null);
    if (!assigned && initial_position_id) {
      const [posRows] = await pool.execute(
        'SELECT position_name FROM scenario_positions WHERE position_id = ?',
        [initial_position_id]
      );
      if (posRows.length > 0) {
        positionName = posRows[0].position_name;
      }
    }

    const db = txn || pool;
    await db.execute(
      `INSERT INTO case_chats (id, student_id, case_id, section_id, scenario_id, persona, activity_type_version, chat_model, status, time_limit_minutes, initial_position, initial_position_id, position_method, submission_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'started', ?, ?, ?, ?, ?)`,
      [id, student_id, case_id, section_id || null, scenario_id || null, persona || null, activity.version, chat_model || null, timeLimitMinutes, positionName, startPositionId, startPositionMethod, submissionId]
    );

    // Log initial position if provided (using position_id or position string)
    if ((startPositionId || initial_position) && startPositionMethod) {
      await db.execute(
        `INSERT INTO chat_position_logs (case_chat_id, position_type, position_value, recorded_by, notes)
         VALUES (?, 'initial', ?, ?, NULL)`,
        [id, positionName, startPositionMethod === 'explicit' ? 'student' : 'instructor']
      );
    }
    if (txn) {
      await txn.commit();
      txn.release();
      txn = null;
    }

    await appendTurns(id, [{ role: 'protagonist', content: greeting }]);

    const [rows] = await pool.execute('SELECT * FROM case_chats WHERE id = ?', [id]);

    res.status(201).json({
      data: {
        ...rows[0],
        greeting,
        activity: activity.studentView,
        // For the intro bar. The goal only for a type whose student copy shows it.
        goal: activity.studentView.copy?.intro?.goal ? (context.caseData.goal || null) : null,
        assigned_position: assigned ? assigned.position : null,
      },
      error: null,
    });
  } catch (error) {
    if (txn) {
      await txn.rollback().catch(() => {});
      txn.release();
    }
    if (error?.code === 'ACTIVITY_TYPE_UNAVAILABLE' || error?.code === 'POSITIONS_NOT_READY') {
      return res.status(409).json({ data: null, error: { code: error.code, message: error.message } });
    }
    if (error?.status === 404) {
      return res.status(404).json({ data: null, error: { message: error.message } });
    }
    console.error('Error creating case chat:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// POST /api/case-chats/:id/complete - The student's chat is ending, and why: { reason }
// (student | goal | max_exchanges | time). Enforces the minimum on the server and records
// completion_reason; grading itself is /api/evaluations/run. See services/chatCompletion.js.
router.post('/:id/complete', requireChatOwner('id'), async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};
    const [rows] = await pool.execute(
      `SELECT id, case_id, section_id, scenario_id, persona, initial_position_id, activity_type_version, status,
              time_limit_minutes, time_started, goal_reached_at, completion_reason
         FROM case_chats WHERE id = ?`,
      [id]
    );
    const chat = rows[0];
    if (!chat) return res.status(404).json({ data: null, error: { message: 'Chat not found' } });
    const context = await loadChatContext(chat);
    const [[{ used }]] = await pool.execute("SELECT COUNT(*) AS used FROM chat_turns WHERE case_chat_id = ? AND role = 'student'", [id]);
    assertCanComplete(chat, reason, context.chatOptions, Number(used));
    await recordCompletionReason(id, reason);
    res.json({ data: { completion_reason: chat.completion_reason || reason }, error: null });
  } catch (error) {
    if (error instanceof CompletionError) {
      return res.status(error.status).json({ data: null, error: { code: error.code, message: error.message, ...error.details } });
    }
    if (error?.code === 'ACTIVITY_TYPE_UNAVAILABLE') {
      return res.status(409).json({ data: null, error: { code: error.code, message: error.message } });
    }
    console.error('Error completing chat:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PATCH /api/case-chats/:id/activity - Update last_activity timestamp (heartbeat)
router.patch('/:id/activity', requireChatOwner('id'), async (req, res) => {
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
// NOTE: Transcript handling removed - use /api/transcripts instead
router.patch('/:id/status', requireChatOwner('id'), async (req, res) => {
  try {
    const { id } = req.params;
    const { status, hints_used } = req.body;

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
    if (status === 'canceled' || status === 'killed') {
      updates.push('completion_reason = COALESCE(completion_reason, ?)');
      params.push(status === 'killed' ? 'instructor' : 'canceled');
    }

    if (hints_used !== undefined) {
      updates.push('hints_used = ?');
      params.push(hints_used);
    }

    params.push(id);

    await pool.execute(`UPDATE case_chats SET ${updates.join(', ')} WHERE id = ?`, params);

    const [rows] = await pool.execute('SELECT * FROM case_chats WHERE id = ?', [id]);

    // Auto-trigger position inference if chat is completed and uses ai_inferred method
    if (status === 'completed') {
      // Run async - don't block the response
      shouldInferPositions(id).then(async (shouldInfer) => {
        if (shouldInfer) {
          console.log(`[CaseChats] Auto-triggering position inference for chat ${id}`);
          try {
            await inferPositionsFromChat(id);
            console.log(`[CaseChats] Position inference completed for chat ${id}`);
          } catch (inferError) {
            console.error(`[CaseChats] Position inference failed for chat ${id}:`, inferError.message);
          }
        }
      }).catch(e => console.error('[CaseChats] Error checking inference:', e));
    }

    res.json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error updating chat status:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PATCH /api/case-chats/:id/complete - Complete chat
// NOTE: evaluation_id and transcript removed from this endpoint
// - Evaluations link via case_chat_id (one-way reference)
// - Transcripts saved via /api/transcripts
router.patch('/:id/complete', requireChatOwner('id'), async (req, res) => {
  try {
    const { id } = req.params;
    const { hints_used } = req.body;

    const [existing] = await pool.execute('SELECT id FROM case_chats WHERE id = ?', [id]);

    if (existing.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Chat not found' } });
    }

    const updates = ["status = 'completed'", 'end_time = CURRENT_TIMESTAMP'];
    const params = [];

    if (hints_used !== undefined) {
      updates.push('hints_used = ?');
      params.push(hints_used);
    }

    params.push(id);

    await pool.execute(`UPDATE case_chats SET ${updates.join(', ')} WHERE id = ?`, params);

    const [rows] = await pool.execute('SELECT * FROM case_chats WHERE id = ?', [id]);

    // Auto-trigger position inference if uses ai_inferred method
    // Run async - don't block the response
    shouldInferPositions(id).then(async (shouldInfer) => {
      if (shouldInfer) {
        console.log(`[CaseChats] Auto-triggering position inference for chat ${id}`);
        try {
          await inferPositionsFromChat(id);
          console.log(`[CaseChats] Position inference completed for chat ${id}`);
        } catch (inferError) {
          console.error(`[CaseChats] Position inference failed for chat ${id}:`, inferError.message);
        }
      }
    }).catch(e => console.error('[CaseChats] Error checking inference:', e));

    res.json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error completing chat:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/case-chats - List chats with filters.
// Admins (without impersonation) see all chats. Instructors and admins acting
// as an instructor see chats only from their accessible sections (primary or
// TA with can_view_chats=1). Empty scope returns an empty list rather than 403.
router.get('/', verifyToken, requireRole(['admin', 'instructor']), async (req, res) => {
  try {
    const { status, section_id, student_id, case_id } = req.query;
    // Optional: the dashboard header Semester selector. Narrows within the access scope above,
    // never widens it.
    const semesterId = req.query.semester_id != null && req.query.semester_id !== 'all'
      ? parseInt(req.query.semester_id, 10) || null
      : null;
    let { limit = 100, offset = 0 } = req.query;

    // Ensure limit and offset are valid numbers
    limit = Math.max(1, parseInt(limit) || 100);
    offset = Math.max(0, parseInt(offset) || 0);

    const scopedSectionIds = await getChatViewableSectionIds(req);
    if (scopedSectionIds && scopedSectionIds.length === 0) {
      return res.json({ data: [], total: 0, limit, offset, error: null });
    }

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

    if (scopedSectionIds) {
      query += ` AND cc.section_id IN (${scopedSectionIds.map(() => '?').join(',')})`;
      params.push(...scopedSectionIds);
    }

    if (status && status !== 'all') {
      query += ' AND cc.status = ?';
      params.push(status);
    }

    if (section_id && section_id !== 'all') {
      // For instructors, the requested section must be in their scope
      if (scopedSectionIds && !scopedSectionIds.includes(section_id)) {
        return res.json({ data: [], total: 0, limit, offset, error: null });
      }
      query += ' AND cc.section_id = ?';
      params.push(section_id);
    }

    if (semesterId) {
      query += ' AND sec.semester_id = ?';
      params.push(semesterId);
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
    let countQuery = semesterId
      ? 'SELECT COUNT(*) as total FROM case_chats cc JOIN sections sec ON cc.section_id = sec.section_id WHERE sec.semester_id = ?'
      : 'SELECT COUNT(*) as total FROM case_chats cc WHERE 1=1';
    const countParams = semesterId ? [semesterId] : [];

    if (scopedSectionIds) {
      countQuery += ` AND cc.section_id IN (${scopedSectionIds.map(() => '?').join(',')})`;
      countParams.push(...scopedSectionIds);
    }
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

// GET /api/case-chats/student/:studentId - Get a student's chats (staff; only sections in scope)
router.get('/student/:studentId', verifyToken, requireRole(['admin', 'instructor']), async (req, res) => {
  try {
    const { studentId } = req.params;
    const { case_id } = req.query;

    const scopedSectionIds = await getChatViewableSectionIds(req);
    if (scopedSectionIds && scopedSectionIds.length === 0) {
      return res.json({ data: [], error: null });
    }

    let query = `
      SELECT cc.*, c.case_title
      FROM case_chats cc
      LEFT JOIN cases c ON cc.case_id = c.case_id
      LEFT JOIN students st ON cc.student_id = st.id
      WHERE cc.student_id = ?
    `;
    const params = [studentId];

    if (scopedSectionIds) {
      query += ` AND COALESCE(cc.section_id, st.section_id) IN (${scopedSectionIds.map(() => '?').join(',')})`;
      params.push(...scopedSectionIds);
    }

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

// GET /api/case-chats/:id - Get a single chat session (staff; 404 outside scope)
router.get('/:id', verifyToken, requireRole(['admin', 'instructor']), async (req, res) => {
  try {
    const { id } = req.params;

    if (!(await canViewChat(req, id))) {
      return res.status(404).json({ data: null, error: { message: 'Chat not found' } });
    }

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
      `UPDATE case_chats SET status = 'killed', end_time = CURRENT_TIMESTAMP, completion_reason = COALESCE(completion_reason, 'instructor') WHERE id = ?`,
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

// POST /api/case-chats/mark-abandoned - Mark old chats as abandoned (for background job).
// Replaces a cron. Called whenever a staff dashboard opens the Latest Chats tab.
// Admins (without impersonation) sweep all chats; instructors and admins acting
// as an instructor sweep only their accessible sections (no-op if empty scope).
router.post('/mark-abandoned', verifyToken, requireRole(['admin', 'instructor']), async (req, res) => {
  try {
    const { timeout_minutes = 60 } = req.body;
    const timeout = parseInt(timeout_minutes) || 60;

    const scopedSectionIds = await getChatViewableSectionIds(req);
    if (scopedSectionIds && scopedSectionIds.length === 0) {
      return res.json({ data: { affected_rows: 0, message: 'Marked 0 chat(s) as abandoned' }, error: null });
    }

    let sql = `UPDATE case_chats
       SET status = 'abandoned', end_time = CURRENT_TIMESTAMP
       WHERE status IN ('started', 'in_progress')
         AND last_activity < DATE_SUB(NOW(), INTERVAL ? MINUTE)`;
    const params = [timeout];
    if (scopedSectionIds) {
      sql += ` AND section_id IN (${scopedSectionIds.map(() => '?').join(',')})`;
      params.push(...scopedSectionIds);
    }
    const [result] = await pool.query(sql, params);

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
router.post('/:id/start-timer', requireChatOwner('id'), async (req, res) => {
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
router.get('/:id/time-remaining', requireChatOwner('id'), async (req, res) => {
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
router.get('/check-scenario-completion/:studentId/:caseId', requireSelfStudent('studentId'), async (req, res) => {
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
router.patch('/:id/position', requireChatOwner('id'), async (req, res) => {
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

// GET /api/case-chats/:id/positions - Get position history for a chat (staff; 404 outside scope)
router.get('/:id/positions', verifyToken, requireRole(['admin', 'instructor']), async (req, res) => {
  try {
    const { id } = req.params;

    if (!(await canViewChat(req, id))) {
      return res.status(404).json({ data: null, error: { message: 'Chat not found' } });
    }

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

// PATCH /api/case-chats/:id/initial-position - Set initial position by position_id (for explicit capture method)
router.patch('/:id/initial-position', requireChatOwner('id'), async (req, res) => {
  try {
    const { id } = req.params;
    const { initial_position_id } = req.body;

    if (!initial_position_id) {
      return res.status(400).json({
        data: null,
        error: { message: 'initial_position_id is required' }
      });
    }

    const [existing] = await pool.execute('SELECT id, position_method FROM case_chats WHERE id = ?', [id]);

    if (existing.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Chat not found' } });
    }
    // A side the server assigned is not the student's to change.
    if (existing[0].position_method === 'assigned') {
      return res.status(409).json({ data: null, error: { code: 'POSITION_ASSIGNED', message: 'Your side was assigned for this activity.' } });
    }

    // Get position_name from scenario_positions
    const [posRows] = await pool.execute(
      'SELECT position_name FROM scenario_positions WHERE position_id = ?',
      [initial_position_id]
    );
    const positionName = posRows.length > 0 ? posRows[0].position_name : null;

    // Update the initial_position_id, initial_position (string), and position_method
    await pool.execute(
      `UPDATE case_chats SET initial_position_id = ?, initial_position = ?, position_method = 'explicit' WHERE id = ?`,
      [initial_position_id, positionName, id]
    );

    // Insert into position logs
    await pool.execute(
      `INSERT INTO chat_position_logs (case_chat_id, position_type, position_value, recorded_by, notes)
       VALUES (?, 'initial', ?, 'student', 'Selected during chat via explicit method')`,
      [id, positionName]
    );

    const [rows] = await pool.execute('SELECT * FROM case_chats WHERE id = ?', [id]);

    res.json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error updating chat initial position:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PATCH /api/case-chats/:id/final-position - Set final position by position_id (new FK-based system)
router.patch('/:id/final-position', requireChatOwner('id'), async (req, res) => {
  try {
    const { id } = req.params;
    const { final_position_id } = req.body;

    if (!final_position_id) {
      return res.status(400).json({
        data: null,
        error: { message: 'final_position_id is required' }
      });
    }

    const [existing] = await pool.execute('SELECT id, position_method FROM case_chats WHERE id = ?', [id]);

    if (existing.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Chat not found' } });
    }

    // Get position_name from scenario_positions
    const [posRows] = await pool.execute(
      'SELECT position_name FROM scenario_positions WHERE position_id = ?',
      [final_position_id]
    );
    const positionName = posRows.length > 0 ? posRows[0].position_name : null;

    // Update the final_position_id and final_position (string for backward compatibility)
    await pool.execute(
      `UPDATE case_chats SET final_position_id = ?, final_position = ? WHERE id = ?`,
      [final_position_id, positionName, id]
    );

    // Insert into position logs
    await pool.execute(
      `INSERT INTO chat_position_logs (case_chat_id, position_type, position_value, recorded_by, notes)
       VALUES (?, 'final', ?, 'student', NULL)`,
      [id, positionName]
    );

    const [rows] = await pool.execute('SELECT * FROM case_chats WHERE id = ?', [id]);

    res.json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error updating chat final position:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// POST /api/case-chats/:id/infer-position - Trigger AI position inference (admin only)
router.post('/:id/infer-position', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    // No model named: the section's supervisor model, as after grading (positionInference.js).
    const { model_id = null } = req.body || {};

    // Check if chat exists
    const [existing] = await pool.execute(
      `SELECT cc.id, cc.status, cc.position_inferred_at, sc.position_tracking_enabled
       FROM case_chats cc
       JOIN section_cases sc ON cc.section_id = sc.section_id AND cc.case_id = sc.case_id
       WHERE cc.id = ?`,
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Chat not found' } });
    }

    const chat = existing[0];

    if (!chat.position_tracking_enabled) {
      return res.status(400).json({
        data: null,
        error: { message: 'Position tracking is not enabled for this assignment' }
      });
    }

    if (chat.status !== 'completed') {
      return res.status(400).json({
        data: null,
        error: { message: 'Can only infer positions for completed chats' }
      });
    }

    // Perform inference
    const result = await inferPositionsFromChat(id, model_id);

    res.json({
      data: result,
      message: chat.position_inferred_at
        ? 'Position inference updated'
        : 'Position inference completed',
      error: null
    });
  } catch (error) {
    console.error('Error inferring chat position:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/case-chats/:id/should-infer - Check if chat should have positions inferred (staff; 404 outside scope)
router.get('/:id/should-infer', verifyToken, requireRole(['admin', 'instructor']), async (req, res) => {
  try {
    const { id } = req.params;
    if (!(await canViewChat(req, id))) {
      return res.status(404).json({ data: null, error: { message: 'Chat not found' } });
    }
    const shouldInfer = await shouldInferPositions(id);
    res.json({ data: { should_infer: shouldInfer }, error: null });
  } catch (error) {
    console.error('Error checking inference status:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

export default router;
