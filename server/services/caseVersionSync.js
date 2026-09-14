/**
 * Case settings versions: the one place settings move between course_case_versions and
 * section_cases.
 *
 * MODEL (migration 078). A course has a case list (course_cases). Each course case has one
 * "Main" version (semester_id NULL, is_main = 1) and any number of semester copies. A section's
 * section_cases row follows one version (section_cases.version_id) or is "Customized" (NULL).
 *
 * LIVE INHERITANCE IS WRITE-THROUGH. applyVersion() copies a version's settings into every
 * linked section_cases row, and replaces their section_case_scenarios / section_case_positions
 * rows, inside the caller's transaction. Readers of section_cases at chat time never know
 * versions exist. The rule that keeps this honest: every writer of section-level SETTINGS must
 * go through guardFollowedCaseSettings (409 unless ?detach=1). Scheduling -- active, open_date,
 * close_date, manual_status -- is per section and is never written through.
 *
 * Callers own the transaction for everything that takes a `conn`.
 */

import { pool } from '../db.js';

/** section_cases columns that a version owns. Scheduling columns are deliberately absent. */
export const VERSION_SETTINGS_COLUMNS = [
  'chat_options',
  'selection_mode',
  'require_order',
  'use_scenarios',
  'position_tracking_enabled',
  'position_capture_method',
  'track_position_change',
  'rubric_id',
];

export class CaseVersionError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Version + the course and case it belongs to, or null.
 * @param {import('mysql2/promise').Pool | import('mysql2/promise').PoolConnection} executor
 */
export async function loadVersion(executor, versionId) {
  const [rows] = await executor.execute(
    `SELECT v.*, cc.course_id, cc.case_id, c.case_title,
            sem.semester_code, sem.semester_name
       FROM course_case_versions v
       JOIN course_cases cc ON cc.id = v.course_case_id
       JOIN cases c ON c.case_id = cc.case_id
       LEFT JOIN semesters sem ON sem.id = v.semester_id
      WHERE v.version_id = ?`,
    [versionId]
  );
  return rows[0] || null;
}

/**
 * Write a version's settings through to linked section_cases rows.
 * @param {import('mysql2/promise').PoolConnection} conn
 * @param {number} versionId
 * @param {number[] | null} sectionCaseIds  limit to these rows (they must already be linked)
 * @returns {Promise<number>} rows updated
 */
export async function applyVersion(conn, versionId, sectionCaseIds = null) {
  if (Array.isArray(sectionCaseIds) && sectionCaseIds.length === 0) return 0;
  const idFilter = sectionCaseIds ? ` AND sc.id IN (${sectionCaseIds.map(() => '?').join(',')})` : '';
  const params = [versionId, ...(sectionCaseIds || [])];

  const setClause = VERSION_SETTINGS_COLUMNS.map((col) => `sc.${col} = v.${col}`).join(', ');
  const [result] = await conn.execute(
    `UPDATE section_cases sc
       JOIN course_case_versions v ON v.version_id = sc.version_id
        SET ${setClause}
      WHERE sc.version_id = ?${idFilter}`,
    params
  );

  await conn.execute(
    `DELETE x FROM section_case_scenarios x
       JOIN section_cases sc ON sc.id = x.section_case_id
      WHERE sc.version_id = ?${idFilter}`,
    params
  );
  await conn.execute(
    `INSERT INTO section_case_scenarios (section_case_id, scenario_id, enabled, sort_order)
     SELECT sc.id, vs.scenario_id, vs.enabled, vs.sort_order
       FROM section_cases sc
       JOIN course_case_version_scenarios vs ON vs.version_id = sc.version_id
      WHERE sc.version_id = ?${idFilter}`,
    params
  );

  await conn.execute(
    `DELETE y FROM section_case_positions y
       JOIN section_cases sc ON sc.id = y.section_case_id
      WHERE sc.version_id = ?${idFilter}`,
    params
  );
  await conn.execute(
    `INSERT INTO section_case_positions (section_case_id, position_id, enabled, sort_order)
     SELECT sc.id, vp.position_id, vp.enabled, vp.sort_order
       FROM section_cases sc
       JOIN course_case_version_positions vp ON vp.version_id = sc.version_id
      WHERE sc.version_id = ?${idFilter}`,
    params
  );

  return result.affectedRows || 0;
}

/**
 * Copy one version's settings (and scenario/position rows) into a new version.
 * @returns {Promise<number>} new version_id
 */
export async function copyVersion(conn, fromVersionId, { semesterId, label, createdBy = null }) {
  const cols = VERSION_SETTINGS_COLUMNS.join(', ');
  const [result] = await conn.execute(
    `INSERT INTO course_case_versions
       (course_case_id, semester_id, is_main, label, parent_version_id, created_by, ${cols})
     SELECT course_case_id, ?, NULL, ?, version_id, ?, ${cols}
       FROM course_case_versions WHERE version_id = ?`,
    [semesterId, label, createdBy, fromVersionId]
  );
  const newId = result.insertId;
  await conn.execute(
    `INSERT INTO course_case_version_scenarios (version_id, scenario_id, enabled, sort_order)
     SELECT ?, scenario_id, enabled, sort_order FROM course_case_version_scenarios WHERE version_id = ?`,
    [newId, fromVersionId]
  );
  await conn.execute(
    `INSERT INTO course_case_version_positions (version_id, position_id, enabled, sort_order)
     SELECT ?, position_id, enabled, sort_order FROM course_case_version_positions WHERE version_id = ?`,
    [newId, fromVersionId]
  );
  return newId;
}

