/**
 * Course case lists and case settings versions (migration 078).
 *
 *   /api/courses/:id/cases                         the course's case list, versions and who follows them
 *   /api/case-versions/:versionId[/...]            read/edit one version -- same body shapes as the
 *                                                  section-level routes in sectionCases.js, so the
 *                                                  dashboard editors can target either
 *   /api/sections/:sectionId/cases/:caseId/version re-link a section to a version, or detach it
 *
 * Every write to a version runs in a transaction that ends with applyVersion(), so linked
 * sections change in the same commit (services/caseVersionSync.js).
 *
 * Writes are gated admin OR course owner (courses.primary_instructor_id). Reads need course access.
 * Exception: rollover creates sections (course structure) and is admin only.
 */

import express from 'express';
import { pool } from '../db.js';
import { verifyToken, requireRole } from '../middleware/auth.js';
import {
  requireAdminOrInstructor,
  requireCourseAccess,
  requireCourseOwnerOrAdmin,
  canAccessCourse,
  canManageSectionCases,
  isCourseOwner,
} from '../middleware/instructorAccess.js';
import {
  CaseVersionError,
  applyVersion,
  copyVersion,
  createCourseCase,
  linkSectionToVersion,
  loadVersion,
} from '../services/caseVersionSync.js';
import { writeAudit } from '../services/auditLog.js';
import { canAccessResource } from '../services/resourceAccess.js';
import { addMinutes, parseDateInput } from '../utils/dateInput.js';
import { executeRollover, planRollover } from '../services/courseRollover.js';
import { ProvisioningError } from '../services/sectionProvisioning.js';
import { backupBeforeRollover } from '../services/databaseBackup.js';

const router = express.Router();

const isAdminUser = (req) => Boolean(req.user?.superuser || req.user?.role === 'admin');

function sendError(res, error, context) {
  if (error instanceof CaseVersionError) {
    return res.status(error.status).json({ data: null, error: { message: error.message, code: error.code } });
  }
  if (error?.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ data: null, error: { message: 'That already exists. Refresh and try again.' } });
  }
  console.error(context, error);
  return res.status(500).json({ data: null, error: { message: error.message } });
}

/** Load :versionId into req.version and check access. `write` requires admin or course owner. */
function loadVersionParam(write) {
  return async (req, res, next) => {
    try {
      const version = await loadVersion(pool, req.params.versionId);
      if (!version) {
        return res.status(404).json({ data: null, error: { message: 'Version not found' } });
      }
      const isAdmin = req.user.superuser || req.user.role === 'admin';
      if (!isAdmin) {
        const allowed = write
          ? await isCourseOwner(req.user.id, version.course_id)
          : await canAccessCourse(req.user.id, version.course_id);
        if (!allowed) {
          return res.status(403).json({ data: null, error: { message: write ? 'Only admins or the course owner can edit course case settings' : 'Access denied to this course' } });
        }
      }
      req.version = version;
      next();
    } catch (error) {
      sendError(res, error, 'Error loading version:');
    }
  };
}

/**
 * Run a version edit in a transaction and write it through to linked sections.
 * `fn(conn, version, req)` returns the response data (or throws CaseVersionError).
 */
function versionWrite(fn) {
  return async (req, res) => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const data = await fn(conn, req.version, req);
      const sectionsUpdated = await applyVersion(conn, req.version.version_id);
      await conn.commit();
      res.json({ data, sections_updated: sectionsUpdated, error: null });
    } catch (error) {
      try { await conn.rollback(); } catch (_) {}
      sendError(res, error, 'Error editing case version:');
    } finally {
      conn.release();
    }
  };
}

const parseJson = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return null; }
};

// ============================================================================
// Course case list
// ============================================================================

