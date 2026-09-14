import express from 'express';
import { pool } from '../db.js';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { requireSuperuser } from '../middleware/instructorAccess.js';
import { writeAudit } from '../services/auditLog.js';
import { semesterCodeError } from '../../utils/academicIds.js';
import { executeRollover, planRollover } from '../services/courseRollover.js';
import { backupBeforeRollover } from '../services/databaseBackup.js';

const router = express.Router();

// Semesters sort by start_date, NEVER by code or name: w26 < sp26 < su26 < f26 in time,
// but alphabetically f26 comes first. Undated semesters ('ongoing') sort last.
export const SEMESTER_ORDER_SQL = 'sem.start_date IS NULL, sem.start_date DESC, sem.semester_code ASC';

// is_current is read from system_state (the authority); semesters.is_current is only a
// mirror kept in step by setCurrentSemester() for older readers.
const SEMESTER_COLUMNS_SQL = `
  sem.id, sem.semester_code, sem.semester_name,
  (sem.id <=> (SELECT current_semester_id FROM system_state WHERE id = 1)) AS is_current,
  sem.start_date, sem.end_date, sem.created_at`;

async function fetchSemester(executor, id) {
  const [rows] = await executor.execute(
    `SELECT ${SEMESTER_COLUMNS_SQL} FROM semesters sem WHERE sem.id = ?`,
    [id]
  );
  return rows[0] ? { ...rows[0], is_current: Boolean(rows[0].is_current) } : null;
}

/**
 * Point system_state at a semester and mirror semesters.is_current, inside the caller's
 * transaction. The ONE writer of the current semester -- create, update and
 * PUT /:id/current all go through it, so the pointer and the flag cannot drift apart
 * (they did: POST used to set only the flag, leaving GET /current answering 404).
 */
async function setCurrentSemester(connection, semesterId, req) {
  await connection.execute(
    'UPDATE system_state SET current_semester_id = ?, updated_by_admin_id = ? WHERE id = 1',
    [semesterId, req.user.role === 'admin' ? req.user.id : null]
  );
  await connection.execute('UPDATE semesters SET is_current = (id = ?)', [semesterId]);
}

function cleanSemesterInput(body) {
  const code = typeof body.semester_code === 'string' ? body.semester_code.trim().toLowerCase() : '';
  const name = typeof body.semester_name === 'string' ? body.semester_name.trim() : '';
  return {
    semester_code: code,
    semester_name: name,
    start_date: body.start_date || null,
    end_date: body.end_date || null,
  };
}

