/**
 * Instructor access control middleware
 * Provides access checks for the instructor tier system:
 * - Superuser admins: Full access (admins.superuser=1)
 * - Regular admins: Function-based access (admins.superuser=0)
 * - Primary instructors: Assigned to semesters (instructors table)
 * - TAs: Assigned to specific sections (instructors table)
 */

import { pool } from '../db.js';
import { canAccessResource, getEffectiveInstructorId, hasAdminVision } from '../services/resourceAccess.js';

// ============================================================
// Helper functions to get accessible resources
// ============================================================

/**
 * Get all semester IDs an instructor has access to
 * @param {string} instructorId - Instructor UUID
 * @returns {Promise<number[]>} Array of semester IDs
 */
export async function getAccessibleSemesterIds(instructorId) {
  const [rows] = await pool.execute(`
    SELECT semester_id FROM instructor_semesters WHERE instructor_id = ?
    UNION
    SELECT DISTINCT c.semester_id FROM courses c WHERE c.primary_instructor_id = ?
    UNION
    SELECT DISTINCT c.semester_id
    FROM courses c
    JOIN sections s ON s.course_id = c.id
    WHERE s.primary_instructor_id = ?
  `, [instructorId, instructorId, instructorId]);
  return rows.map(r => r.semester_id);
}

/**
 * Get all course IDs an instructor has access to
 * Sources: semester assignment, course primary, section primary
 * @param {string} instructorId - Instructor UUID
 * @returns {Promise<number[]>} Array of course IDs
 */
export async function getAccessibleCourseIds(instructorId) {
  const [rows] = await pool.execute(`
    SELECT DISTINCT c.id
    FROM courses c
    JOIN instructor_semesters isem ON c.semester_id = isem.semester_id
    WHERE isem.instructor_id = ?
    UNION
    SELECT id FROM courses WHERE primary_instructor_id = ?
    UNION
    SELECT DISTINCT s.course_id FROM sections s WHERE s.primary_instructor_id = ?
  `, [instructorId, instructorId, instructorId]);
  return rows.map(r => r.id);
}

/**
 * Get all section IDs an instructor has access to
 * Sources: semester assignment, course primary, section primary, direct TA assignment
 * @param {string} instructorId - Instructor UUID
 * @returns {Promise<string[]>} Array of section IDs
 */
export async function getAccessibleSectionIds(instructorId) {
  const [rows] = await pool.execute(`
    SELECT DISTINCT s.section_id
    FROM sections s
    JOIN courses c ON s.course_id = c.id
    JOIN instructor_semesters isem ON c.semester_id = isem.semester_id
    WHERE isem.instructor_id = ?
    UNION
    SELECT s.section_id
    FROM sections s
    JOIN courses c ON s.course_id = c.id
    WHERE c.primary_instructor_id = ?
    UNION
    SELECT section_id FROM sections WHERE primary_instructor_id = ?
    UNION
    SELECT section_id FROM instructor_sections WHERE instructor_id = ?
  `, [instructorId, instructorId, instructorId, instructorId]);
  return rows.map(r => r.section_id);
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
  const [rows] = await pool.execute(`
    SELECT 1 FROM instructor_semesters
    WHERE instructor_id = ? AND semester_id = ?
    UNION
    SELECT 1 FROM courses
    WHERE primary_instructor_id = ? AND semester_id = ?
    UNION
    SELECT 1
    FROM sections s
    JOIN courses c ON s.course_id = c.id
    WHERE s.primary_instructor_id = ? AND c.semester_id = ?
    LIMIT 1
  `, [instructorId, semesterId, instructorId, semesterId, instructorId, semesterId]);
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
    SELECT 1
    FROM courses c
    JOIN instructor_semesters isem ON c.semester_id = isem.semester_id
    WHERE isem.instructor_id = ? AND c.id = ?
    UNION
    SELECT 1 FROM courses WHERE primary_instructor_id = ? AND id = ?
    UNION
    SELECT 1 FROM sections WHERE primary_instructor_id = ? AND course_id = ?
    LIMIT 1
  `, [instructorId, courseId, instructorId, courseId, instructorId, courseId]);
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
  const [rows] = await pool.execute(`
    SELECT 1 FROM instructor_sections
    WHERE instructor_id = ? AND section_id = ?
    UNION
    SELECT 1
    FROM sections s
    JOIN courses c ON s.course_id = c.id
    JOIN instructor_semesters isem ON c.semester_id = isem.semester_id
    WHERE isem.instructor_id = ? AND s.section_id = ?
    UNION
    SELECT 1 FROM sections WHERE primary_instructor_id = ? AND section_id = ?
    UNION
    SELECT 1
    FROM sections s
    JOIN courses c ON s.course_id = c.id
    WHERE c.primary_instructor_id = ? AND s.section_id = ?
    LIMIT 1
  `, [instructorId, sectionId, instructorId, sectionId, instructorId, sectionId, instructorId, sectionId]);

  return rows.length > 0;
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
    SELECT 1
    FROM sections s
    JOIN courses c ON s.course_id = c.id
    JOIN instructor_semesters isem ON c.semester_id = isem.semester_id
    WHERE isem.instructor_id = ? AND s.section_id = ?
    UNION
    SELECT 1 FROM sections WHERE primary_instructor_id = ? AND section_id = ?
    UNION
    SELECT 1
    FROM sections s
    JOIN courses c ON s.course_id = c.id
    WHERE c.primary_instructor_id = ? AND s.section_id = ?
    LIMIT 1
  `, [instructorId, sectionId, instructorId, sectionId, instructorId, sectionId]);
  return rows.length > 0;
}