// GET /api/courses/:id/cases - Case list with versions, the sections following each, and the
// Customized sections (course sections with the case but no version). Each section row carries
// its own scheduling (active, open/close, manual_status), which never comes from a version.
// `unlisted` = cases on some of the course's sections that are not on the course list.
router.get('/courses/:id/cases', verifyToken, requireAdminOrInstructor, requireCourseAccess('id'), async (req, res) => {
  try {
    const courseId = req.params.id;
    const [cases] = await pool.execute(
      `SELECT cc.id AS course_case_id, cc.case_id, cc.sort_order, c.case_title, c.enabled AS case_enabled
         FROM course_cases cc JOIN cases c ON c.case_id = cc.case_id
        WHERE cc.course_id = ?
        ORDER BY cc.sort_order, c.case_title`,
      [courseId]
    );
    const [versions] = await pool.execute(
      `SELECT v.version_id, v.course_case_id, v.semester_id, v.is_main, v.label, v.parent_version_id,
              v.rubric_id, v.updated_at, sem.semester_code, sem.semester_name
         FROM course_case_versions v
         JOIN course_cases cc ON cc.id = v.course_case_id
         LEFT JOIN semesters sem ON sem.id = v.semester_id
        WHERE cc.course_id = ?
        ORDER BY v.is_main DESC, sem.start_date IS NULL, sem.start_date DESC, v.label`,
      [courseId]
    );
    const [rows] = await pool.execute(
      `SELECT sc.section_id, sc.case_id, sc.version_id, sc.active, sc.open_date, sc.close_date,
              sc.manual_status, s.section_number, s.semester_id, sem.semester_code, sem.semester_name,
              c.case_title
         FROM section_cases sc
         JOIN sections s ON s.section_id = sc.section_id
         JOIN cases c ON c.case_id = sc.case_id
         LEFT JOIN semesters sem ON sem.id = s.semester_id
        WHERE s.course_id = ?
        ORDER BY sem.start_date IS NULL, sem.start_date DESC, s.section_number, sc.section_id`,
      [courseId]
    );
    const sectionRow = ({ case_title, ...row }) => ({ ...row, active: Boolean(row.active) });

    const data = cases.map((cc) => ({
      ...cc,
      versions: versions
        .filter((v) => v.course_case_id === cc.course_case_id)
        .map((v) => ({
          ...v,
          is_main: v.is_main === 1,
          sections: rows.filter((r) => r.case_id === cc.case_id && r.version_id === v.version_id).map(sectionRow),
        })),
      customized_sections: rows.filter((r) => r.case_id === cc.case_id && r.version_id == null).map(sectionRow),
    }));

    const listed = new Set(cases.map((cc) => cc.case_id));
    const unlisted = new Map();
    for (const r of rows) {
      if (listed.has(r.case_id)) continue;
      if (!unlisted.has(r.case_id)) unlisted.set(r.case_id, { case_id: r.case_id, case_title: r.case_title, sections: [] });
      unlisted.get(r.case_id).sections.push(sectionRow(r));
    }
    res.json({ data, unlisted: [...unlisted.values()], error: null });
  } catch (error) {
    sendError(res, error, 'Error fetching course cases:');
  }
});

// POST /api/courses/:id/cases - Add a case to the course.
// Body: { case_id, from_section_id?, section_ids?: string[] }
//   from_section_id  start Main from that section's current settings for this case
//                    (that section is then linked to Main)
//   section_ids      also give these course sections the case, inactive, following Main
router.post('/courses/:id/cases', verifyToken, requireAdminOrInstructor, requireCourseOwnerOrAdmin('id'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const courseId = Number(req.params.id);
    const { case_id, from_section_id, section_ids = [] } = req.body || {};
    if (!case_id) {
      return res.status(400).json({ data: null, error: { message: 'case_id is required' } });
    }
    const [caseRows] = await conn.execute('SELECT case_id FROM cases WHERE case_id = ?', [case_id]);
    if (caseRows.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Case not found' } });
    }
    // A course owner may add only cases they can see (own, team-shared, public), as POST /sections/:sectionId/cases.
    if (!isAdminUser(req) && !(await canAccessResource(req, 'case', case_id, 'view')).allowed) {
      return res.status(403).json({ data: null, error: { message: 'You do not have access to that case' } });
    }

    let fromSectionCaseId = null;
    if (from_section_id) {
      const [src] = await conn.execute(
        `SELECT sc.id FROM section_cases sc JOIN sections s ON s.section_id = sc.section_id
          WHERE sc.section_id = ? AND sc.case_id = ? AND s.course_id = ?`,
        [from_section_id, case_id, courseId]
      );
      if (src.length === 0) {
        return res.status(400).json({ data: null, error: { message: `Section ${from_section_id} of this course does not have this case` } });
      }
      fromSectionCaseId = src[0].id;
    }

    await conn.beginTransaction();
    const { courseCaseId, mainVersionId } = await createCourseCase(conn, {
      courseId, caseId: case_id, fromSectionCaseId, createdBy: req.user.id,
    });

    const targets = new Set(Array.isArray(section_ids) ? section_ids : []);
    if (from_section_id) targets.add(from_section_id);
    const linked = [];
    for (const sectionId of targets) {
      const { created } = await linkSectionToVersion(conn, sectionId, mainVersionId);
      linked.push({ section_id: sectionId, created });
    }
    await conn.commit();

    res.status(201).json({ data: { course_case_id: courseCaseId, main_version_id: mainVersionId, linked }, error: null });
  } catch (error) {
    try { await conn.rollback(); } catch (_) {}
    sendError(res, error, 'Error adding case to course:');
  } finally {
    conn.release();
  }
});

