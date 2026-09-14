/**
 * Roll a course's sections forward from one semester into another.
 *
 * PREVIEW FIRST. planRollover() writes nothing and returns exactly what executeRollover() will do,
 * with a per-section status and error, so the dashboard can show it before anything is created.
 *
 * SAFE TO RUN TWICE. A source section whose (course, target semester, section_number) already
 * exists is reported as `exists` and skipped, so a second run proposes nothing.
 *
 * COPIED: the section (minted id, same number, default title re-derived if the old one was the
 * default, models, primary instructor, enabled) and every case assignment -- inactive, manual
 * status 'auto', dates shifted by the difference between the semesters' start dates (NULL when
 * either semester has no start date). Version links carry over: Main stays Main; each source
 * semester copy is cloned ONCE into the target semester and shared by the same sections;
 * Customized rows are copied as Customized.
 *
 * NOT COPIED: students, chats, enrollment keys, accept_new_students (starts locked), and TAs
 * unless copyTas is set.
 *
 * Legacy sections without a section_number need one supplied (sectionNumbers[source_id]) and
 * are reported as `needs_number` until then.
 */

import { defaultSectionTitle, mintSectionId } from '../../utils/academicIds.js';
import { createCourseSection, ProvisioningError } from './sectionProvisioning.js';
import { VERSION_SETTINGS_COLUMNS, copyVersion, linkSectionToVersion } from './caseVersionSync.js';

const DAY_MS = 86_400_000;

function toDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * @param {import('mysql2/promise').Pool | import('mysql2/promise').PoolConnection} db
 * @param {{ courseId: number, fromSemesterId: number, toSemesterId: number,
 *           sectionIds?: string[] | null, sectionNumbers?: Record<string, number> }} input
 */
