import express from 'express';
import { pool } from '../db.js';
import { verifyToken, requireRole } from '../middleware/auth.js';
import {
  requireAdminOrInstructor,
  requireCourseAccess,
  getAccessibleSemesterIds,
  getAccessibleCourseIds
} from '../middleware/instructorAccess.js';
import { writeAudit } from '../services/auditLog.js';

const router = express.Router();

// Note: GET/POST /api/semesters/:semesterId/courses routes are in semesters.js

// GET /api/courses - Get all courses (filtered by instructor access)
router.get('/', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    let query = `
      SELECT
        c.id,
        c.semester_id,
        c.course_name,
        c.course_code,
        c.description,
        c.primary_section_id,
        c.primary_instructor_id,
        c.sync_scheduling,
        c.created_at,
        sem.semester_name,
        sem.is_current as semester_is_current,
        i.full_name as primary_instructor_name
      FROM courses c
      JOIN semesters sem ON c.semester_id = sem.id
      LEFT JOIN instructors i ON c.primary_instructor_id = i.id
    `;

    const params = [];

    // Filter by instructor access (admin without impersonation sees all).
    const effectiveId = req.user.role === 'instructor'
      ? req.user.id
      : (req.user.role === 'admin' && req.effectiveInstructorId ? req.effectiveInstructorId : null);
    if (effectiveId) {
      const accessibleCourseIds = await getAccessibleCourseIds(effectiveId);
      if (accessibleCourseIds.length === 0) {
        return res.json({ data: [], error: null });
      }
      const placeholders = accessibleCourseIds.map(() => '?').join(',');
      query += ` WHERE c.id IN (${placeholders})`;
      params.push(...accessibleCourseIds);
    }

    query += ' ORDER BY sem.is_current DESC, sem.semester_name DESC, c.course_name ASC';

    const [rows] = await pool.execute(query, params);
    res.json({ data: rows, error: null });
  } catch (error) {
    console.error('Error fetching all courses:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/courses/:id - Get single course with sections
router.get('/:id', verifyToken, requireAdminOrInstructor, requireCourseAccess('id'), async (req, res) => {
  try {
    const [courseRows] = await pool.execute(`
      SELECT
        c.id,
        c.semester_id,
        c.course_name,
        c.course_code,
        c.description,
        c.primary_section_id,
        c.primary_instructor_id,
        c.sync_scheduling,
        c.created_at,
        sem.semester_name,
        i.full_name as primary_instructor_name
      FROM courses c
      JOIN semesters sem ON c.semester_id = sem.id
      LEFT JOIN instructors i ON c.primary_instructor_id = i.id
      WHERE c.id = ?
    `, [req.params.id]);

    if (courseRows.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Course not found' } });
    }

    // Get sections in this course
    const [sectionRows] = await pool.execute(`
      SELECT
        s.section_id,
        s.section_title,
        s.year_term,
        s.enabled,
        s.accept_new_students,
        s.chat_model,
        s.super_model,
        s.created_at,
        (s.section_id = ?) as is_primary,
        COUNT(DISTINCT ss.student_id) as student_count,
        COUNT(DISTINCT sc.case_id) as case_count
      FROM sections s
      LEFT JOIN student_sections ss ON s.section_id = ss.section_id
      LEFT JOIN section_cases sc ON s.section_id = sc.section_id
      WHERE s.course_id = ?
      GROUP BY s.section_id, s.section_title, s.year_term, s.enabled, s.accept_new_students,
               s.chat_model, s.super_model, s.created_at
      ORDER BY s.section_title
    `, [courseRows[0].primary_section_id, req.params.id]);

    res.json({
      data: {
        ...courseRows[0],
        sections: sectionRows
      },
      error: null
    });
  } catch (error) {
    console.error('Error fetching course:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PUT /api/courses/:id - Update course
router.put('/:id', verifyToken, requireRole(['admin']), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { id } = req.params;
    const {
      course_name,
      course_code,
      description,
      sync_scheduling,
      primary_instructor_id,
      cascade_to_sections
    } = req.body;

    // Check course exists
    const [existing] = await connection.execute(
      'SELECT id, semester_id, primary_instructor_id FROM courses WHERE id = ?',
      [id]
    );
    if (existing.length === 0) {
      connection.release();
      return res.status(404).json({ data: null, error: { message: 'Course not found' } });
    }

    // Check for duplicate name in same semester (if name changed)
    if (course_name) {
      const [duplicate] = await connection.execute(
        'SELECT id FROM courses WHERE semester_id = ? AND course_name = ? AND id != ?',
        [existing[0].semester_id, course_name, id]
      );
      if (duplicate.length > 0) {
        connection.release();
        return res.status(409).json({ data: null, error: { message: 'Another course with this name already exists in this semester' } });
      }
    }

    // Validate primary instructor when set
    const primaryIdProvided = primary_instructor_id !== undefined;
    if (primaryIdProvided && primary_instructor_id) {
      const [inst] = await connection.execute(
        'SELECT id, active FROM instructors WHERE id = ?',
        [primary_instructor_id]
      );
      if (inst.length === 0) {
        connection.release();
        return res.status(400).json({ data: null, error: { message: 'Primary instructor not found' } });
      }
      if (!inst[0].active) {
        connection.release();
        return res.status(400).json({ data: null, error: { message: 'Primary instructor is deactivated' } });
      }
    }

    await connection.beginTransaction();

    await connection.execute(
      `UPDATE courses SET
        course_name = COALESCE(?, course_name),
        course_code = ?,
        description = ?,
        sync_scheduling = COALESCE(?, sync_scheduling),
        primary_instructor_id = ${primaryIdProvided ? '?' : 'primary_instructor_id'}
       WHERE id = ?`,
      primaryIdProvided
        ? [course_name, course_code, description, sync_scheduling !== undefined ? (sync_scheduling ? 1 : 0) : null, primary_instructor_id || null, id]
        : [course_name, course_code, description, sync_scheduling !== undefined ? (sync_scheduling ? 1 : 0) : null, id]
    );

    // Cascade to sections only when caller asks AND we're setting a non-null instructor.
    let sectionsCascaded = 0;
    if (primaryIdProvided && primary_instructor_id && cascade_to_sections) {
      const [r] = await connection.execute(
        'UPDATE sections SET primary_instructor_id = ? WHERE course_id = ?',
        [primary_instructor_id, id]
      );
      sectionsCascaded = r.affectedRows || 0;
    }

    await connection.commit();

    // Audit the primary-instructor change (if any).
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
      `SELECT c.id, c.semester_id, c.course_name, c.course_code, c.description,
              c.primary_section_id, c.primary_instructor_id, c.sync_scheduling, c.created_at,
              i.full_name AS primary_instructor_name
         FROM courses c
         LEFT JOIN instructors i ON c.primary_instructor_id = i.id
        WHERE c.id = ?`,
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

    // Check course exists
    const [existing] = await pool.execute('SELECT id, course_name FROM courses WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Course not found' } });
    }

    // Get sections in this course
    const [sections] = await pool.execute('SELECT section_id FROM sections WHERE course_id = ?', [id]);

    if (sections.length > 0 && cascade !== 'true') {
      // Return info about what would be deleted so UI can show confirmation
      const sectionIds = sections.map(s => s.section_id);
      const placeholders = sectionIds.map(() => '?').join(',');

      // Count students
      const [studentCount] = await pool.execute(
        `SELECT COUNT(DISTINCT student_id) as count FROM student_sections WHERE section_id IN (${placeholders})`,
        sectionIds
      );

      // Count case assignments
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
        error: { message: `Course has ${sections.length} section(s). Use cascade delete to remove everything.` }
      });
    }

    // Cascade delete if requested
    if (cascade === 'true' && sections.length > 0) {
      const sectionIds = sections.map(s => s.section_id);
      const placeholders = sectionIds.map(() => '?').join(',');

      // Delete student enrollments for these sections
      await pool.execute(
        `DELETE FROM student_sections WHERE section_id IN (${placeholders})`,
        sectionIds
      );

      // Get section_case IDs for cleanup
      const [sectionCases] = await pool.execute(
        `SELECT id FROM section_cases WHERE section_id IN (${placeholders})`,
        sectionIds
      );

      if (sectionCases.length > 0) {
        const scIds = sectionCases.map(sc => sc.id);
        const scPlaceholders = scIds.map(() => '?').join(',');

        // Delete section_case_scenarios
        await pool.execute(
          `DELETE FROM section_case_scenarios WHERE section_case_id IN (${scPlaceholders})`,
          scIds
        );

        // Delete section_case_positions
        await pool.execute(
          `DELETE FROM section_case_positions WHERE section_case_id IN (${scPlaceholders})`,
          scIds
        );
      }

      // Delete case assignments
      await pool.execute(
        `DELETE FROM section_cases WHERE section_id IN (${placeholders})`,
        sectionIds
      );

      // Delete sections
      await pool.execute(
        `DELETE FROM sections WHERE section_id IN (${placeholders})`,
        sectionIds
      );
    }

    // Delete the course
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

// POST /api/courses/:id/sections - Add section to course
router.post('/:id/sections', verifyToken, requireAdminOrInstructor, requireCourseAccess('id'), async (req, res) => {
  try {
    const { id } = req.params;
    const { section_id, section_title, enabled, accept_new_students, chat_model, super_model } = req.body;

    // Check course exists
    const [course] = await pool.execute('SELECT id, semester_id, primary_section_id FROM courses WHERE id = ?', [id]);
    if (course.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Course not found' } });
    }

    // Get semester name for year_term
    const [semester] = await pool.execute('SELECT semester_name FROM semesters WHERE id = ?', [course[0].semester_id]);

    if (!section_id || !section_title) {
      return res.status(400).json({ data: null, error: { message: 'Section ID and title are required' } });
    }

    // Check if section_id already exists
    const [existingSection] = await pool.execute('SELECT section_id FROM sections WHERE section_id = ?', [section_id]);
    if (existingSection.length > 0) {
      return res.status(409).json({ data: null, error: { message: 'Section ID already exists' } });
    }

    // Create the section
    await pool.execute(
      `INSERT INTO sections (section_id, course_id, section_title, year_term, enabled, accept_new_students, chat_model, super_model)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        section_id,
        id,
        section_title,
        semester[0]?.semester_name || null,
        enabled !== false ? 1 : 0,
        accept_new_students ? 1 : 0,
        chat_model || null,
        super_model || null
      ]
    );

    // If this is the first section, make it the primary
    if (!course[0].primary_section_id) {
      await pool.execute('UPDATE courses SET primary_section_id = ? WHERE id = ?', [section_id, id]);
    }

    // Return created section
    const [rows] = await pool.execute(
      'SELECT section_id, course_id, section_title, year_term, enabled, accept_new_students, chat_model, super_model, created_at FROM sections WHERE section_id = ?',
      [section_id]
    );

    res.status(201).json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error adding section to course:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// DELETE /api/courses/:id/sections/:sectionId - Remove section from course (unassign, not delete)
router.delete('/:id/sections/:sectionId', verifyToken, requireAdminOrInstructor, requireCourseAccess('id'), async (req, res) => {
  try {
    const { id, sectionId } = req.params;

    // Check course exists
    const [course] = await pool.execute('SELECT id, primary_section_id FROM courses WHERE id = ?', [id]);
    if (course.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Course not found' } });
    }

    // Check section belongs to this course
    const [section] = await pool.execute(
      'SELECT section_id FROM sections WHERE section_id = ? AND course_id = ?',
      [sectionId, id]
    );
    if (section.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Section not found in this course' } });
    }

    // Unassign section from course (set course_id to NULL)
    await pool.execute('UPDATE sections SET course_id = NULL WHERE section_id = ?', [sectionId]);

    // If this was the primary section, clear primary_section_id
    if (course[0].primary_section_id === sectionId) {
      // Find another section to make primary, or set to NULL
      const [remainingSections] = await pool.execute(
        'SELECT section_id FROM sections WHERE course_id = ? LIMIT 1',
        [id]
      );
      const newPrimaryId = remainingSections.length > 0 ? remainingSections[0].section_id : null;
      await pool.execute('UPDATE courses SET primary_section_id = ? WHERE id = ?', [newPrimaryId, id]);
    }

    res.json({ data: { removed: true, section_id: sectionId }, error: null });
  } catch (error) {
    console.error('Error removing section from course:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PUT /api/courses/:id/primary - Change primary section
router.put('/:id/primary', verifyToken, requireAdminOrInstructor, requireCourseAccess('id'), async (req, res) => {
  try {
    const { id } = req.params;
    const { section_id } = req.body;

    if (!section_id) {
      return res.status(400).json({ data: null, error: { message: 'Section ID is required' } });
    }

    // Check course exists
    const [course] = await pool.execute('SELECT id FROM courses WHERE id = ?', [id]);
    if (course.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Course not found' } });
    }

    // Check section belongs to this course
    const [section] = await pool.execute(
      'SELECT section_id FROM sections WHERE section_id = ? AND course_id = ?',
      [section_id, id]
    );
    if (section.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Section not found in this course' } });
    }

    await pool.execute('UPDATE courses SET primary_section_id = ? WHERE id = ?', [section_id, id]);

    res.json({ data: { primary_section_id: section_id }, error: null });
  } catch (error) {
    console.error('Error changing primary section:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// POST /api/courses/:id/sync - Push from primary section to other sections in course
router.post('/:id/sync', verifyToken, requireAdminOrInstructor, requireCourseAccess('id'), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      sync_options = true,
      sync_scenarios = true,
      sync_scheduling = null // null = use course setting
    } = req.body;

    // Get course with primary section
    const [course] = await pool.execute(
      'SELECT id, course_name, primary_section_id, sync_scheduling FROM courses WHERE id = ?',
      [id]
    );
    if (course.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Course not found' } });
    }

    if (!course[0].primary_section_id) {
      return res.status(400).json({ data: null, error: { message: 'Course has no primary section set' } });
    }

    const primarySectionId = course[0].primary_section_id;
    const shouldSyncScheduling = sync_scheduling !== null ? sync_scheduling : course[0].sync_scheduling;

    // Get other sections in course
    const [targetSections] = await pool.execute(
      'SELECT section_id FROM sections WHERE course_id = ? AND section_id != ?',
      [id, primarySectionId]
    );

    if (targetSections.length === 0) {
      return res.status(400).json({ data: null, error: { message: 'No other sections in course to sync to' } });
    }

    // Get all case assignments from primary section
    const [primaryCases] = await pool.execute(
      `SELECT sc.id, sc.case_id, sc.chat_options, sc.open_date, sc.close_date, sc.manual_status,
              sc.selection_mode, sc.require_order, sc.use_scenarios,
              c.case_title
       FROM section_cases sc
       JOIN cases c ON sc.case_id = c.case_id
       WHERE sc.section_id = ?`,
      [primarySectionId]
    );

    const results = {
      sections_synced: targetSections.length,
      cases_in_primary: primaryCases.length,
      details: []
    };

    // Sync each target section
    for (const targetSection of targetSections) {
      const sectionResult = {
        section_id: targetSection.section_id,
        cases_updated: 0,
        cases_added: 0,
        scenarios_synced: 0
      };

      for (const primaryCase of primaryCases) {
        // Check if case already exists in target section
        const [existingCase] = await pool.execute(
          'SELECT id FROM section_cases WHERE section_id = ? AND case_id = ?',
          [targetSection.section_id, primaryCase.case_id]
        );

        if (existingCase.length > 0) {
          // Update existing case assignment
          const updateFields = [];
          const updateParams = [];

          if (sync_options) {
            updateFields.push('chat_options = ?');
            updateParams.push(primaryCase.chat_options ? JSON.stringify(primaryCase.chat_options) : null);
          }

          if (sync_scenarios) {
            updateFields.push('selection_mode = ?', 'require_order = ?', 'use_scenarios = ?');
            updateParams.push(primaryCase.selection_mode, primaryCase.require_order, primaryCase.use_scenarios);
          }

          if (shouldSyncScheduling) {
            updateFields.push('open_date = ?', 'close_date = ?', 'manual_status = ?');
            updateParams.push(primaryCase.open_date, primaryCase.close_date, primaryCase.manual_status);
          }

          if (updateFields.length > 0) {
            updateParams.push(existingCase[0].id);
            await pool.execute(
              `UPDATE section_cases SET ${updateFields.join(', ')} WHERE id = ?`,
              updateParams
            );
            sectionResult.cases_updated++;
          }

          // Sync scenarios if requested
          if (sync_scenarios && primaryCase.use_scenarios) {
            // Delete existing scenarios for this section_case
            await pool.execute(
              'DELETE FROM section_case_scenarios WHERE section_case_id = ?',
              [existingCase[0].id]
            );

            // Copy scenarios from primary
            const [primaryScenarios] = await pool.execute(
              'SELECT scenario_id, enabled, sort_order FROM section_case_scenarios WHERE section_case_id = ?',
              [primaryCase.id]
            );

            for (const scenario of primaryScenarios) {
              try {
                await pool.execute(
                  'INSERT INTO section_case_scenarios (section_case_id, scenario_id, enabled, sort_order) VALUES (?, ?, ?, ?)',
                  [existingCase[0].id, scenario.scenario_id, scenario.enabled, scenario.sort_order]
                );
                sectionResult.scenarios_synced++;
              } catch (err) {
                console.error('Error syncing scenario:', err.message);
              }
            }

            // Copy positions if they exist
            await pool.execute(
              'DELETE FROM section_case_positions WHERE section_case_id = ?',
              [existingCase[0].id]
            );

            const [primaryPositions] = await pool.execute(
              'SELECT position_id, enabled, sort_order FROM section_case_positions WHERE section_case_id = ?',
              [primaryCase.id]
            );

            for (const pos of primaryPositions) {
              try {
                await pool.execute(
                  'INSERT INTO section_case_positions (section_case_id, position_id, enabled, sort_order) VALUES (?, ?, ?, ?)',
                  [existingCase[0].id, pos.position_id, pos.enabled, pos.sort_order]
                );
              } catch (err) {
                console.error('Error syncing position:', err.message);
              }
            }
          }
        } else {
          // Insert new case assignment
          const chatOptions = sync_options ? primaryCase.chat_options : null;
          const openDate = shouldSyncScheduling ? primaryCase.open_date : null;
          const closeDate = shouldSyncScheduling ? primaryCase.close_date : null;
          const manualStatus = shouldSyncScheduling ? primaryCase.manual_status : 'auto';

          const [insertResult] = await pool.execute(
            `INSERT INTO section_cases (section_id, case_id, active, chat_options, open_date, close_date, manual_status, selection_mode, require_order, use_scenarios)
             VALUES (?, ?, FALSE, ?, ?, ?, ?, ?, ?, ?)`,
            [
              targetSection.section_id,
              primaryCase.case_id,
              chatOptions ? JSON.stringify(chatOptions) : null,
              openDate,
              closeDate,
              manualStatus,
              sync_scenarios ? primaryCase.selection_mode : 'student_choice',
              sync_scenarios ? primaryCase.require_order : false,
              sync_scenarios ? primaryCase.use_scenarios : false
            ]
          );

          sectionResult.cases_added++;

          // Copy scenarios if requested
          if (sync_scenarios && primaryCase.use_scenarios) {
            const newSectionCaseId = insertResult.insertId;

            const [primaryScenarios] = await pool.execute(
              'SELECT scenario_id, enabled, sort_order FROM section_case_scenarios WHERE section_case_id = ?',
              [primaryCase.id]
            );

            for (const scenario of primaryScenarios) {
              try {
                await pool.execute(
                  'INSERT INTO section_case_scenarios (section_case_id, scenario_id, enabled, sort_order) VALUES (?, ?, ?, ?)',
                  [newSectionCaseId, scenario.scenario_id, scenario.enabled, scenario.sort_order]
                );
                sectionResult.scenarios_synced++;
              } catch (err) {
                console.error('Error copying scenario:', err.message);
              }
            }

            // Copy positions
            const [primaryPositions] = await pool.execute(
              'SELECT position_id, enabled, sort_order FROM section_case_positions WHERE section_case_id = ?',
              [primaryCase.id]
            );

            for (const pos of primaryPositions) {
              try {
                await pool.execute(
                  'INSERT INTO section_case_positions (section_case_id, position_id, enabled, sort_order) VALUES (?, ?, ?, ?)',
                  [newSectionCaseId, pos.position_id, pos.enabled, pos.sort_order]
                );
              } catch (err) {
                console.error('Error copying position:', err.message);
              }
            }
          }
        }
      }

      results.details.push(sectionResult);
    }

    res.json({
      data: results,
      message: `Synced ${results.sections_synced} section(s) from primary`,
      error: null
    });
  } catch (error) {
    console.error('Error syncing course:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PUT /api/courses/:id/sections/:sectionId/assign - Assign existing orphan section to course
router.put('/:id/sections/:sectionId/assign', verifyToken, requireAdminOrInstructor, requireCourseAccess('id'), async (req, res) => {
  try {
    const { id, sectionId } = req.params;

    // Check course exists
    const [course] = await pool.execute('SELECT id, primary_section_id FROM courses WHERE id = ?', [id]);
    if (course.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Course not found' } });
    }

    // Check section exists and is orphaned (no course_id)
    const [section] = await pool.execute('SELECT section_id, course_id FROM sections WHERE section_id = ?', [sectionId]);
    if (section.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Section not found' } });
    }
    if (section[0].course_id !== null) {
      return res.status(400).json({ data: null, error: { message: 'Section is already assigned to a course' } });
    }

    // Assign section to course
    await pool.execute('UPDATE sections SET course_id = ? WHERE section_id = ?', [id, sectionId]);

    // If course has no primary section, make this the primary
    if (!course[0].primary_section_id) {
      await pool.execute('UPDATE courses SET primary_section_id = ? WHERE id = ?', [sectionId, id]);
    }

    res.json({ data: { assigned: true, section_id: sectionId, course_id: id }, error: null });
  } catch (error) {
    console.error('Error assigning section to course:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

export default router;