// DELETE /api/courses/:id/cases/:caseId - Remove a case from the course list.
// Sections keep their assignments; rows that followed its versions become Customized.
router.delete('/courses/:id/cases/:caseId', verifyToken, requireAdminOrInstructor, requireCourseOwnerOrAdmin('id'), async (req, res) => {
  try {
    const [result] = await pool.execute(
      'DELETE FROM course_cases WHERE course_id = ? AND case_id = ?',
      [req.params.id, req.params.caseId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ data: null, error: { message: 'Case is not on this course' } });
    }
    await writeAudit(req, {
      action: 'course.case_removed',
      resourceType: 'course',
      resourceId: String(req.params.id),
      details: { case_id: req.params.caseId },
    });
    res.json({ data: { deleted: true }, error: null });
  } catch (error) {
    sendError(res, error, 'Error removing case from course:');
  }
});

// PATCH /api/courses/:id/cases/reorder - { order: case_id[] } sets the course's custom case order
// (course_cases.sort_order, used by the "Custom" sort in Assignments > By course and by rollover).
// Cases left out of `order` keep their current relative order after the listed ones.
router.patch('/courses/:id/cases/reorder', verifyToken, requireAdminOrInstructor, requireCourseOwnerOrAdmin('id'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const courseId = Number(req.params.id);
    const { order } = req.body || {};
    if (!Array.isArray(order) || order.length === 0 || order.some((id) => typeof id !== 'string')) {
      return res.status(400).json({ data: null, error: { message: 'order must be a non-empty array of case IDs' } });
    }
    const [existing] = await conn.execute(
      `SELECT cc.case_id FROM course_cases cc JOIN cases c ON c.case_id = cc.case_id
        WHERE cc.course_id = ? ORDER BY cc.sort_order, c.case_title`,
      [courseId]
    );
    const current = existing.map((r) => r.case_id);
    const stray = order.filter((id) => !current.includes(id));
    if (stray.length > 0) {
      return res.status(400).json({ data: null, error: { message: `Not cases of this course: ${stray.join(', ')}` } });
    }
    const listed = [...new Set(order)];
    const finalOrder = [...listed, ...current.filter((id) => !listed.includes(id))];

    await conn.beginTransaction();
    for (let i = 0; i < finalOrder.length; i++) {
      await conn.execute('UPDATE course_cases SET sort_order = ? WHERE course_id = ? AND case_id = ?', [i, courseId, finalOrder[i]]);
    }
    await conn.commit();
    await writeAudit(req, {
      action: 'course.cases_reordered',
      resourceType: 'course',
      resourceId: String(courseId),
      details: { order: finalOrder },
    });
    res.json({ data: { order: finalOrder }, error: null });
  } catch (error) {
    try { await conn.rollback(); } catch (_) {}
    sendError(res, error, 'Error reordering course cases:');
  } finally {
    conn.release();
  }
});

// ============================================================================
// Bulk scheduling for a course in one semester
// ============================================================================

