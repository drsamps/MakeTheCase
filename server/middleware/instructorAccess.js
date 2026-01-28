/**
 * Instructor access control middleware
 * Provides access checks for the instructor tier system:
 * - Superuser admins: Full access (admins.superuser=1)
 * - Regular admins: Function-based access (admins.superuser=0)
 * - Primary instructors: Assigned to semesters (instructors table)
 * - TAs: Assigned to specific sections (instructors table)
 */

import { pool } from '../db.js';

// ============================================================
// Helper functions to get accessible resources
// ============================================================

/**
 * Get all semester IDs an instructor has access to
 * @param {string} instructorId - Instructor UUID
 * @returns {Promise<number[]>} Array of semester IDs
 */
export async function getAccessibleSemesterIds(instructorId) {
  const [rows] = await pool.execute(
    'SELECT semester_id FROM instructor_semesters WHERE instructor_id = ?',
    [instructorId]
  );
  return rows.map(r => r.semester_id);
}

/**
 * Get all course IDs an instructor has access to (via semester assignment)
 * @param {string} instructorId - Instructor UUID
 * @returns {Promise<number[]>} Array of course IDs
 */
export async function getAccessibleCourseIds(instructorId) {
  const [rows] = await pool.execute(`
    SELECT DISTINCT c.id
    FROM courses c
    JOIN instructor_semesters isem ON c.semester_id = isem.semester_id
    WHERE isem.instructor_id = ?
  `, [instructorId]);
  return rows.map(r => r.id);
}

/**
 * Get all section IDs an instructor has access to
 * Includes sections via course assignment AND direct TA assignment
 * @param {string} instructorId - Instructor UUID
 * @returns {Promise<string[]>} Array of section IDs
 */
export async function getAccessibleSectionIds(instructorId) {
  // Get sections via semester -> course -> section path (primary instructor)
  const [courseSections] = await pool.execute(`
    SELECT DISTINCT s.section_id
    FROM sections s
    JOIN courses c ON s.course_id = c.id
    JOIN instructor_semesters isem ON c.semester_id = isem.semester_id
    WHERE isem.instructor_id = ?
  `, [instructorId]);

  // Get directly assigned sections (TA)
  const [directSections] = await pool.execute(
    'SELECT section_id FROM instructor_sections WHERE instructor_id = ?',
    [instructorId]
  );

  const allSectionIds = new Set([
    ...courseSections.map(r => r.section_id),
    ...directSections.map(r => r.section_id)
  ]);

  return Array.from(allSectionIds);
}

// ============================================================
// Access check functions
// ============================================================

/**
 * Check if an instructor has access to a specific semester
 * @param {string} instructorId - Instructor UUID
 * @param {number} semesterId - Semester ID
 * @returns {Promise<boolean>}
 */
export async function canAccessSemester(instructorId, semesterId) {
  const [rows] = await pool.execute(
    'SELECT id FROM instructor_semesters WHERE instructor_id = ? AND semester_id = ?',
    [instructorId, semesterId]
  );
  return rows.length > 0;
}

/**
 * Check if an instructor has access to a specific course
 * Access is granted via semester assignment
 * @param {string} instructorId - Instructor UUID
 * @param {number} courseId - Course ID
 * @returns {Promise<boolean>}
 */
export async function canAccessCourse(instructorId, courseId) {
  const [rows] = await pool.execute(`
    SELECT c.id
    FROM courses c
    JOIN instructor_semesters isem ON c.semester_id = isem.semester_id
    WHERE isem.instructor_id = ? AND c.id = ?
  `, [instructorId, courseId]);
  return rows.length > 0;
}

/**
 * Check if an instructor has access to a specific section
 * Access via course (primary instructor) OR direct assignment (TA)
 * @param {string} instructorId - Instructor UUID
 * @param {string} sectionId - Section ID
 * @returns {Promise<boolean>}
 */
