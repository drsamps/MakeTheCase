import express from 'express';
import { pool } from '../db.js';
import { verifyToken } from '../middleware/auth.js';
import { previewOwnerManagesSection, closedSectionsForPreview } from '../services/previewStudents.js';
import { canManageStudentsAs } from '../middleware/instructorAccess.js';

const router = express.Router();

// GET /api/student-sections/preview-sections - Student view only: sections closed to new
// students that the preview student's owner manages, so the instructor can still preview them.
router.get('/preview-sections', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'student') return res.json({ data: [], error: null });
    const [rows] = await pool.execute('SELECT preview_for FROM students WHERE id = ?', [req.user.id]);
    const previewFor = rows[0]?.preview_for;
    if (!previewFor) return res.json({ data: [], error: null });
    res.json({ data: await closedSectionsForPreview(previewFor), error: null });
  } catch (error) {
    console.error('Error fetching preview sections:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// POST /api/student-sections/enroll - Student self-enrollment
// Checks accept_new_students before allowing new enrollment.
// - A student always enrolls themselves (student_id in the body is ignored for students);
//   staff may pass student_id only for a section where they can manage students.
// - Email-account students (password, no NetID) may join only sections with an enrollment key.
// - A preview student (Student view) may also join a closed section its owner manages.
router.post('/enroll', verifyToken, async (req, res) => {
  try {
    const { section_id, enrollment_key } = req.body;
    const student_id = req.user.role === 'student' ? req.user.id : req.body.student_id;

    if (!student_id || !section_id) {
      return res.status(400).json({ data: null, error: { message: 'student_id and section_id are required' } });
    }

    // Staff enrolling someone else must be able to manage students in that section.
    if (req.user.role !== 'student') {
      const isStaff = req.user.role === 'admin' || req.user.role === 'instructor';
      const allowed = isStaff && await canManageStudentsAs({
        isAdmin: req.user.role === 'admin' && !req.effectiveInstructorId,
        instructorId: req.user.role === 'instructor' ? req.user.id : (req.effectiveInstructorId || null),
      }, section_id);
      if (!allowed) {
        return res.status(403).json({ data: null, error: { message: 'You cannot manage students in this section' } });
      }
    }

    // Check if student exists
    const [student] = await pool.execute(
      'SELECT id, password_hash IS NOT NULL AS has_password, preview_for FROM students WHERE id = ?',
      [student_id]
    );
    if (student.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Student not found' } });
    }
    const previewFor = student[0].preview_for || null;
    const isEmailStudent = Boolean(student[0].has_password) && !previewFor && !String(student_id).startsWith('cas:');

    // Check if section exists and get its accept_new_students status
    const [section] = await pool.execute(
      'SELECT section_id, accept_new_students, enabled, enrollment_key FROM sections WHERE section_id = ?',
      [section_id]
    );
    if (section.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Section not found' } });
    }

    if (!section[0].enabled) {
      return res.status(403).json({ data: null, error: { message: 'Section is disabled' } });
    }

    // Check if already enrolled
    const [existing] = await pool.execute(
      'SELECT id FROM student_sections WHERE student_id = ? AND section_id = ?',
      [student_id, section_id]
    );

    // If already enrolled, just return success (idempotent)
    if (existing.length > 0) {
      const [rows] = await pool.execute(
        `SELECT ss.section_id, ss.enrolled_at, ss.enrolled_by, ss.is_primary,
                s.section_title, s.year_term
         FROM student_sections ss
         JOIN sections s ON ss.section_id = s.section_id
         WHERE ss.student_id = ? AND ss.section_id = ?`,
        [student_id, section_id]
      );
      return res.json({ data: rows[0], error: null });
    }

    // If not already enrolled, check if section accepts new students
    if (!section[0].accept_new_students
        && !(previewFor && await previewOwnerManagesSection(previewFor, section_id))) {
      return res.status(403).json({ data: null, error: { message: 'Section is not accepting new students' } });
    }

    // Email-account students can join only sections protected by an enrollment key.
    if (isEmailStudent && !section[0].enrollment_key) {
      return res.status(403).json({
        data: null,
        error: { message: 'This section can only be joined with your instructor\'s help. Ask your instructor to add you.' }
      });
    }

    // Enforce enrollment key for self-enrollments only. Instructor-added rows
    // skip this check (they use POST /api/students/:id/sections instead).
    if (section[0].enrollment_key) {
      const provided = typeof enrollment_key === 'string' ? enrollment_key.trim() : '';
      if (provided !== section[0].enrollment_key) {
        return res.status(403).json({
          data: null,
          error: { code: 'ENROLLMENT_KEY_REQUIRED', message: 'Enrollment key is incorrect or missing.' }
        });
      }
    }

    // Check if student has any existing sections
    const [existingSections] = await pool.execute(
      'SELECT id FROM student_sections WHERE student_id = ?',
      [student_id]
    );
    const isFirstSection = existingSections.length === 0;

    // Insert enrollment (first section becomes primary)
    await pool.execute(
      'INSERT INTO student_sections (student_id, section_id, enrolled_by, is_primary) VALUES (?, ?, ?, ?)',
      [student_id, section_id, 'self', isFirstSection ? 1 : 0]
    );

    // If first section, sync to students.section_id for backward compatibility
    if (isFirstSection) {
      await pool.execute('UPDATE students SET section_id = ? WHERE id = ?', [section_id, student_id]);
    }

    // Return the enrollment record
    const [rows] = await pool.execute(
      `SELECT ss.section_id, ss.enrolled_at, ss.enrolled_by, ss.is_primary,
              s.section_title, s.year_term
       FROM student_sections ss
       JOIN sections s ON ss.section_id = s.section_id
       WHERE ss.student_id = ? AND ss.section_id = ?`,
      [student_id, section_id]
    );

    res.status(201).json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error enrolling student:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/student-sections/my-sections - Get current student's sections (for student use)
// Also reconciles the legacy students.section_id with the junction table so the
// student and instructor views stay in sync on login.
router.get('/my-sections', verifyToken, async (req, res) => {
  try {
    // Get student ID from the JWT token
    const studentId = req.user?.id;

    if (!studentId) {
      return res.status(401).json({ data: null, error: { message: 'Student ID not found in token' } });
    }

    // Helper to load current section enrollments
    const loadSections = async () => {
      const [rows] = await pool.execute(
        `SELECT ss.section_id, ss.enrolled_at, ss.enrolled_by, ss.is_primary,
                s.section_title, s.year_term, s.enabled, s.accept_new_students
         FROM student_sections ss
         JOIN sections s ON ss.section_id = s.section_id
         WHERE ss.student_id = ?
         ORDER BY ss.is_primary DESC, ss.enrolled_at DESC`,
        [studentId]
      );
      return rows;
    };

    // Load current enrollments and legacy value
    let sections = await loadSections();
    const [legacyRows] = await pool.execute(
      'SELECT section_id FROM students WHERE id = ?',
      [studentId]
    );
    const legacySectionId = legacyRows[0]?.section_id || null;

    let didSync = false;

    if (sections.length > 0) {
      // Ensure exactly one primary; if none, promote first enrollment
      const primaryRows = sections.filter((s) => !!s.is_primary);
      if (primaryRows.length === 0) {
        const primarySectionId = sections[0].section_id;
        await pool.execute(
          'UPDATE student_sections SET is_primary = 0 WHERE student_id = ?',
          [studentId]
        );
        await pool.execute(
          'UPDATE student_sections SET is_primary = 1 WHERE student_id = ? AND section_id = ?',
          [studentId, primarySectionId]
        );
        didSync = true;
        // Mirror to legacy field
        await pool.execute(
          'UPDATE students SET section_id = ? WHERE id = ?',
          [primarySectionId, studentId]
        );
      } else if (primaryRows.length > 1) {
        // If multiple primaries, keep the most recent and clear others
        const primarySectionId = primaryRows[0].section_id;
        await pool.execute(
          'UPDATE student_sections SET is_primary = CASE WHEN section_id = ? THEN 1 ELSE 0 END WHERE student_id = ?',
          [primarySectionId, studentId]
        );
        didSync = true;
        await pool.execute(
          'UPDATE students SET section_id = ? WHERE id = ?',
          [primarySectionId, studentId]
        );
      } else {
        // Single primary exists; keep legacy in sync with it
        const primarySectionId = primaryRows[0].section_id;
        if (legacySectionId !== primarySectionId) {
          await pool.execute(
            'UPDATE students SET section_id = ? WHERE id = ?',
            [primarySectionId, studentId]
          );
          didSync = true;
        }
      }
    } else if (legacySectionId) {
      // No enrollments yet: seed from legacy section_id for backward compatibility
      const [sectionInfo] = await pool.execute(
        'SELECT section_id FROM sections WHERE section_id = ?',
        [legacySectionId]
      );
      if (sectionInfo.length > 0) {
        await pool.execute(
          'INSERT INTO student_sections (student_id, section_id, enrolled_by, is_primary) VALUES (?, ?, ?, 1)',
          [studentId, legacySectionId, 'legacy_sync']
        );
        didSync = true;
        sections = await loadSections();
      }
    }

    // Reload after reconciliation so client receives the final state
    if (didSync) {
      sections = await loadSections();
    }

    res.json({ data: sections, error: null });
  } catch (error) {
    console.error('Error fetching student sections:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PATCH /api/student-sections/current - Student sets their active (primary) section
// Used by multi-section students to switch which section is in focus on the Welcome screen.
router.patch('/current', verifyToken, async (req, res) => {
  try {
    const studentId = req.user?.id;
    if (!studentId) {
      return res.status(401).json({ data: null, error: { message: 'Student ID not found in token' } });
    }

    const { section_id } = req.body;
    if (!section_id) {
      return res.status(400).json({ data: null, error: { message: 'section_id is required' } });
    }

    // Verify the student is enrolled in the requested section
    const [enrollment] = await pool.execute(
      'SELECT id FROM student_sections WHERE student_id = ? AND section_id = ?',
      [studentId, section_id]
    );
    if (enrollment.length === 0) {
      return res.status(403).json({ data: null, error: { message: 'Student is not enrolled in that section' } });
    }

    // Flip primaries: clear all, then set the chosen one
    await pool.execute(
      'UPDATE student_sections SET is_primary = 0 WHERE student_id = ?',
      [studentId]
    );
    await pool.execute(
      'UPDATE student_sections SET is_primary = 1 WHERE student_id = ? AND section_id = ?',
      [studentId, section_id]
    );

    // Keep legacy students.section_id in sync for backward compatibility
    await pool.execute(
      'UPDATE students SET section_id = ? WHERE id = ?',
      [section_id, studentId]
    );

    const [rows] = await pool.execute(
      `SELECT ss.section_id, ss.enrolled_at, ss.enrolled_by, ss.is_primary,
              s.section_title, s.year_term
       FROM student_sections ss
       JOIN sections s ON ss.section_id = s.section_id
       WHERE ss.student_id = ? AND ss.section_id = ?`,
      [studentId, section_id]
    );

    res.json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error setting current section:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

export default router;