// POST /api/courses/:id/schedule - Set a case's open/close dates on several sections at once.
// Body: { semester_id, case_id, section_ids?: string[] (default: all sections of the course in
//         that semester), open_date, close_date, manual_status?, offsets?: { [section_id]: minutes } }
// Dates are per section (class meeting times differ); `offsets` shifts both dates for a section.
// Allowed for admins, the course owner, or the primary instructor of EVERY targeted section.
router.post('/courses/:id/schedule', verifyToken, requireAdminOrInstructor, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const courseId = Number(req.params.id);
    const { semester_id, case_id, section_ids, manual_status, offsets = {} } = req.body || {};
    if (!semester_id || !case_id) {
      return res.status(400).json({ data: null, error: { message: 'semester_id and case_id are required' } });
    }
    if (manual_status && !['auto', 'manually_opened', 'manually_closed'].includes(manual_status)) {
      return res.status(400).json({ data: null, error: { message: 'manual_status must be "auto", "manually_opened", or "manually_closed"' } });
    }
    let openDate;
    let closeDate;
    try {
      openDate = parseDateInput(req.body.open_date);
      closeDate = parseDateInput(req.body.close_date);
    } catch (dateError) {
      return res.status(400).json({ data: null, error: { message: dateError.message } });
    }
    if (openDate && closeDate && closeDate <= openDate) {
      return res.status(400).json({ data: null, error: { message: 'Close date must be after open date' } });
    }

    const [sectionRows] = await conn.execute(
      `SELECT s.section_id, s.primary_instructor_id, sc.id AS section_case_id
         FROM sections s
         LEFT JOIN section_cases sc ON sc.section_id = s.section_id AND sc.case_id = ?
        WHERE s.course_id = ? AND s.semester_id = ?
        ORDER BY s.section_number, s.section_id`,
      [case_id, courseId, semester_id]
    );
    const wanted = Array.isArray(section_ids) && section_ids.length > 0 ? new Set(section_ids) : null;
    const targets = sectionRows.filter((s) => !wanted || wanted.has(s.section_id));
    if (wanted) {
      const known = new Set(sectionRows.map((s) => s.section_id));
      const stray = [...wanted].filter((id) => !known.has(id));
      if (stray.length > 0) {
        return res.status(400).json({ data: null, error: { message: `Not sections of this course in that semester: ${stray.join(', ')}` } });
      }
    }
    if (targets.length === 0) {
      return res.status(400).json({ data: null, error: { message: 'No sections to schedule' } });
    }

    // Admins and the course owner schedule every section. Anyone else schedules the sections whose
    // cases they manage (primary instructor, or TA with can_manage_cases), the same rule as the
    // per-section scheduling route; the rest are skipped rather than refusing the whole request.
    const updated = [];
    const skipped = [];
    const manageAll = isAdminUser(req) || (await isCourseOwner(req.user.id, courseId));
    const manageable = [];
    for (const s of targets) {
      if (manageAll || (await canManageSectionCases(req, s.section_id))) manageable.push(s);
      else skipped.push({ section_id: s.section_id, reason: 'You cannot manage cases on this section' });
    }
    if (manageable.length === 0) {
      return res.status(403).json({ data: null, error: { message: `You cannot manage cases on: ${targets.map((s) => s.section_id).join(', ')}` } });
    }

    await conn.beginTransaction();
    for (const s of manageable) {
      if (!s.section_case_id) {
        skipped.push({ section_id: s.section_id, reason: 'Case is not assigned to this section' });
        continue;
      }
      const offset = Number(offsets[s.section_id] || 0);
      const open = addMinutes(openDate, offset);
      const close = addMinutes(closeDate, offset);
      const sets = ['open_date = ?', 'close_date = ?'];
      const params = [open, close];
      if (manual_status) { sets.push('manual_status = ?'); params.push(manual_status); }
      await conn.execute(`UPDATE section_cases SET ${sets.join(', ')} WHERE id = ?`, [...params, s.section_case_id]);
      updated.push({ section_id: s.section_id, open_date: open, close_date: close, offset_minutes: offset });
    }
    await conn.commit();

    await writeAudit(req, {
      action: 'course.bulk_schedule',
      resourceType: 'course',
      resourceId: String(courseId),
      details: { semester_id, case_id, sections: updated.map((u) => u.section_id), skipped: skipped.length },
    });
    res.json({ data: { updated, skipped }, error: null });
  } catch (error) {
    try { await conn.rollback(); } catch (_) {}
    sendError(res, error, 'Error bulk scheduling:');
  } finally {
    conn.release();
  }
});

// ============================================================================
// Rollover: carry a course's sections and case setup into another semester
// ============================================================================

// POST /api/courses/:id/rollover
// Body: { from_semester_id, to_semester_id, section_ids?: string[], section_numbers?: {[legacy_id]: n},
//         copy_tas?: boolean, preview?: boolean, backup_first?: boolean }
// preview:true (the default) writes nothing. Re-planned inside the transaction on execute, so
// the result matches what is in the database at that moment. See services/courseRollover.js.
// backup_first: on execute only, take a `pre-rollover` database backup before the transaction
// opens; if it fails the rollover is refused. The file stays on the server (Admin > Backup).
// Admin only: rollover creates sections, which is course structure.
router.post('/courses/:id/rollover', verifyToken, requireRole(['admin']), async (req, res) => {
  const b = req.body || {};
  const input = {
    courseId: Number(req.params.id),
    fromSemesterId: Number(b.from_semester_id),
    toSemesterId: Number(b.to_semester_id),
    sectionIds: b.section_ids || null,
    sectionNumbers: b.section_numbers || {},
  };
  if (!input.fromSemesterId || !input.toSemesterId) {
    return res.status(400).json({ data: null, error: { message: 'from_semester_id and to_semester_id are required' } });
  }

  if (b.preview !== false) {
    try {
      return res.json({ data: await planRollover(pool, input), error: null });
    } catch (error) {
      return sendRolloverError(res, error);
    }
  }

  let backup = null;
  if (b.backup_first) {
    const outcome = await backupBeforeRollover(req, writeAudit);
    if (!outcome.backup) return res.status(outcome.status).json(outcome.body);
    backup = outcome.backup;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const plan = await planRollover(conn, input);
    const result = await executeRollover(conn, plan, { copyTas: Boolean(b.copy_tas), userId: req.user.id });
    await conn.commit();
    await writeAudit(req, {
      action: 'course.rollover',
      resourceType: 'course',
      resourceId: String(input.courseId),
      details: { from: input.fromSemesterId, to: input.toSemesterId, created: result.created, copies_created: result.copies_created, backup: backup?.name ?? null },
    });
    res.json({ data: { ...result, plan, backup }, error: null });
  } catch (error) {
    try { await conn.rollback(); } catch (_) {}
    if (backup) error.message = `${error.message} (A backup was taken first: ${backup.name}.)`;
    sendRolloverError(res, error);
  } finally {
    conn.release();
  }
});