export async function planRollover(db, { courseId, fromSemesterId, toSemesterId, sectionIds = null, sectionNumbers = {} }) {
  if (Number(fromSemesterId) === Number(toSemesterId)) {
    throw new ProvisioningError(400, 'A semester cannot be rolled into itself.');
  }
  const [[course]] = await db.execute('SELECT id, course_code, course_name FROM courses WHERE id = ?', [courseId]);
  if (!course) throw new ProvisioningError(404, 'Course not found');
  const [semRows] = await db.execute(
    'SELECT id, semester_code, semester_name, start_date FROM semesters WHERE id IN (?, ?)',
    [fromSemesterId, toSemesterId]
  );
  const from = semRows.find((s) => s.id === Number(fromSemesterId));
  const to = semRows.find((s) => s.id === Number(toSemesterId));
  if (!from || !to) throw new ProvisioningError(404, 'Semester not found');

  const fromStart = toDate(from.start_date);
  const toStart = toDate(to.start_date);
  const shiftMs = fromStart && toStart ? toStart.getTime() - fromStart.getTime() : null;

  const [sources] = await db.execute(
    `SELECT section_id, section_number, section_title, chat_model, super_model,
            primary_instructor_id, enabled
       FROM sections
      WHERE course_id = ? AND semester_id = ?
      ORDER BY section_number IS NULL, section_number, section_id`,
    [courseId, fromSemesterId]
  );
  const [existingTargets] = await db.execute(
    'SELECT section_id, section_number FROM sections WHERE course_id = ? AND semester_id = ?',
    [courseId, toSemesterId]
  );
  const takenNumbers = new Map(existingTargets.map((t) => [t.section_number, t.section_id]));

  // New sections get the course case list (following Main) from createCourseSection, so the
  // preview lists course cases a source section lacks as well.
  const [courseCases] = await db.execute(
    `SELECT cc.case_id, c.case_title FROM course_cases cc JOIN cases c ON c.case_id = cc.case_id
      WHERE cc.course_id = ? ORDER BY cc.sort_order, c.case_title`,
    [courseId]
  );

  const wanted = Array.isArray(sectionIds) && sectionIds.length > 0 ? new Set(sectionIds) : null;
  const plannedNumbers = new Set();
  const sections = [];

  for (const src of sources) {
    if (wanted && !wanted.has(src.section_id)) continue;
    const n = src.section_number ?? (sectionNumbers[src.section_id] != null ? Number(sectionNumbers[src.section_id]) : null);
    const entry = {
      source_section_id: src.section_id,
      source_title: src.section_title,
      section_number: n,
      target_section_id: null,
      target_title: null,
      status: 'create',
      error: null,
      cases: [],
    };

    if (n == null || !Number.isInteger(n) || n < 1) {
      entry.status = 'needs_number';
      entry.error = 'Legacy section without a section number: choose one to roll it forward.';
    } else if (takenNumbers.has(n)) {
      entry.status = 'exists';
      entry.target_section_id = takenNumbers.get(n);
    } else if (plannedNumbers.has(n)) {
      entry.status = 'error';
      entry.error = `Section number ${n} is used twice in this rollover.`;
    } else {
      try {
        entry.target_section_id = mintSectionId(to.semester_code, course.course_code, n);
      } catch (err) {
        entry.status = 'error';
        entry.error = err.message;
      }
      const oldDefault = src.section_number != null ? defaultSectionTitle(course.course_name, src.section_number) : null;
      entry.target_title = oldDefault && src.section_title === oldDefault
        ? defaultSectionTitle(course.course_name, n)
        : src.section_title;
      if (entry.status === 'create') plannedNumbers.add(n);
    }

    const [cases] = await db.execute(
      `SELECT sc.id, sc.case_id, c.case_title, sc.version_id, sc.open_date, sc.close_date,
              v.label AS version_label, v.is_main, v.semester_id AS version_semester_id
         FROM section_cases sc
         JOIN cases c ON c.case_id = sc.case_id
         LEFT JOIN course_case_versions v ON v.version_id = sc.version_id
        WHERE sc.section_id = ?
        ORDER BY c.case_title`,
      [src.section_id]
    );
    entry.cases = cases.map((sc) => {
      const open = toDate(sc.open_date);
      const close = toDate(sc.close_date);
      return {
        source_section_case_id: sc.id,
        case_id: sc.case_id,
        case_title: sc.case_title,
        follows: sc.version_id == null ? 'customized' : sc.is_main === 1 ? 'main' : 'copy',
        version_id: sc.version_id,
        version_label: sc.version_label,
        open_date: shiftMs != null && open ? new Date(open.getTime() + shiftMs) : null,
        close_date: shiftMs != null && close ? new Date(close.getTime() + shiftMs) : null,
        had_dates: Boolean(open || close),
        from_course: false,
      };
    });
    for (const cc of courseCases) {
      if (!entry.cases.some((c) => c.case_id === cc.case_id)) {
        entry.cases.push({
          source_section_case_id: null,
          case_id: cc.case_id,
          case_title: cc.case_title,
          follows: 'main',
          version_id: null,
          version_label: 'Main',
          open_date: null,
          close_date: null,
          had_dates: false,
          from_course: true,
        });
      }
    }
    sections.push(entry);
  }

  const copies = new Map();
  for (const s of sections) {
    if (s.status !== 'create') continue;
    for (const c of s.cases) {
      if (c.follows === 'copy' && !copies.has(c.version_id)) {
        copies.set(c.version_id, { source_version_id: c.version_id, label: c.version_label, case_id: c.case_id });
      }
    }
  }

  return {
    course: { id: course.id, course_code: course.course_code, course_name: course.course_name },
    from: { id: from.id, semester_code: from.semester_code, semester_name: from.semester_name, start_date: from.start_date },
    to: { id: to.id, semester_code: to.semester_code, semester_name: to.semester_name, start_date: to.start_date },
    shift_days: shiftMs == null ? null : Math.round(shiftMs / DAY_MS),
    sections,
    copies: [...copies.values()],
    to_create: sections.filter((s) => s.status === 'create').length,
  };
}

/**
 * Carry out a plan from planRollover() inside the caller's transaction.
 * @param {import('mysql2/promise').PoolConnection} conn
 * @returns {Promise<{ created: string[], copies_created: number }>}
 */
