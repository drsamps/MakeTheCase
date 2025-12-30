import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db.js';
import { verifyToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

// GET /api/students - Get all students (optionally filter by section_id)
router.get('/', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { section_id } = req.query;
    
    let query = 'SELECT id, created_at, first_name, last_name, full_name, persona, section_id, finished_at FROM students';
    const params = [];
    
    if (section_id) {
      query += ' WHERE section_id = ?';
      params.push(section_id);
    }
    
    query += ' ORDER BY created_at DESC';
    
    const [rows] = await pool.execute(query, params);
    res.json({ data: rows, error: null });
  } catch (error) {
    console.error('Error fetching students:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/students/:id - Get single student
router.get('/:id', verifyToken, requireRole(['admin', 'student']), async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, created_at, first_name, last_name, full_name, persona, section_id, finished_at FROM students WHERE id = ?',
      [req.params.id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Student not found' } });
    }
    
    res.json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error fetching student:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// POST /api/students - Create new student
router.post('/', verifyToken, requireRole(['admin', 'student']), async (req, res) => {
  try {
    const { first_name, last_name, full_name, persona, section_id } = req.body;
    
    if (!first_name || !last_name || !full_name) {
      return res.status(400).json({ data: null, error: { message: 'First name, last name, and full name are required' } });
    }
    
    const id = uuidv4();
    
    await pool.execute(
      'INSERT INTO students (id, first_name, last_name, full_name, persona, section_id) VALUES (?, ?, ?, ?, ?, ?)',
      [id, first_name, last_name, full_name, persona || null, section_id || null]
    );
    
    // Return the created student
    const [rows] = await pool.execute(
      'SELECT id, created_at, first_name, last_name, full_name, persona, section_id, finished_at FROM students WHERE id = ?',
      [id]
    );
    
    res.status(201).json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error creating student:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PATCH /api/students/:id - Update student
router.patch('/:id', verifyToken, requireRole(['admin', 'student']), async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    // Build dynamic update query
    const allowedFields = ['first_name', 'last_name', 'full_name', 'persona', 'section_id', 'finished_at'];
    const setClauses = [];
    const params = [];
    
    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        setClauses.push(`${key} = ?`);
        params.push(value);
      }
    }
    
    if (setClauses.length === 0) {
      return res.status(400).json({ data: null, error: { message: 'No valid fields to update' } });
    }
    
    params.push(id);
    
    await pool.execute(
      `UPDATE students SET ${setClauses.join(', ')} WHERE id = ?`,
      params
    );
    
    // Return updated student
    const [rows] = await pool.execute(
      'SELECT id, created_at, first_name, last_name, full_name, persona, section_id, finished_at FROM students WHERE id = ?',
      [id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Student not found' } });
    }
    
    res.json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error updating student:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

export default router;

