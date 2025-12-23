import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db.js';

const router = express.Router();

// GET /api/evaluations - Get all evaluations (optionally filter by student_id)
router.get('/', async (req, res) => {
  try {
    const { student_id, student_ids } = req.query;
    
    let query = `SELECT id, created_at, student_id, score, summary, criteria, persona, 
                 hints, helpful, liked, improve, chat_model, super_model, transcript 
                 FROM evaluations`;
    const params = [];
    
    if (student_id) {
      query += ' WHERE student_id = ?';
      params.push(student_id);
    } else if (student_ids) {
      // Support comma-separated list of student IDs
      const ids = student_ids.split(',');
      const placeholders = ids.map(() => '?').join(',');
      query += ` WHERE student_id IN (${placeholders})`;
      params.push(...ids);
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

// GET /api/evaluations/:id - Get single evaluation
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, created_at, student_id, score, summary, criteria, persona, 
       hints, helpful, liked, improve, chat_model, super_model, transcript 
       FROM evaluations WHERE id = ?`,
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
      student_id, score, summary, criteria, persona, 
      hints, helpful, liked, improve, chat_model, super_model, transcript 
    } = req.body;
    
    if (!student_id || score === undefined) {
      return res.status(400).json({ data: null, error: { message: 'Student ID and score are required' } });
    }
    
    const id = uuidv4();
    const criteriaJson = criteria ? JSON.stringify(criteria) : null;
    
    await pool.execute(
      `INSERT INTO evaluations (id, student_id, score, summary, criteria, persona, hints, helpful, liked, improve, chat_model, super_model, transcript) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, student_id, score, summary || null, criteriaJson, persona || null, 
       hints || 0, helpful || null, liked || null, improve || null, 
       chat_model || null, super_model || null, transcript || null]
    );
    
    // Return the created evaluation
    const [rows] = await pool.execute(
      `SELECT id, created_at, student_id, score, summary, criteria, persona, 
       hints, helpful, liked, improve, chat_model, super_model, transcript 
       FROM evaluations WHERE id = ?`,
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

export default router;

