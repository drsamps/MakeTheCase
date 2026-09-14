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
import { createCourseSection, ProvisioningError } from '../services/sectionProvisioning.js';
import { detachMismatchedLinks } from '../services/caseVersionSync.js';

// Sections are listed newest semester first by semesters.start_date -- never by year_term,
// which is display text ("Fall 2026" sorts before "Winter 2026").
const SECTION_ORDER_SQL = 'sem.start_date IS NULL, sem.start_date DESC, sem.semester_code, co.course_name, s.section_number IS NULL, s.section_number, s.section_title';

const router = express.Router();

// GET /api/sections/public - Get enabled sections for student login (no auth required)
// Returns minimal info: section_id, section_title, year_term for enabled sections
router.get('/public', async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT s.section_id, s.section_title, s.year_term, s.accept_new_students,
             (s.enrollment_key IS NOT NULL AND s.enrollment_key <> '') AS requires_enrollment_key
      FROM sections s
      LEFT JOIN courses co ON s.course_id = co.id
      LEFT JOIN semesters sem ON s.semester_id = sem.id
      WHERE s.enabled = 1
      ORDER BY ${SECTION_ORDER_SQL}
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
             s.primary_instructor_id, s.section_number,
             co.course_name, co.course_code, co.id as course_id_num,
             sem.id as semester_id, sem.semester_code, sem.semester_name, sem.start_date as semester_start_date,
             (sem.id <=> (SELECT current_semester_id FROM system_state WHERE id = 1)) as semester_is_current,
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
      LEFT JOIN semesters sem ON s.semester_id = sem.id
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

    query += ` ORDER BY ${SECTION_ORDER_SQL}`;

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
        s.semester_id,
        sem.semester_code,
        s.enabled,
        s.created_at,
        COUNT(DISTINCT ss.student_id) as student_count,
        COUNT(DISTINCT sc.case_id) as case_count
      FROM sections s
      LEFT JOIN semesters sem ON s.semester_id = sem.id
      LEFT JOIN student_sections ss ON s.section_id = ss.section_id
      LEFT JOIN section_cases sc ON s.section_id = sc.section_id
      WHERE s.course_id IS NULL
      GROUP BY s.section_id, s.section_title, s.year_term, s.semester_id, sem.semester_code, sem.start_date, s.enabled, s.created_at
      ORDER BY sem.start_date IS NULL, sem.start_date DESC, s.section_title
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
              s.primary_instructor_id, s.semester_id, s.section_number,
              co.course_name, co.course_code, co.id as course_id_num,
              sem.semester_code, sem.semester_name,
              i.full_name as primary_instructor_name,
              COUNT(sc.case_id) as active_case_count,
              GROUP_CONCAT(c.case_title ORDER BY c.case_title SEPARATOR ', ') as active_case_titles
       FROM sections s
       LEFT JOIN courses co ON s.course_id = co.id
       LEFT JOIN semesters sem ON s.semester_id = sem.id
       LEFT JOIN instructors i ON s.primary_instructor_id = i.id
       LEFT JOIN section_cases sc ON s.section_id = sc.section_id AND sc.active = TRUE
       LEFT JOIN cases c ON sc.case_id = c.case_id
       WHERE s.section_id = ?
       GROUP BY s.section_id, s.course_id, s.created_at, s.section_title, s.year_term, s.enabled, s.accept_new_students, s.enrollment_key, s.chat_model, s.super_model, s.primary_instructor_id, s.semester_id, s.section_number, co.course_name, co.course_code, co.id, sem.semester_code, sem.semester_name, i.full_name`,
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

const SECTION_RETURN_SQL = `SELECT section_id, course_id, semester_id, section_number, created_at, section_title, year_term,
       enabled, accept_new_students, enrollment_key, chat_model, super_model, primary_instructor_id
  FROM sections WHERE section_id = ?`;

// POST /api/sections - Create new section (admin only; course owners use POST /api/courses/:id/sections)
// With course_id: delegates to createCourseSection (minted id, next section number, default title).
// Without course_id: an unassigned section needs an explicit section_id and title.
router.post('/', verifyToken, requireRole(['admin']), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const {
      section_id, section_title, section_number, semester_id, enabled, accept_new_students,
      enrollment_key, chat_model, super_model, course_id, primary_instructor_id
    } = req.body;

    if (!semester_id) {
      return res.status(400).json({ data: null, error: { message: 'Semester is required' } });
    }

    let createdId;
    await connection.beginTransaction();
    if (course_id) {
      const created = await createCourseSection(connection, {
        courseId: Number(course_id),
        semesterId: Number(semester_id),
        sectionNumber: section_number,
        sectionId: section_id,
        sectionTitle: section_title,
        chatModel: chat_model,
        superModel: super_model,
        primaryInstructorId: primary_instructor_id,
        enabled,
        acceptNewStudents: accept_new_students,
        enrollmentKey: enrollment_key,
      });
      createdId = created.section_id;
    } else {
      if (!section_id || !section_title) {
        throw new ProvisioningError(400, 'A section without a course needs a Section ID and title');
      }
      const [semester] = await connection.execute('SELECT semester_name FROM semesters WHERE id = ?', [semester_id]);
      if (semester.length === 0) throw new ProvisioningError(404, 'Semester not found');
      const [existing] = await connection.execute('SELECT section_id FROM sections WHERE section_id = ?', [section_id]);
      if (existing.length > 0) throw new ProvisioningError(409, 'Section ID already exists');

      const trimmedKey = typeof enrollment_key === 'string' ? enrollment_key.trim() : '';
      await connection.execute(
        `INSERT INTO sections (section_id, semester_id, section_title, year_term, enabled, accept_new_students,
                               enrollment_key, chat_model, super_model, primary_instructor_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          section_id,
          semester_id,
          section_title,
          semester[0].semester_name,
          enabled !== false ? 1 : 0,
          accept_new_students ? 1 : 0,  // Default to locked (0) for new sections
          trimmedKey || null,
          chat_model || null,
          super_model || null,
          primary_instructor_id || null
        ]
      );
      createdId = section_id;
    }
    await connection.commit();

    const [rows] = await pool.execute(SECTION_RETURN_SQL, [createdId]);
    res.status(201).json({ data: rows[0], error: null });
  } catch (error) {
    try { await connection.rollback(); } catch (_) {}
    if (error instanceof ProvisioningError) {
      return res.status(error.status).json({ data: null, error: { message: error.message } });
    }
    console.error('Error creating section:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  } finally {
    connection.release();
  }
});