/**
 * @deprecated Use `canAccessResource(req, 'case', caseId, action)` from
 * services/resourceAccess.js, which honors the visibility enum + team shares
 * + admin impersonation. This wrapper exists only for legacy call sites that
 * don't have access to `req`.
 */
export async function canAccessCase(userId, caseId, isSuperuser, userRole) {
  if (isSuperuser || userRole === 'admin') return true;
  const fakeReq = { user: { id: userId, role: userRole, superuser: !!isSuperuser } };
  const result = await canAccessResource(fakeReq, 'case', caseId, 'view');
  return result.allowed;
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
 * Middleware factory: Require access to a specific case.
 *
 * Delegates to the unified visibility/ownership model in
 * services/resourceAccess.js (honors `visibility` enum + `resource_team_shares`
 * + admin impersonation). For backward compatibility this thin wrapper still
 * accepts just a param name; supply `action` ('edit' | 'delete' | 'share') for
 * mutating routes — default is 'view'.
 *
 * @param {string} caseIdParam - Request param name containing case ID (default: 'id')
 * @param {'view'|'edit'|'share'|'delete'} action
 */
export function requireCaseAccess(caseIdParam = 'id', action = 'view') {
  return requireResourceAccess('case', caseIdParam, action);
}

/**
 * Middleware factory: Require access to a generic shared resource (case,
 * rubric, rubric_criteria, persona, case_writer_project) via the unified
 * visibility/ownership model in services/resourceAccess.js.
 *
 *   router.get('/rubrics/:id',
 *     verifyToken,
 *     requireResourceAccess('rubric', 'id', 'view'),
 *     async (req, res) => { ... }
 *   );
 *
 * On success, attaches:
 *   req.resource       - the fetched row
 *   req.resourceAccess - { allowed: true, reason, row }
 *
 * @param {string} resourceType - 'case' | 'rubric' | 'rubric_criteria' | 'persona' | 'case_writer_project'
 * @param {string} paramName - request param key holding the resource id (default 'id')
 * @param {'view'|'edit'|'share'|'delete'} action
 */
export function requireResourceAccess(resourceType, paramName = 'id', action = 'view') {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const resourceId = req.params[paramName] || req.body[paramName];
    if (!resourceId) {
      return res.status(400).json({ error: `${paramName} required` });
    }
    try {
      const result = await canAccessResource(req, resourceType, resourceId, action);
      if (!result.allowed) {
        // For 'view' actions, hide existence by mapping `not_visible` → 404 so
        // the caller can't probe for the existence of private/team resources
        // they don't have access to. For mutating actions, keep 403 since the
        // caller may have already discovered the resource via view/list.
        let code;
        if (result.reason === 'not_found') code = 404;
        else if (action === 'view' && result.reason === 'not_visible') code = 404;
        else code = 403;
        return res.status(code).json({ error: result.reason });
      }
      req.resource = result.row;
      req.resourceAccess = result;
      next();
    } catch (err) {
      console.error('[requireResourceAccess]', err);
      return res.status(500).json({ error: 'Access check failed' });
    }
  };
}
