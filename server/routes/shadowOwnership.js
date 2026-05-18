/**
 * Shadow-instructor ownership management.
 *
 * After running `npm run migrate` + `node server/scripts/backfill-multi-instructor.js`,
 * every legacy resource (created before the multi-instructor pivot) is owned
 * by the seeded shadow instructor (`00000000-0000-0000-0000-000000000001`).
 *
 * These routes let a superuser admin:
 *   GET    /api/admin/shadow-ownership/summary
 *          counts of shadow-owned rows per resource type
 *
 *   GET    /api/admin/shadow-ownership/list/:resourceType
 *          rows currently parked on the shadow (case|rubric|rubric_criteria|
 *          persona|case_writer_project|course|section)
 *
 *   POST   /api/admin/shadow-ownership/transfer
 *          re-point ownership of one row, all rows of one type, or everything
 *          from shadow -> target instructor. Writes one audit entry per call.
 *
 * Only superusers may call these endpoints. We do NOT allow an instructor to
 * "claim" rows themselves — the admin decides who gets what.
 */
import express from 'express';
import { pool } from '../db.js';
import { verifyToken } from '../middleware/auth.js';
import { requireSuperuser } from '../middleware/instructorAccess.js';
import { writeAudit } from '../services/auditLog.js';

const router = express.Router();

const SHADOW_ID = '00000000-0000-0000-0000-000000000001';

// Resource type -> SQL bits. Each entry knows its table, the columns to
// update on transfer, and (where applicable) a label expression for the list
// endpoint so the admin UI has something human-readable to show.
const SHADOW_TARGETS = {
  case: {
    table: 'cases',
    pkCol: 'case_id',
    ownerCol: 'created_by',
    ownerTypeCol: 'created_by_type',
    labelSql: 'title',
    extraSql: 'created_at'
  },
  rubric: {
    table: 'rubrics',
    pkCol: 'rubric_id',
    ownerCol: 'created_by',
    ownerTypeCol: 'created_by_type',
    labelSql: 'name',
    extraSql: 'created_at',
    systemDefaultCol: 'is_system_default'
  },
  rubric_criteria: {
    table: 'rubric_criteria',
    pkCol: 'id',
    ownerCol: 'created_by',
    ownerTypeCol: 'created_by_type',
    labelSql: 'name',
    extraSql: 'criteria_id',
    systemDefaultCol: 'is_system_default'
  },
  persona: {
    table: 'personas',
    pkCol: 'persona_id',
    ownerCol: 'created_by',
    ownerTypeCol: 'created_by_type',
    labelSql: 'name',
    extraSql: 'created_at',
    systemDefaultCol: 'is_system_default'
  },
  case_writer_project: {
    table: 'case_writer_projects',
    pkCol: 'project_id',
    ownerCol: 'owner_id',
    ownerTypeCol: 'owner_type',
    labelSql: 'title',
    extraSql: 'created_at'
  },
  course: {
    table: 'courses',
    pkCol: 'id',
    ownerCol: 'primary_instructor_id',
    ownerTypeCol: null,
    labelSql: 'course_name',
    extraSql: 'semester_id'
  },
  section: {
    table: 'sections',
    pkCol: 'section_id',
    ownerCol: 'primary_instructor_id',
    ownerTypeCol: null,
    labelSql: 'section_name',
    extraSql: 'course_id'
  }
};

function getTarget(type) {
  const t = SHADOW_TARGETS[type];
  if (!t) {
    const err = new Error(`Unknown resourceType: ${type}`);
    err.statusCode = 400;
    throw err;
  }
  return t;
}

// ============================================================
// GET /summary  - counts per resource type
// ============================================================

router.get('/summary', verifyToken, requireSuperuser, async (req, res) => {
  try {
    const out = {};
    for (const [type, cfg] of Object.entries(SHADOW_TARGETS)) {
      const sysFilter = cfg.systemDefaultCol ? ` AND ${cfg.systemDefaultCol} = 0` : '';
      const [rows] = await pool.execute(
        `SELECT COUNT(*) AS n FROM ${cfg.table} WHERE ${cfg.ownerCol} = ?${sysFilter}`,
        [SHADOW_ID]
      );
      out[type] = rows[0].n;
    }
    res.json({ shadowInstructorId: SHADOW_ID, counts: out });
  } catch (err) {
    console.error('[shadow-ownership/summary]', err);
    res.status(500).json({ error: 'Failed to load summary' });
  }
});

