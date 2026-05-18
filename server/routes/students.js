import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { verifyToken } from '../middleware/auth.js';
import {
  requireAdminOrInstructor,
  getAccessibleSectionIds,
  isPrimaryInstructorForSection,
  getTAPermissions
} from '../middleware/instructorAccess.js';

const router = express.Router();

router.use(verifyToken);

function callerInstructorId(req) {
  if (req.user?.role === 'instructor') return req.user.id;
  if (req.user?.role === 'admin') return req.effectiveInstructorId || null;
  return null;
}

async function canManageStudentsInSection(req, sectionId) {
  if (req.user.role === 'admin' && !req.effectiveInstructorId) return true;
  const instructorId = callerInstructorId(req);
  if (!instructorId) return false;
  if (await isPrimaryInstructorForSection(instructorId, sectionId)) return true;
  const perms = await getTAPermissions(instructorId, sectionId);
  return Boolean(perms?.canManageStudents);
}

async function studentVisibleToCaller(req, studentId) {
  if (req.user.role === 'admin' && !req.effectiveInstructorId) return true;
  const instructorId = callerInstructorId(req);
  if (!instructorId) return false;
  const accessibleSectionIds = await getAccessibleSectionIds(instructorId);
  if (accessibleSectionIds.length === 0) return false;
  const placeholders = accessibleSectionIds.map(() => '?').join(',');
  const [rows] = await pool.execute(
    `SELECT 1
       FROM students s
       LEFT JOIN student_sections ss ON ss.student_id = s.id
      WHERE s.id = ?
        AND (s.section_id IN (${placeholders}) OR ss.section_id IN (${placeholders}))
      LIMIT 1`,
    [studentId, ...accessibleSectionIds, ...accessibleSectionIds]
  );
  return rows.length > 0;
}

