import express from 'express';
import { pool } from '../db.js';
import { verifyToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

// GET /api/sections - Get all sections (optionally filter by enabled)
// Includes active case info via LEFT JOIN
router.get('/', async (req, res) => {
  try {
    const { enabled, orderBy } = req.query;
    
    let query = `
      SELECT s.section_id, s.created_at, s.section_title, s.year_term, s.enabled, s.accept_new_students, s.chat_model, s.super_model,
             sc.case_id as active_case_id, c.case_title as active_case_title
      FROM sections s
      LEFT JOIN section_cases sc ON s.section_id = sc.section_id AND sc.active = TRUE
      LEFT JOIN cases c ON sc.case_id = c.case_id
    `;
    const params = [];
    
    if (enabled !== undefined) {
      query += ' WHERE s.enabled = ?';
      params.push(enabled === 'true' ? 1 : 0);
    }
    
    // Default ordering: year_term DESC, section_title ASC
    query += ' ORDER BY s.year_term DESC, s.section_title ASC';
    
    const [rows] = await pool.execute(query, params);
    res.json({ data: rows, error: null });
  } catch (error) {
    console.error('Error fetching sections:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/sections/:id - Get single section with active case info
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT s.section_id, s.created_at, s.section_title, s.year_term, s.enabled, s.accept_new_students, s.chat_model, s.super_model,
              sc.case_id as active_case_id, c.case_title as active_case_title
       FROM sections s
       LEFT JOIN section_cases sc ON s.section_id = sc.section_id AND sc.active = TRUE
       LEFT JOIN cases c ON sc.case_id = c.case_id
       WHERE s.section_id = ?`,
      [req.params.id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Section not found' } });
    }
    
    res.json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error fetching section:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// POST /api/sections - Create new section
router.post('/', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { section_id, section_title, year_term, enabled, accept_new_students, chat_model, super_model } = req.body;
    
    if (!section_id || !section_title) {
      return res.status(400).json({ data: null, error: { message: 'Section ID and title are required' } });
    }
    
    // Check if section_id already exists
    const [existing] = await pool.execute(
      'SELECT section_id FROM sections WHERE section_id = ?',
      [section_id]
    );
    
    if (existing.length > 0) {
      return res.status(409).json({ data: null, error: { message: 'Section ID already exists' } });
    }
    
    await pool.execute(
      'INSERT INTO sections (section_id, section_title, year_term, enabled, accept_new_students, chat_model, super_model) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        section_id,
        section_title,
        year_term || null,
        enabled !== false ? 1 : 0,
        accept_new_students ? 1 : 0,  // Default to locked (0) for new sections
        chat_model || null,
        super_model || null
      ]
    );

    // Return the created section
    const [rows] = await pool.execute(
      'SELECT section_id, created_at, section_title, year_term, enabled, accept_new_students, chat_model, super_model FROM sections WHERE section_id = ?',
      [section_id]
    );
    
    res.status(201).json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error creating section:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PATCH /api/sections/:id - Update section
router.patch('/:id', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    // Build dynamic update query
    const allowedFields = ['section_title', 'year_term', 'enabled', 'accept_new_students', 'chat_model', 'super_model'];
    const setClauses = [];
    const params = [];

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        setClauses.push(`${key} = ?`);
        // Handle boolean for enabled and accept_new_students fields
        if (key === 'enabled' || key === 'accept_new_students') {
          params.push(value ? 1 : 0);
        } else {
          params.push(value === '' ? null : value);
        }
      }
    }
    
    if (setClauses.length === 0) {
      return res.status(400).json({ data: null, error: { message: 'No valid fields to update' } });
    }
    
    params.push(id);
    
    await pool.execute(
      `UPDATE sections SET ${setClauses.join(', ')} WHERE section_id = ?`,
      params
    );
    
    // Return updated section
    const [rows] = await pool.execute(
      'SELECT section_id, created_at, section_title, year_term, enabled, accept_new_students, chat_model, super_model FROM sections WHERE section_id = ?',
      [id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Section not found' } });
    }
    
    res.json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error updating section:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/sections/:id/students - Get all students enrolled in a section
router.get('/:id/students', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;

    // Get students from junction table with student details
    const [rows] = await pool.execute(
      `SELECT s.id, s.full_name, s.first_name, s.last_name, s.email, s.created_at,
              ss.enrolled_at, ss.enrolled_by, ss.is_primary
       FROM student_sections ss
       JOIN students s ON ss.student_id = s.id
       WHERE ss.section_id = ?
       ORDER BY s.full_name ASC`,
      [id]
    );

    res.json({ data: rows, error: null });
  } catch (error) {
    console.error('Error fetching section students:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// DELETE /api/sections/:id - Delete section
router.delete('/:id', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if section exists
    const [existing] = await pool.execute(
      'SELECT section_id FROM sections WHERE section_id = ?',
      [id]
    );
    
    if (existing.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Section not found' } });
    }
    
    // Delete the section (students with this section_id will have their section_id set to NULL due to FK constraint)
    await pool.execute('DELETE FROM sections WHERE section_id = ?', [id]);
    
    res.json({ data: { deleted: true }, error: null });
  } catch (error) {
    console.error('Error deleting section:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

export default router;