// PATCH /api/sections/:id - Update section
router.patch('/:id', verifyToken, requireAdminOrInstructor, requireSectionAccess('id'), async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Build dynamic update query
    // section_id is never editable: it is a key referenced by chats, enrolments and usage.
    // year_term is derived from semester_id below, so a client value is ignored.
    const allowedFields = ['section_title', 'enabled', 'accept_new_students', 'enrollment_key', 'chat_model', 'super_model', 'course_id', 'semester_id', 'section_number'];
    // Per permissions matrix: moving a section (course, semester, number) is course structure
    // and admin-only. Model fields are admin or primary instructor. TAs with section access can
    // only tune section_title/enabled/accept_new_students/enrollment_key.
    const adminOnly = new Set(['course_id', 'semester_id', 'section_number']);
    const primaryOrAdminOnly = new Set(['chat_model', 'super_model']);
    const isAdmin = req.user.superuser || req.user.role === 'admin';
    if (!isAdmin) {
      for (const key of Object.keys(updates)) {
        if (adminOnly.has(key)) {
          return res.status(403).json({
            data: null,
            error: { message: `Only admins can edit ${key}` }
          });
        }
        if (primaryOrAdminOnly.has(key) && !req.isPrimaryInstructor) {
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
        } else if (key === 'course_id' || key === 'semester_id' || key === 'section_number') {
          // course_id can be null to unassign from course
          params.push(value === null || value === '' ? null : Number(value));
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

    // A section number only means something within a course.
    if ('course_id' in updates && (updates.course_id === null || updates.course_id === '') && !('section_number' in updates)) {
      setClauses.push('section_number = NULL');
    }

    params.push(id);

    await pool.execute(
      `UPDATE sections SET ${setClauses.join(', ')} WHERE section_id = ?`,
      params
    );

    if ('semester_id' in updates) {
      await pool.execute(
        `UPDATE sections s LEFT JOIN semesters sem ON sem.id = s.semester_id
            SET s.year_term = sem.semester_name
          WHERE s.section_id = ?`,
        [id]
      );
    }
    if ('semester_id' in updates || 'course_id' in updates) {
      // Another course's versions, or another semester's copy, can no longer be followed.
      await detachMismatchedLinks(pool, id);
    }

    // Return updated section
    const [rows] = await pool.execute(SECTION_RETURN_SQL, [id]);

    if (rows.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Section not found' } });
    }

    res.json({ data: rows[0], error: null });
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ data: null, error: { message: 'That section number is already used by another section of this course in this semester' } });
    }
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

// DELETE /api/sections/:id - Delete section (admin only: course structure)
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
