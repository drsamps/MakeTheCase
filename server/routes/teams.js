/**
 * Instructor teams.
 *
 *   GET    /api/teams                       - admin sees all; instructor sees teams they belong to
 *   GET    /api/teams/mine                  - lightweight list for visibility picker
 *   POST   /api/teams                       - create team (caller becomes owner)
 *   GET    /api/teams/:id                   - team detail with members
 *   PATCH  /api/teams/:id                   - update name/description (owner or admin)
 *   DELETE /api/teams/:id                   - delete (owner or admin)
 *
 *   POST   /api/teams/:id/invitations       - invite by email (owner/editor)
 *   POST   /api/teams/invitations/:invId/accept   - invited instructor accepts
 *   POST   /api/teams/invitations/:invId/decline  - invited instructor declines
 *   POST   /api/teams/invitations/:invId/revoke   - inviter or team owner revokes
 *   GET    /api/teams/invitations/mine            - pending invitations for caller
 *
 *   DELETE /api/teams/:id/members/:instructorId   - remove member (owner or self)
 *   PATCH  /api/teams/:id/members/:instructorId   - change role (owner only)
 */
import express from 'express';
import { randomUUID } from 'crypto';
import { pool } from '../db.js';
import { verifyToken } from '../middleware/auth.js';
import { requireAdminOrInstructor } from '../middleware/instructorAccess.js';
import { writeAudit } from '../services/auditLog.js';

const router = express.Router();

function callerInstructorId(req) {
  if (req.user?.role === 'instructor') return req.user.id;
  if (req.user?.role === 'admin' && req.effectiveInstructorId) {
    return req.effectiveInstructorId;
  }
  return null;
}

async function getMembership(teamId, instructorId) {
  if (!instructorId) return null;
  const [rows] = await pool.execute(
    'SELECT role FROM instructor_team_members WHERE team_id = ? AND instructor_id = ?',
    [teamId, instructorId]
  );
  return rows[0]?.role || null;
}

