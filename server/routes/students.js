import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';

const router = express.Router();

// All routes require admin authentication and 'students' permission (available to all admins)
router.use(verifyToken);
router.use(requireRole(['admin']));
router.use(requirePermission('students'));

// GET /api/students - Get all students (optionally filter by section_id)
router.get('/', async (req, res) => {
  try {
    const { section_id } = req.query;

    let query = 'SELECT id, created_at, first_name, last_name, full_name, email, favorite_persona, section_id, finished_at FROM students';
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
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, created_at, first_name, last_name, full_name, email, favorite_persona, section_id, finished_at FROM students WHERE id = ?',
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
router.post('/', async (req, res) => {
  try {
    const { id, first_name, last_name, full_name, email, password, favorite_persona, section_id } = req.body;

    if (!full_name) {
      return res.status(400).json({ data: null, error: { message: 'Full name is required' } });
    }

    const studentId = id || uuidv4();

    // Check if student already exists
    const [existing] = await pool.execute('SELECT id FROM students WHERE id = ?', [studentId]);
    if (existing.length > 0) {
      return res.status(400).json({ data: null, error: { message: 'Student with this ID already exists' } });
    }

    // Hash password if provided
    let password_hash = null;
    if (password) {
      password_hash = await bcrypt.hash(password, 10);
    }

    await pool.execute(
      'INSERT INTO students (id, first_name, last_name, full_name, email, password_hash, favorite_persona, section_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [studentId, first_name || '', last_name || '', full_name, email, password_hash, favorite_persona || null, section_id || null]
    );

    // Return the created student
    const [rows] = await pool.execute(
      'SELECT id, created_at, first_name, last_name, full_name, email, favorite_persona, section_id, finished_at FROM students WHERE id = ?',
      [studentId]
    );

    res.status(201).json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error creating student:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PATCH /api/students/:id - Update student
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Build dynamic update query
    const allowedFields = ['first_name', 'last_name', 'full_name', 'email', 'favorite_persona', 'section_id', 'finished_at'];
    const setClauses = [];
    const params = [];

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        setClauses.push(`${key} = ?`);
        params.push(value);
      }
    }

    // Handle password separately
    if (updates.password) {
      const password_hash = await bcrypt.hash(updates.password, 10);
      setClauses.push('password_hash = ?');
      params.push(password_hash);
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
      'SELECT id, created_at, first_name, last_name, full_name, email, favorite_persona, section_id, finished_at FROM students WHERE id = ?',
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

// DELETE /api/students/:id - Delete student
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Check if student exists
    const [existing] = await pool.execute('SELECT id FROM students WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Student not found' } });
    }

    // Delete student
    await pool.execute('DELETE FROM students WHERE id = ?', [id]);

    res.json({ data: { success: true }, error: null });
  } catch (error) {
    console.error('Error deleting student:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// POST /api/students/:id/reset-password - Reset student password
router.post('/:id/reset-password', async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ data: null, error: { message: 'Password is required' } });
    }

    // Check if student exists
    const [existing] = await pool.execute('SELECT id FROM students WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Student not found' } });
    }

    const password_hash = await bcrypt.hash(password, 10);
    await pool.execute('UPDATE students SET password_hash = ? WHERE id = ?', [password_hash, id]);

    res.json({ data: { success: true }, error: null });
  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

export default router;