function sendRolloverError(res, error) {
  if (error instanceof ProvisioningError) {
    return res.status(error.status).json({ data: null, error: { message: error.message } });
  }
  return sendError(res, error, 'Error rolling course over:');
}

// ============================================================================
// Versions: read
// ============================================================================

// GET /api/case-versions/:versionId - Version settings (chat_options parsed) and context
router.get('/case-versions/:versionId', verifyToken, requireAdminOrInstructor, loadVersionParam(false), async (req, res) => {
  const v = req.version;
  res.json({
    data: { ...v, is_main: v.is_main === 1, chat_options: parseJson(v.chat_options) },
    error: null,
  });
});

// GET /api/case-versions/:versionId/scenarios - Same shape as GET /sections/:s/cases/:c/scenarios
router.get('/case-versions/:versionId/scenarios', verifyToken, requireAdminOrInstructor, loadVersionParam(false), async (req, res) => {
  try {
    const v = req.version;
    const [rows] = await pool.execute(
      `SELECT vs.id, vs.version_id, vs.scenario_id, vs.enabled, vs.sort_order,
              cs.scenario_name, cs.protagonist, cs.protagonist_initials, cs.protagonist_role,
              cs.chat_topic, cs.chat_question, cs.enabled AS scenario_enabled
         FROM course_case_version_scenarios vs
         JOIN case_scenarios cs ON cs.id = vs.scenario_id
        WHERE vs.version_id = ?
        ORDER BY vs.sort_order ASC, vs.id ASC`,
      [v.version_id]
    );
    res.json({
      data: {
        version_id: v.version_id,
        selection_mode: v.selection_mode,
        require_order: v.require_order,
        use_scenarios: v.use_scenarios,
        scenarios: rows,
      },
      error: null,
    });
  } catch (error) {
    sendError(res, error, 'Error fetching version scenarios:');
  }
});

// GET /api/case-versions/:versionId/positions - Positions of this version's enabled scenarios
router.get('/case-versions/:versionId/positions', verifyToken, requireAdminOrInstructor, loadVersionParam(false), async (req, res) => {
  try {
    const vid = req.version.version_id;
    const [rows] = await pool.execute(
      `SELECT sp.position_id, sp.scenario_id, sp.position_name, sp.position, sp.position_order,
              sp.position_enabled AS default_enabled, cs.scenario_name,
              COALESCE(vp.enabled, sp.position_enabled) AS enabled,
              COALESCE(vp.sort_order, sp.position_order) AS sort_order,
              vp.id AS override_id
         FROM course_case_version_scenarios vs
         JOIN case_scenarios cs ON vs.scenario_id = cs.id
         JOIN scenario_positions sp ON sp.scenario_id = cs.id
         LEFT JOIN course_case_version_positions vp ON vp.version_id = ? AND vp.position_id = sp.position_id
        WHERE vs.version_id = ? AND vs.enabled = TRUE AND cs.enabled = TRUE
        ORDER BY cs.scenario_name, COALESCE(vp.sort_order, sp.position_order) ASC`,
      [vid, vid]
    );
    res.json({ data: rows, error: null });
  } catch (error) {
    sendError(res, error, 'Error fetching version positions:');
  }
});

// ============================================================================
// Versions: edit (each writes through to linked sections)
// ============================================================================

const WRITE = [verifyToken, requireAdminOrInstructor, loadVersionParam(true)];

// PATCH /api/case-versions/:versionId - { label }
router.patch('/case-versions/:versionId', ...WRITE, versionWrite(async (conn, v, req) => {
  const label = typeof req.body?.label === 'string' ? req.body.label.trim() : '';
  if (!label) throw new CaseVersionError(400, 'Label is required');
  if (v.is_main === 1) throw new CaseVersionError(400, 'Main cannot be renamed');
  await conn.execute('UPDATE course_case_versions SET label = ? WHERE version_id = ?', [label.slice(0, 100), v.version_id]);
  return { version_id: v.version_id, label };
}));