export async function executeRollover(conn, plan, { copyTas = false, userId = null } = {}) {
  const created = [];
  const copyMap = new Map(); // source version_id -> new version_id in the target semester

  for (const s of plan.sections) {
    if (s.status !== 'create') continue;

    const [[src]] = await conn.execute(
      'SELECT chat_model, super_model, primary_instructor_id, enabled FROM sections WHERE section_id = ?',
      [s.source_section_id]
    );
    const result = await createCourseSection(conn, {
      courseId: plan.course.id,
      semesterId: plan.to.id,
      sectionNumber: s.section_number,
      sectionTitle: s.target_title,
      chatModel: src.chat_model,
      superModel: src.super_model,
      primaryInstructorId: src.primary_instructor_id,
      enabled: Boolean(src.enabled),
      acceptNewStudents: false,
      enrollmentKey: null,
    });
    const targetId = result.section_id;

    for (const c of s.cases) {
      if (c.from_course) continue; // attached by createCourseSection, inactive and unscheduled
      let targetScId;
      if (c.follows === 'main') {
        ({ sectionCaseId: targetScId } = await linkSectionToVersion(conn, targetId, c.version_id));
      } else if (c.follows === 'copy') {
        if (!copyMap.has(c.version_id)) {
          copyMap.set(c.version_id, await copyVersion(conn, c.version_id, {
            semesterId: plan.to.id, label: c.version_label, createdBy: userId,
          }));
        }
        ({ sectionCaseId: targetScId } = await linkSectionToVersion(conn, targetId, copyMap.get(c.version_id)));
      } else {
        targetScId = await copyCustomizedCase(conn, c.source_section_case_id, targetId, c.case_id);
      }
      await conn.execute(
        `UPDATE section_cases SET active = 0, manual_status = 'auto', open_date = ?, close_date = ? WHERE id = ?`,
        [c.open_date, c.close_date, targetScId]
      );
    }

    if (copyTas) {
      await conn.execute(
        `INSERT IGNORE INTO instructor_sections
           (instructor_id, section_id, can_manage_students, can_manage_cases, can_view_chats, assigned_by)
         SELECT instructor_id, ?, can_manage_students, can_manage_cases, can_view_chats, ?
           FROM instructor_sections WHERE section_id = ?`,
        [targetId, userId, s.source_section_id]
      );
    }
    created.push(targetId);
  }

  return { created, copies_created: copyMap.size };
}

/** Copy a Customized case assignment's settings (and scenario/position rows) onto a new section. */
async function copyCustomizedCase(conn, sourceSectionCaseId, targetSectionId, caseId) {
  const cols = VERSION_SETTINGS_COLUMNS;
  const [existing] = await conn.execute(
    'SELECT id FROM section_cases WHERE section_id = ? AND case_id = ?',
    [targetSectionId, caseId]
  );
  let targetScId;
  if (existing.length > 0) {
    // createCourseSection attached this case from the course list; the source was Customized.
    targetScId = existing[0].id;
    await conn.execute(
      `UPDATE section_cases t JOIN section_cases s ON s.id = ?
          SET ${cols.map((c) => `t.${c} = s.${c}`).join(', ')}, t.version_id = NULL
        WHERE t.id = ?`,
      [sourceSectionCaseId, targetScId]
    );
  } else {
    const [ins] = await conn.execute(
      `INSERT INTO section_cases (section_id, case_id, active, manual_status, version_id, ${cols.join(', ')})
       SELECT ?, case_id, 0, 'auto', NULL, ${cols.join(', ')} FROM section_cases WHERE id = ?`,
      [targetSectionId, sourceSectionCaseId]
    );
    targetScId = ins.insertId;
  }
  await conn.execute('DELETE FROM section_case_scenarios WHERE section_case_id = ?', [targetScId]);
  await conn.execute(
    `INSERT INTO section_case_scenarios (section_case_id, scenario_id, enabled, sort_order)
     SELECT ?, scenario_id, enabled, sort_order FROM section_case_scenarios WHERE section_case_id = ?`,
    [targetScId, sourceSectionCaseId]
  );
  await conn.execute('DELETE FROM section_case_positions WHERE section_case_id = ?', [targetScId]);
  await conn.execute(
    `INSERT INTO section_case_positions (section_case_id, position_id, enabled, sort_order)
     SELECT ?, position_id, enabled, sort_order FROM section_case_positions WHERE section_case_id = ?`,
    [targetScId, sourceSectionCaseId]
  );
  return targetScId;
}