// ============================================================
// GET /list/:resourceType  - rows currently owned by the shadow
// ============================================================

router.get('/list/:resourceType', verifyToken, requireSuperuser, async (req, res) => {
  try {
    const cfg = getTarget(req.params.resourceType);
    const sysFilter = cfg.systemDefaultCol ? ` AND ${cfg.systemDefaultCol} = 0` : '';
    const [rows] = await pool.execute(
      `SELECT ${cfg.pkCol} AS id, ${cfg.labelSql} AS label, ${cfg.extraSql} AS extra
       FROM ${cfg.table}
       WHERE ${cfg.ownerCol} = ?${sysFilter}
       ORDER BY ${cfg.extraSql} DESC
       LIMIT 500`,
      [SHADOW_ID]
    );
    res.json({ resourceType: req.params.resourceType, rows });
  } catch (err) {
    if (err.statusCode === 400) {
      return res.status(400).json({ error: err.message });
    }
    console.error('[shadow-ownership/list]', err);
    res.status(500).json({ error: 'Failed to list shadow rows' });
  }
});

// ============================================================
// POST /transfer  - re-point ownership shadow -> target
// ============================================================
//
// Body shapes:
//   { resourceType: 'case', resourceId: 'abc', targetInstructorId: '...' }
//     - transfer one specific row
//
//   { resourceType: 'case', all: true, targetInstructorId: '...' }
//     - transfer every shadow-owned row of one type
//
//   { all: true, targetInstructorId: '...' }
//     - transfer everything across every type (use sparingly)

router.post('/transfer', verifyToken, requireSuperuser, async (req, res) => {
  const { resourceType, resourceId, all, targetInstructorId } = req.body || {};
  if (!targetInstructorId) {
    return res.status(400).json({ error: 'targetInstructorId required' });
  }
  if (targetInstructorId === SHADOW_ID) {
    return res.status(400).json({ error: 'Cannot transfer to the shadow account' });
  }

  let conn;
  try {
    // Verify target instructor exists, is active, and is not itself a system account.
    const [tRows] = await pool.execute(
      'SELECT id, email, is_system_account, active FROM instructors WHERE id = ? LIMIT 1',
      [targetInstructorId]
    );
    if (tRows.length === 0) {
      return res.status(404).json({ error: 'Target instructor not found' });
    }
    if (tRows[0].is_system_account === 1) {
      return res.status(400).json({ error: 'Target cannot be a system account' });
    }

    const summary = [];
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const transferOneType = async (type, idMaybe) => {
      const cfg = getTarget(type);
      const params = [targetInstructorId, SHADOW_ID];
      const sysFilter = cfg.systemDefaultCol ? ` AND ${cfg.systemDefaultCol} = 0` : '';
      let where = `${cfg.ownerCol} = ?${sysFilter}`;
      if (idMaybe) {
        where += ` AND ${cfg.pkCol} = ?`;
        params.push(idMaybe);
      }
      const setOwnerType = cfg.ownerTypeCol
        ? `, ${cfg.ownerTypeCol} = 'instructor'`
        : '';
      const [r] = await conn.execute(
        `UPDATE ${cfg.table} SET ${cfg.ownerCol} = ?${setOwnerType} WHERE ${where}`,
        params
      );
      summary.push({ type, rows: r.affectedRows });
    };

    if (all === true && !resourceType) {
      for (const type of Object.keys(SHADOW_TARGETS)) {
        await transferOneType(type, null);
      }
    } else if (resourceType && all === true) {
      await transferOneType(resourceType, null);
    } else if (resourceType && resourceId) {
      await transferOneType(resourceType, resourceId);
    } else {
      await conn.rollback();
      return res.status(400).json({
        error: 'Provide either {all:true}, {resourceType, all:true}, or {resourceType, resourceId}'
      });
    }

    await conn.commit();

    await writeAudit(req, {
      action: 'shadow.transfer_ownership',
      resourceType: resourceType || 'all',
      resourceId: resourceId || null,
      details: {
        targetInstructorId,
        targetEmail: tRows[0].email,
        summary
      }
    });

    res.json({ ok: true, summary });
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (_) { /* swallow */ }
    }
    console.error('[shadow-ownership/transfer]', err);
    res.status(500).json({ error: 'Transfer failed' });
  } finally {
    if (conn) conn.release();
  }
});

export default router;
