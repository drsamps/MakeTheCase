/**
 * Audit log writer.
 *
 * Captures sensitive actions (impersonation, transcript viewing, sharing,
 * key changes, ownership transfers) to the `audit_log` table created in
 * migration 052.
 *
 * Both `actor_admin_id` and `acted_as_instructor_id` are captured so writes
 * made under impersonation remain attributable to the originating admin.
 *
 * Failures inside this helper never throw - audit logging must not break
 * the underlying request. We log to stderr and continue.
 */
import { pool } from '../db.js';

/**
 * Resolve actor identity from req.user / req.effectiveInstructorId.
 *
 * @param {object} req - Express request
 * @returns {{actorAdminId: ?string, actorInstructorId: ?string, actedAsInstructorId: ?string}}
 */
function resolveActor(req) {
  const u = req.user || {};
  // Admin acting as themselves
  if (u.role === 'admin') {
    return {
      actorAdminId: u.id,
      actorInstructorId: null,
      actedAsInstructorId: req.effectiveInstructorId || null
    };
  }
  // Instructor (no impersonation)
  if (u.role === 'instructor') {
    return {
      actorAdminId: null,
      actorInstructorId: u.id,
      actedAsInstructorId: null
    };
  }
  return { actorAdminId: null, actorInstructorId: null, actedAsInstructorId: null };
}

/**
 * Write an audit log entry.
 *
 * @param {object} req - Express request (for actor + IP/UA)
 * @param {object} opts
 * @param {string} opts.action - e.g. 'login', 'impersonate.start', 'case.share', 'key.set'
 * @param {string} [opts.resourceType] - e.g. 'case', 'rubric'
 * @param {string} [opts.resourceId]
 * @param {object} [opts.details] - Optional structured payload (old/new values)
 */
export async function writeAudit(req, { action, resourceType = null, resourceId = null, details = null }) {
  try {
    const { actorAdminId, actorInstructorId, actedAsInstructorId } = resolveActor(req);
    const ip = (req.headers?.['x-forwarded-for'] || req.ip || '').toString().slice(0, 64);
    const ua = (req.headers?.['user-agent'] || '').toString().slice(0, 255);

    await pool.execute(
      `INSERT INTO audit_log
        (actor_admin_id, actor_instructor_id, acted_as_instructor_id,
         action, resource_type, resource_id, ip, user_agent, details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        actorAdminId,
        actorInstructorId,
        actedAsInstructorId,
        action,
        resourceType,
        resourceId ? String(resourceId).slice(0, 64) : null,
        ip || null,
        ua || null,
        details ? JSON.stringify(details) : null
      ]
    );
  } catch (err) {
    console.error('[audit] failed to write:', err.message);
  }
}

/**
 * Convenience wrapper for system-initiated audit entries (no req).
 * Used by background jobs, migrations, scripts.
 */
export async function writeSystemAudit({ action, instructorId = null, resourceType = null, resourceId = null, details = null }) {
  try {
    await pool.execute(
      `INSERT INTO audit_log
        (actor_admin_id, actor_instructor_id, acted_as_instructor_id,
         action, resource_type, resource_id, ip, user_agent, details)
       VALUES (NULL, ?, NULL, ?, ?, ?, NULL, 'system', ?)`,
      [
        instructorId,
        action,
        resourceType,
        resourceId ? String(resourceId).slice(0, 64) : null,
        details ? JSON.stringify(details) : null
      ]
    );
  } catch (err) {
    console.error('[audit] system-write failed:', err.message);
  }
}