/**
 * Create a course case with its Main version. Main starts from a section's current settings
 * when `fromSectionCaseId` is given, otherwise from defaults (chat_options NULL = use defaults).
 * @returns {Promise<{courseCaseId: number, mainVersionId: number}>}
 */
export async function createCourseCase(conn, { courseId, caseId, fromSectionCaseId = null, createdBy = null }) {
  const [[{ nextOrder }]] = await conn.execute(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS nextOrder FROM course_cases WHERE course_id = ?',
    [courseId]
  );
  const [cc] = await conn.execute(
    'INSERT INTO course_cases (course_id, case_id, sort_order) VALUES (?, ?, ?)',
    [courseId, caseId, nextOrder]
  );
  const courseCaseId = cc.insertId;

  let mainVersionId;
  if (fromSectionCaseId) {
    const cols = VERSION_SETTINGS_COLUMNS.join(', ');
    // section_cases allows NULL in columns that are NOT NULL on versions; same defaults as migration 078.
    const [v] = await conn.execute(
      `INSERT INTO course_case_versions (course_case_id, semester_id, is_main, label, created_by, ${cols})
       SELECT ?, NULL, 1, 'Main', ?,
              chat_options, selection_mode, COALESCE(require_order, 0), COALESCE(use_scenarios, 0),
              COALESCE(position_tracking_enabled, 0), position_capture_method,
              COALESCE(track_position_change, 1), rubric_id
         FROM section_cases WHERE id = ?`,
      [courseCaseId, createdBy, fromSectionCaseId]
    );
    mainVersionId = v.insertId;
    await conn.execute(
      `INSERT INTO course_case_version_scenarios (version_id, scenario_id, enabled, sort_order)
       SELECT ?, scenario_id, enabled, sort_order FROM section_case_scenarios WHERE section_case_id = ?`,
      [mainVersionId, fromSectionCaseId]
    );
    await conn.execute(
      `INSERT INTO course_case_version_positions (version_id, position_id, enabled, sort_order)
       SELECT ?, position_id, enabled, sort_order FROM section_case_positions WHERE section_case_id = ?`,
      [mainVersionId, fromSectionCaseId]
    );
  } else {
    const [v] = await conn.execute(
      `INSERT INTO course_case_versions (course_case_id, semester_id, is_main, label, created_by)
       VALUES (?, NULL, 1, 'Main', ?)`,
      [courseCaseId, createdBy]
    );
    mainVersionId = v.insertId;
  }
  return { courseCaseId, mainVersionId };
}

/**
 * Make a section follow a version, creating its section_cases row (inactive) if it has none.
 * The row's settings are replaced by the version's; its scheduling is kept.
 * @returns {Promise<{sectionCaseId: number, created: boolean}>}
 */
export async function linkSectionToVersion(conn, sectionId, versionId) {
  const version = await loadVersion(conn, versionId);
  if (!version) throw new CaseVersionError(404, 'Version not found');

  const [sections] = await conn.execute(
    'SELECT section_id, course_id, semester_id FROM sections WHERE section_id = ?',
    [sectionId]
  );
  if (sections.length === 0) throw new CaseVersionError(404, `Section ${sectionId} not found`);
  const section = sections[0];
  if (section.course_id !== version.course_id) {
    throw new CaseVersionError(400, `Section ${sectionId} is not a section of this course`);
  }
  if (version.semester_id != null && version.semester_id !== section.semester_id) {
    throw new CaseVersionError(400, `"${version.label}" is a ${version.semester_name} copy; section ${sectionId} is in a different semester`);
  }

  const [existing] = await conn.execute(
    'SELECT id FROM section_cases WHERE section_id = ? AND case_id = ?',
    [sectionId, version.case_id]
  );
  let sectionCaseId;
  let created = false;
  if (existing.length > 0) {
    sectionCaseId = existing[0].id;
    await conn.execute('UPDATE section_cases SET version_id = ? WHERE id = ?', [versionId, sectionCaseId]);
  } else {
    const [ins] = await conn.execute(
      `INSERT INTO section_cases (section_id, case_id, active, manual_status, version_id)
       VALUES (?, ?, 0, 'auto', ?)`,
      [sectionId, version.case_id, versionId]
    );
    sectionCaseId = ins.insertId;
    created = true;
  }
  await applyVersion(conn, versionId, [sectionCaseId]);
  return { sectionCaseId, created };
}

/**
 * Give a newly created section of a course a (linked, inactive) row for every course case.
 * Called by section provisioning inside its transaction.
 * @returns {Promise<number>} rows created
 */