export async function canAccessSection(instructorId, sectionId) {
  // Check direct section assignment (TA)
  const [directAccess] = await pool.execute(
    'SELECT id FROM instructor_sections WHERE instructor_id = ? AND section_id = ?',
    [instructorId, sectionId]
  );
  if (directAccess.length > 0) return true;

  // Check via course -> semester assignment (primary instructor)
  const [courseAccess] = await pool.execute(`
    SELECT s.section_id
    FROM sections s
    JOIN courses c ON s.course_id = c.id
    JOIN instructor_semesters isem ON c.semester_id = isem.semester_id
    WHERE isem.instructor_id = ? AND s.section_id = ?
  `, [instructorId, sectionId]);

  return courseAccess.length > 0;
}

/**
 * Get TA permissions for a specific section
 * Returns null if not assigned as TA (might still have access as primary instructor)
 * @param {string} instructorId - Instructor UUID
 * @param {string} sectionId - Section ID
 * @returns {Promise<Object|null>} Permission object or null
 */
export async function getTAPermissions(instructorId, sectionId) {
  const [rows] = await pool.execute(
    `SELECT can_manage_students, can_manage_cases, can_view_chats
     FROM instructor_sections
     WHERE instructor_id = ? AND section_id = ?`,
    [instructorId, sectionId]
  );
  if (rows.length === 0) return null;
  return {
    canManageStudents: Boolean(rows[0].can_manage_students),
    canManageCases: Boolean(rows[0].can_manage_cases),
    canViewChats: Boolean(rows[0].can_view_chats)
  };
}

/**
 * Check if instructor is a primary instructor for a section (via course)
 * @param {string} instructorId - Instructor UUID
 * @param {string} sectionId - Section ID
 * @returns {Promise<boolean>}
 */
export async function isPrimaryInstructorForSection(instructorId, sectionId) {
  const [rows] = await pool.execute(`
    SELECT s.section_id
    FROM sections s
    JOIN courses c ON s.course_id = c.id
    JOIN instructor_semesters isem ON c.semester_id = isem.semester_id
    WHERE isem.instructor_id = ? AND s.section_id = ?
  `, [instructorId, sectionId]);
  return rows.length > 0;
}

/**
 * Check if a user can access a case
 * Admins always can; instructors can if they own it or it's shared
 * @param {string} userId - User UUID
 * @param {string} caseId - Case ID
 * @param {boolean} isSuperuser - Whether user is a superuser
 * @param {string} userRole - 'admin' or 'instructor'
 * @returns {Promise<boolean>}
 */
export async function canAccessCase(userId, caseId, isSuperuser, userRole) {
  // Superusers and regular admins can access all cases
  if (isSuperuser || userRole === 'admin') {
    return true;
  }

  // Instructors: can access if they created it or if it's shared
  const [rows] = await pool.execute(
    'SELECT case_id, created_by, is_shared FROM cases WHERE case_id = ?',
    [caseId]
  );

  if (rows.length === 0) return false;

  const caseData = rows[0];
  return caseData.created_by === userId || Boolean(caseData.is_shared);
}

// ============================================================
// Middleware functions
// ============================================================

/**
 * Middleware: Require superuser status
 * Only admins.superuser=1 can proceed
 */
export function requireSuperuser(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (req.user.superuser) {
    return next();
  }

  return res.status(403).json({
    error: 'Only superusers can perform this action'
  });
}

/**
 * Middleware: Require admin (any admin, superuser or regular)
 * Blocks instructors from the instructors table
 */
export function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (req.user.role === 'admin') {
    return next();
  }

  return res.status(403).json({
    error: 'Admin access required'
  });
}

/**
 * Middleware: Require admin OR instructor
 * Allows any authenticated staff member
 */
export function requireAdminOrInstructor(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (req.user.role === 'admin' || req.user.role === 'instructor') {
    return next();
  }

  return res.status(403).json({
    error: 'Admin or instructor access required'
  });
}

/**
 * Middleware factory: Require access to a specific semester
 * Superusers and admins bypass check
 * @param {string} semesterIdParam - Request param name containing semester ID (default: 'id')
 */