// ============================================================
// GET /api/teams/mine - lightweight list for visibility picker
// ============================================================
router.get('/mine', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const instructorId = callerInstructorId(req);
    if (!instructorId) {
      // Pure admin (not impersonating) sees all teams so they can share on others' behalf
      const [all] = await pool.execute(
        'SELECT id AS team_id, team_name FROM instructor_teams ORDER BY team_name'
      );
      return res.json({ data: all, error: null });
    }
    const [rows] = await pool.execute(
      `SELECT t.id AS team_id, t.team_name
       FROM instructor_teams t
       JOIN instructor_team_members m ON m.team_id = t.id
       WHERE m.instructor_id = ?
       ORDER BY t.team_name`,
      [instructorId]
    );
    res.json({ data: rows, error: null });
  } catch (error) {
    console.error('Error listing my teams:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// ============================================================
// GET /api/teams/invitations/mine - pending invitations for caller
// ============================================================
router.get('/invitations/mine', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const instructorId = callerInstructorId(req);
    if (!instructorId) return res.json({ data: [], error: null });

    // Match by id or by email (legacy invites)
    const [rows] = await pool.execute(
      `SELECT i.id, i.team_id, t.team_name, i.invited_by, ib.full_name AS invited_by_name,
              i.proposed_role, i.status, i.created_at
       FROM instructor_team_invitations i
       JOIN instructor_teams t ON t.id = i.team_id
       LEFT JOIN instructors ib ON ib.id = i.invited_by
       JOIN instructors me ON me.id = ?
       WHERE i.status = 'pending'
         AND (i.invited_instructor_id = me.id OR i.invited_email = me.email)
       ORDER BY i.created_at DESC`,
      [instructorId]
    );
    res.json({ data: rows, error: null });
  } catch (error) {
    console.error('Error listing my invitations:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// ============================================================
// GET /api/teams - list teams visible to caller
// ============================================================
router.get('/', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const instructorId = callerInstructorId(req);

    let query;
    let params = [];
    if (req.user.role === 'admin' && !req.effectiveInstructorId) {
      query = `SELECT t.id, t.team_name, t.description, t.created_by, t.created_at, t.updated_at,
                      (SELECT COUNT(*) FROM instructor_team_members m WHERE m.team_id = t.id) AS member_count
               FROM instructor_teams t
               ORDER BY t.team_name`;
    } else {
      query = `SELECT t.id, t.team_name, t.description, t.created_by, t.created_at, t.updated_at,
                      m.role AS my_role,
                      (SELECT COUNT(*) FROM instructor_team_members m2 WHERE m2.team_id = t.id) AS member_count
               FROM instructor_teams t
               JOIN instructor_team_members m ON m.team_id = t.id AND m.instructor_id = ?
               ORDER BY t.team_name`;
      params = [instructorId];
    }

    const [rows] = await pool.execute(query, params);
    res.json({ data: rows, error: null });
  } catch (error) {
    console.error('Error listing teams:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// ============================================================
// POST /api/teams - create a team
// ============================================================
router.post('/', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const { team_name, description } = req.body || {};
    if (!team_name || !team_name.trim()) {
      return res.status(400).json({ data: null, error: { message: 'team_name is required' } });
    }
    const instructorId = callerInstructorId(req);
    if (!instructorId) {
      return res.status(400).json({
        data: null,
        error: { message: 'Admins must impersonate an instructor to create a team' },
      });
    }

    const id = randomUUID();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(
        'INSERT INTO instructor_teams (id, team_name, description, created_by) VALUES (?, ?, ?, ?)',
        [id, team_name.trim(), description || null, instructorId]
      );
      await conn.execute(
        `INSERT INTO instructor_team_members (team_id, instructor_id, role) VALUES (?, ?, 'owner')`,
        [id, instructorId]
      );
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    await writeAudit(req, {
      action: 'team.create',
      resourceType: 'team',
      resourceId: id,
      details: { team_name },
    });

    const [rows] = await pool.execute('SELECT * FROM instructor_teams WHERE id = ?', [id]);
    res.status(201).json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error creating team:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// ============================================================
// GET /api/teams/:id - team detail with members
// ============================================================
router.get('/:id', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const { id } = req.params;
    const [teams] = await pool.execute('SELECT * FROM instructor_teams WHERE id = ?', [id]);
    if (teams.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Team not found' } });
    }

    const instructorId = callerInstructorId(req);
    const myRole = await getMembership(id, instructorId);
    if (req.user.role !== 'admin' && !myRole) {
      return res.status(403).json({ data: null, error: { message: 'forbidden' } });
    }

    const [members] = await pool.execute(
      `SELECT m.instructor_id, m.role, m.joined_at, i.email, i.full_name
       FROM instructor_team_members m
       JOIN instructors i ON i.id = m.instructor_id
       WHERE m.team_id = ?
       ORDER BY m.role = 'owner' DESC, i.full_name`,
      [id]
    );

    const [invites] = await pool.execute(
      `SELECT id, invited_email, invited_by, proposed_role, status, created_at, responded_at
       FROM instructor_team_invitations
       WHERE team_id = ? AND status = 'pending'
       ORDER BY created_at DESC`,
      [id]
    );

    res.json({ data: { ...teams[0], my_role: myRole, members, invitations: invites }, error: null });
  } catch (error) {
    console.error('Error fetching team:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// ============================================================
// PATCH /api/teams/:id
// ============================================================
router.patch('/:id', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const { id } = req.params;
    const { team_name, description } = req.body || {};
    const instructorId = callerInstructorId(req);
    const myRole = await getMembership(id, instructorId);
    if (req.user.role !== 'admin' && myRole !== 'owner') {
      return res.status(403).json({ data: null, error: { message: 'forbidden' } });
    }

    const updates = [];
    const params = [];
    if (team_name !== undefined) { updates.push('team_name = ?'); params.push(team_name); }
    if (description !== undefined) { updates.push('description = ?'); params.push(description); }
    if (updates.length === 0) {
      return res.status(400).json({ data: null, error: { message: 'No fields to update' } });
    }
    params.push(id);
    await pool.execute(`UPDATE instructor_teams SET ${updates.join(', ')} WHERE id = ?`, params);

    await writeAudit(req, { action: 'team.update', resourceType: 'team', resourceId: id });
    const [rows] = await pool.execute('SELECT * FROM instructor_teams WHERE id = ?', [id]);
    res.json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error updating team:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// ============================================================
// DELETE /api/teams/:id
// ============================================================
router.delete('/:id', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const { id } = req.params;
    const instructorId = callerInstructorId(req);
    const myRole = await getMembership(id, instructorId);
    if (req.user.role !== 'admin' && myRole !== 'owner') {
      return res.status(403).json({ data: null, error: { message: 'forbidden' } });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute('DELETE FROM resource_team_shares WHERE team_id = ?', [id]);
      await conn.execute('DELETE FROM instructor_team_members WHERE team_id = ?', [id]);
      await conn.execute('DELETE FROM instructor_team_invitations WHERE team_id = ?', [id]);
      await conn.execute('DELETE FROM instructor_teams WHERE id = ?', [id]);
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    await writeAudit(req, { action: 'team.delete', resourceType: 'team', resourceId: id });
    res.json({ data: { deleted: true }, error: null });
  } catch (error) {
    console.error('Error deleting team:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// ============================================================
// POST /api/teams/:id/invitations - invite an instructor by email
// ============================================================
router.post('/:id/invitations', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const { id: teamId } = req.params;
    const email = (req.body?.email || req.body?.invited_email || '').trim();
    const role = req.body?.role ?? req.body?.proposed_role;
    if (!email) {
      return res.status(400).json({ data: null, error: { message: 'email is required' } });
    }
    const proposedRole = ['owner', 'editor', 'viewer'].includes(role) ? role : 'viewer';

    const instructorId = callerInstructorId(req);
    const myRole = await getMembership(teamId, instructorId);
    if (req.user.role !== 'admin' && !['owner', 'editor'].includes(myRole)) {
      return res.status(403).json({ data: null, error: { message: 'forbidden' } });
    }

    // Resolve invited instructor (best-effort) by email
    const [invitedRows] = await pool.execute(
      'SELECT id FROM instructors WHERE email = ?',
      [email.toLowerCase()]
    );
    const invitedInstructorId = invitedRows[0]?.id || null;

    if (invitedInstructorId) {
      // Already a member?
      const [existing] = await pool.execute(
        'SELECT 1 FROM instructor_team_members WHERE team_id = ? AND instructor_id = ?',
        [teamId, invitedInstructorId]
      );
      if (existing.length > 0) {
        return res.status(409).json({
          data: null,
          error: { message: 'Already a member of this team' },
        });
      }
    }

    // Existing pending invitation?
    const [pending] = await pool.execute(
      `SELECT id FROM instructor_team_invitations
       WHERE team_id = ? AND invited_email = ? AND status = 'pending'`,
      [teamId, email.toLowerCase()]
    );
    if (pending.length > 0) {
      return res.status(409).json({
        data: null,
        error: { message: 'A pending invitation already exists for this email' },
      });
    }

    const inviterId = instructorId || req.user.id;
    const [result] = await pool.execute(
      `INSERT INTO instructor_team_invitations
         (team_id, invited_instructor_id, invited_email, invited_by, proposed_role, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [teamId, invitedInstructorId, email.toLowerCase(), inviterId, proposedRole]
    );

    await writeAudit(req, {
      action: 'team.invite',
      resourceType: 'team',
      resourceId: teamId,
      details: { email, role: proposedRole },
    });

    res.status(201).json({
      data: { id: result.insertId, team_id: teamId, invited_email: email, proposed_role: proposedRole },
      error: null,
    });
  } catch (error) {
    console.error('Error creating invitation:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// ============================================================
// POST /api/teams/invitations/:invId/accept
// ============================================================
router.post('/invitations/:invId/accept', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const { invId } = req.params;
    const instructorId = callerInstructorId(req);
    if (!instructorId) {
      return res.status(400).json({ data: null, error: { message: 'Must be an instructor to accept' } });
    }

    const [rows] = await pool.execute(
      `SELECT i.*, ins.email AS my_email
       FROM instructor_team_invitations i
       JOIN instructors ins ON ins.id = ?
       WHERE i.id = ?`,
      [instructorId, invId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Invitation not found' } });
    }
    const inv = rows[0];
    if (inv.status !== 'pending') {
      return res.status(409).json({ data: null, error: { message: `Invitation is ${inv.status}` } });
    }
    const matchesMe = inv.invited_instructor_id === instructorId ||
      inv.invited_email?.toLowerCase() === inv.my_email?.toLowerCase();
    if (!matchesMe) {
      return res.status(403).json({ data: null, error: { message: 'forbidden' } });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(
        `INSERT IGNORE INTO instructor_team_members (team_id, instructor_id, role) VALUES (?, ?, ?)`,
        [inv.team_id, instructorId, inv.proposed_role]
      );
      await conn.execute(
        `UPDATE instructor_team_invitations SET status='accepted', responded_at=NOW() WHERE id = ?`,
        [invId]
      );
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    await writeAudit(req, {
      action: 'team.invitation.accept',
      resourceType: 'team',
      resourceId: inv.team_id,
    });
    res.json({ data: { accepted: true, team_id: inv.team_id }, error: null });
  } catch (error) {
    console.error('Error accepting invitation:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// ============================================================
// POST /api/teams/invitations/:invId/decline
// ============================================================
router.post('/invitations/:invId/decline', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const { invId } = req.params;
    const instructorId = callerInstructorId(req);
    if (!instructorId) {
      return res.status(400).json({ data: null, error: { message: 'Must be an instructor' } });
    }
    const [rows] = await pool.execute(
      `SELECT i.*, ins.email AS my_email
       FROM instructor_team_invitations i
       JOIN instructors ins ON ins.id = ?
       WHERE i.id = ?`,
      [instructorId, invId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Invitation not found' } });
    }
    const inv = rows[0];
    if (inv.status !== 'pending') {
      return res.status(409).json({ data: null, error: { message: `Invitation is ${inv.status}` } });
    }
    const matchesMe = inv.invited_instructor_id === instructorId ||
      inv.invited_email?.toLowerCase() === inv.my_email?.toLowerCase();
    if (!matchesMe) {
      return res.status(403).json({ data: null, error: { message: 'forbidden' } });
    }
    await pool.execute(
      `UPDATE instructor_team_invitations SET status='declined', responded_at=NOW() WHERE id = ?`,
      [invId]
    );
    res.json({ data: { declined: true }, error: null });
  } catch (error) {
    console.error('Error declining invitation:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// ============================================================
// POST /api/teams/invitations/:invId/revoke - inviter or team owner
// ============================================================
router.post('/invitations/:invId/revoke', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const { invId } = req.params;
    const [rows] = await pool.execute(
      'SELECT * FROM instructor_team_invitations WHERE id = ?',
      [invId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Invitation not found' } });
    }
    const inv = rows[0];
    const instructorId = callerInstructorId(req);
    const myRole = await getMembership(inv.team_id, instructorId);
    const isOwner = myRole === 'owner';
    const isInviter = inv.invited_by === instructorId;
    if (req.user.role !== 'admin' && !isOwner && !isInviter) {
      return res.status(403).json({ data: null, error: { message: 'forbidden' } });
    }
    await pool.execute(
      `UPDATE instructor_team_invitations SET status='revoked', responded_at=NOW() WHERE id = ?`,
      [invId]
    );
    res.json({ data: { revoked: true }, error: null });
  } catch (error) {
    console.error('Error revoking invitation:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// ============================================================
// DELETE /api/teams/:id/members/:instructorId
// ============================================================
router.delete('/:id/members/:instructorId', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const { id: teamId, instructorId: targetId } = req.params;
    const callerId = callerInstructorId(req);
    const myRole = await getMembership(teamId, callerId);
    const isSelfRemoval = callerId === targetId;
    if (req.user.role !== 'admin' && myRole !== 'owner' && !isSelfRemoval) {
      return res.status(403).json({ data: null, error: { message: 'forbidden' } });
    }

    // Prevent removing the last owner
    const [owners] = await pool.execute(
      `SELECT instructor_id FROM instructor_team_members WHERE team_id = ? AND role = 'owner'`,
      [teamId]
    );
    if (owners.length === 1 && owners[0].instructor_id === targetId) {
      return res.status(409).json({
        data: null,
        error: { message: 'Cannot remove the last owner. Promote another member first.' },
      });
    }

    await pool.execute(
      'DELETE FROM instructor_team_members WHERE team_id = ? AND instructor_id = ?',
      [teamId, targetId]
    );
    await writeAudit(req, {
      action: 'team.member.remove',
      resourceType: 'team',
      resourceId: teamId,
      details: { removed_instructor_id: targetId },
    });
    res.json({ data: { removed: true }, error: null });
  } catch (error) {
    console.error('Error removing member:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// ============================================================
// PATCH /api/teams/:id/members/:instructorId - change role
// ============================================================
router.patch('/:id/members/:instructorId', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const { id: teamId, instructorId: targetId } = req.params;
    const { role } = req.body || {};
    if (!['owner', 'editor', 'viewer'].includes(role)) {
      return res.status(400).json({ data: null, error: { message: 'Invalid role' } });
    }

    const callerId = callerInstructorId(req);
    const myRole = await getMembership(teamId, callerId);
    if (req.user.role !== 'admin' && myRole !== 'owner') {
      return res.status(403).json({ data: null, error: { message: 'forbidden' } });
    }

    // Demoting the last owner is not allowed
    if (role !== 'owner') {
      const [owners] = await pool.execute(
        `SELECT instructor_id FROM instructor_team_members WHERE team_id = ? AND role = 'owner'`,
        [teamId]
      );
      if (owners.length === 1 && owners[0].instructor_id === targetId) {
        return res.status(409).json({
          data: null,
          error: { message: 'Cannot demote the last owner.' },
        });
      }
    }

    await pool.execute(
      'UPDATE instructor_team_members SET role = ? WHERE team_id = ? AND instructor_id = ?',
      [role, teamId, targetId]
    );
    await writeAudit(req, {
      action: 'team.member.role',
      resourceType: 'team',
      resourceId: teamId,
      details: { instructor_id: targetId, role },
    });
    res.json({ data: { updated: true }, error: null });
  } catch (error) {
    console.error('Error updating member role:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

export default router;
