import express from 'express';
import { pool } from '../db.js';
import { verifyToken, requireRole } from '../middleware/auth.js';
import {
  requireAdminOrInstructor,
  requireCourseAccess,
  getAccessibleCourseIds
} from '../middleware/instructorAccess.js';
import { writeAudit } from '../services/auditLog.js';
import { courseCodeError } from '../../utils/academicIds.js';
import { createCourseSection, previewSection, ProvisioningError } from '../services/sectionProvisioning.js';
import { detachMismatchedLinks } from '../services/caseVersionSync.js';

const router = express.Router();

// COURSES SPAN SEMESTERS (migration 077). A course is one row keyed by course_code
// ('gscm410'); "the course in a semester" is its sections with that sections.semester_id.
// courses.semester_id is deprecated and must not be read. courses.primary_instructor_id is
// the course OWNER.

const COURSE_COLUMNS_SQL = `
  c.id, c.course_code, c.course_name, c.description,
  c.primary_instructor_id, c.created_at,
  i.full_name AS primary_instructor_name`;

function effectiveInstructorId(req) {
  if (req.user.role === 'instructor') return req.user.id;
  if (req.user.role === 'admin' && req.effectiveInstructorId) return req.effectiveInstructorId;
  return null;
}

async function validateOwner(executor, instructorId) {
  if (!instructorId) return null;
  const [inst] = await executor.execute('SELECT id, active FROM instructors WHERE id = ?', [instructorId]);
  if (inst.length === 0) return 'Course owner not found';
  if (!inst[0].active) return 'Course owner is deactivated';
  return null;
}

function sendProvisioningError(res, error, fallbackMessage) {
  if (error instanceof ProvisioningError) {
    return res.status(error.status).json({ data: null, error: { message: error.message } });
  }
  if (error?.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ data: null, error: { message: 'That section already exists. Refresh and try again.' } });
  }
  console.error(fallbackMessage, error);
  return res.status(500).json({ data: null, error: { message: error.message } });
}