export function requireSemesterAccess(semesterIdParam = 'id') {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Superusers and admins can access all semesters
    if (req.user.superuser || req.user.role === 'admin') {
      return next();
    }

    const semesterId = req.params[semesterIdParam] || req.body.semester_id;
    if (!semesterId) {
      return res.status(400).json({ error: 'Semester ID required' });
    }

    // Instructors need explicit semester assignment
    if (req.user.role === 'instructor') {
      const hasAccess = await canAccessSemester(req.user.id, semesterId);
      if (!hasAccess) {
        return res.status(403).json({ error: 'Access denied to this semester' });
      }
    }

    next();
  };
}

/**
 * Middleware factory: Require access to a specific course
 * Superusers and admins bypass check
 * @param {string} courseIdParam - Request param name containing course ID (default: 'id')
 */
export function requireCourseAccess(courseIdParam = 'id') {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Superusers and admins can access all courses
    if (req.user.superuser || req.user.role === 'admin') {
      return next();
    }

    const courseId = req.params[courseIdParam] || req.body.course_id;
    if (!courseId) {
      return res.status(400).json({ error: 'Course ID required' });
    }

    // Instructors need access via semester assignment
    if (req.user.role === 'instructor') {
      const hasAccess = await canAccessCourse(req.user.id, courseId);
      if (!hasAccess) {
        return res.status(403).json({ error: 'Access denied to this course' });
      }
    }

    next();
  };
}

/**
 * Middleware factory: Require access to a specific section
 * Superusers and admins bypass check
 * @param {string} sectionIdParam - Request param name containing section ID (default: 'id')
 */
export function requireSectionAccess(sectionIdParam = 'id') {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Superusers and admins can access all sections
    if (req.user.superuser || req.user.role === 'admin') {
      return next();
    }

    const sectionId = req.params[sectionIdParam] || req.body.section_id;
    if (!sectionId) {
      return res.status(400).json({ error: 'Section ID required' });
    }

    // Instructors need access via semester/course OR direct TA assignment
    if (req.user.role === 'instructor') {
      const hasAccess = await canAccessSection(req.user.id, sectionId);
      if (!hasAccess) {
        return res.status(403).json({ error: 'Access denied to this section' });
      }

      // For TAs, also check specific permissions
      const isPrimary = await isPrimaryInstructorForSection(req.user.id, sectionId);
      if (!isPrimary) {
        // Check TA permissions for specific actions
        const permissions = await getTAPermissions(req.user.id, sectionId);
        if (permissions) {
          // Attach permissions to request for use in route handlers
          req.taPermissions = permissions;
        }
      } else {
        // Primary instructors have full permissions
        req.isPrimaryInstructor = true;
      }
    }

    next();
  };
}

/**
 * Middleware factory: Require specific TA permission for section
 * Must be used after requireSectionAccess
 * @param {string} permission - 'canManageStudents', 'canManageCases', or 'canViewChats'
 */
export function requireSectionPermission(permission) {
  return (req, res, next) => {
    // Superusers, admins, and primary instructors always have permission
    if (req.user.superuser || req.user.role === 'admin' || req.isPrimaryInstructor) {
      return next();
    }

    // Check TA permissions
    if (req.taPermissions && req.taPermissions[permission]) {
      return next();
    }

    return res.status(403).json({
      error: `You don't have permission for this action on this section`
    });
  };
}

/**
 * Middleware factory: Require access to a specific case
 * Superusers and admins can access all; instructors need ownership or shared status
 * @param {string} caseIdParam - Request param name containing case ID (default: 'id')
 */
export function requireCaseAccess(caseIdParam = 'id') {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const caseId = req.params[caseIdParam] || req.body.case_id;
    if (!caseId) {
      return res.status(400).json({ error: 'Case ID required' });
    }

    const hasAccess = await canAccessCase(
      req.user.id,
      caseId,
      req.user.superuser,
      req.user.role
    );

    if (!hasAccess) {
      return res.status(403).json({
        error: 'Access denied to this case. The case may be private.'
      });
    }

    next();
  };
}
