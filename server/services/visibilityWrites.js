/**
 * Helpers for visibility + team-share writes.
 *
 * `setVisibility()` validates the new visibility value, enforces the
 * `can_publish` gate when transitioning to 'public', writes the row, and
 * (for team visibility) rewrites the resource_team_shares mapping.
 *
 * Callers should already have verified ownership (or admin-vision) via
 * `canAccessResource(..., 'share')` before invoking this.
 */
import { pool } from '../db.js';
import { canPublish, getResourceConfig } from './resourceAccess.js';
import { writeAudit } from './auditLog.js';

const ALLOWED = new Set(['private', 'team', 'public']);

/**
 * @param {object} req
 * @param {string} resourceType - key in RESOURCE_CONFIG
 * @param {string|number} resourceId
 * @param {{visibility: 'private'|'team'|'public', team_ids?: Array<{team_id:number, access_level?: 'view'|'edit'}>}} body
 * @returns {Promise<{ok: boolean, status?: number, error?: string}>}
 */
export async function setVisibility(req, resourceType, resourceId, body) {
  const cfg = getResourceConfig(resourceType);
  if (!cfg.visibilityCol) {
    return { ok: false, status: 400, error: 'Resource has no visibility column' };
  }
  const visibility = body?.visibility;
  if (!ALLOWED.has(visibility)) {
    return { ok: false, status: 400, error: "visibility must be 'private', 'team', or 'public'" };
  }
  if (visibility === 'public') {
    const ok = await canPublish(req);
    if (!ok) {
      return { ok: false, status: 403, error: 'You do not have permission to publish to all instructors.' };
    }
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.execute(
      `UPDATE ${cfg.table} SET ${cfg.visibilityCol} = ? WHERE ${cfg.pkCol} = ?`,
      [visibility, resourceId]
    );

    // Always clear existing team-shares for this resource; rewrite if team.
    await conn.execute(
      `DELETE FROM resource_team_shares WHERE resource_type = ? AND resource_id = ?`,
      [cfg.shareResourceType, String(resourceId)]
    );

    if (visibility === 'team' && Array.isArray(body.team_ids)) {
      for (const share of body.team_ids) {
        const teamId = share?.team_id;
        const access = share?.access_level === 'edit' ? 'edit' : 'view';
        if (!teamId) continue;
        await conn.execute(
          `INSERT INTO resource_team_shares (resource_type, resource_id, team_id, access_level)
           VALUES (?, ?, ?, ?)`,
          [cfg.shareResourceType, String(resourceId), teamId, access]
        );
      }
    }

    await conn.commit();

    await writeAudit(req, {
      action: 'resource.visibility',
      resourceType,
      resourceId: String(resourceId),
      details: {
        visibility,
        team_ids: Array.isArray(body.team_ids)
          ? body.team_ids.map(t => ({ team_id: t.team_id, access_level: t.access_level || 'view' }))
          : [],
      },
    });

    return { ok: true };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