export async function attachCourseCasesToSection(conn, sectionId) {
  const [mains] = await conn.execute(
    `SELECT v.version_id
       FROM sections s
       JOIN course_cases cc ON cc.course_id = s.course_id
       JOIN course_case_versions v ON v.course_case_id = cc.id AND v.is_main = 1
       LEFT JOIN section_cases sc ON sc.section_id = s.section_id AND sc.case_id = cc.case_id
      WHERE s.section_id = ? AND sc.id IS NULL
      ORDER BY cc.sort_order, cc.id`,
    [sectionId]
  );
  for (const { version_id } of mains) {
    await linkSectionToVersion(conn, sectionId, version_id);
  }
  return mains.length;
}

/**
 * After a section changes course or semester, rows following a version it can no longer follow
 * (another course's, or another semester's copy) become Customized. Their settings are kept.
 * @returns {Promise<number>} rows detached
 */
export async function detachMismatchedLinks(executor, sectionId) {
  const [result] = await executor.execute(
    `UPDATE section_cases sc
       JOIN sections s ON s.section_id = sc.section_id
       JOIN course_case_versions v ON v.version_id = sc.version_id
       JOIN course_cases cc ON cc.id = v.course_case_id
        SET sc.version_id = NULL
      WHERE sc.section_id = ?
        AND (NOT (cc.course_id <=> s.course_id)
             OR (v.semester_id IS NOT NULL AND NOT (v.semester_id <=> s.semester_id)))`,
    [sectionId]
  );
  return result.affectedRows || 0;
}

/**
 * The Main version a section would follow for a case: its course lists the case. Null otherwise.
 * @param {import('mysql2/promise').Pool | import('mysql2/promise').PoolConnection} executor
 */
export async function findMainVersionForSection(executor, sectionId, caseId) {
  const [rows] = await executor.execute(
    `SELECT v.version_id
       FROM sections s
       JOIN course_cases cc ON cc.course_id = s.course_id AND cc.case_id = ?
       JOIN course_case_versions v ON v.course_case_id = cc.id AND v.is_main = 1
      WHERE s.section_id = ?`,
    [caseId, sectionId]
  );
  return rows[0]?.version_id ?? null;
}

/**
 * Express middleware for section-level settings writers (routes with :sectionId and :caseId).
 * A row that follows a version answers 409 CASE_FOLLOWS_VERSION so the client can ask
 * "Customize this section?". A missing row falls through so the route can answer its own 404.
 *
 * With ?detach=1 the detach and the edit are ONE transaction: the row is locked (so a version
 * write-through waits, then skips the row because it no longer follows), version_id is cleared,
 * and the connection is handed to the handler as req.db. A success response commits; an error
 * response rolls back, leaving the section following its version with its settings untouched.
 * Guarded handlers must write through `req.db || pool` and respond with res.json().
 */
export function guardFollowedCaseSettings(req, res, next) {
  (async () => {
    const { sectionId, caseId } = req.params;
    const [rows] = await pool.execute(
      `SELECT sc.id, sc.version_id, v.label, v.semester_id
         FROM section_cases sc
         LEFT JOIN course_case_versions v ON v.version_id = sc.version_id
        WHERE sc.section_id = ? AND sc.case_id = ?`,
      [sectionId, caseId]
    );
    const row = rows[0];
    if (!row || row.version_id == null) return next();
    if (req.query.detach === '1' || req.query.detach === 'true') {
      const conn = await pool.getConnection();
      let settled = false;
      const settle = async (commit) => {
        if (settled) return;
        settled = true;
        try {
          if (commit) await conn.commit();
          else await conn.rollback();
        } catch (err) {
          try { await conn.rollback(); } catch (_) {}
          throw err;
        } finally {
          conn.release();
        }
      };

      try {
        await conn.beginTransaction();
        await conn.execute('SELECT id FROM section_cases WHERE id = ? FOR UPDATE', [row.id]);
        await conn.execute('UPDATE section_cases SET version_id = NULL WHERE id = ?', [row.id]);
      } catch (err) {
        await settle(false).catch(() => {});
        throw err;
      }

      req.db = conn;
      const sendJson = res.json.bind(res);
      res.json = (body) => {
        const ok = res.statusCode < 400;
        settle(ok)
          .then(() => sendJson(body))
          .catch((err) => {
            console.error('Error finishing section case detach transaction:', err);
            if (!ok) return sendJson(body);
            res.status(500);
            sendJson({ data: null, error: { message: `Could not save the change: ${err.message}` } });
          });
        return res;
      };
      // A response sent some other way (an uncaught error reaching Express's handler) rolls back.
      res.on('finish', () => { settle(false).catch(() => {}); });
      return next();
    }
    return res.status(409).json({
      data: null,
      error: {
        code: 'CASE_FOLLOWS_VERSION',
        message: `This section follows the course's "${row.label}" settings for this case. Customize this section to edit it here, or edit "${row.label}" on the Courses screen.`,
        version_id: row.version_id,
        version_label: row.label,
      },
    });
  })().catch(next);
}
