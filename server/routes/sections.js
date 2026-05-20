import express from 'express';
import { pool } from '../db.js';
import { verifyToken, requireRole } from '../middleware/auth.js';
import {
  requireAdminOrInstructor,
  requireSectionAccess,
  requireSectionPermission,
  getAccessibleSectionIds
} from '../middleware/instructorAccess.js';
import { checkSectionReadiness } from '../services/keyResolver.js';

const router = express.Router();

// GET /api/sections/public - Get enabled sections for student login (no auth required)
// Returns minimal info: section_id, section_title, year_term for enabled sections
router.get('/public', async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT s.section_id, s.section_title, s.year_term, s.accept_new_students,
             (s.enrollment_key IS NOT NULL AND s.enrollment_key <> '') AS requires_enrollment_key
      FROM sections s
      WHERE s.enabled = 1
      ORDER BY s.year_term DESC, s.section_title ASC
    `);
    const data = rows.map(r => ({
      ...r,
      requires_enrollment_key: Boolean(r.requires_enrollment_key),
    }));
    res.json({ data, error: null });
  } catch (error) {
    console.error('Error fetching public sections:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/sections - Get all sections (filtered by instructor access)
// Includes student count, total case count, active case count, and course/semester info
router.get('/', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const { enabled } = req.query;

    let query = `
      SELECT s.section_id, s.course_id, s.created_at, s.section_title, s.year_term, s.enabled, s.accept_new_students, s.enrollment_key, s.chat_model, s.super_model,
             s.primary_instructor_id,
             co.course_name, co.id as course_id_num,
             sem.id as semester_id, sem.semester_name, sem.is_current as semester_is_current,
             i.full_name as primary_instructor_name,
             (SELECT COUNT(DISTINCT s2.id)
              FROM students s2
              WHERE s2.section_id = s.section_id
                 OR EXISTS (SELECT 1 FROM student_sections ss WHERE ss.student_id = s2.id AND ss.section_id = s.section_id)
             ) as student_count,
             (SELECT COUNT(*) FROM section_cases sc2 WHERE sc2.section_id = s.section_id) as case_count,
             (SELECT COUNT(*) FROM section_cases sc3 WHERE sc3.section_id = s.section_id AND sc3.active = TRUE) as active_case_count
      FROM sections s
      LEFT JOIN courses co ON s.course_id = co.id
      LEFT JOIN semesters sem ON co.semester_id = sem.id
      LEFT JOIN instructors i ON s.primary_instructor_id = i.id
    `;
    const params = [];
    const whereClauses = [];

    // Filter by instructor access (admin without impersonation sees all).
    const effectiveId = req.user.role === 'instructor'
      ? req.user.id
      : (req.user.role === 'admin' && req.effectiveInstructorId ? req.effectiveInstructorId : null);
    if (effectiveId) {
      const accessibleSectionIds = await getAccessibleSectionIds(effectiveId);
      if (accessibleSectionIds.length === 0) {
        return res.json({ data: [], error: null });
      }
      const placeholders = accessibleSectionIds.map(() => '?').join(',');
      whereClauses.push(`s.section_id IN (${placeholders})`);
      params.push(...accessibleSectionIds);
    }

    if (enabled !== undefined) {
      whereClauses.push('s.enabled = ?');
      params.push(enabled === 'true' ? 1 : 0);
    }

    if (whereClauses.length > 0) {
      query += ' WHERE ' + whereClauses.join(' AND ');
    }

    // Order by semester (current first, then by name), then course, then section
    query += ' ORDER BY sem.is_current DESC, sem.semester_name DESC, co.course_name ASC, s.section_title ASC';

    const [rows] = await pool.execute(query, params);
    res.json({ data: rows, error: null });
  } catch (error) {
    console.error('Error fetching sections:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/sections/orphaned - Get sections not assigned to any course (admin only)
// Note: Must be before /:id route to match correctly
router.get('/orphaned', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT
        s.section_id,
        s.section_title,
        s.year_term,
        s.enabled,
        s.created_at,
        COUNT(DISTINCT ss.student_id) as student_count,
        COUNT(DISTINCT sc.case_id) as case_count
      FROM sections s
      LEFT JOIN student_sections ss ON s.section_id = ss.section_id
      LEFT JOIN section_cases sc ON s.section_id = sc.section_id
      WHERE s.course_id IS NULL
      GROUP BY s.section_id, s.section_title, s.year_term, s.enabled, s.created_at
      ORDER BY s.year_term DESC, s.section_title
    `);

    res.json({ data: rows, error: null });
  } catch (error) {
    console.error('Error fetching orphaned sections:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/sections/:id - Get single section with active case info
router.get('/:id', verifyToken, requireAdminOrInstructor, requireSectionAccess('id'), async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT s.section_id, s.course_id, s.created_at, s.section_title, s.year_term, s.enabled, s.accept_new_students, s.enrollment_key, s.chat_model, s.super_model,
              s.primary_instructor_id,
              co.course_name, co.id as course_id_num,
              i.full_name as primary_instructor_name,
              COUNT(sc.case_id) as active_case_count,
              GROUP_CONCAT(c.case_title ORDER BY c.case_title SEPARATOR ', ') as active_case_titles
       FROM sections s
       LEFT JOIN courses co ON s.course_id = co.id
       LEFT JOIN instructors i ON s.primary_instructor_id = i.id
       LEFT JOIN section_cases sc ON s.section_id = sc.section_id AND sc.active = TRUE
       LEFT JOIN cases c ON sc.case_id = c.case_id
       WHERE s.section_id = ?
       GROUP BY s.section_id, s.course_id, s.created_at, s.section_title, s.year_term, s.enabled, s.accept_new_students, s.enrollment_key, s.chat_model, s.super_model, s.primary_instructor_id, co.course_name, co.id, i.full_name`,
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

// POST /api/sections - Create new section (admin only, instructors use courses/:id/sections)
router.post('/', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { section_id, section_title, year_term, enabled, accept_new_students, enrollment_key, chat_model, super_model, course_id } = req.body;

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

    // If course_id provided, verify it exists
    if (course_id) {
      const [courseExists] = await pool.execute('SELECT id FROM courses WHERE id = ?', [course_id]);
      if (courseExists.length === 0) {
        return res.status(404).json({ data: null, error: { message: 'Course not found' } });
      }
    }

    const trimmedKey = typeof enrollment_key === 'string' ? enrollment_key.trim() : '';
    await pool.execute(
      'INSERT INTO sections (section_id, course_id, section_title, year_term, enabled, accept_new_students, enrollment_key, chat_model, super_model) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        section_id,
        course_id || null,
        section_title,
        year_term || null,
        enabled !== false ? 1 : 0,
        accept_new_students ? 1 : 0,  // Default to locked (0) for new sections
        trimmedKey || null,
        chat_model || null,
        super_model || null
      ]
    );

    // Return the created section
    const [rows] = await pool.execute(
      'SELECT section_id, course_id, created_at, section_title, year_term, enabled, accept_new_students, enrollment_key, chat_model, super_model FROM sections WHERE section_id = ?',
      [section_id]
    );

    res.status(201).json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error creating section:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PATCH /api/sections/:id - Update section
router.patch('/:id', verifyToken, requireAdminOrInstructor, requireSectionAccess('id'), async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Build dynamic update query
    const allowedFields = ['section_title', 'year_term', 'enabled', 'accept_new_students', 'enrollment_key', 'chat_model', 'super_model', 'course_id'];
    // Per permissions matrix: only admins or the primary instructor may edit
    // model fields or reassign the course. TAs with section access can only
    // tune section_title/year_term/enabled/accept_new_students.
    const primaryOrAdminOnly = new Set(['chat_model', 'super_model', 'course_id']);
    const isAdmin = req.user.superuser || req.user.role === 'admin';
    if (!isAdmin && !req.isPrimaryInstructor) {
      for (const key of Object.keys(updates)) {
        if (primaryOrAdminOnly.has(key)) {
          return res.status(403).json({
            data: null,
            error: { message: `Only admins or the primary instructor can edit ${key}` }
          });
        }
      }
    }
    const setClauses = [];
    const params = [];

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        setClauses.push(`${key} = ?`);
        // Handle boolean for enabled and accept_new_students fields
        if (key === 'enabled' || key === 'accept_new_students') {
          params.push(value ? 1 : 0);
        } else if (key === 'course_id') {
          // course_id can be null to unassign from course
          params.push(value === null || value === '' ? null : value);
        } else if (key === 'enrollment_key') {
          const trimmed = typeof value === 'string' ? value.trim() : '';
          params.push(trimmed === '' ? null : trimmed);
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
      'SELECT section_id, course_id, created_at, section_title, year_term, enabled, accept_new_students, enrollment_key, chat_model, super_model FROM sections WHERE section_id = ?',
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

// GET /api/sections/:id/readiness - Is this section ready for students?
// Returns { ready, missing: [providers], instructor_id }. A section is "ready"
// when every required provider (chat_model + super_model vendors) has a key
// resolvable for the section's primary instructor — either an instructor_api_keys
// row or `use_system_key=1`.
router.get('/:id/readiness', verifyToken, requireAdminOrInstructor, requireSectionAccess('id'), async (req, res) => {
  try {
    const result = await checkSectionReadiness(req.params.id);
    res.json({ data: result, error: null });
  } catch (error) {
    console.error('Error checking section readiness:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/sections/readiness - Bulk readiness for accessible sections.
// Same shape as :id/readiness but keyed by section_id. Used by the dashboard
// to render the green/red dot column without N+1 requests.
router.get('/readiness/bulk', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    let ids;
    if (req.user.role === 'admin' && !req.effectiveInstructorId) {
      const [rows] = await pool.execute('SELECT section_id FROM sections');
      ids = rows.map(r => r.section_id);
    } else {
      const effectiveId = req.effectiveInstructorId || req.user.id;
      ids = await getAccessibleSectionIds(effectiveId);
    }
    const out = {};
    for (const sid of ids) {
      try {
        out[sid] = await checkSectionReadiness(sid);
      } catch (_) {
        out[sid] = { ready: false, missing: ['unknown'], instructorId: null };
      }
    }
    res.json({ data: out, error: null });
  } catch (error) {
    console.error('Error bulk checking section readiness:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/sections/:id/students - Get all students enrolled in a section
router.get('/:id/students', verifyToken, requireAdminOrInstructor, requireSectionAccess('id'), async (req, res) => {
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

// DELETE /api/sections/:id - Delete section (admin or primary instructor for the course)
router.delete('/:id', verifyToken, requireAdminOrInstructor, requireSectionAccess('id'), async (req, res) => {
  try {
    const { id } = req.params;

    // Section deletion is admin/primary-only. requireSectionAccess sets
    // req.isPrimaryInstructor for primaries; TAs reach here with that flag
    // unset and must be rejected even when they have can_manage_* TA flags.
    const isAdmin = req.user.superuser || req.user.role === 'admin';
    if (!isAdmin && !req.isPrimaryInstructor) {
      return res.status(403).json({
        data: null,
        error: { message: 'Only admins or the primary instructor can delete a section' }
      });
    }

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
