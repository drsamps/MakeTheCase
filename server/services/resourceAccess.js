/**
 * Unified resource access + visibility scoping.
 *
 * Every list/get endpoint for a shared resource (cases, rubrics,
 * rubric_criteria, personas, case_writer_projects) must filter its query
 * through `buildVisibilityScope()` so the WHERE clause is consistent. Routes
 * MUST NOT write ad-hoc visibility filters.
 *
 * `canAccessResource()` answers a yes/no question for a single resource
 * given an action ('view' | 'edit' | 'delete' | 'share'). Used by middleware
 * and by inline route checks before mutations.
 *
 * Role semantics:
 *   admin (not impersonating)  - sees everything; can edit anything
 *   admin (impersonating)      - acts as the target instructor; effective
 *                                identity is req.effectiveInstructorId
 *   instructor                 - sees: own + team-shared + public + system
 */
import { pool } from '../db.js';

// ============================================================
// Resource configuration
// ============================================================
//
// Each entry describes the columns this helper needs on a given resource's
// table. The `shareResourceType` matches the ENUM in resource_team_shares.
//
// `systemDefaultCol` is null when a resource has no system-default tier.

const RESOURCE_CONFIG = {
  case: {
    table: 'cases',
    pkCol: 'case_id',
    ownerCol: 'created_by',
    ownerTypeCol: 'created_by_type',
    visibilityCol: 'visibility',
    systemDefaultCol: null,
    shareResourceType: 'case'
  },
  rubric: {
    table: 'rubrics',
    pkCol: 'rubric_id',
    ownerCol: 'created_by',
    ownerTypeCol: 'created_by_type',
    visibilityCol: 'visibility',
    systemDefaultCol: 'is_system_default',
    shareResourceType: 'rubric'
  },
  rubric_criteria: {
    table: 'rubric_criteria',
    pkCol: 'id',
    ownerCol: 'created_by',
    ownerTypeCol: 'created_by_type',
    visibilityCol: 'visibility',
    systemDefaultCol: 'is_system_default',
    shareResourceType: 'rubric_criteria'
  },
  persona: {
    table: 'personas',
    pkCol: 'persona_id',
    ownerCol: 'created_by',
    ownerTypeCol: 'created_by_type',
    visibilityCol: 'visibility',
    systemDefaultCol: 'is_system_default',
    shareResourceType: 'persona'
  },
  case_writer_project: {
    table: 'case_writer_projects',
    pkCol: 'project_id',
    ownerCol: 'owner_id',
    ownerTypeCol: 'owner_type',
    visibilityCol: 'visibility',
    systemDefaultCol: null,
    shareResourceType: 'case_writer_project'
  }
};

export function getResourceConfig(resourceType) {
  const cfg = RESOURCE_CONFIG[resourceType];
  if (!cfg) throw new Error(`Unknown resourceType: ${resourceType}`);
  return cfg;
}

// ============================================================
// Effective identity (impersonation-aware)
// ============================================================

/**
 * The instructor whose viewpoint should be used for scoping.
 *
 *   instructor             -> their own id
 *   admin (impersonating)  -> req.effectiveInstructorId
 *   admin (not impersonating) -> null (means "see everything")
 *
 * @param {object} req
 * @returns {string|null}
 */
export function getEffectiveInstructorId(req) {
  const u = req.user || {};
  if (u.role === 'instructor') return u.id;
  if (u.role === 'admin' && req.effectiveInstructorId) {
    return req.effectiveInstructorId;
  }
  return null;
}

/**
 * True when the caller has god-mode visibility (admin without impersonation).
 */
export function hasAdminVision(req) {
  return req.user?.role === 'admin' && !req.effectiveInstructorId;
}

// ============================================================
// Visibility scope (WHERE-fragment builder)
// ============================================================

/**
 * Build a WHERE-fragment + params that filter `<alias>.<table>` rows to the
 * set the caller may view.
 *
 *   const { whereSql, params } = buildVisibilityScope(req, 'rubric', 'r');
 *   const [rows] = await pool.execute(
 *     `SELECT r.* FROM rubrics r WHERE ${whereSql} ORDER BY r.created_at`,
 *     params
 *   );
 *
 * The fragment is always parenthesized so it composes safely with AND/OR.
 *
 * @param {object} req
 * @param {string} resourceType - key in RESOURCE_CONFIG
 * @param {string} alias - table alias used in the calling query
 * @returns {{whereSql: string, params: any[]}}
 */
export function buildVisibilityScope(req, resourceType, alias) {
  const cfg = getResourceConfig(resourceType);
  const a = alias;

  // Admin with no impersonation - unrestricted.
  if (hasAdminVision(req)) {
    return { whereSql: '(1=1)', params: [] };
  }

  const effectiveId = getEffectiveInstructorId(req);
  if (!effectiveId) {
    // Authenticated but no instructor identity - deny everything.
    return { whereSql: '(1=0)', params: [] };
  }

  const clauses = [];
  const params = [];

  // 1. Owned by the effective instructor.
  clauses.push(`${a}.${cfg.ownerCol} = ?`);
  params.push(effectiveId);

  // 2. Public visibility (if the table has a visibility column).
  if (cfg.visibilityCol) {
    clauses.push(`${a}.${cfg.visibilityCol} = 'public'`);
  }

  // 3. System defaults (if the table has the flag).
  if (cfg.systemDefaultCol) {
    clauses.push(`${a}.${cfg.systemDefaultCol} = 1`);
  }

  // 4. Team-shared - resource appears in resource_team_shares for any team
  //    the effective instructor is a member of.
  if (cfg.visibilityCol) {
    clauses.push(
      `(${a}.${cfg.visibilityCol} = 'team' AND ${a}.${cfg.pkCol} IN (
         SELECT rts.resource_id
         FROM resource_team_shares rts
         JOIN instructor_team_members itm ON itm.team_id = rts.team_id
         WHERE rts.resource_type = ? AND itm.instructor_id = ?
       ))`
    );
    params.push(cfg.shareResourceType, effectiveId);
  }

  return { whereSql: `(${clauses.join(' OR ')})`, params };
}

