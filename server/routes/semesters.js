import express from 'express';
import { pool } from '../db.js';
import { verifyToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

// GET /api/semesters - Get all semesters with course and section counts
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT
        sem.id,
        sem.semester_name,
        sem.is_current,
        sem.start_date,
        sem.end_date,
        sem.created_at,
        COUNT(DISTINCT c.id) as course_count,
        COUNT(DISTINCT s.section_id) as section_count
      FROM semesters sem
      LEFT JOIN courses c ON sem.id = c.semester_id
      LEFT JOIN sections s ON c.id = s.course_id
      GROUP BY sem.id, sem.semester_name, sem.is_current, sem.start_date, sem.end_date, sem.created_at
      ORDER BY sem.semester_name DESC
    `);
    res.json({ data: rows, error: null });
  } catch (error) {
    console.error('Error fetching semesters:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/semesters/current - Get current semester with courses
router.get('/current', async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT
        sem.id,
        sem.semester_name,
        sem.is_current,
        sem.start_date,
        sem.end_date,
        sem.created_at
      FROM semesters sem
      WHERE sem.is_current = TRUE
      LIMIT 1
    `);

    if (rows.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'No current semester set' } });
    }

    res.json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error fetching current semester:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/semesters/:id - Get single semester with courses
router.get('/:id', async (req, res) => {
  try {
    const [semesterRows] = await pool.execute(`
      SELECT
        sem.id,
        sem.semester_name,
        sem.is_current,
        sem.start_date,
        sem.end_date,
        sem.created_at
      FROM semesters sem
      WHERE sem.id = ?
    `, [req.params.id]);

    if (semesterRows.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Semester not found' } });
    }

    // Get courses in this semester
    const [courseRows] = await pool.execute(`
      SELECT
        c.id,
        c.course_name,
        c.course_code,
        c.description,
        c.primary_section_id,
        c.sync_scheduling,
        COUNT(s.section_id) as section_count
      FROM courses c
      LEFT JOIN sections s ON c.id = s.course_id
      WHERE c.semester_id = ?
      GROUP BY c.id, c.course_name, c.course_code, c.description, c.primary_section_id, c.sync_scheduling
      ORDER BY c.course_name
    `, [req.params.id]);

    res.json({
      data: {
        ...semesterRows[0],
        courses: courseRows
      },
      error: null
    });
  } catch (error) {
    console.error('Error fetching semester:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// POST /api/semesters - Create new semester
router.post('/', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { semester_name, start_date, end_date, is_current } = req.body;

    if (!semester_name) {
      return res.status(400).json({ data: null, error: { message: 'Semester name is required' } });
    }

    // Check if semester name already exists
    const [existing] = await pool.execute(
      'SELECT id FROM semesters WHERE semester_name = ?',
      [semester_name]
    );

    if (existing.length > 0) {
      return res.status(409).json({ data: null, error: { message: 'Semester with this name already exists' } });
    }

    // If setting as current, clear current flag from other semesters
    if (is_current) {
      await pool.execute('UPDATE semesters SET is_current = FALSE');
    }

    const [result] = await pool.execute(
      'INSERT INTO semesters (semester_name, start_date, end_date, is_current) VALUES (?, ?, ?, ?)',
      [semester_name, start_date || null, end_date || null, is_current ? 1 : 0]
    );

    // Return the created semester
    const [rows] = await pool.execute(
      'SELECT id, semester_name, is_current, start_date, end_date, created_at FROM semesters WHERE id = ?',
      [result.insertId]
    );

    res.status(201).json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error creating semester:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PUT /api/semesters/:id - Update semester
router.put('/:id', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { semester_name, start_date, end_date } = req.body;

    // Check if semester exists
    const [existing] = await pool.execute('SELECT id FROM semesters WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Semester not found' } });
    }

    // Check for duplicate name (excluding current semester)
    if (semester_name) {
      const [duplicate] = await pool.execute(
        'SELECT id FROM semesters WHERE semester_name = ? AND id != ?',
        [semester_name, id]
      );
      if (duplicate.length > 0) {
        return res.status(409).json({ data: null, error: { message: 'Another semester with this name already exists' } });
      }
    }

    await pool.execute(
      'UPDATE semesters SET semester_name = COALESCE(?, semester_name), start_date = ?, end_date = ? WHERE id = ?',
      [semester_name, start_date || null, end_date || null, id]
    );

    // Return updated semester
    const [rows] = await pool.execute(
      'SELECT id, semester_name, is_current, start_date, end_date, created_at FROM semesters WHERE id = ?',
      [id]
    );

    res.json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error updating semester:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PUT /api/semesters/:id/current - Set semester as current
router.put('/:id/current', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;

    // Check if semester exists
    const [existing] = await pool.execute('SELECT id FROM semesters WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Semester not found' } });
    }

    // Clear current flag from all semesters
    await pool.execute('UPDATE semesters SET is_current = FALSE');

    // Set this semester as current
    await pool.execute('UPDATE semesters SET is_current = TRUE WHERE id = ?', [id]);

    // Return updated semester
    const [rows] = await pool.execute(
      'SELECT id, semester_name, is_current, start_date, end_date, created_at FROM semesters WHERE id = ?',
      [id]
    );

    res.json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error setting current semester:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// DELETE /api/semesters/:id - Delete semester
router.delete('/:id', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;

    // Check if semester exists
    const [existing] = await pool.execute('SELECT id, semester_name FROM semesters WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Semester not found' } });
    }

    // Check if semester has courses
    const [courses] = await pool.execute('SELECT id FROM courses WHERE semester_id = ?', [id]);
    if (courses.length > 0) {
      return res.status(400).json({
        data: null,
        error: { message: `Cannot delete semester with ${courses.length} course(s). Delete courses first or move them to another semester.` }
      });
    }

    // Delete the semester
    await pool.execute('DELETE FROM semesters WHERE id = ?', [id]);

    res.json({ data: { deleted: true, semester_name: existing[0].semester_name }, error: null });
  } catch (error) {
    console.error('Error deleting semester:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// POST /api/semesters/:id/clone - Clone semester to new semester
router.post('/:id/clone', verifyToken, requireRole(['admin']), async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const { id } = req.params;
    const {
      new_semester_name,
      clone_case_assignments = true,
      clone_chat_options = true,
      clone_scenarios = true,
      clone_scheduling = false
    } = req.body;

    if (!new_semester_name) {
      return res.status(400).json({ data: null, error: { message: 'New semester name is required' } });
    }

    // Check if source semester exists
    const [sourceSemester] = await connection.execute(
      'SELECT id, semester_name FROM semesters WHERE id = ?',
      [id]
    );
    if (sourceSemester.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Source semester not found' } });
    }

    // Check if new semester name already exists
    const [existingNew] = await connection.execute(
      'SELECT id FROM semesters WHERE semester_name = ?',
      [new_semester_name]
    );
    if (existingNew.length > 0) {
      return res.status(409).json({ data: null, error: { message: 'A semester with this name already exists' } });
    }

    await connection.beginTransaction();

    // 1. Create new semester
    const [newSemesterResult] = await connection.execute(
      'INSERT INTO semesters (semester_name, is_current) VALUES (?, FALSE)',
      [new_semester_name]
    );
    const newSemesterId = newSemesterResult.insertId;

    // 2. Get all courses in source semester
    const [sourceCourses] = await connection.execute(
      'SELECT * FROM courses WHERE semester_id = ?',
      [id]
    );

    const cloneStats = {
      courses_cloned: 0,
      sections_cloned: 0,
      case_assignments_cloned: 0
    };

    // 3. Clone each course
    for (const course of sourceCourses) {
      // Create new course
      const [newCourseResult] = await connection.execute(
        `INSERT INTO courses (semester_id, course_name, course_code, description, sync_scheduling)
         VALUES (?, ?, ?, ?, ?)`,
        [newSemesterId, course.course_name, course.course_code, course.description, course.sync_scheduling]
      );
      const newCourseId = newCourseResult.insertId;
      cloneStats.courses_cloned++;

      // 4. Get sections for this course
      const [sourceSections] = await connection.execute(
        'SELECT * FROM sections WHERE course_id = ?',
        [course.id]
      );

      const sectionIdMap = {}; // old_section_id -> new_section_id
      let newPrimarySectionId = null;

      // 5. Clone each section
      for (const section of sourceSections) {
        // Generate new section_id by replacing year_term reference
        // e.g., "MBA620-F25-001" -> "MBA620-W26-001" (simplified: append "-clone" for now)
        const newSectionId = generateNewSectionId(section.section_id, new_semester_name);
        sectionIdMap[section.section_id] = newSectionId;

        // Create new section (without students)
        await connection.execute(
          `INSERT INTO sections (section_id, course_id, section_title, year_term, enabled, accept_new_students, chat_model, super_model)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
          [
            newSectionId,
            newCourseId,
            section.section_title,
            new_semester_name, // Use new semester name as year_term
            section.enabled,
            section.chat_model,
            section.super_model
          ]
        );
        cloneStats.sections_cloned++;

        // Track primary section
        if (section.section_id === course.primary_section_id) {
          newPrimarySectionId = newSectionId;
        }

        // 6. Clone case assignments if requested
        if (clone_case_assignments) {
          const [sectionCases] = await connection.execute(
            'SELECT * FROM section_cases WHERE section_id = ?',
            [section.section_id]
          );

          for (const sc of sectionCases) {
            // Insert new section_case
            const [scResult] = await connection.execute(
              `INSERT INTO section_cases (section_id, case_id, active, chat_options, selection_mode, require_order, use_scenarios
                ${clone_scheduling ? ', open_date, close_date, manual_status' : ''})
               VALUES (?, ?, ?, ?, ?, ?, ?
                ${clone_scheduling ? ', ?, ?, ?' : ''})`,
              [
                newSectionId,
                sc.case_id,
                0, // Start inactive in new semester
                clone_chat_options ? sc.chat_options : null,
                sc.selection_mode,
                sc.require_order,
                sc.use_scenarios,
                ...(clone_scheduling ? [sc.open_date, sc.close_date, sc.manual_status] : [])
              ]
            );
            cloneStats.case_assignments_cloned++;

            // Clone scenarios if requested
            if (clone_scenarios && sc.use_scenarios) {
              const newSectionCaseId = scResult.insertId;

              // Copy section_case_scenarios
              await connection.execute(
                `INSERT INTO section_case_scenarios (section_case_id, scenario_id, enabled, sort_order)
                 SELECT ?, scenario_id, enabled, sort_order
                 FROM section_case_scenarios
                 WHERE section_case_id = ?`,
                [newSectionCaseId, sc.id]
              );

              // Copy section_case_positions if they exist
              const [positions] = await connection.execute(
                'SELECT * FROM section_case_positions WHERE section_case_id = ?',
                [sc.id]
              );
              for (const pos of positions) {
                await connection.execute(
                  `INSERT INTO section_case_positions (section_case_id, position_id, enabled, sort_order)
                   VALUES (?, ?, ?, ?)`,
                  [newSectionCaseId, pos.position_id, pos.enabled, pos.sort_order]
                );
              }
            }
          }
        }
      }

      // Update primary_section_id for the new course
      if (newPrimarySectionId) {
        await connection.execute(
          'UPDATE courses SET primary_section_id = ? WHERE id = ?',
          [newPrimarySectionId, newCourseId]
        );
      }
    }

    await connection.commit();

    // Fetch the created semester
    const [newSemester] = await connection.execute(
      'SELECT id, semester_name, is_current, start_date, end_date, created_at FROM semesters WHERE id = ?',
      [newSemesterId]
    );

    res.status(201).json({
      data: {
        semester: newSemester[0],
        stats: cloneStats
      },
      error: null
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error cloning semester:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  } finally {
    connection.release();
  }
});

// Helper function to generate new section ID for cloned semester
function generateNewSectionId(oldSectionId, newSemesterName) {
  // Try to parse semester indicators from old ID and replace
  // Common patterns: F25 (Fall 2025), W26 (Winter 2026), SP25 (Spring 2025), SU25 (Summer 2025)

  // Extract semester code from new semester name
  const semesterMatch = newSemesterName.match(/^(Fall|Winter|Spring|Summer)\s+(\d{4})$/i);
  if (semesterMatch) {
    const [, season, year] = semesterMatch;
    const shortYear = year.slice(-2);
    const seasonCode = {
      'fall': 'F',
      'winter': 'W',
      'spring': 'SP',
      'summer': 'SU'
    }[season.toLowerCase()];
    const newCode = `${seasonCode}${shortYear}`;

    // Try to replace old semester code in section ID
    const replaced = oldSectionId.replace(/[FW](?:SP|SU)?\d{2}/i, newCode);
    if (replaced !== oldSectionId) {
      return replaced;
    }
  }

  // Fallback: append new semester indicator
  const cleanName = newSemesterName.replace(/\s+/g, '').slice(0, 6);
  return `${oldSectionId}-${cleanName}`;
}

// GET /api/semesters/:semesterId/courses - Get all courses in a semester
router.get('/:semesterId/courses', async (req, res) => {
  try {
    const { semesterId } = req.params;

    const [rows] = await pool.execute(`
      SELECT
        c.id,
        c.semester_id,
        c.course_name,
        c.course_code,
        c.description,
        c.primary_section_id,
        c.sync_scheduling,
        c.created_at,
        ps.section_title as primary_section_title,
        COUNT(s.section_id) as section_count
      FROM courses c
      LEFT JOIN sections s ON c.id = s.course_id
      LEFT JOIN sections ps ON c.primary_section_id = ps.section_id
      WHERE c.semester_id = ?
      GROUP BY c.id, c.semester_id, c.course_name, c.course_code, c.description,
               c.primary_section_id, c.sync_scheduling, c.created_at, ps.section_title
      ORDER BY c.course_name
    `, [semesterId]);

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

// POST /api/semesters/:semesterId/courses - Create new course in semester
router.post('/:semesterId/courses', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { semesterId } = req.params;
    const { course_name, course_code, description, sync_scheduling } = req.body;

    if (!course_name) {
      return res.status(400).json({ data: null, error: { message: 'Course name is required' } });
    }

    // Check semester exists
    const [semester] = await pool.execute('SELECT id FROM semesters WHERE id = ?', [semesterId]);
    if (semester.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Semester not found' } });
    }

    // Check for duplicate course name in semester
    const [existing] = await pool.execute(
      'SELECT id FROM courses WHERE semester_id = ? AND course_name = ?',
      [semesterId, course_name]
    );
    if (existing.length > 0) {
      return res.status(409).json({ data: null, error: { message: 'A course with this name already exists in this semester' } });
    }

    const [result] = await pool.execute(
      'INSERT INTO courses (semester_id, course_name, course_code, description, sync_scheduling) VALUES (?, ?, ?, ?, ?)',
      [semesterId, course_name, course_code || null, description || null, sync_scheduling ? 1 : 0]
    );

    // Return created course
    const [rows] = await pool.execute(
      'SELECT id, semester_id, course_name, course_code, description, primary_section_id, sync_scheduling, created_at FROM courses WHERE id = ?',
      [result.insertId]
    );

    res.status(201).json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error creating course:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

export default router;