// GET /api/semesters - All semesters with course and section counts, newest first
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT ${SEMESTER_COLUMNS_SQL},
             COUNT(DISTINCT s.course_id) AS course_count,
             COUNT(DISTINCT s.section_id) AS section_count
      FROM semesters sem
      LEFT JOIN sections s ON s.semester_id = sem.id
      GROUP BY sem.id, sem.semester_code, sem.semester_name, sem.start_date, sem.end_date, sem.created_at
      ORDER BY ${SEMESTER_ORDER_SQL}
    `);
    res.json({ data: rows.map(r => ({ ...r, is_current: Boolean(r.is_current) })), error: null });
  } catch (error) {
    console.error('Error fetching semesters:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/semesters/current - The current semester.
// system_state.current_semester_id is the authority; the is_current flag is a fallback
// for a pointer that is NULL (the FK nulls it when its semester is deleted).
router.get('/current', async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT COALESCE(
        (SELECT sem.id FROM semesters sem
          WHERE sem.id = (SELECT current_semester_id FROM system_state WHERE id = 1)),
        (SELECT sem.id FROM semesters sem WHERE sem.is_current = TRUE
          ORDER BY ${SEMESTER_ORDER_SQL} LIMIT 1)
      ) AS id
    `);

    if (rows[0]?.id == null) {
      return res.status(404).json({ data: null, error: { message: 'No current semester set' } });
    }

    res.json({ data: await fetchSemester(pool, rows[0].id), error: null });
  } catch (error) {
    console.error('Error fetching current semester:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/semesters/:id - Single semester with the courses that have sections in it
router.get('/:id', async (req, res) => {
  try {
    const semester = await fetchSemester(pool, req.params.id);
    if (!semester) {
      return res.status(404).json({ data: null, error: { message: 'Semester not found' } });
    }

    const [courseRows] = await pool.execute(`
      SELECT c.id, c.course_code, c.course_name, c.description,
             COUNT(s.section_id) AS section_count
      FROM courses c
      JOIN sections s ON s.course_id = c.id AND s.semester_id = ?
      GROUP BY c.id, c.course_code, c.course_name, c.description
      ORDER BY c.course_name
    `, [req.params.id]);

    res.json({ data: { ...semester, courses: courseRows }, error: null });
  } catch (error) {
    console.error('Error fetching semester:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// POST /api/semesters - Create semester
router.post('/', verifyToken, requireRole(['admin']), requireSuperuser, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const input = cleanSemesterInput(req.body);

    const codeError = semesterCodeError(input.semester_code);
    if (codeError) {
      return res.status(400).json({ data: null, error: { message: codeError } });
    }
    if (!input.semester_name) {
      return res.status(400).json({ data: null, error: { message: 'Semester name is required' } });
    }

    const [existing] = await connection.execute(
      'SELECT semester_code, semester_name FROM semesters WHERE semester_code = ? OR semester_name = ?',
      [input.semester_code, input.semester_name]
    );
    if (existing.length > 0) {
      const clash = existing[0].semester_code === input.semester_code ? `ID "${input.semester_code}"` : `name "${input.semester_name}"`;
      return res.status(409).json({ data: null, error: { message: `A semester with ${clash} already exists` } });
    }

    await connection.beginTransaction();
    const [result] = await connection.execute(
      'INSERT INTO semesters (semester_code, semester_name, start_date, end_date, is_current) VALUES (?, ?, ?, ?, FALSE)',
      [input.semester_code, input.semester_name, input.start_date, input.end_date]
    );
    if (req.body.is_current) {
      await setCurrentSemester(connection, result.insertId, req);
    }
    await connection.commit();

    res.status(201).json({ data: await fetchSemester(pool, result.insertId), error: null });
  } catch (error) {
    try { await connection.rollback(); } catch (_) {}
    console.error('Error creating semester:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  } finally {
    connection.release();
  }
});

// PUT /api/semesters/:id - Update semester. A rename is copied into sections.year_term,
// which student-facing lists still display.
router.put('/:id', verifyToken, requireRole(['admin']), requireSuperuser, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { id } = req.params;
    const input = cleanSemesterInput(req.body);

    const [existing] = await connection.execute('SELECT id, semester_code, semester_name FROM semesters WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Semester not found' } });
    }

    const code = input.semester_code || existing[0].semester_code;
    const name = input.semester_name || existing[0].semester_name;
    if (code !== existing[0].semester_code) {
      const codeError = semesterCodeError(code);
      if (codeError) {
        return res.status(400).json({ data: null, error: { message: codeError } });
      }
    }

    const [duplicate] = await connection.execute(
      'SELECT semester_code FROM semesters WHERE (semester_code = ? OR semester_name = ?) AND id != ?',
      [code, name, id]
    );
    if (duplicate.length > 0) {
      return res.status(409).json({ data: null, error: { message: 'Another semester with this ID or name already exists' } });
    }

    await connection.beginTransaction();
    await connection.execute(
      'UPDATE semesters SET semester_code = ?, semester_name = ?, start_date = ?, end_date = ? WHERE id = ?',
      [code, name, input.start_date, input.end_date, id]
    );
    if (name !== existing[0].semester_name) {
      await connection.execute('UPDATE sections SET year_term = ? WHERE semester_id = ?', [name, id]);
    }
    if (req.body.is_current === true) {
      await setCurrentSemester(connection, Number(id), req);
    }
    await connection.commit();

    res.json({ data: await fetchSemester(pool, id), error: null });
  } catch (error) {
    try { await connection.rollback(); } catch (_) {}
    console.error('Error updating semester:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  } finally {
    connection.release();
  }
});

// PUT /api/semesters/:id/current - Set semester as current.
// CAS-safe: client must send the expected_previous_id it saw when the page
// loaded. If another admin has switched the semester in the meantime, the
// CAS update touches zero rows and we return 409 so the caller can refresh.
router.put('/:id/current', verifyToken, requireRole(['admin']), requireSuperuser, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const newId = Number(req.params.id);
    const expectedPrev = req.body?.expected_previous_id;

    const [existing] = await connection.execute('SELECT id FROM semesters WHERE id = ?', [newId]);
    if (existing.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Semester not found' } });
    }

    await connection.beginTransaction();

    // Read current state under the transaction for the audit trail.
    const [stateRows] = await connection.execute(
      'SELECT current_semester_id FROM system_state WHERE id = 1 FOR UPDATE'
    );
    const currentId = stateRows[0]?.current_semester_id ?? null;

    // CAS guard - only enforced when caller passes the value they saw.
    if (expectedPrev !== undefined && Number(expectedPrev) !== Number(currentId)) {
      await connection.rollback();
      return res.status(409).json({
        data: null,
        error: {
          code: 'CURRENT_SEMESTER_CAS_CONFLICT',
          message: 'Current semester was changed by another admin. Refresh and try again.',
          current_semester_id: currentId
        }
      });
    }

    await setCurrentSemester(connection, newId, req);
    await connection.commit();

    await writeAudit(req, {
      action: 'semester.set_current',
      resourceType: 'semester',
      resourceId: String(newId),
      details: { previous_semester_id: currentId, new_semester_id: newId }
    });

    res.json({ data: await fetchSemester(pool, newId), error: null });
  } catch (error) {
    try { await connection.rollback(); } catch (_) {}
    console.error('Error setting current semester:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  } finally {
    connection.release();
  }
});

