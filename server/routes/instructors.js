/**
 * Instructor management routes
 * Handles CRUD for instructors and their assignments to semesters/sections
 */

import express from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db.js';
import { verifyToken, requireRole } from '../middleware/auth.js';
import {
  requireSuperuser,
  requireAdminOrInstructor,
  requireSectionAccess,
  canAccessSection,
  isPrimaryInstructorForSection
} from '../middleware/instructorAccess.js';

const router = express.Router();

// ============================================================
// Instructor CRUD
// ============================================================

/**
 * GET /api/instructors - List all instructors
 * Superusers see all; primary instructors see TAs in their sections
 */
router.get('/', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    let query = `
      SELECT i.id, i.email, i.first_name, i.last_name, i.full_name,
             i.active, i.created_at, i.last_login,
             COUNT(DISTINCT isem.semester_id) as semester_count,
             COUNT(DISTINCT isec.section_id) as section_count
      FROM instructors i
      LEFT JOIN instructor_semesters isem ON i.id = isem.instructor_id
      LEFT JOIN instructor_sections isec ON i.id = isec.instructor_id
    `;

    const params = [];

    // Non-superuser admins and instructors can only see instructors in their accessible sections
    if (!req.user.superuser && req.user.role === 'instructor') {
      // Instructors see only TAs in their courses/sections
      query += `
        WHERE i.id IN (
          SELECT DISTINCT isec2.instructor_id
          FROM instructor_sections isec2
          WHERE isec2.section_id IN (
            SELECT s.section_id
            FROM sections s
            JOIN courses c ON s.course_id = c.id
            JOIN instructor_semesters isem2 ON c.semester_id = isem2.semester_id
            WHERE isem2.instructor_id = ?
          )
        )
        OR i.id = ?
      `;
      params.push(req.user.id, req.user.id);
    }

    query += ' GROUP BY i.id ORDER BY i.full_name ASC';

    const [rows] = await pool.execute(query, params);

    const instructors = rows.map(row => ({
      ...row,
      active: Boolean(row.active)
    }));

    res.json({ data: instructors, error: null });
  } catch (error) {
    console.error('Error fetching instructors:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

/**
 * GET /api/instructors/:id - Get single instructor with assignments
 */
router.get('/:id', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const { id } = req.params;

    // Get instructor
    const [instructorRows] = await pool.execute(
      `SELECT id, email, first_name, last_name, full_name, active, created_at, last_login
       FROM instructors WHERE id = ?`,
      [id]
    );

    if (instructorRows.length === 0) {
      return res.status(404).json({ error: 'Instructor not found' });
    }

    const instructor = {
      ...instructorRows[0],
      active: Boolean(instructorRows[0].active)
    };

    // Get semester assignments
    const [semesterRows] = await pool.execute(`
      SELECT isem.id, isem.semester_id, isem.assigned_at,
             sem.semester_name, sem.is_current
      FROM instructor_semesters isem
      JOIN semesters sem ON isem.semester_id = sem.id
      WHERE isem.instructor_id = ?
      ORDER BY sem.is_current DESC, sem.semester_name DESC
    `, [id]);

    // Get section assignments (TA)
    const [sectionRows] = await pool.execute(`
      SELECT isec.id, isec.section_id, isec.can_manage_students,
             isec.can_manage_cases, isec.can_view_chats, isec.assigned_at,
             s.section_title, c.course_name, sem.semester_name
      FROM instructor_sections isec
      JOIN sections s ON isec.section_id = s.section_id
      LEFT JOIN courses c ON s.course_id = c.id
      LEFT JOIN semesters sem ON c.semester_id = sem.id
      WHERE isec.instructor_id = ?
      ORDER BY sem.is_current DESC, c.course_name ASC, s.section_title ASC
    `, [id]);

    instructor.semesters = semesterRows.map(r => ({
      ...r,
      is_current: Boolean(r.is_current)
    }));

    instructor.sections = sectionRows.map(r => ({
      ...r,
      can_manage_students: Boolean(r.can_manage_students),
      can_manage_cases: Boolean(r.can_manage_cases),
      can_view_chats: Boolean(r.can_view_chats)
    }));

    res.json({ data: instructor, error: null });
  } catch (error) {
    console.error('Error fetching instructor:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

/**
 * POST /api/instructors - Create new instructor (superuser only)
 */
router.post('/', verifyToken, requireRole(['admin']), requireSuperuser, async (req, res) => {
  try {
    const { email, password, first_name, last_name, full_name } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Check if email exists in admins table
    const [existingAdmin] = await pool.execute(
      'SELECT id FROM admins WHERE email = ?',
      [email]
    );
    if (existingAdmin.length > 0) {
      return res.status(409).json({ error: 'An admin with this email already exists' });
    }

    // Check if email exists in instructors table
    const [existingInstructor] = await pool.execute(
      'SELECT id FROM instructors WHERE email = ?',
      [email]
    );
    if (existingInstructor.length > 0) {
      return res.status(409).json({ error: 'An instructor with this email already exists' });
    }

    const id = uuidv4();
    const passwordHash = await bcrypt.hash(password, 10);
    const displayName = full_name || `${first_name || ''} ${last_name || ''}`.trim() || email;

    await pool.execute(
      `INSERT INTO instructors (id, email, password_hash, first_name, last_name, full_name)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, email, passwordHash, first_name || null, last_name || null, displayName]
    );

    res.status(201).json({
      data: {
        id,
        email,
        first_name: first_name || null,
        last_name: last_name || null,
        full_name: displayName,
        active: true
      },
      error: null
    });
  } catch (error) {
    console.error('Error creating instructor:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

/**
 * PATCH /api/instructors/:id - Update instructor
 * Superuser can update any instructor; instructors can update themselves
 */
router.patch('/:id', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const { id } = req.params;
    const { email, password, first_name, last_name, full_name, active } = req.body;

    // Non-superusers can only update themselves
    if (!req.user.superuser && req.user.id !== id) {
      return res.status(403).json({ error: 'You can only update your own profile' });
    }

    // Only superusers can change active status
    if (active !== undefined && !req.user.superuser) {
      return res.status(403).json({ error: 'Only superusers can change active status' });
    }

    const updates = [];
    const values = [];

    if (email !== undefined) {
      // Check for email conflicts
      const [conflicts] = await pool.execute(
        'SELECT id FROM instructors WHERE email = ? AND id != ?',
        [email, id]
      );
      if (conflicts.length > 0) {
        return res.status(409).json({ error: 'Email already in use' });
      }
      const [adminConflicts] = await pool.execute(
        'SELECT id FROM admins WHERE email = ?',
        [email]
      );
      if (adminConflicts.length > 0) {
        return res.status(409).json({ error: 'Email already in use by an admin' });
      }
      updates.push('email = ?');
      values.push(email);
    }

    if (password) {
      const passwordHash = await bcrypt.hash(password, 10);
      updates.push('password_hash = ?');
      values.push(passwordHash);
    }

    if (first_name !== undefined) {
      updates.push('first_name = ?');
      values.push(first_name);
    }

    if (last_name !== undefined) {
      updates.push('last_name = ?');
      values.push(last_name);
    }

    if (full_name !== undefined) {
      updates.push('full_name = ?');
      values.push(full_name);
    }

    if (active !== undefined) {
      updates.push('active = ?');
      values.push(active ? 1 : 0);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(id);
    await pool.execute(
      `UPDATE instructors SET ${updates.join(', ')} WHERE id = ?`,
      values
    );

    // Fetch updated record
    const [rows] = await pool.execute(
      `SELECT id, email, first_name, last_name, full_name, active, created_at, last_login
       FROM instructors WHERE id = ?`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Instructor not found' });
    }

    res.json({
      data: { ...rows[0], active: Boolean(rows[0].active) },
      error: null
    });
  } catch (error) {
    console.error('Error updating instructor:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

/**
 * DELETE /api/instructors/:id - Delete instructor (superuser only)
 */
router.delete('/:id', verifyToken, requireRole(['admin']), requireSuperuser, async (req, res) => {
  try {
    const { id } = req.params;

    // Prevent self-deletion
    if (req.user.id === id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    const [result] = await pool.execute(
      'DELETE FROM instructors WHERE id = ?',
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Instructor not found' });
    }

    res.json({ data: { success: true }, error: null });
  } catch (error) {
    console.error('Error deleting instructor:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// ============================================================
// Semester Assignments (Primary Instructors)
// ============================================================

/**
 * GET /api/instructors/:id/semesters - Get instructor's semester assignments
 */
router.get('/:id/semesters', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await pool.execute(`
      SELECT isem.id, isem.semester_id, isem.assigned_at, isem.assigned_by,
             sem.semester_name, sem.is_current, sem.start_date, sem.end_date
      FROM instructor_semesters isem
      JOIN semesters sem ON isem.semester_id = sem.id
      WHERE isem.instructor_id = ?
      ORDER BY sem.is_current DESC, sem.semester_name DESC
    `, [id]);

    res.json({
      data: rows.map(r => ({ ...r, is_current: Boolean(r.is_current) })),
      error: null
    });
  } catch (error) {
    console.error('Error fetching instructor semesters:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

/**
 * POST /api/instructors/:id/semesters - Assign instructor to semester (superuser only)
 */
router.post('/:id/semesters', verifyToken, requireRole(['admin']), requireSuperuser, async (req, res) => {
  try {
    const { id } = req.params;
    const { semester_id } = req.body;

    if (!semester_id) {
      return res.status(400).json({ error: 'semester_id is required' });
    }

    // Verify instructor exists
    const [instructor] = await pool.execute('SELECT id FROM instructors WHERE id = ?', [id]);
    if (instructor.length === 0) {
      return res.status(404).json({ error: 'Instructor not found' });
    }

    // Verify semester exists
    const [semester] = await pool.execute('SELECT id FROM semesters WHERE id = ?', [semester_id]);
    if (semester.length === 0) {
      return res.status(404).json({ error: 'Semester not found' });
    }

    // Check for existing assignment
    const [existing] = await pool.execute(
      'SELECT id FROM instructor_semesters WHERE instructor_id = ? AND semester_id = ?',
      [id, semester_id]
    );
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Instructor is already assigned to this semester' });
    }

    // Create assignment
    const [result] = await pool.execute(
      `INSERT INTO instructor_semesters (instructor_id, semester_id, assigned_by)
       VALUES (?, ?, ?)`,
      [id, semester_id, req.user.id]
    );

    res.status(201).json({
      data: {
        id: result.insertId,
        instructor_id: id,
        semester_id,
        assigned_by: req.user.id
      },
      error: null
    });
  } catch (error) {
    console.error('Error assigning instructor to semester:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

/**
 * DELETE /api/instructors/:id/semesters/:semesterId - Remove semester assignment (superuser only)
 */
router.delete('/:id/semesters/:semesterId', verifyToken, requireRole(['admin']), requireSuperuser, async (req, res) => {
  try {
    const { id, semesterId } = req.params;

    const [result] = await pool.execute(
      'DELETE FROM instructor_semesters WHERE instructor_id = ? AND semester_id = ?',
      [id, semesterId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    res.json({ data: { success: true }, error: null });
  } catch (error) {
    console.error('Error removing semester assignment:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// ============================================================
// Section Assignments (TAs)
// ============================================================

/**
 * GET /api/instructors/:id/sections - Get instructor's section assignments
 */
router.get('/:id/sections', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await pool.execute(`
      SELECT isec.id, isec.section_id, isec.can_manage_students,
             isec.can_manage_cases, isec.can_view_chats, isec.assigned_at,
             s.section_title, c.course_name, sem.semester_name
      FROM instructor_sections isec
      JOIN sections s ON isec.section_id = s.section_id
      LEFT JOIN courses c ON s.course_id = c.id
      LEFT JOIN semesters sem ON c.semester_id = sem.id
      WHERE isec.instructor_id = ?
      ORDER BY sem.semester_name DESC, c.course_name ASC, s.section_title ASC
    `, [id]);

    res.json({
      data: rows.map(r => ({
        ...r,
        can_manage_students: Boolean(r.can_manage_students),
        can_manage_cases: Boolean(r.can_manage_cases),
        can_view_chats: Boolean(r.can_view_chats)
      })),
      error: null
    });
  } catch (error) {
    console.error('Error fetching instructor sections:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

/**
 * POST /api/instructors/:id/sections - Assign instructor to section as TA
 * Superusers can assign anyone; primary instructors can assign to their sections
 */
router.post('/:id/sections', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const { id } = req.params;
    const { section_id, can_manage_students, can_manage_cases, can_view_chats } = req.body;

    if (!section_id) {
      return res.status(400).json({ error: 'section_id is required' });
    }

    // Check permission to assign to this section
    if (!req.user.superuser && req.user.role !== 'admin') {
      // Instructors can only assign to sections they are primary instructor for
      const isPrimary = await isPrimaryInstructorForSection(req.user.id, section_id);
      if (!isPrimary) {
        return res.status(403).json({ error: 'You can only assign TAs to your own sections' });
      }
    }

    // Verify instructor exists
    const [instructor] = await pool.execute('SELECT id FROM instructors WHERE id = ?', [id]);
    if (instructor.length === 0) {
      return res.status(404).json({ error: 'Instructor not found' });
    }

    // Verify section exists
    const [section] = await pool.execute('SELECT section_id FROM sections WHERE section_id = ?', [section_id]);
    if (section.length === 0) {
      return res.status(404).json({ error: 'Section not found' });
    }

    // Check for existing assignment
    const [existing] = await pool.execute(
      'SELECT id FROM instructor_sections WHERE instructor_id = ? AND section_id = ?',
      [id, section_id]
    );
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Instructor is already assigned to this section' });
    }

    // Create assignment
    const [result] = await pool.execute(
      `INSERT INTO instructor_sections
       (instructor_id, section_id, can_manage_students, can_manage_cases, can_view_chats, assigned_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        id,
        section_id,
        can_manage_students !== false ? 1 : 0,
        can_manage_cases !== false ? 1 : 0,
        can_view_chats !== false ? 1 : 0,
        req.user.id
      ]
    );

    res.status(201).json({
      data: {
        id: result.insertId,
        instructor_id: id,
        section_id,
        can_manage_students: can_manage_students !== false,
        can_manage_cases: can_manage_cases !== false,
        can_view_chats: can_view_chats !== false
      },
      error: null
    });
  } catch (error) {
    console.error('Error assigning instructor to section:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

/**
 * PATCH /api/instructors/:id/sections/:sectionId - Update TA permissions
 */
router.patch('/:id/sections/:sectionId', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const { id, sectionId } = req.params;
    const { can_manage_students, can_manage_cases, can_view_chats } = req.body;

    // Check permission
    if (!req.user.superuser && req.user.role !== 'admin') {
      const isPrimary = await isPrimaryInstructorForSection(req.user.id, sectionId);
      if (!isPrimary) {
        return res.status(403).json({ error: 'You can only modify TAs in your own sections' });
      }
    }

    const updates = [];
    const values = [];

    if (can_manage_students !== undefined) {
      updates.push('can_manage_students = ?');
      values.push(can_manage_students ? 1 : 0);
    }
    if (can_manage_cases !== undefined) {
      updates.push('can_manage_cases = ?');
      values.push(can_manage_cases ? 1 : 0);
    }
    if (can_view_chats !== undefined) {
      updates.push('can_view_chats = ?');
      values.push(can_view_chats ? 1 : 0);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(id, sectionId);
    const [result] = await pool.execute(
      `UPDATE instructor_sections SET ${updates.join(', ')} WHERE instructor_id = ? AND section_id = ?`,
      values
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    // Fetch updated record
    const [rows] = await pool.execute(
      `SELECT id, instructor_id, section_id, can_manage_students, can_manage_cases, can_view_chats
       FROM instructor_sections WHERE instructor_id = ? AND section_id = ?`,
      [id, sectionId]
    );

    res.json({
      data: {
        ...rows[0],
        can_manage_students: Boolean(rows[0].can_manage_students),
        can_manage_cases: Boolean(rows[0].can_manage_cases),
        can_view_chats: Boolean(rows[0].can_view_chats)
      },
      error: null
    });
  } catch (error) {
    console.error('Error updating section assignment:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

/**
 * DELETE /api/instructors/:id/sections/:sectionId - Remove section assignment
 */
router.delete('/:id/sections/:sectionId', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const { id, sectionId } = req.params;

    // Check permission
    if (!req.user.superuser && req.user.role !== 'admin') {
      const isPrimary = await isPrimaryInstructorForSection(req.user.id, sectionId);
      if (!isPrimary) {
        return res.status(403).json({ error: 'You can only remove TAs from your own sections' });
      }
    }

    const [result] = await pool.execute(
      'DELETE FROM instructor_sections WHERE instructor_id = ? AND section_id = ?',
      [id, sectionId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    res.json({ data: { success: true }, error: null });
  } catch (error) {
    console.error('Error removing section assignment:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// ============================================================
// Section-level TA listing (for section management)
// ============================================================

/**
 * GET /api/sections/:sectionId/instructors - Get TAs assigned to a section
 */
router.get('/sections/:sectionId/tas', verifyToken, requireSectionAccess('sectionId'), async (req, res) => {
  try {
    const { sectionId } = req.params;

    const [rows] = await pool.execute(`
      SELECT i.id, i.email, i.first_name, i.last_name, i.full_name,
             isec.can_manage_students, isec.can_manage_cases, isec.can_view_chats,
             isec.assigned_at
      FROM instructors i
      JOIN instructor_sections isec ON i.id = isec.instructor_id
      WHERE isec.section_id = ?
      ORDER BY i.full_name ASC
    `, [sectionId]);

    res.json({
      data: rows.map(r => ({
        ...r,
        can_manage_students: Boolean(r.can_manage_students),
        can_manage_cases: Boolean(r.can_manage_cases),
        can_view_chats: Boolean(r.can_view_chats)
      })),
      error: null
    });
  } catch (error) {
    console.error('Error fetching section TAs:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

export default router;
