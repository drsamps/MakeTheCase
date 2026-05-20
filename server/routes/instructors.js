/**
 * Instructor management routes
 * Handles CRUD for instructors and their assignments to semesters/sections
 */

import express from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db.js';
import { verifyToken, requireRole } from '../middleware/auth.js';
import {
  requireSuperuser,
  requireAdminOrInstructor,
  requireSectionAccess,
  canAccessSection,
  isPrimaryInstructorForSection
} from '../middleware/instructorAccess.js';
import { writeAudit } from '../services/auditLog.js';
import { getMonthlyUsage } from '../services/usageGuard.js';

const router = express.Router();

// ============================================================
// Instructor CRUD
// ============================================================

/**
 * GET /api/instructors - List all instructors
 * Superusers see all; primary instructors see TAs in their sections
 */
router.get('/', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    let query = `
      SELECT i.id, i.email, i.netid, i.auth_method,
             i.first_name, i.last_name, i.full_name,
             i.active, i.use_system_key, i.can_publish, i.monthly_token_cap, i.is_system_account,
             i.created_at, i.last_login,
             COUNT(DISTINCT isem.semester_id) as semester_count,
             COUNT(DISTINCT isec.section_id) as section_count
      FROM instructors i
      LEFT JOIN instructor_semesters isem ON i.id = isem.instructor_id
      LEFT JOIN instructor_sections isec ON i.id = isec.instructor_id
    `;

    const params = [];

    // Non-superuser admins and instructors can only see instructors in their accessible sections
    if (!req.user.superuser && req.user.role === 'instructor') {
      // Instructors see only TAs in their courses/sections
      query += `
        WHERE i.id IN (
          SELECT DISTINCT isec2.instructor_id
          FROM instructor_sections isec2
          WHERE isec2.section_id IN (
            SELECT s.section_id
            FROM sections s
            JOIN courses c ON s.course_id = c.id
            JOIN instructor_semesters isem2 ON c.semester_id = isem2.semester_id
            WHERE isem2.instructor_id = ?
          )
        )
        OR i.id = ?
      `;
      params.push(req.user.id, req.user.id);
    }

    query += ' GROUP BY i.id ORDER BY i.full_name ASC';

    const [rows] = await pool.execute(query, params);

    const instructors = rows.map(row => ({
      ...row,
      active: Boolean(row.active),
      use_system_key: Boolean(row.use_system_key),
      can_publish: Boolean(row.can_publish),
      is_system_account: Boolean(row.is_system_account),
      monthly_token_cap: row.monthly_token_cap == null ? null : Number(row.monthly_token_cap),
    }));

    res.json({ data: instructors, error: null });
  } catch (error) {
    console.error('Error fetching instructors:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

/**
 * GET /api/instructors/:id - Get single instructor with assignments
 */
router.get('/:id', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const { id } = req.params;

    // Get instructor
    const [instructorRows] = await pool.execute(
      `SELECT id, email, netid, auth_method,
              first_name, last_name, full_name, active,
              use_system_key, can_publish, monthly_token_cap, is_system_account,
              created_at, last_login
       FROM instructors WHERE id = ?`,
      [id]
    );

    if (instructorRows.length === 0) {
      return res.status(404).json({ error: 'Instructor not found' });
    }

    const instructor = {
      ...instructorRows[0],
      active: Boolean(instructorRows[0].active),
      use_system_key: Boolean(instructorRows[0].use_system_key),
      can_publish: Boolean(instructorRows[0].can_publish),
      is_system_account: Boolean(instructorRows[0].is_system_account),
      monthly_token_cap: instructorRows[0].monthly_token_cap == null ? null : Number(instructorRows[0].monthly_token_cap),
    };

    // Get semester assignments
    const [semesterRows] = await pool.execute(`
      SELECT isem.id, isem.semester_id, isem.assigned_at,
             sem.semester_name, sem.is_current
      FROM instructor_semesters isem
      JOIN semesters sem ON isem.semester_id = sem.id
      WHERE isem.instructor_id = ?
      ORDER BY sem.is_current DESC, sem.semester_name DESC
    `, [id]);

    // Get section assignments (TA)
    const [sectionRows] = await pool.execute(`
      SELECT isec.id, isec.section_id, isec.can_manage_students,
             isec.can_manage_cases, isec.can_view_chats, isec.assigned_at,
             s.section_title, c.course_name, sem.semester_name
      FROM instructor_sections isec
      JOIN sections s ON isec.section_id = s.section_id
      LEFT JOIN courses c ON s.course_id = c.id
      LEFT JOIN semesters sem ON c.semester_id = sem.id
      WHERE isec.instructor_id = ?
      ORDER BY sem.is_current DESC, c.course_name ASC, s.section_title ASC
    `, [id]);

    instructor.semesters = semesterRows.map(r => ({
      ...r,
      is_current: Boolean(r.is_current)
    }));

    instructor.sections = sectionRows.map(r => ({
      ...r,
      can_manage_students: Boolean(r.can_manage_students),
      can_manage_cases: Boolean(r.can_manage_cases),
      can_view_chats: Boolean(r.can_view_chats)
    }));

    res.json({ data: instructor, error: null });
  } catch (error) {
    console.error('Error fetching instructor:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

/**
 * POST /api/instructors - Create new instructor (superuser only)
 */
router.post('/', verifyToken, requireRole(['admin']), requireSuperuser, async (req, res) => {
  try {
    const { email, password, first_name, last_name, full_name } = req.body;
    const auth_method = (req.body.auth_method || 'password').toLowerCase();
    const netidRaw = (req.body.netid || '').trim().toLowerCase();
    const netid = netidRaw || null;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    if (!['password', 'cas', 'both'].includes(auth_method)) {
      return res.status(400).json({ error: "auth_method must be 'password', 'cas', or 'both'" });
    }
    const passwordRequired = auth_method !== 'cas';
    if (passwordRequired && !password) {
      return res.status(400).json({ error: 'Password is required for this sign-in method' });
    }
    if (auth_method === 'cas' && password) {
      return res.status(400).json({ error: 'CAS-only instructors cannot have a password' });
    }

    // Check if email exists in admins table
    const [existingAdmin] = await pool.execute(
      'SELECT id FROM admins WHERE email = ?',
      [email]
    );
    if (existingAdmin.length > 0) {
      return res.status(409).json({ error: 'An admin with this email already exists' });
    }

    // Check if email exists in instructors table
    const [existingInstructor] = await pool.execute(
      'SELECT id FROM instructors WHERE email = ?',
      [email]
    );
    if (existingInstructor.length > 0) {
      return res.status(409).json({ error: 'An instructor with this email already exists' });
    }

    if (netid) {
      const [netidConflict] = await pool.execute(
        'SELECT id FROM instructors WHERE netid = ?',
        [netid]
      );
      if (netidConflict.length > 0) {
        return res.status(409).json({ error: 'An instructor with this NetID already exists' });
      }
    }

    const id = uuidv4();
    const passwordHash = password ? await bcrypt.hash(password, 10) : null;
    const displayName = full_name || `${first_name || ''} ${last_name || ''}`.trim() || email;

    await pool.execute(
      `INSERT INTO instructors (id, email, netid, password_hash, first_name, last_name, full_name, auth_method)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, email, netid, passwordHash, first_name || null, last_name || null, displayName, auth_method]
    );

    res.status(201).json({
      data: {
        id,
        email,
        netid,
        auth_method,
        first_name: first_name || null,
        last_name: last_name || null,
        full_name: displayName,
        active: true
      },
      error: null
    });
  } catch (error) {
    console.error('Error creating instructor:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

/**
 * GET /api/instructors/:id/usage - current-month token usage + cap status
 * Visible to: the instructor themselves, any admin.
 */
router.get('/:id/usage', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const { id } = req.params;
    if (req.user.role === 'instructor' && req.user.id !== id) {
      return res.status(403).json({ error: 'You can only view your own usage' });
    }
    const usage = await getMonthlyUsage(id);
    res.json({ data: usage, error: null });
  } catch (error) {
    console.error('Error fetching instructor usage:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

/**
 * PATCH /api/instructors/:id - Update instructor
 * Superuser can update any instructor; instructors can update themselves
 */
router.patch('/:id', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const { id } = req.params;
    const { email, password, first_name, last_name, full_name, active,
            use_system_key, can_publish, monthly_token_cap,
            auth_method, netid } = req.body;

    // Non-superusers can only update themselves
    if (!req.user.superuser && req.user.id !== id) {
      return res.status(403).json({ error: 'You can only update your own profile' });
    }

    // Only superusers can change active status
    if (active !== undefined && !req.user.superuser) {
      return res.status(403).json({ error: 'Only superusers can change active status' });
    }
    if ((use_system_key !== undefined || can_publish !== undefined || monthly_token_cap !== undefined) && !req.user.superuser) {
      return res.status(403).json({ error: 'Only superusers can grant use_system_key, can_publish, or set monthly_token_cap' });
    }
    if ((auth_method !== undefined || netid !== undefined) && !req.user.superuser) {
      return res.status(403).json({ error: 'Only superusers can change sign-in method or NetID' });
    }

    let normalizedAuthMethod;
    if (auth_method !== undefined) {
      normalizedAuthMethod = String(auth_method).toLowerCase();
      if (!['password', 'cas', 'both'].includes(normalizedAuthMethod)) {
        return res.status(400).json({ error: "auth_method must be 'password', 'cas', or 'both'" });
      }
    }

    let normalizedNetid;
    if (netid !== undefined) {
      const trimmed = (netid || '').trim().toLowerCase();
      normalizedNetid = trimmed === '' ? null : trimmed;
      if (normalizedNetid) {
        const [netidConflict] = await pool.execute(
          'SELECT id FROM instructors WHERE netid = ? AND id != ?',
          [normalizedNetid, id]
        );
        if (netidConflict.length > 0) {
          return res.status(409).json({ error: 'NetID already in use' });
        }
      }
    }

    const updates = [];
    const values = [];

    if (email !== undefined) {
      // Check for email conflicts
      const [conflicts] = await pool.execute(
        'SELECT id FROM instructors WHERE email = ? AND id != ?',
        [email, id]
      );
      if (conflicts.length > 0) {
        return res.status(409).json({ error: 'Email already in use' });
      }
      const [adminConflicts] = await pool.execute(
        'SELECT id FROM admins WHERE email = ?',
        [email]
      );
      if (adminConflicts.length > 0) {
        return res.status(409).json({ error: 'Email already in use by an admin' });
      }
      updates.push('email = ?');
      values.push(email);
    }

    if (password) {
      const passwordHash = await bcrypt.hash(password, 10);
      updates.push('password_hash = ?');
      values.push(passwordHash);
    }

    if (normalizedAuthMethod !== undefined) {
      updates.push('auth_method = ?');
      values.push(normalizedAuthMethod);
      // Switching to CAS-only clears any existing password.
      if (normalizedAuthMethod === 'cas') {
        updates.push('password_hash = ?');
        values.push(null);
      }
    }

    if (normalizedNetid !== undefined) {
      updates.push('netid = ?');
      values.push(normalizedNetid);
    }

    if (first_name !== undefined) {
      updates.push('first_name = ?');
      values.push(first_name);
    }

    if (last_name !== undefined) {
      updates.push('last_name = ?');
      values.push(last_name);
    }

    if (full_name !== undefined) {
      updates.push('full_name = ?');
      values.push(full_name);
    }

    if (active !== undefined) {
      updates.push('active = ?');
      values.push(active ? 1 : 0);
    }

    // Admin-grantable permission flags
    let auditDetails = null;
    if (use_system_key !== undefined) {
      updates.push('use_system_key = ?');
      values.push(use_system_key ? 1 : 0);
      auditDetails = { ...(auditDetails || {}), use_system_key: Boolean(use_system_key) };
    }
    if (can_publish !== undefined) {
      updates.push('can_publish = ?');
      values.push(can_publish ? 1 : 0);
      auditDetails = { ...(auditDetails || {}), can_publish: Boolean(can_publish) };
    }
    if (monthly_token_cap !== undefined) {
      const cap = monthly_token_cap === null || monthly_token_cap === '' ? null : Number(monthly_token_cap);
      if (cap !== null && (!Number.isFinite(cap) || cap < 0)) {
        return res.status(400).json({ error: 'monthly_token_cap must be a non-negative number or null' });
      }
      updates.push('monthly_token_cap = ?');
      values.push(cap);
      auditDetails = { ...(auditDetails || {}), monthly_token_cap: cap };
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(id);
    await pool.execute(
      `UPDATE instructors SET ${updates.join(', ')} WHERE id = ?`,
      values
    );

    if (auditDetails) {
      await writeAudit(req, {
        action: 'instructor.permissions',
        resourceType: 'instructor',
        resourceId: id,
        details: auditDetails,
      });
    }

    // Fetch updated record
    const [rows] = await pool.execute(
      `SELECT id, email, netid, auth_method,
              first_name, last_name, full_name, active,
              use_system_key, can_publish, monthly_token_cap, created_at, last_login
       FROM instructors WHERE id = ?`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Instructor not found' });
    }

    res.json({
      data: {
        ...rows[0],
        active: Boolean(rows[0].active),
        use_system_key: Boolean(rows[0].use_system_key),
        can_publish: Boolean(rows[0].can_publish),
        monthly_token_cap: rows[0].monthly_token_cap == null ? null : Number(rows[0].monthly_token_cap),
      },
      error: null
    });
  } catch (error) {
    console.error('Error updating instructor:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

/**
 * DELETE /api/instructors/:id - Delete instructor (superuser only)
 */
router.delete('/:id', verifyToken, requireRole(['admin']), requireSuperuser, async (req, res) => {
  try {
    const { id } = req.params;
    const force = req.query.force === 'true';

    if (req.user.id === id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    // Check for owned resources first; require explicit transfer or ?force=true.
    const ownership = await getOwnershipCounts(id);
    if (!force && ownership.total > 0) {
      return res.status(409).json({
        data: null,
        error: {
          code: 'INSTRUCTOR_OWNS_RESOURCES',
          message: 'Instructor still owns resources. Transfer ownership first or pass ?force=true to orphan-and-delete.',
          ownership
        }
      });
    }

    const [result] = await pool.execute(
      'DELETE FROM instructors WHERE id = ?',
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Instructor not found' });
    }

    await writeAudit(req, {
      action: 'instructor.delete',
      resourceType: 'instructor',
      resourceId: id,
      details: { force, ownership }
    });

    res.json({ data: { success: true }, error: null });
  } catch (error) {
    console.error('Error deleting instructor:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// ============================================================
// Deactivation / activation
// ============================================================
async function getOwnershipCounts(instructorId) {
  const [[cases]] = await pool.execute(
    'SELECT COUNT(*) c FROM cases WHERE created_by = ? AND created_by_type = "instructor"',
    [instructorId]
  );
  const [[rubrics]] = await pool.execute(
    'SELECT COUNT(*) c FROM rubrics WHERE created_by = ? AND created_by_type = "instructor"',
    [instructorId]
  );
  const [[criteria]] = await pool.execute(
    'SELECT COUNT(*) c FROM rubric_criteria WHERE created_by = ? AND created_by_type = "instructor"',
    [instructorId]
  );
  const [[personas]] = await pool.execute(
    'SELECT COUNT(*) c FROM personas WHERE created_by = ? AND created_by_type = "instructor"',
    [instructorId]
  );
  const [[projects]] = await pool.execute(
    'SELECT COUNT(*) c FROM case_writer_projects WHERE owner_id = ? AND owner_type = "instructor"',
    [instructorId]
  );
  const [[courses]] = await pool.execute(
    'SELECT COUNT(*) c FROM courses WHERE primary_instructor_id = ?',
    [instructorId]
  );
  const [[sections]] = await pool.execute(
    'SELECT COUNT(*) c FROM sections WHERE primary_instructor_id = ?',
    [instructorId]
  );
  const out = {
    cases: cases.c, rubrics: rubrics.c, rubric_criteria: criteria.c,
    personas: personas.c, case_writer_projects: projects.c,
    courses: courses.c, sections: sections.c
  };
  out.total = Object.values(out).reduce((a, b) => a + b, 0);
  return out;
}

/**
 * POST /api/instructors/:id/deactivate - Soft-delete (active=0).
 * Resources remain owned; team-shared content stays visible. JWTs for the
 * instructor are rejected at the auth middleware on next request.
 */
router.post('/:id/deactivate', verifyToken, requireRole(['admin']), requireSuperuser, async (req, res) => {
  try {
    const { id } = req.params;
    if (req.user.id === id) {
      return res.status(400).json({ error: 'Cannot deactivate your own account' });
    }
    const [result] = await pool.execute(
      'UPDATE instructors SET active = 0 WHERE id = ?',
      [id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Instructor not found' });
    }
    await writeAudit(req, {
      action: 'instructor.deactivate',
      resourceType: 'instructor',
      resourceId: id
    });
    res.json({ data: { success: true, active: false }, error: null });
  } catch (error) {
    console.error('Error deactivating instructor:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

/**
 * POST /api/instructors/:id/activate - Re-enable a deactivated instructor.
 */
router.post('/:id/activate', verifyToken, requireRole(['admin']), requireSuperuser, async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await pool.execute(
      'UPDATE instructors SET active = 1 WHERE id = ?',
      [id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Instructor not found' });
    }
    await writeAudit(req, {
      action: 'instructor.activate',
      resourceType: 'instructor',
      resourceId: id
    });
    res.json({ data: { success: true, active: true }, error: null });
  } catch (error) {
    console.error('Error activating instructor:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

/**
 * GET /api/instructors/:id/ownership - Count owned resources (used before
 * deactivating or deleting to show "you still own N items" warnings).
 */
router.get('/:id/ownership', verifyToken, requireRole(['admin']), requireSuperuser, async (req, res) => {
  try {
    const ownership = await getOwnershipCounts(req.params.id);
    res.json({ data: ownership, error: null });
  } catch (error) {
    console.error('Error computing ownership:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

/**
 * POST /api/instructors/:id/transfer-ownership
 * Body: { targetInstructorId, scope: 'all' | { cases:[ids], rubrics:[ids], ... } }
 *
 * Re-points created_by / primary_instructor_id from :id to targetInstructorId.
 * Writes one audit entry summarising the transfer.
 */
router.post('/:id/transfer-ownership', verifyToken, requireRole(['admin']), requireSuperuser, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { id } = req.params;
    const { targetInstructorId, scope = 'all' } = req.body || {};

    if (!targetInstructorId) {
      connection.release();
      return res.status(400).json({ error: 'targetInstructorId is required' });
    }
    if (targetInstructorId === id) {
      connection.release();
      return res.status(400).json({ error: 'Source and target instructors must differ' });
    }

    const [src] = await connection.execute('SELECT id FROM instructors WHERE id = ?', [id]);
    const [tgt] = await connection.execute('SELECT id, active FROM instructors WHERE id = ?', [targetInstructorId]);
    if (src.length === 0) {
      connection.release();
      return res.status(404).json({ error: 'Source instructor not found' });
    }
    if (tgt.length === 0) {
      connection.release();
      return res.status(404).json({ error: 'Target instructor not found' });
    }
    if (!tgt[0].active) {
      connection.release();
      return res.status(400).json({ error: 'Target instructor is deactivated' });
    }

    await connection.beginTransaction();

    const before = await getOwnershipCounts(id);
    const transferred = {};

    async function moveAll(table, ownerCol, typeCol = null) {
      if (typeCol) {
        const [r] = await connection.execute(
          `UPDATE ${table} SET ${ownerCol} = ? WHERE ${ownerCol} = ? AND ${typeCol} = 'instructor'`,
          [targetInstructorId, id]
        );
        return r.affectedRows;
      }
      const [r] = await connection.execute(
        `UPDATE ${table} SET ${ownerCol} = ? WHERE ${ownerCol} = ?`,
        [targetInstructorId, id]
      );
      return r.affectedRows;
    }
    async function moveSubset(table, ownerCol, ids, typeCol = null) {
      if (!ids || ids.length === 0) return 0;
      const placeholders = ids.map(() => '?').join(',');
      const where = typeCol
        ? `${ownerCol} = ? AND ${typeCol} = 'instructor' AND id IN (${placeholders})`
        : `${ownerCol} = ? AND id IN (${placeholders})`;
      const [r] = await connection.execute(
        `UPDATE ${table} SET ${ownerCol} = ? WHERE ${where}`,
        [targetInstructorId, id, ...ids]
      );
      return r.affectedRows;
    }

    if (scope === 'all') {
      transferred.cases = await moveAll('cases', 'created_by', 'created_by_type');
      transferred.rubrics = await moveAll('rubrics', 'created_by', 'created_by_type');
      transferred.rubric_criteria = await moveAll('rubric_criteria', 'created_by', 'created_by_type');
      transferred.personas = await moveAll('personas', 'created_by', 'created_by_type');
      transferred.case_writer_projects = await moveAll('case_writer_projects', 'owner_id', 'owner_type');
      transferred.courses = await moveAll('courses', 'primary_instructor_id');
      transferred.sections = await moveAll('sections', 'primary_instructor_id');
    } else {
      transferred.cases = await moveSubset('cases', 'created_by', scope.cases, 'created_by_type');
      transferred.rubrics = await moveSubset('rubrics', 'created_by', scope.rubrics, 'created_by_type');
      transferred.rubric_criteria = await moveSubset('rubric_criteria', 'created_by', scope.rubric_criteria, 'created_by_type');
      transferred.personas = await moveSubset('personas', 'created_by', scope.personas, 'created_by_type');
      transferred.case_writer_projects = await moveSubset('case_writer_projects', 'owner_id', scope.case_writer_projects, 'owner_type');
      transferred.courses = await moveSubset('courses', 'primary_instructor_id', scope.courses);
      transferred.sections = await moveSubset('sections', 'primary_instructor_id', scope.sections);
    }

    await connection.commit();

    await writeAudit(req, {
      action: 'instructor.transfer_ownership',
      resourceType: 'instructor',
      resourceId: id,
      details: { source: id, target: targetInstructorId, scope, before, transferred }
    });

    res.json({ data: { source: id, target: targetInstructorId, transferred }, error: null });
  } catch (error) {
    try { await connection.rollback(); } catch (_) {}
    console.error('Error transferring ownership:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  } finally {
    try { connection.release(); } catch (_) {}
  }
});

// ============================================================
// Semester Assignments (Primary Instructors)
// ============================================================

/**
 * GET /api/instructors/:id/semesters - Get instructor's semester assignments
 */
router.get('/:id/semesters', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await pool.execute(`
      SELECT isem.id, isem.semester_id, isem.assigned_at, isem.assigned_by,
             sem.semester_name, sem.is_current, sem.start_date, sem.end_date
      FROM instructor_semesters isem
      JOIN semesters sem ON isem.semester_id = sem.id
      WHERE isem.instructor_id = ?
      ORDER BY sem.is_current DESC, sem.semester_name DESC
    `, [id]);

    res.json({
      data: rows.map(r => ({ ...r, is_current: Boolean(r.is_current) })),
      error: null
    });
  } catch (error) {
    console.error('Error fetching instructor semesters:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

/**
 * POST /api/instructors/:id/semesters - Assign instructor to semester (superuser only)
 */
router.post('/:id/semesters', verifyToken, requireRole(['admin']), requireSuperuser, async (req, res) => {
  try {
    const { id } = req.params;
    const { semester_id } = req.body;

    if (!semester_id) {
      return res.status(400).json({ error: 'semester_id is required' });
    }

    // Verify instructor exists
    const [instructor] = await pool.execute('SELECT id FROM instructors WHERE id = ?', [id]);
    if (instructor.length === 0) {
      return res.status(404).json({ error: 'Instructor not found' });
    }

    // Verify semester exists
    const [semester] = await pool.execute('SELECT id FROM semesters WHERE id = ?', [semester_id]);
    if (semester.length === 0) {
      return res.status(404).json({ error: 'Semester not found' });
    }

    // Check for existing assignment
    const [existing] = await pool.execute(
      'SELECT id FROM instructor_semesters WHERE instructor_id = ? AND semester_id = ?',
      [id, semester_id]
    );
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Instructor is already assigned to this semester' });
    }

    // Create assignment
    const [result] = await pool.execute(
      `INSERT INTO instructor_semesters (instructor_id, semester_id, assigned_by)
       VALUES (?, ?, ?)`,
      [id, semester_id, req.user.id]
    );

    res.status(201).json({
      data: {
        id: result.insertId,
        instructor_id: id,
        semester_id,
        assigned_by: req.user.id
      },
      error: null
    });
  } catch (error) {
    console.error('Error assigning instructor to semester:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

/**
 * DELETE /api/instructors/:id/semesters/:semesterId - Remove semester assignment (superuser only)
 */
router.delete('/:id/semesters/:semesterId', verifyToken, requireRole(['admin']), requireSuperuser, async (req, res) => {
  try {
    const { id, semesterId } = req.params;

    const [result] = await pool.execute(
      'DELETE FROM instructor_semesters WHERE instructor_id = ? AND semester_id = ?',
      [id, semesterId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    res.json({ data: { success: true }, error: null });
  } catch (error) {
    console.error('Error removing semester assignment:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// ============================================================
// Section Assignments (TAs)
// ============================================================

/**
 * GET /api/instructors/:id/sections - Get instructor's section assignments
 */
router.get('/:id/sections', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await pool.execute(`
      SELECT isec.id, isec.section_id, isec.can_manage_students,
             isec.can_manage_cases, isec.can_view_chats, isec.assigned_at,
             s.section_title, c.course_name, sem.semester_name
      FROM instructor_sections isec
      JOIN sections s ON isec.section_id = s.section_id
      LEFT JOIN courses c ON s.course_id = c.id
      LEFT JOIN semesters sem ON c.semester_id = sem.id
      WHERE isec.instructor_id = ?
      ORDER BY sem.semester_name DESC, c.course_name ASC, s.section_title ASC
    `, [id]);

    res.json({
      data: rows.map(r => ({
        ...r,
        can_manage_students: Boolean(r.can_manage_students),
        can_manage_cases: Boolean(r.can_manage_cases),
        can_view_chats: Boolean(r.can_view_chats)
      })),
      error: null
    });
  } catch (error) {
    console.error('Error fetching instructor sections:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

/**
 * POST /api/instructors/:id/sections - Assign instructor to section as TA
 * Superusers can assign anyone; primary instructors can assign to their sections
 */
router.post('/:id/sections', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const { id } = req.params;
    const { section_id, can_manage_students, can_manage_cases, can_view_chats } = req.body;

    if (!section_id) {
      return res.status(400).json({ error: 'section_id is required' });
    }

    // Check permission to assign to this section
    if (!req.user.superuser && req.user.role !== 'admin') {
      // Instructors can only assign to sections they are primary instructor for
      const isPrimary = await isPrimaryInstructorForSection(req.user.id, section_id);
      if (!isPrimary) {
        return res.status(403).json({ error: 'You can only assign TAs to your own sections' });
      }
    }

    // Verify instructor exists
    const [instructor] = await pool.execute('SELECT id FROM instructors WHERE id = ?', [id]);
    if (instructor.length === 0) {
      return res.status(404).json({ error: 'Instructor not found' });
    }

    // Verify section exists
    const [section] = await pool.execute('SELECT section_id FROM sections WHERE section_id = ?', [section_id]);
    if (section.length === 0) {
      return res.status(404).json({ error: 'Section not found' });
    }

    // Check for existing assignment
    const [existing] = await pool.execute(
      'SELECT id FROM instructor_sections WHERE instructor_id = ? AND section_id = ?',
      [id, section_id]
    );
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Instructor is already assigned to this section' });
    }

    // Create assignment
    const [result] = await pool.execute(
      `INSERT INTO instructor_sections
       (instructor_id, section_id, can_manage_students, can_manage_cases, can_view_chats, assigned_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        id,
        section_id,
        can_manage_students !== false ? 1 : 0,
        can_manage_cases !== false ? 1 : 0,
        can_view_chats !== false ? 1 : 0,
        req.user.id
      ]
    );

    res.status(201).json({
      data: {
        id: result.insertId,
        instructor_id: id,
        section_id,
        can_manage_students: can_manage_students !== false,
        can_manage_cases: can_manage_cases !== false,
        can_view_chats: can_view_chats !== false
      },
      error: null
    });
  } catch (error) {
    console.error('Error assigning instructor to section:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

/**
 * PATCH /api/instructors/:id/sections/:sectionId - Update TA permissions
 */
router.patch('/:id/sections/:sectionId', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const { id, sectionId } = req.params;
    const { can_manage_students, can_manage_cases, can_view_chats } = req.body;

    // Check permission
    if (!req.user.superuser && req.user.role !== 'admin') {
      const isPrimary = await isPrimaryInstructorForSection(req.user.id, sectionId);
      if (!isPrimary) {
        return res.status(403).json({ error: 'You can only modify TAs in your own sections' });
      }
    }

    const updates = [];
    const values = [];

    if (can_manage_students !== undefined) {
      updates.push('can_manage_students = ?');
      values.push(can_manage_students ? 1 : 0);
    }
    if (can_manage_cases !== undefined) {
      updates.push('can_manage_cases = ?');
      values.push(can_manage_cases ? 1 : 0);
    }
    if (can_view_chats !== undefined) {
      updates.push('can_view_chats = ?');
      values.push(can_view_chats ? 1 : 0);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(id, sectionId);
    const [result] = await pool.execute(
      `UPDATE instructor_sections SET ${updates.join(', ')} WHERE instructor_id = ? AND section_id = ?`,
      values
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    // Fetch updated record
    const [rows] = await pool.execute(
      `SELECT id, instructor_id, section_id, can_manage_students, can_manage_cases, can_view_chats
       FROM instructor_sections WHERE instructor_id = ? AND section_id = ?`,
      [id, sectionId]
    );

    res.json({
      data: {
        ...rows[0],
        can_manage_students: Boolean(rows[0].can_manage_students),
        can_manage_cases: Boolean(rows[0].can_manage_cases),
        can_view_chats: Boolean(rows[0].can_view_chats)
      },
      error: null
    });
  } catch (error) {
    console.error('Error updating section assignment:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

/**
 * DELETE /api/instructors/:id/sections/:sectionId - Remove section assignment
 */
router.delete('/:id/sections/:sectionId', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const { id, sectionId } = req.params;

    // Check permission
    if (!req.user.superuser && req.user.role !== 'admin') {
      const isPrimary = await isPrimaryInstructorForSection(req.user.id, sectionId);
      if (!isPrimary) {
        return res.status(403).json({ error: 'You can only remove TAs from your own sections' });
      }
    }

    const [result] = await pool.execute(
      'DELETE FROM instructor_sections WHERE instructor_id = ? AND section_id = ?',
      [id, sectionId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    res.json({ data: { success: true }, error: null });
  } catch (error) {
    console.error('Error removing section assignment:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// ============================================================
// Section-level TA listing (for section management)
// ============================================================

/**
 * GET /api/sections/:sectionId/instructors - Get TAs assigned to a section
 */
router.get('/sections/:sectionId/tas', verifyToken, requireSectionAccess('sectionId'), async (req, res) => {
  try {
    const { sectionId } = req.params;

    const [rows] = await pool.execute(`
      SELECT i.id, i.email, i.first_name, i.last_name, i.full_name,
             isec.can_manage_students, isec.can_manage_cases, isec.can_view_chats,
             isec.assigned_at
      FROM instructors i
      JOIN instructor_sections isec ON i.id = isec.instructor_id
      WHERE isec.section_id = ?
      ORDER BY i.full_name ASC
    `, [sectionId]);

    res.json({
      data: rows.map(r => ({
        ...r,
        can_manage_students: Boolean(r.can_manage_students),
        can_manage_cases: Boolean(r.can_manage_cases),
        can_view_chats: Boolean(r.can_view_chats)
      })),
      error: null
    });
  } catch (error) {
    console.error('Error fetching section TAs:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

export default router;
