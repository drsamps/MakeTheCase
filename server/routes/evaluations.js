import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db.js';
import { verifyToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

// Field list for SELECT queries (keeps things DRY)
const EVAL_FIELDS = `id, created_at, student_id, case_id, score, summary, criteria, persona, 
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
      student_id, case_id, score, summary, criteria, persona, 
      hints, helpful, liked, improve, chat_model, super_model, transcript 
    } = req.body;
    
    if (!student_id || score === undefined) {
      return res.status(400).json({ data: null, error: { message: 'Student ID and score are required' } });
    }
    
    const id = uuidv4();
    const criteriaJson = criteria ? JSON.stringify(criteria) : null;
    
    await pool.execute(
      `INSERT INTO evaluations (id, student_id, case_id, score, summary, criteria, persona, hints, helpful, liked, improve, chat_model, super_model, transcript, allow_rechat) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE)`,
      [id, student_id, case_id || null, score, summary || null, criteriaJson, persona || null, 
       hints || 0, helpful || null, liked || null, improve || null, 
       chat_model || null, super_model || null, transcript || null]
    );
    
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

// PATCH /api/evaluations/:id/allow-rechat - Toggle allow_rechat status (admin only)
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