// ============================================================
// Single-resource access check (canAccessResource)
// ============================================================

/**
 * Fetch the row, then evaluate visibility + ownership + team shares + role
 * to decide if `action` is allowed.
 *
 * Returns `{ allowed, reason, row }`:
 *   allowed: boolean
 *   reason:  short string for logs/UI ("owner", "public", "team:edit", "admin", ...)
 *   row:     the fetched row (or null if not found)
 *
 * Actions:
 *   'view'   - read access
 *   'edit'   - mutate fields except visibility
 *   'share'  - set/change visibility (Private/Team/Public)
 *   'delete' - remove the resource
 *
 * Admin (no impersonation): allowed for everything except 'share' to public
 *   if their target instructor lacks can_publish. (Admins themselves bypass.)
 *
 * @param {object} req
 * @param {string} resourceType
 * @param {string|number} resourceId
 * @param {'view'|'edit'|'share'|'delete'} action
 */
export async function canAccessResource(req, resourceType, resourceId, action = 'view') {
  const cfg = getResourceConfig(resourceType);

  // Fetch the row (need visibility + owner to decide).
  const cols = [cfg.pkCol, cfg.ownerCol, cfg.ownerTypeCol];
  if (cfg.visibilityCol) cols.push(cfg.visibilityCol);
  if (cfg.systemDefaultCol) cols.push(cfg.systemDefaultCol);
  const [rows] = await pool.execute(
    `SELECT ${cols.join(', ')} FROM ${cfg.table} WHERE ${cfg.pkCol} = ? LIMIT 1`,
    [resourceId]
  );
  if (rows.length === 0) {
    return { allowed: false, reason: 'not_found', row: null };
  }
  const row = rows[0];

  // System-default rows are read-only to everyone except superuser.
  const isSystem = cfg.systemDefaultCol && row[cfg.systemDefaultCol] === 1;
  if (isSystem) {
    if (action === 'view') return { allowed: true, reason: 'system', row };
    if (req.user?.superuser) return { allowed: true, reason: 'superuser', row };
    return { allowed: false, reason: 'system_readonly', row };
  }

  // Admin with full vision (not impersonating).
  if (hasAdminVision(req)) {
    return { allowed: true, reason: 'admin', row };
  }

  const effectiveId = getEffectiveInstructorId(req);
  if (!effectiveId) return { allowed: false, reason: 'no_identity', row };

  // Owner can do anything to their own resource.
  if (row[cfg.ownerCol] === effectiveId) {
    return { allowed: true, reason: 'owner', row };
  }

  // Non-owner actions: view + (sometimes) edit through team shares.
  const visibility = cfg.visibilityCol ? row[cfg.visibilityCol] : null;

  if (action === 'view') {
    if (visibility === 'public') return { allowed: true, reason: 'public', row };
    if (visibility === 'team') {
      const access = await teamShareAccess(cfg.shareResourceType, row[cfg.pkCol], effectiveId);
      if (access) return { allowed: true, reason: `team:${access}`, row };
    }
    return { allowed: false, reason: 'not_visible', row };
  }

  if (action === 'edit') {
    if (visibility === 'team') {
      const access = await teamShareAccess(cfg.shareResourceType, row[cfg.pkCol], effectiveId);
      if (access === 'edit') return { allowed: true, reason: 'team:edit', row };
    }
    return { allowed: false, reason: 'not_owner', row };
  }

  // 'share' and 'delete' require ownership; non-owners cannot.
  return { allowed: false, reason: 'not_owner', row };
}

/**
 * Returns the team access_level ('view' | 'edit') for a resource if the
 * effective instructor is a member of any team it's shared with, else null.
 */
async function teamShareAccess(shareResourceType, resourceId, instructorId) {
  const [rows] = await pool.execute(
    `SELECT MAX(CASE WHEN rts.access_level = 'edit' THEN 2 ELSE 1 END) AS lvl
     FROM resource_team_shares rts
     JOIN instructor_team_members itm ON itm.team_id = rts.team_id
     WHERE rts.resource_type = ?
       AND rts.resource_id = ?
       AND itm.instructor_id = ?`,
    [shareResourceType, String(resourceId), instructorId]
  );
  if (!rows.length || rows[0].lvl == null) return null;
  return rows[0].lvl === 2 ? 'edit' : 'view';
}

// ============================================================
// Publish permission
// ============================================================

/**
 * Resolve whether the caller may set visibility='public' on a resource.
 *
 * Admins always can. Instructors need `instructors.can_publish = 1`.
 * Caches per-request via req._canPublish so multiple checks in one request
 * don't re-query the DB.
 */
export async function canPublish(req) {
  if (hasAdminVision(req)) return true;
  if (req._canPublish !== undefined) return req._canPublish;

  const effectiveId = getEffectiveInstructorId(req);
  if (!effectiveId) {
    req._canPublish = false;
    return false;
  }
  const [rows] = await pool.execute(
    'SELECT can_publish FROM instructors WHERE id = ? LIMIT 1',
    [effectiveId]
  );
  const ok = rows.length > 0 && rows[0].can_publish === 1;
  req._canPublish = ok;
  return ok;
}