// GET /api/courses - All courses (filtered by instructor access), each with a per-semester
// summary of its sections, newest semester first.
router.get('/', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const params = [];
    let where = '';
    const effectiveId = effectiveInstructorId(req);
    if (effectiveId) {
      const accessibleCourseIds = await getAccessibleCourseIds(effectiveId);
      if (accessibleCourseIds.length === 0) {
        return res.json({ data: [], error: null });
      }
      where = `WHERE c.id IN (${accessibleCourseIds.map(() => '?').join(',')})`;
      params.push(...accessibleCourseIds);
    }

    const [courses] = await pool.execute(`
      SELECT ${COURSE_COLUMNS_SQL}
      FROM courses c
      LEFT JOIN instructors i ON c.primary_instructor_id = i.id
      ${where}
      ORDER BY c.course_name ASC
    `, params);

    if (courses.length === 0) {
      return res.json({ data: [], error: null });
    }

    const [terms] = await pool.execute(`
      SELECT s.course_id, sem.id AS semester_id, sem.semester_code, sem.semester_name,
             sem.start_date, COUNT(s.section_id) AS section_count
      FROM sections s
      JOIN semesters sem ON sem.id = s.semester_id
      WHERE s.course_id IN (${courses.map(() => '?').join(',')})
      GROUP BY s.course_id, sem.id, sem.semester_code, sem.semester_name, sem.start_date
      ORDER BY sem.start_date IS NULL, sem.start_date DESC, sem.semester_code ASC
    `, courses.map(c => c.id));

    const byCourse = new Map(courses.map(c => [c.id, { ...c, semesters: [] }]));
    for (const t of terms) {
      byCourse.get(t.course_id)?.semesters.push({
        semester_id: t.semester_id,
        semester_code: t.semester_code,
        semester_name: t.semester_name,
        start_date: t.start_date,
        section_count: Number(t.section_count),
      });
    }

    res.json({ data: [...byCourse.values()], error: null });
  } catch (error) {
    console.error('Error fetching all courses:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// POST /api/courses - Create a course (admin)
router.post('/', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const course_code = typeof req.body.course_code === 'string' ? req.body.course_code.trim().toLowerCase() : '';
    const course_name = typeof req.body.course_name === 'string' ? req.body.course_name.trim() : '';
    const { description, primary_instructor_id } = req.body;

    const codeError = courseCodeError(course_code);
    if (codeError) {
      return res.status(400).json({ data: null, error: { message: codeError } });
    }
    if (!course_name) {
      return res.status(400).json({ data: null, error: { message: 'Course name is required' } });
    }
    const ownerError = await validateOwner(pool, primary_instructor_id);
    if (ownerError) {
      return res.status(400).json({ data: null, error: { message: ownerError } });
    }

    const [existing] = await pool.execute('SELECT id FROM courses WHERE course_code = ?', [course_code]);
    if (existing.length > 0) {
      return res.status(409).json({ data: null, error: { message: `A course with ID "${course_code}" already exists` } });
    }

    const [result] = await pool.execute(
      'INSERT INTO courses (course_code, course_name, description, primary_instructor_id) VALUES (?, ?, ?, ?)',
      [course_code, course_name, description || null, primary_instructor_id || null]
    );

    const [rows] = await pool.execute(
      `SELECT ${COURSE_COLUMNS_SQL} FROM courses c LEFT JOIN instructors i ON c.primary_instructor_id = i.id WHERE c.id = ?`,
      [result.insertId]
    );
    res.status(201).json({ data: { ...rows[0], semesters: [] }, error: null });
  } catch (error) {
    console.error('Error creating course:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/courses/:id - Single course with its sections, newest semester first
router.get('/:id', verifyToken, requireAdminOrInstructor, requireCourseAccess('id'), async (req, res) => {
  try {
    const [courseRows] = await pool.execute(
      `SELECT ${COURSE_COLUMNS_SQL} FROM courses c LEFT JOIN instructors i ON c.primary_instructor_id = i.id WHERE c.id = ?`,
      [req.params.id]
    );
    if (courseRows.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Course not found' } });
    }

    const [sectionRows] = await pool.execute(`
      SELECT
        s.section_id, s.section_number, s.section_title, s.year_term,
        s.semester_id, sem.semester_code, sem.semester_name, sem.start_date AS semester_start_date,
        s.enabled, s.accept_new_students, s.chat_model, s.super_model,
        s.primary_instructor_id, si.full_name AS primary_instructor_name, s.created_at,
        COUNT(DISTINCT ss.student_id) AS student_count,
        COUNT(DISTINCT sc.case_id) AS case_count
      FROM sections s
      LEFT JOIN semesters sem ON sem.id = s.semester_id
      LEFT JOIN instructors si ON si.id = s.primary_instructor_id
      LEFT JOIN student_sections ss ON s.section_id = ss.section_id
      LEFT JOIN section_cases sc ON s.section_id = sc.section_id
      WHERE s.course_id = ?
      GROUP BY s.section_id, s.section_number, s.section_title, s.year_term,
               s.semester_id, sem.semester_code, sem.semester_name, sem.start_date,
               s.enabled, s.accept_new_students, s.chat_model, s.super_model,
               s.primary_instructor_id, si.full_name, s.created_at
      ORDER BY sem.start_date IS NULL, sem.start_date DESC, sem.semester_code,
               s.section_number IS NULL, s.section_number, s.section_id
    `, [req.params.id]);

    res.json({ data: { ...courseRows[0], sections: sectionRows }, error: null });
  } catch (error) {
    console.error('Error fetching course:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/courses/:id/next-section?semester_id= - What "+ Add section" would create
router.get('/:id/next-section', verifyToken, requireAdminOrInstructor, requireCourseAccess('id'), async (req, res) => {
  try {
    const semesterId = Number(req.query.semester_id);
    if (!semesterId) {
      return res.status(400).json({ data: null, error: { message: 'semester_id is required' } });
    }
    const sectionNumber = req.query.section_number ? Number(req.query.section_number) : null;
    const preview = await previewSection(pool, req.params.id, semesterId, sectionNumber);
    res.json({ data: preview, error: null });
  } catch (error) {
    sendProvisioningError(res, error, 'Error previewing section:');
  }
});

// PUT /api/courses/:id - Update course (admin). Changing course_code does NOT rename
// existing sections: their ids are keys referenced by chats and enrolments.
router.put('/:id', verifyToken, requireRole(['admin']), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { id } = req.params;
    const { description, primary_instructor_id, cascade_to_sections } = req.body;
    const course_name = typeof req.body.course_name === 'string' ? req.body.course_name.trim() : undefined;
    const course_code = typeof req.body.course_code === 'string' ? req.body.course_code.trim().toLowerCase() : undefined;

    const [existing] = await connection.execute(
      'SELECT id, course_code, primary_instructor_id FROM courses WHERE id = ?',
      [id]
    );
    if (existing.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Course not found' } });
    }

    // A non-conforming code already in the data stays saveable; only a CHANGED code is validated.
    if (course_code !== undefined && course_code !== existing[0].course_code) {
      const codeError = courseCodeError(course_code);
      if (codeError) {
        return res.status(400).json({ data: null, error: { message: codeError } });
      }
      const [duplicate] = await connection.execute('SELECT id FROM courses WHERE course_code = ? AND id != ?', [course_code, id]);
      if (duplicate.length > 0) {
        return res.status(409).json({ data: null, error: { message: `Another course already uses ID "${course_code}"` } });
      }
    }

    const primaryIdProvided = primary_instructor_id !== undefined;
    if (primaryIdProvided) {
      const ownerError = await validateOwner(connection, primary_instructor_id);
      if (ownerError) {
        return res.status(400).json({ data: null, error: { message: ownerError } });
      }
    }

    await connection.beginTransaction();

    await connection.execute(
      `UPDATE courses SET
         course_code = COALESCE(?, course_code),
         course_name = COALESCE(NULLIF(?, ''), course_name),
         description = ?,
         primary_instructor_id = ${primaryIdProvided ? '?' : 'primary_instructor_id'}
       WHERE id = ?`,
      primaryIdProvided
        ? [course_code ?? null, course_name ?? null, description ?? null, primary_instructor_id || null, id]
        : [course_code ?? null, course_name ?? null, description ?? null, id]
    );

    // Cascade to sections only when caller asks AND we're setting a non-null owner.
    let sectionsCascaded = 0;
    if (primaryIdProvided && primary_instructor_id && cascade_to_sections) {
      const [r] = await connection.execute(
        'UPDATE sections SET primary_instructor_id = ? WHERE course_id = ?',
        [primary_instructor_id, id]
      );
      sectionsCascaded = r.affectedRows || 0;
    }

    await connection.commit();

    if (primaryIdProvided && primary_instructor_id !== existing[0].primary_instructor_id) {
      await writeAudit(req, {
        action: 'course.primary_instructor',
        resourceType: 'course',
        resourceId: String(id),
        details: {
          old: existing[0].primary_instructor_id,
          new: primary_instructor_id || null,
          cascaded_sections: sectionsCascaded
        }
      });
    }

    const [rows] = await connection.execute(
      `SELECT ${COURSE_COLUMNS_SQL} FROM courses c LEFT JOIN instructors i ON c.primary_instructor_id = i.id WHERE c.id = ?`,
      [id]
    );
    res.json({ data: { ...rows[0], cascaded_sections: sectionsCascaded }, error: null });
  } catch (error) {
    try { await connection.rollback(); } catch (_) {}
    console.error('Error updating course:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  } finally {
    connection.release();
  }
});

// DELETE /api/courses/:id - Delete course
// Use ?cascade=true to delete all sections, assignments, and student enrollments
router.delete('/:id', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { cascade } = req.query;

    const [existing] = await pool.execute('SELECT id, course_name FROM courses WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Course not found' } });
    }

    const [sections] = await pool.execute('SELECT section_id FROM sections WHERE course_id = ?', [id]);

    if (sections.length > 0 && cascade !== 'true') {
      // Return info about what would be deleted so UI can show confirmation
      const sectionIds = sections.map(s => s.section_id);
      const placeholders = sectionIds.map(() => '?').join(',');

      const [studentCount] = await pool.execute(
        `SELECT COUNT(DISTINCT student_id) as count FROM student_sections WHERE section_id IN (${placeholders})`,
        sectionIds
      );
      const [assignmentCount] = await pool.execute(
        `SELECT COUNT(*) as count FROM section_cases WHERE section_id IN (${placeholders})`,
        sectionIds
      );

      return res.status(400).json({
        data: {
          sections_count: sections.length,
          students_count: studentCount[0].count,
          assignments_count: assignmentCount[0].count,
          requires_cascade: true
        },
        error: { message: `Course has ${sections.length} section(s) across all semesters. Use cascade delete to remove everything.` }
      });
    }

    if (cascade === 'true' && sections.length > 0) {
      const sectionIds = sections.map(s => s.section_id);
      const placeholders = sectionIds.map(() => '?').join(',');

      await pool.execute(
        `DELETE FROM student_sections WHERE section_id IN (${placeholders})`,
        sectionIds
      );

      const [sectionCases] = await pool.execute(
        `SELECT id FROM section_cases WHERE section_id IN (${placeholders})`,
        sectionIds
      );

      if (sectionCases.length > 0) {
        const scIds = sectionCases.map(sc => sc.id);
        const scPlaceholders = scIds.map(() => '?').join(',');
        await pool.execute(
          `DELETE FROM section_case_scenarios WHERE section_case_id IN (${scPlaceholders})`,
          scIds
        );
        await pool.execute(
          `DELETE FROM section_case_positions WHERE section_case_id IN (${scPlaceholders})`,
          scIds
        );
      }

      await pool.execute(
        `DELETE FROM section_cases WHERE section_id IN (${placeholders})`,
        sectionIds
      );
      await pool.execute(
        `DELETE FROM sections WHERE section_id IN (${placeholders})`,
        sectionIds
      );
    }

    await pool.execute('DELETE FROM courses WHERE id = ?', [id]);

    res.json({
      data: {
        deleted: true,
        course_name: existing[0].course_name,
        sections_deleted: sections.length,
        cascade_used: cascade === 'true'
      },
      error: null
    });
  } catch (error) {
    console.error('Error deleting course:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// POST /api/courses/:id/sections - Add a section of this course in a semester (admin only: course structure).
// Body: { semester_id, section_number?, section_id?, section_title?, chat_model?, super_model?,
//         primary_instructor_id?, enabled?, accept_new_students?, enrollment_key? }
// section_number defaults to the next free number; section_id is minted as
// {semester_code}-{course_code}-{n} unless explicitly overridden.
router.post('/:id/sections', verifyToken, requireRole(['admin']), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const b = req.body || {};
    if (!b.semester_id) {
      return res.status(400).json({ data: null, error: { message: 'Semester is required' } });
    }

    await connection.beginTransaction();
    const created = await createCourseSection(connection, {
      courseId: Number(req.params.id),
      semesterId: Number(b.semester_id),
      sectionNumber: b.section_number,
      sectionId: b.section_id,
      sectionTitle: b.section_title,
      chatModel: b.chat_model,
      superModel: b.super_model,
      primaryInstructorId: b.primary_instructor_id,
      enabled: b.enabled,
      acceptNewStudents: b.accept_new_students,
      enrollmentKey: b.enrollment_key,
    });
    await connection.commit();

    const [rows] = await pool.execute(
      `SELECT section_id, course_id, semester_id, section_number, section_title, year_term, enabled,
              accept_new_students, enrollment_key, chat_model, super_model, primary_instructor_id, created_at
         FROM sections WHERE section_id = ?`,
      [created.section_id]
    );
    res.status(201).json({ data: rows[0], error: null });
  } catch (error) {
    try { await connection.rollback(); } catch (_) {}
    sendProvisioningError(res, error, 'Error adding section to course:');
  } finally {
    connection.release();
  }
});

// DELETE /api/courses/:id/sections/:sectionId - Remove section from course (unassign, not delete; admin only)
router.delete('/:id/sections/:sectionId', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { id, sectionId } = req.params;

    const [course] = await pool.execute('SELECT id FROM courses WHERE id = ?', [id]);
    if (course.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Course not found' } });
    }

    const [section] = await pool.execute(
      'SELECT section_id FROM sections WHERE section_id = ? AND course_id = ?',
      [sectionId, id]
    );
    if (section.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Section not found in this course' } });
    }

    // The section keeps its semester; section_number is per course, so it goes with the course.
    await pool.execute('UPDATE sections SET course_id = NULL, section_number = NULL WHERE section_id = ?', [sectionId]);
    // Its case assignments stay, but can no longer follow this course's versions.
    await detachMismatchedLinks(pool, sectionId);

    res.json({ data: { removed: true, section_id: sectionId }, error: null });
  } catch (error) {
    console.error('Error removing section from course:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PUT /api/courses/:id/sections/:sectionId/assign - Assign existing orphan section to course (admin only).
// Body: { section_number? } -- defaults to the next free number in the section's semester.
router.put('/:id/sections/:sectionId/assign', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { id, sectionId } = req.params;

    const [course] = await pool.execute('SELECT id FROM courses WHERE id = ?', [id]);
    if (course.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Course not found' } });
    }

    const [section] = await pool.execute('SELECT section_id, course_id, semester_id FROM sections WHERE section_id = ?', [sectionId]);
    if (section.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Section not found' } });
    }
    if (section[0].course_id !== null) {
      return res.status(400).json({ data: null, error: { message: 'Section is already assigned to a course' } });
    }

    let sectionNumber = null;
    if (section[0].semester_id != null) {
      const requested = req.body?.section_number != null ? Number(req.body.section_number) : null;
      if (requested != null) {
        const [taken] = await pool.execute(
          'SELECT section_id FROM sections WHERE course_id = ? AND semester_id = ? AND section_number = ?',
          [id, section[0].semester_id, requested]
        );
        if (taken.length > 0) {
          return res.status(409).json({ data: null, error: { message: `Section number ${requested} is already used by ${taken[0].section_id}` } });
        }
        sectionNumber = requested;
      } else {
        const [[row]] = await pool.execute(
          'SELECT COALESCE(MAX(section_number), 0) + 1 AS n FROM sections WHERE course_id = ? AND semester_id = ?',
          [id, section[0].semester_id]
        );
        sectionNumber = Number(row.n);
      }
    }

    // Its existing case assignments stay Customized; link them to the course's versions on the Courses screen.
    await pool.execute('UPDATE sections SET course_id = ?, section_number = ? WHERE section_id = ?', [id, sectionNumber, sectionId]);

    res.json({ data: { assigned: true, section_id: sectionId, course_id: id, section_number: sectionNumber }, error: null });
  } catch (error) {
    console.error('Error assigning section to course:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

export default router;