// DELETE /api/semesters/:id - Delete an empty, non-current semester
router.delete('/:id', verifyToken, requireRole(['admin']), requireSuperuser, async (req, res) => {
  try {
    const { id } = req.params;

    const semester = await fetchSemester(pool, id);
    if (!semester) {
      return res.status(404).json({ data: null, error: { message: 'Semester not found' } });
    }
    if (semester.is_current) {
      return res.status(400).json({
        data: null,
        error: { message: 'Cannot delete the current semester. Set another semester as current first.' }
      });
    }

    const [[{ n }]] = await pool.execute('SELECT COUNT(*) AS n FROM sections WHERE semester_id = ?', [id]);
    if (n > 0) {
      return res.status(400).json({
        data: null,
        error: { message: `Cannot delete semester with ${n} section(s). Delete or move its sections first.` }
      });
    }

    await pool.execute('DELETE FROM semesters WHERE id = ?', [id]);

    res.json({ data: { deleted: true, semester_name: semester.semester_name }, error: null });
  } catch (error) {
    console.error('Error deleting semester:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// POST /api/semesters/:id/rollover - Roll every course's sections in this semester into another.
// Body: { into: semester_id, course_ids?: number[], section_numbers?: {[legacy_id]: n},
//         copy_tas?: boolean, preview?: boolean, backup_first?: boolean }
// One plan per course (services/courseRollover.js); execute runs all courses in ONE transaction.
// backup_first: on execute only, take a `pre-rollover` database backup before the transaction
// opens; if it fails the rollover is refused.
router.post('/:id/rollover', verifyToken, requireRole(['admin']), async (req, res) => {
  const fromSemesterId = Number(req.params.id);
  const b = req.body || {};
  const toSemesterId = Number(b.into);
  if (!toSemesterId) {
    return res.status(400).json({ data: null, error: { message: 'Choose a semester to roll into.' } });
  }

  const planAll = async (db) => {
    const [courses] = await db.execute(
      `SELECT DISTINCT c.id FROM courses c JOIN sections s ON s.course_id = c.id
        WHERE s.semester_id = ? ORDER BY c.id`,
      [fromSemesterId]
    );
    const wanted = Array.isArray(b.course_ids) && b.course_ids.length > 0 ? new Set(b.course_ids.map(Number)) : null;
    const plans = [];
    for (const { id } of courses) {
      if (wanted && !wanted.has(id)) continue;
      plans.push(await planRollover(db, {
        courseId: id, fromSemesterId, toSemesterId, sectionNumbers: b.section_numbers || {},
      }));
    }
    return plans;
  };

  try {
    if (b.preview !== false) {
      return res.json({ data: { plans: await planAll(pool) }, error: null });
    }
  } catch (error) {
    return res.status(error.status || 500).json({ data: null, error: { message: error.message } });
  }

  let backup = null;
  if (b.backup_first) {
    const outcome = await backupBeforeRollover(req, writeAudit);
    if (!outcome.backup) return res.status(outcome.status).json(outcome.body);
    backup = outcome.backup;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const plans = await planAll(connection);
    const results = [];
    for (const plan of plans) {
      results.push({ course_id: plan.course.id, ...(await executeRollover(connection, plan, { copyTas: Boolean(b.copy_tas), userId: req.user.id })) });
    }
    await connection.commit();
    await writeAudit(req, {
      action: 'semester.rollover',
      resourceType: 'semester',
      resourceId: String(fromSemesterId),
      details: { into: toSemesterId, results, backup: backup?.name ?? null },
    });
    res.json({ data: { results, plans, backup }, error: null });
  } catch (error) {
    try { await connection.rollback(); } catch (_) {}
    console.error('Error rolling semester over:', error);
    const suffix = backup ? ` (A backup was taken first: ${backup.name}.)` : '';
    res.status(error.status || 500).json({ data: null, error: { message: error.message + suffix } });
  } finally {
    connection.release();
  }
});

// GET /api/semesters/:semesterId/courses - Courses with sections in a semester
router.get('/:semesterId/courses', async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT
        c.id,
        c.course_code,
        c.course_name,
        c.description,
        c.primary_instructor_id,
        c.created_at,
        i.full_name AS primary_instructor_name,
        COUNT(s.section_id) AS section_count
      FROM courses c
      JOIN sections s ON s.course_id = c.id AND s.semester_id = ?
      LEFT JOIN instructors i ON c.primary_instructor_id = i.id
      GROUP BY c.id, c.course_code, c.course_name, c.description,
               c.primary_instructor_id, c.created_at, i.full_name
      ORDER BY c.course_name
    `, [req.params.semesterId]);

    res.json({ data: rows, error: null });
  } catch (error) {
    console.error('Error fetching courses:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/semesters/:id/instructors - Get instructors assigned to a semester
router.get('/:id/instructors', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await pool.execute(`
      SELECT
        i.id,
        i.email,
        i.first_name,
        i.last_name,
        i.full_name,
        i.active,
        isem.assigned_at,
        isem.assigned_by
      FROM instructors i
      JOIN instructor_semesters isem ON i.id = isem.instructor_id
      WHERE isem.semester_id = ?
      ORDER BY i.full_name ASC
    `, [id]);

    res.json({
      data: rows.map(r => ({ ...r, active: Boolean(r.active) })),
      error: null
    });
  } catch (error) {
    console.error('Error fetching semester instructors:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

export default router;