// PATCH /api/case-versions/:versionId/options - { chat_options }
router.patch('/case-versions/:versionId/options', ...WRITE, versionWrite(async (conn, v, req) => {
  const { chat_options } = req.body || {};
  if (chat_options !== null && typeof chat_options !== 'object') {
    throw new CaseVersionError(400, 'chat_options must be an object or null');
  }
  await conn.execute(
    'UPDATE course_case_versions SET chat_options = ? WHERE version_id = ?',
    [chat_options ? JSON.stringify(chat_options) : null, v.version_id]
  );
  return { version_id: v.version_id, chat_options };
}));

// PATCH /api/case-versions/:versionId/rubric - { rubric_id }
router.patch('/case-versions/:versionId/rubric', ...WRITE, versionWrite(async (conn, v, req) => {
  const { rubric_id } = req.body || {};
  if (rubric_id !== null && rubric_id !== undefined && !Number.isInteger(rubric_id)) {
    throw new CaseVersionError(400, 'rubric_id must be an integer or null');
  }
  if (rubric_id) {
    const [r] = await conn.execute('SELECT rubric_id FROM rubrics WHERE rubric_id = ? AND enabled = 1', [rubric_id]);
    if (r.length === 0) throw new CaseVersionError(400, 'Rubric not found or disabled');
    // Same check as the section rubric route; applyVersion would otherwise copy it to every linked section.
    if (!isAdminUser(req) && !(await canAccessResource(req, 'rubric', rubric_id, 'view')).allowed) {
      throw new CaseVersionError(403, 'You do not have access to that rubric');
    }
  }
  await conn.execute('UPDATE course_case_versions SET rubric_id = ? WHERE version_id = ?', [rubric_id || null, v.version_id]);
  return { version_id: v.version_id, rubric_id: rubric_id || null };
}));

// PATCH /api/case-versions/:versionId/selection-mode - { selection_mode?, require_order? }
router.patch('/case-versions/:versionId/selection-mode', ...WRITE, versionWrite(async (conn, v, req) => {
  const { selection_mode, require_order } = req.body || {};
  if (selection_mode && !['student_choice', 'all_required'].includes(selection_mode)) {
    throw new CaseVersionError(400, 'selection_mode must be "student_choice" or "all_required"');
  }
  const sets = [];
  const params = [];
  if (selection_mode !== undefined) { sets.push('selection_mode = ?'); params.push(selection_mode); }
  if (require_order !== undefined) { sets.push('require_order = ?'); params.push(require_order ? 1 : 0); }
  if (sets.length === 0) throw new CaseVersionError(400, 'No fields to update');
  await conn.execute(`UPDATE course_case_versions SET ${sets.join(', ')} WHERE version_id = ?`, [...params, v.version_id]);
  return { version_id: v.version_id };
}));

// PATCH /api/case-versions/:versionId/position-settings
router.patch('/case-versions/:versionId/position-settings', ...WRITE, versionWrite(async (conn, v, req) => {
  const { position_tracking_enabled, position_capture_method, track_position_change } = req.body || {};
  const validMethods = ['explicit', 'ai_inferred', 'instructor_manual', 'none'];
  if (position_capture_method && !validMethods.includes(position_capture_method)) {
    throw new CaseVersionError(400, `position_capture_method must be one of: ${validMethods.join(', ')}`);
  }
  const sets = [];
  const params = [];
  if (position_tracking_enabled !== undefined) { sets.push('position_tracking_enabled = ?'); params.push(position_tracking_enabled ? 1 : 0); }
  if (position_capture_method !== undefined) { sets.push('position_capture_method = ?'); params.push(position_capture_method); }
  if (track_position_change !== undefined) { sets.push('track_position_change = ?'); params.push(track_position_change ? 1 : 0); }
  if (sets.length === 0) throw new CaseVersionError(400, 'No fields to update');
  await conn.execute(`UPDATE course_case_versions SET ${sets.join(', ')} WHERE version_id = ?`, [...params, v.version_id]);
  return { version_id: v.version_id };
}));

