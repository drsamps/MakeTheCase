import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';

const router = express.Router();

// All routes require authentication
router.use(verifyToken);

// GET /api/students - Get all students (optionally filter by section_id) - Admin only
router.get('/', requireRole(['admin']), requirePermission('students'), async (req, res) => {
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

// GET /api/students/:id - Get single student - Admin only
router.get('/:id', requireRole(['admin']), requirePermission('students'), async (req, res) => {
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

// POST /api/students - Create new student - Admin only
router.post('/', requireRole(['admin']), requirePermission('students'), async (req, res) => {
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

// PATCH /api/students/:id - Update student (Admins can update any student, students can update themselves)
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const isAdmin = req.user.role === 'admin';
    const isSelf = req.user.id === id;

    // Students can only update their own records
    if (!isAdmin && !isSelf) {
      return res.status(403).json({ data: null, error: { message: 'Forbidden' } });
    }

    // Check admin permission if user is admin
    if (isAdmin) {
      const hasPermission = req.user.permissions && req.user.permissions.includes('students');
      if (!hasPermission) {
        return res.status(403).json({ data: null, error: { message: 'Forbidden' } });
      }
    }

    // Define allowed fields based on role
    const allowedFields = isAdmin
      ? ['first_name', 'last_name', 'full_name', 'email', 'favorite_persona', 'section_id', 'finished_at']
      : ['first_name', 'last_name', 'full_name', 'favorite_persona', 'section_id']; // Students can't change email or finished_at

    const setClauses = [];
    const params = [];

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        setClauses.push(`${key} = ?`);
        params.push(value);
      }
    }

    // Handle password separately (admin only)
    if (updates.password) {
      if (!isAdmin) {
        return res.status(403).json({ data: null, error: { message: 'Students cannot change password via this endpoint' } });
      }
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

// DELETE /api/students/:id - Delete student - Admin only
router.delete('/:id', requireRole(['admin']), requirePermission('students'), async (req, res) => {
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

// POST /api/students/:id/reset-password - Reset student password - Admin only
router.post('/:id/reset-password', requireRole(['admin']), requirePermission('students'), async (req, res) => {
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

// ============================================================================
// Multi-Section Enrollment Endpoints
// ============================================================================

// GET /api/students/:id/sections - Get all sections a student is enrolled in - Admin only
router.get('/:id/sections', requireRole(['admin']), requirePermission('students'), async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await pool.execute(
      `SELECT ss.section_id, ss.enrolled_at, ss.enrolled_by, ss.is_primary,
              s.section_title, s.year_term, s.enabled, s.accept_new_students
       FROM student_sections ss
       JOIN sections s ON ss.section_id = s.section_id
       WHERE ss.student_id = ?
       ORDER BY ss.is_primary DESC, ss.enrolled_at DESC`,
      [id]
    );

    res.json({ data: rows, error: null });
  } catch (error) {
    console.error('Error fetching student sections:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// POST /api/students/:id/sections - Enroll student in a section (instructor use) - Admin only
router.post('/:id/sections', requireRole(['admin']), requirePermission('students'), async (req, res) => {
  try {
    const { id } = req.params;
    const { section_id, is_primary } = req.body;

    if (!section_id) {
      return res.status(400).json({ data: null, error: { message: 'section_id is required' } });
    }

    // Check if student exists
    const [student] = await pool.execute('SELECT id FROM students WHERE id = ?', [id]);
    if (student.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Student not found' } });
    }

    // Check if section exists
    const [section] = await pool.execute('SELECT section_id FROM sections WHERE section_id = ?', [section_id]);
    if (section.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Section not found' } });
    }

    // Check if already enrolled
    const [existing] = await pool.execute(
      'SELECT id FROM student_sections WHERE student_id = ? AND section_id = ?',
      [id, section_id]
    );

    if (existing.length > 0) {
      return res.status(409).json({ data: null, error: { message: 'Student already enrolled in this section' } });
    }

    // If setting as primary, unset other primary sections for this student
    if (is_primary) {
      await pool.execute(
        'UPDATE student_sections SET is_primary = 0 WHERE student_id = ?',
        [id]
      );
    }

    // Insert enrollment
    await pool.execute(
      'INSERT INTO student_sections (student_id, section_id, enrolled_by, is_primary) VALUES (?, ?, ?, ?)',
      [id, section_id, 'instructor', is_primary ? 1 : 0]
    );

    // If primary, sync to students.section_id for backward compatibility
    if (is_primary) {
      await pool.execute('UPDATE students SET section_id = ? WHERE id = ?', [section_id, id]);
    }

    // Return the enrollment record
    const [rows] = await pool.execute(
      `SELECT ss.section_id, ss.enrolled_at, ss.enrolled_by, ss.is_primary,
              s.section_title, s.year_term
       FROM student_sections ss
       JOIN sections s ON ss.section_id = s.section_id
       WHERE ss.student_id = ? AND ss.section_id = ?`,
      [id, section_id]
    );

    res.status(201).json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error enrolling student in section:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// DELETE /api/students/:id/sections/:sectionId - Remove student from section - Admin only
router.delete('/:id/sections/:sectionId', requireRole(['admin']), requirePermission('students'), async (req, res) => {
  try {
    const { id, sectionId } = req.params;

    // Check if enrollment exists
    const [existing] = await pool.execute(
      'SELECT id, is_primary FROM student_sections WHERE student_id = ? AND section_id = ?',
      [id, sectionId]
    );

    if (existing.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Enrollment not found' } });
    }

    const wasPrimary = existing[0].is_primary;

    // Delete enrollment
    await pool.execute(
      'DELETE FROM student_sections WHERE student_id = ? AND section_id = ?',
      [id, sectionId]
    );

    // If deleted was primary, set another as primary (if any remain)
    if (wasPrimary) {
      const [remaining] = await pool.execute(
        'SELECT section_id FROM student_sections WHERE student_id = ? ORDER BY enrolled_at ASC LIMIT 1',
        [id]
      );

      if (remaining.length > 0) {
        await pool.execute(
          'UPDATE student_sections SET is_primary = 1 WHERE student_id = ? AND section_id = ?',
          [id, remaining[0].section_id]
        );
        await pool.execute('UPDATE students SET section_id = ? WHERE id = ?', [remaining[0].section_id, id]);
      } else {
        // No sections remain, set section_id to NULL
        await pool.execute('UPDATE students SET section_id = NULL WHERE id = ?', [id]);
      }
    }

    res.json({ data: { success: true }, error: null });
  } catch (error) {
    console.error('Error removing student from section:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PATCH /api/students/:id/sections/:sectionId - Update enrollment (e.g., set primary) - Admin only
router.patch('/:id/sections/:sectionId', requireRole(['admin']), requirePermission('students'), async (req, res) => {
  try {
    const { id, sectionId } = req.params;
    const { is_primary } = req.body;

    // Check if enrollment exists
    const [existing] = await pool.execute(
      'SELECT id FROM student_sections WHERE student_id = ? AND section_id = ?',
      [id, sectionId]
    );

    if (existing.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Enrollment not found' } });
    }

    if (is_primary !== undefined) {
      if (is_primary) {
        // Unset other primary sections
        await pool.execute(
          'UPDATE student_sections SET is_primary = 0 WHERE student_id = ?',
          [id]
        );
      }

      await pool.execute(
        'UPDATE student_sections SET is_primary = ? WHERE student_id = ? AND section_id = ?',
        [is_primary ? 1 : 0, id, sectionId]
      );

      // Sync to students.section_id
      if (is_primary) {
        await pool.execute('UPDATE students SET section_id = ? WHERE id = ?', [sectionId, id]);
      }
    }

    // Return updated enrollment
    const [rows] = await pool.execute(
      `SELECT ss.section_id, ss.enrolled_at, ss.enrolled_by, ss.is_primary,
              s.section_title, s.year_term
       FROM student_sections ss
       JOIN sections s ON ss.section_id = s.section_id
       WHERE ss.student_id = ? AND ss.section_id = ?`,
      [id, sectionId]
    );

    res.json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error updating student enrollment:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

export default router;