// GET /api/students - List students; scoped to accessible sections for instructors
router.get('/', requireAdminOrInstructor, async (req, res) => {
  try {
    const { section_id } = req.query;
    const isPureAdmin = req.user.role === 'admin' && !req.effectiveInstructorId;

    let accessibleSectionIds = null;
    if (!isPureAdmin) {
      const instructorId = callerInstructorId(req);
      if (!instructorId) {
        return res.status(400).json({ data: null, error: { message: 'admins must impersonate an instructor to view students' } });
      }
      accessibleSectionIds = await getAccessibleSectionIds(instructorId);

      if (section_id && !accessibleSectionIds.includes(section_id)) {
        return res.json({ data: [], error: null });
      }
      if (accessibleSectionIds.length === 0) {
        return res.json({ data: [], error: null });
      }
    }

    let query = `
      SELECT s.id, s.created_at, s.first_name, s.last_name, s.full_name, s.email,
             s.favorite_persona, s.section_id, s.finished_at,
             GROUP_CONCAT(DISTINCT ss.section_id) AS section_ids_csv
      FROM students s
      LEFT JOIN student_sections ss ON ss.student_id = s.id
    `;
    const whereClauses = [];
    const params = [];

    if (section_id) {
      whereClauses.push(`(s.section_id = ?
                          OR EXISTS (SELECT 1 FROM student_sections ss2
                                       WHERE ss2.student_id = s.id AND ss2.section_id = ?))`);
      params.push(section_id, section_id);
    } else if (accessibleSectionIds) {
      const placeholders = accessibleSectionIds.map(() => '?').join(',');
      whereClauses.push(`(s.section_id IN (${placeholders})
                          OR EXISTS (SELECT 1 FROM student_sections ss3
                                       WHERE ss3.student_id = s.id
                                         AND ss3.section_id IN (${placeholders})))`);
      params.push(...accessibleSectionIds, ...accessibleSectionIds);
    }

    if (whereClauses.length > 0) {
      query += ' WHERE ' + whereClauses.join(' AND ');
    }
    query += ' GROUP BY s.id, s.created_at, s.first_name, s.last_name, s.full_name, s.email, s.favorite_persona, s.section_id, s.finished_at';
    query += ' ORDER BY s.created_at DESC';

    const [rows] = await pool.execute(query, params);
    const data = rows.map(r => ({
      id: r.id,
      created_at: r.created_at,
      first_name: r.first_name,
      last_name: r.last_name,
      full_name: r.full_name,
      email: r.email,
      favorite_persona: r.favorite_persona,
      section_id: r.section_id,
      finished_at: r.finished_at,
      section_ids: r.section_ids_csv ? r.section_ids_csv.split(',') : []
    }));
    res.json({ data, error: null });
  } catch (error) {
    console.error('Error fetching students:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/students/:id - Get single student
router.get('/:id', requireAdminOrInstructor, async (req, res) => {
  try {
    if (!(await studentVisibleToCaller(req, req.params.id))) {
      return res.status(403).json({ data: null, error: { message: 'Forbidden' } });
    }
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
router.post('/', requireAdminOrInstructor, async (req, res) => {
  try {
    const { id, first_name, last_name, full_name, email, password, favorite_persona, section_id } = req.body;

    if (!full_name) {
      return res.status(400).json({ data: null, error: { message: 'Full name is required' } });
    }

    const isPureAdmin = req.user.role === 'admin' && !req.effectiveInstructorId;
    if (!isPureAdmin) {
      if (!section_id) {
        return res.status(400).json({ data: null, error: { message: 'section_id is required when creating a student as an instructor' } });
      }
      if (!(await canManageStudentsInSection(req, section_id))) {
        return res.status(403).json({ data: null, error: { message: 'You cannot manage students in this section' } });
      }
    }

    const studentId = id || uuidv4();

    const [existing] = await pool.execute('SELECT id FROM students WHERE id = ?', [studentId]);
    if (existing.length > 0) {
      return res.status(400).json({ data: null, error: { message: 'Student with this ID already exists' } });
    }

    let password_hash = null;
    if (password) {
      password_hash = await bcrypt.hash(password, 10);
    }

    await pool.execute(
      'INSERT INTO students (id, first_name, last_name, full_name, email, password_hash, favorite_persona, section_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [studentId, first_name || '', last_name || '', full_name, email, password_hash, favorite_persona || null, section_id || null]
    );

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

// PATCH /api/students/:id - Admins/instructors can update students they manage; students can update themselves
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const role = req.user.role;
    const isStaff = role === 'admin' || role === 'instructor';
    const isSelf = req.user.id === id;

    if (!isStaff && !isSelf) {
      return res.status(403).json({ data: null, error: { message: 'Forbidden' } });
    }

    if (isStaff && !(await studentVisibleToCaller(req, id))) {
      return res.status(403).json({ data: null, error: { message: 'Forbidden' } });
    }

    const allowedFields = isStaff
      ? ['first_name', 'last_name', 'full_name', 'email', 'favorite_persona', 'section_id', 'finished_at']
      : ['first_name', 'last_name', 'full_name', 'favorite_persona', 'section_id'];

    const setClauses = [];
    const params = [];

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        setClauses.push(`${key} = ?`);
        params.push(value);
      }
    }

    if (updates.password) {
      if (!isStaff) {
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

// DELETE /api/students/:id - Admins/primary-instructors only
router.delete('/:id', requireAdminOrInstructor, async (req, res) => {
  try {
    const { id } = req.params;

    if (!(await studentVisibleToCaller(req, id))) {
      return res.status(403).json({ data: null, error: { message: 'Forbidden' } });
    }

    const isPureAdmin = req.user.role === 'admin' && !req.effectiveInstructorId;
    if (!isPureAdmin) {
      // Instructor must be able to manage at least one section the student is in
      const instructorId = callerInstructorId(req);
      const accessible = await getAccessibleSectionIds(instructorId);
      const placeholders = accessible.map(() => '?').join(',');
      const [studentSections] = await pool.execute(
        `SELECT s.section_id
           FROM students st
           LEFT JOIN student_sections s ON s.student_id = st.id
          WHERE st.id = ?
            AND s.section_id IN (${placeholders || 'NULL'})
          UNION
          SELECT section_id FROM students WHERE id = ? AND section_id IN (${placeholders || 'NULL'})`,
        [id, ...accessible, id, ...accessible]
      );
      let canManage = false;
      for (const row of studentSections) {
        if (await canManageStudentsInSection(req, row.section_id)) {
          canManage = true;
          break;
        }
      }
      if (!canManage) {
        return res.status(403).json({ data: null, error: { message: 'You cannot manage this student' } });
      }
    }

    const [existing] = await pool.execute('SELECT id FROM students WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Student not found' } });
    }

    await pool.execute('DELETE FROM students WHERE id = ?', [id]);

    res.json({ data: { success: true }, error: null });
  } catch (error) {
    console.error('Error deleting student:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// POST /api/students/:id/reset-password
router.post('/:id/reset-password', requireAdminOrInstructor, async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ data: null, error: { message: 'Password is required' } });
    }

    if (!(await studentVisibleToCaller(req, id))) {
      return res.status(403).json({ data: null, error: { message: 'Forbidden' } });
    }

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

// GET /api/students/:id/sections
router.get('/:id/sections', requireAdminOrInstructor, async (req, res) => {
  try {
    const { id } = req.params;

    if (!(await studentVisibleToCaller(req, id))) {
      return res.status(403).json({ data: null, error: { message: 'Forbidden' } });
    }

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

// POST /api/students/:id/sections - Enroll student in a section
router.post('/:id/sections', requireAdminOrInstructor, async (req, res) => {
  try {
    const { id } = req.params;
    const { section_id, is_primary } = req.body;

    if (!section_id) {
      return res.status(400).json({ data: null, error: { message: 'section_id is required' } });
    }

    if (!(await canManageStudentsInSection(req, section_id))) {
      return res.status(403).json({ data: null, error: { message: 'You cannot manage students in this section' } });
    }

    const [student] = await pool.execute('SELECT id FROM students WHERE id = ?', [id]);
    if (student.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Student not found' } });
    }

    const [section] = await pool.execute('SELECT section_id FROM sections WHERE section_id = ?', [section_id]);
    if (section.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Section not found' } });
    }

    const [existing] = await pool.execute(
      'SELECT id FROM student_sections WHERE student_id = ? AND section_id = ?',
      [id, section_id]
    );

    if (existing.length > 0) {
      return res.status(409).json({ data: null, error: { message: 'Student already enrolled in this section' } });
    }

    if (is_primary) {
      await pool.execute(
        'UPDATE student_sections SET is_primary = 0 WHERE student_id = ?',
        [id]
      );
    }

    await pool.execute(
      'INSERT INTO student_sections (student_id, section_id, enrolled_by, is_primary) VALUES (?, ?, ?, ?)',
      [id, section_id, 'instructor', is_primary ? 1 : 0]
    );

    if (is_primary) {
      await pool.execute('UPDATE students SET section_id = ? WHERE id = ?', [section_id, id]);
    }

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

// DELETE /api/students/:id/sections/:sectionId - Remove student from section
router.delete('/:id/sections/:sectionId', requireAdminOrInstructor, async (req, res) => {
  try {
    const { id, sectionId } = req.params;

    if (!(await canManageStudentsInSection(req, sectionId))) {
      return res.status(403).json({ data: null, error: { message: 'You cannot manage students in this section' } });
    }

    const [existing] = await pool.execute(
      'SELECT id, is_primary FROM student_sections WHERE student_id = ? AND section_id = ?',
      [id, sectionId]
    );

    if (existing.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Enrollment not found' } });
    }

    const wasPrimary = existing[0].is_primary;

    await pool.execute(
      'DELETE FROM student_sections WHERE student_id = ? AND section_id = ?',
      [id, sectionId]
    );

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
        await pool.execute('UPDATE students SET section_id = NULL WHERE id = ?', [id]);
      }
    }

    res.json({ data: { success: true }, error: null });
  } catch (error) {
    console.error('Error removing student from section:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PATCH /api/students/:id/sections/:sectionId - Update enrollment (e.g., set primary)
router.patch('/:id/sections/:sectionId', requireAdminOrInstructor, async (req, res) => {
  try {
    const { id, sectionId } = req.params;
    const { is_primary } = req.body;

    if (!(await canManageStudentsInSection(req, sectionId))) {
      return res.status(403).json({ data: null, error: { message: 'You cannot manage students in this section' } });
    }

    const [existing] = await pool.execute(
      'SELECT id FROM student_sections WHERE student_id = ? AND section_id = ?',
      [id, sectionId]
    );

    if (existing.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Enrollment not found' } });
    }

    if (is_primary !== undefined) {
      if (is_primary) {
        await pool.execute(
          'UPDATE student_sections SET is_primary = 0 WHERE student_id = ?',
          [id]
        );
      }

      await pool.execute(
        'UPDATE student_sections SET is_primary = ? WHERE student_id = ? AND section_id = ?',
        [is_primary ? 1 : 0, id, sectionId]
      );

      if (is_primary) {
        await pool.execute('UPDATE students SET section_id = ? WHERE id = ?', [sectionId, id]);
      }
    }

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