// POST /api/case-versions/:versionId/scenarios - { scenario_ids: number[] }
router.post('/case-versions/:versionId/scenarios', ...WRITE, versionWrite(async (conn, v, req) => {
  const { scenario_ids } = req.body || {};
  if (!Array.isArray(scenario_ids) || scenario_ids.length === 0) {
    throw new CaseVersionError(400, 'scenario_ids must be a non-empty array');
  }
  const [valid] = await conn.execute(
    `SELECT id FROM case_scenarios WHERE case_id = ? AND id IN (${scenario_ids.map(() => '?').join(',')})`,
    [v.case_id, ...scenario_ids]
  );
  if (valid.length !== scenario_ids.length) {
    throw new CaseVersionError(400, 'Some scenario IDs do not belong to this case');
  }
  const [[{ nextOrder }]] = await conn.execute(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS nextOrder FROM course_case_version_scenarios WHERE version_id = ?',
    [v.version_id]
  );
  let order = nextOrder;
  for (const scenarioId of scenario_ids) {
    await conn.execute(
      `INSERT IGNORE INTO course_case_version_scenarios (version_id, scenario_id, enabled, sort_order)
       VALUES (?, ?, 1, ?)`,
      [v.version_id, scenarioId, order++]
    );
  }
  await conn.execute('UPDATE course_case_versions SET use_scenarios = 1 WHERE version_id = ?', [v.version_id]);
  return { version_id: v.version_id };
}));

// DELETE /api/case-versions/:versionId/scenarios/:scenarioId
router.delete('/case-versions/:versionId/scenarios/:scenarioId', ...WRITE, versionWrite(async (conn, v, req) => {
  const [result] = await conn.execute(
    'DELETE FROM course_case_version_scenarios WHERE version_id = ? AND scenario_id = ?',
    [v.version_id, req.params.scenarioId]
  );
  if (result.affectedRows === 0) throw new CaseVersionError(404, 'Scenario assignment not found');
  const [[{ n }]] = await conn.execute(
    'SELECT COUNT(*) AS n FROM course_case_version_scenarios WHERE version_id = ?',
    [v.version_id]
  );
  if (n === 0) {
    await conn.execute('UPDATE course_case_versions SET use_scenarios = 0 WHERE version_id = ?', [v.version_id]);
  }
  return { deleted: true };
}));

// PATCH /api/case-versions/:versionId/scenarios/reorder - { order: scenarioId[] }
router.patch('/case-versions/:versionId/scenarios/reorder', ...WRITE, versionWrite(async (conn, v, req) => {
  const { order } = req.body || {};
  if (!Array.isArray(order) || order.length === 0) {
    throw new CaseVersionError(400, 'order must be a non-empty array of scenario IDs');
  }
  for (let i = 0; i < order.length; i++) {
    await conn.execute(
      'UPDATE course_case_version_scenarios SET sort_order = ? WHERE version_id = ? AND scenario_id = ?',
      [i, v.version_id, order[i]]
    );
  }
  return { version_id: v.version_id };
}));

// PATCH /api/case-versions/:versionId/scenarios/:scenarioId/toggle
router.patch('/case-versions/:versionId/scenarios/:scenarioId/toggle', ...WRITE, versionWrite(async (conn, v, req) => {
  const [rows] = await conn.execute(
    'SELECT id, enabled FROM course_case_version_scenarios WHERE version_id = ? AND scenario_id = ?',
    [v.version_id, req.params.scenarioId]
  );
  if (rows.length === 0) throw new CaseVersionError(404, 'Scenario assignment not found');
  const enabled = !rows[0].enabled;
  await conn.execute('UPDATE course_case_version_scenarios SET enabled = ? WHERE id = ?', [enabled ? 1 : 0, rows[0].id]);
  return { id: rows[0].id, enabled };
}));

// PATCH /api/case-versions/:versionId/positions/reorder - { positions: [{position_id, sort_order}] }
router.patch('/case-versions/:versionId/positions/reorder', ...WRITE, versionWrite(async (conn, v, req) => {
  const { positions } = req.body || {};
  if (!Array.isArray(positions)) throw new CaseVersionError(400, 'positions must be an array');
  for (const pos of positions) {
    // A new override row starts from the position's own default, so reordering never enables
    // a position that is disabled by default.
    await conn.execute(
      `INSERT INTO course_case_version_positions (version_id, position_id, enabled, sort_order)
       SELECT ?, sp.position_id, sp.position_enabled, ? FROM scenario_positions sp WHERE sp.position_id = ?
       ON DUPLICATE KEY UPDATE sort_order = ?`,
      [v.version_id, pos.sort_order, pos.position_id, pos.sort_order]
    );
  }
  return { success: true };
}));

