import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db.js';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { inferPositionFromTranscript } from '../services/positionInference.js';

const router = express.Router();

// Field list for SELECT queries (keeps things DRY)
const EVAL_FIELDS = `id, created_at, student_id, case_id, case_chat_id, score, summary, criteria, persona,
                     hints, helpful, liked, improve, chat_model, super_model, transcript, allow_rechat`;

// GET /api/evaluations - Get all evaluations (optionally filter by student_id and/or case_id)
router.get('/', async (req, res) => {
  try {
    const { student_id, student_ids, case_id } = req.query;
    
    let query = `SELECT ${EVAL_FIELDS} FROM evaluations`;
    const params = [];
    const conditions = [];
    
    if (student_id) {
      conditions.push('student_id = ?');
      params.push(student_id);
    } else if (student_ids) {
      // Support comma-separated list of student IDs
      const ids = student_ids.split(',');
      const placeholders = ids.map(() => '?').join(',');
      conditions.push(`student_id IN (${placeholders})`);
      params.push(...ids);
    }
    
    if (case_id) {
      conditions.push('case_id = ?');
      params.push(case_id);
    }
    
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    
    query += ' ORDER BY created_at DESC';
    
    const [rows] = await pool.execute(query, params);
    
    // Parse JSON criteria field
    const data = rows.map(row => ({
      ...row,
      criteria: row.criteria ? (typeof row.criteria === 'string' ? JSON.parse(row.criteria) : row.criteria) : null
    }));
    
    res.json({ data, error: null });
  } catch (error) {
    console.error('Error fetching evaluations:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/evaluations/check-completion/:studentId/:caseId - Check if student has completed a case
// Returns { completed: boolean, allow_rechat: boolean, evaluation_id: string | null }
router.get('/check-completion/:studentId/:caseId', async (req, res) => {
  try {
    const { studentId, caseId } = req.params;
    
    const [rows] = await pool.execute(
      `SELECT id, allow_rechat FROM evaluations 
       WHERE student_id = ? AND case_id = ? 
       ORDER BY created_at DESC LIMIT 1`,
      [studentId, caseId]
    );
    
    if (rows.length === 0) {
      return res.json({ 
        data: { completed: false, allow_rechat: false, evaluation_id: null }, 
        error: null 
      });
    }
    
    const evaluation = rows[0];
    res.json({ 
      data: { 
        completed: true, 
        allow_rechat: !!evaluation.allow_rechat,
        evaluation_id: evaluation.id
      }, 
      error: null 
    });
  } catch (error) {
    console.error('Error checking completion:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PATCH /api/evaluations/:id/allow-rechat - Toggle allow_rechat status (admin only)
// IMPORTANT: This route must be defined BEFORE /:id to ensure proper route matching
router.patch('/:id/allow-rechat', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { allow_rechat } = req.body;
    
    if (typeof allow_rechat !== 'boolean') {
      return res.status(400).json({ data: null, error: { message: 'allow_rechat must be a boolean' } });
    }
    
    await pool.execute(
      'UPDATE evaluations SET allow_rechat = ? WHERE id = ?',
      [allow_rechat ? 1 : 0, id]
    );
    
    const [rows] = await pool.execute(
      `SELECT ${EVAL_FIELDS} FROM evaluations WHERE id = ?`,
      [id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Evaluation not found' } });
    }
    
    const row = rows[0];
    const data = {
      ...row,
      criteria: row.criteria ? (typeof row.criteria === 'string' ? JSON.parse(row.criteria) : row.criteria) : null
    };
    
    res.json({ data, error: null });
  } catch (error) {
    console.error('Error updating allow_rechat:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/evaluations/:id - Get single evaluation
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT ${EVAL_FIELDS} FROM evaluations WHERE id = ?`,
      [req.params.id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Evaluation not found' } });
    }
    
    const row = rows[0];
    const data = {
      ...row,
      criteria: row.criteria ? (typeof row.criteria === 'string' ? JSON.parse(row.criteria) : row.criteria) : null
    };
    
    res.json({ data, error: null });
  } catch (error) {
    console.error('Error fetching evaluation:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// POST /api/evaluations - Create new evaluation
router.post('/', async (req, res) => {
  try {
    const {
      student_id, case_id, case_chat_id, score, summary, criteria, persona,
      hints, helpful, liked, improve, chat_model, super_model, transcript
    } = req.body;

    if (!student_id || score === undefined) {
      return res.status(400).json({ data: null, error: { message: 'Student ID and score are required' } });
    }

    const id = uuidv4();
    const criteriaJson = criteria ? JSON.stringify(criteria) : null;

    await pool.execute(
      `INSERT INTO evaluations (id, student_id, case_id, case_chat_id, score, summary, criteria, persona, hints, helpful, liked, improve, chat_model, super_model, transcript, allow_rechat)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE)`,
      [id, student_id, case_id || null, case_chat_id || null, score, summary || null, criteriaJson, persona || null,
       hints || 0, helpful || null, liked || null, improve || null,
       chat_model || null, super_model || null, transcript || null]
    );

    // If case_chat_id provided, update the case_chat status to completed and link to this evaluation
    if (case_chat_id) {
      await pool.execute(
        `UPDATE case_chats SET status = 'completed', end_time = CURRENT_TIMESTAMP, evaluation_id = ? WHERE id = ?`,
        [id, case_chat_id]
      );

      // AI Position Inference: If position tracking is enabled with ai_inferred method and no position set yet
      try {
        const [chatRows] = await pool.execute(
          `SELECT cc.*, cs.chat_options_override, c.case_title
           FROM case_chats cc
           LEFT JOIN case_scenarios cs ON cc.scenario_id = cs.id
           LEFT JOIN cases c ON cc.case_id = c.case_id
           WHERE cc.id = ?`,
          [case_chat_id]
        );

        if (chatRows.length > 0) {
          const chat = chatRows[0];
          const scenarioSettings = chat.chat_options_override ? JSON.parse(chat.chat_options_override) : {};

          // Check if AI inference is needed
          const needsInference =
            scenarioSettings.position_tracking_enabled === true &&
            scenarioSettings.position_capture_method === 'ai_inferred' &&
            (!chat.initial_position || !chat.final_position) &&
            transcript; // Make sure we have a transcript to analyze

          if (needsInference) {
            const positionOptions = scenarioSettings.position_options || ['for', 'against'];

            // Get case data for the prompt
            const [caseRows] = await pool.execute(
              `SELECT case_title, arguments_for, arguments_against
               FROM cases WHERE case_id = ?`,
              [chat.case_id]
            );

            const caseData = caseRows.length > 0 ? caseRows[0] : {};
            if (chat.case_title) caseData.case_title = chat.case_title;

            // Get chat question from scenario
            if (chat.scenario_id) {
              const [scenarioRows] = await pool.execute(
                `SELECT chat_question FROM case_scenarios WHERE id = ?`,
                [chat.scenario_id]
              );
              if (scenarioRows.length > 0) {
                caseData.chat_question = scenarioRows[0].chat_question;
              }
            }

            // Infer position using AI
            const modelId = chat_model || 'gemini-1.5-flash'; // Use chat model or default
            const inferenceResult = await inferPositionFromTranscript(
              transcript,
              caseData,
              positionOptions,
              modelId
            );

            if (inferenceResult && inferenceResult.position) {
              // Update case_chat with inferred position
              await pool.execute(
                `UPDATE case_chats
                 SET initial_position = ?, final_position = ?, position_method = 'ai_inferred'
                 WHERE id = ?`,
                [inferenceResult.position, inferenceResult.position, case_chat_id]
              );

              // Log the inferred position
              await pool.execute(
                `INSERT INTO chat_position_logs (case_chat_id, position_type, position_value, recorded_by, notes)
                 VALUES (?, 'initial', ?, 'ai', ?)`,
                [case_chat_id, inferenceResult.position, `AI inference (confidence: ${inferenceResult.confidence.toFixed(2)}): ${inferenceResult.reasoning}`]
              );

              console.log(`[AI Position Inference] Chat ${case_chat_id}: ${inferenceResult.position} (confidence: ${inferenceResult.confidence.toFixed(2)})`);
            } else {
              console.warn(`[AI Position Inference] Failed to infer position for chat ${case_chat_id}`);
            }
          }
        }
      } catch (inferenceError) {
        // Log error but don't fail the evaluation creation
        console.error('[AI Position Inference] Error during position inference:', inferenceError);
      }
    }

    // Return the created evaluation
    const [rows] = await pool.execute(
      `SELECT ${EVAL_FIELDS} FROM evaluations WHERE id = ?`,
      [id]
    );

    const row = rows[0];
    const data = {
      ...row,
      criteria: row.criteria ? (typeof row.criteria === 'string' ? JSON.parse(row.criteria) : row.criteria) : null
    };

    res.status(201).json({ data, error: null });
  } catch (error) {
    console.error('Error creating evaluation:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// DELETE /api/evaluations/:id - Delete evaluation (admin only - for testing/cleanup)
router.delete('/:id', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    
    const [existing] = await pool.execute('SELECT id FROM evaluations WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Evaluation not found' } });
    }
    
    await pool.execute('DELETE FROM evaluations WHERE id = ?', [id]);
    
    res.json({ data: { deleted: true }, error: null });
  } catch (error) {
    console.error('Error deleting evaluation:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

export default router;