// PATCH /api/case-versions/:versionId/positions/:positionId/toggle
router.patch('/case-versions/:versionId/positions/:positionId/toggle', ...WRITE, versionWrite(async (conn, v, req) => {
  const [position] = await conn.execute(
    'SELECT position_id, position_enabled FROM scenario_positions WHERE position_id = ?',
    [req.params.positionId]
  );
  if (position.length === 0) throw new CaseVersionError(404, 'Position not found');
  const [existing] = await conn.execute(
    'SELECT id, enabled FROM course_case_version_positions WHERE version_id = ? AND position_id = ?',
    [v.version_id, req.params.positionId]
  );
  let enabled;
  if (existing.length > 0) {
    enabled = !existing[0].enabled;
    await conn.execute('UPDATE course_case_version_positions SET enabled = ? WHERE id = ?', [enabled ? 1 : 0, existing[0].id]);
  } else {
    enabled = !position[0].position_enabled;
    await conn.execute(
      'INSERT INTO course_case_version_positions (version_id, position_id, enabled) VALUES (?, ?, ?)',
      [v.version_id, req.params.positionId, enabled ? 1 : 0]
    );
  }
  return { position_id: Number(req.params.positionId), enabled };
}));

// ============================================================================
// Versions: copy, delete, link
// ============================================================================

// POST /api/case-versions/:versionId/clone - Make a semester copy and link sections to it.
// Body: { semester_id, label, section_ids: string[] }
router.post('/case-versions/:versionId/clone', ...WRITE, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const v = req.version;
    const semesterId = Number(req.body?.semester_id);
    const label = typeof req.body?.label === 'string' ? req.body.label.trim().slice(0, 100) : '';
    const sectionIds = Array.isArray(req.body?.section_ids) ? req.body.section_ids : [];
    if (!semesterId) return res.status(400).json({ data: null, error: { message: 'semester_id is required' } });
    if (!label) return res.status(400).json({ data: null, error: { message: 'A label is required' } });
    if (label.toLowerCase() === 'main') return res.status(400).json({ data: null, error: { message: '"Main" is reserved' } });

    await conn.beginTransaction();
    const newVersionId = await copyVersion(conn, v.version_id, { semesterId, label, createdBy: req.user.id });
    const linked = [];
    for (const sectionId of sectionIds) {
      const result = await linkSectionToVersion(conn, sectionId, newVersionId);
      linked.push({ section_id: sectionId, created: result.created });
    }
    await conn.commit();
    res.status(201).json({ data: { version_id: newVersionId, linked }, error: null });
  } catch (error) {
    try { await conn.rollback(); } catch (_) {}
    sendError(res, error, 'Error copying case version:');
  } finally {
    conn.release();
  }
});

// DELETE /api/case-versions/:versionId - Delete a semester copy. Its sections become Customized
// (they keep the copy's settings). Main cannot be deleted; remove the case from the course instead.
router.delete('/case-versions/:versionId', ...WRITE, async (req, res) => {
  try {
    if (req.version.is_main === 1) {
      return res.status(400).json({ data: null, error: { message: 'Main cannot be deleted. Remove the case from the course instead.' } });
    }
    await pool.execute('DELETE FROM course_case_versions WHERE version_id = ?', [req.version.version_id]);
    res.json({ data: { deleted: true }, error: null });
  } catch (error) {
    sendError(res, error, 'Error deleting case version:');
  }
});

// PUT /api/sections/:sectionId/cases/:caseId/version - { version_id: number | null }
// A number re-links the section (its settings are REPLACED by the version's); null detaches it
// (Customized, keeping its current settings). Admin or the course owner.
router.put('/sections/:sectionId/cases/:caseId/version', verifyToken, requireAdminOrInstructor, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { sectionId, caseId } = req.params;
    const [sections] = await conn.execute('SELECT section_id, course_id FROM sections WHERE section_id = ?', [sectionId]);
    if (sections.length === 0) return res.status(404).json({ data: null, error: { message: 'Section not found' } });
    const courseId = sections[0].course_id;
    const isAdmin = req.user.superuser || req.user.role === 'admin';
    if (!isAdmin && !(courseId && await isCourseOwner(req.user.id, courseId))) {
      return res.status(403).json({ data: null, error: { message: 'Only admins or the course owner can change which settings a section follows' } });
    }

    const versionId = req.body?.version_id ?? null;
    await conn.beginTransaction();
    if (versionId === null) {
      const [result] = await conn.execute(
        'UPDATE section_cases SET version_id = NULL WHERE section_id = ? AND case_id = ?',
        [sectionId, caseId]
      );
      if (result.affectedRows === 0) throw new CaseVersionError(404, 'Case assignment not found');
    } else {
      const version = await loadVersion(conn, versionId);
      if (!version || version.case_id !== caseId) throw new CaseVersionError(400, 'That version is not for this case');
      await linkSectionToVersion(conn, sectionId, Number(versionId));
    }
    await conn.commit();
    res.json({ data: { section_id: sectionId, case_id: caseId, version_id: versionId }, error: null });
  } catch (error) {
    try { await conn.rollback(); } catch (_) {}
    sendError(res, error, 'Error changing section case version:');
  } finally {
    conn.release();
  }
});

export default router;
