/**
 * Section provisioning: the one place a section of a course is created.
 *
 * Used by POST /api/courses/:id/sections, POST /api/sections (when a course is given) and
 * course rollover, so the id-minting and default-title rules cannot diverge between them.
 * The minting rules themselves live in utils/academicIds.js, shared with the dashboard's
 * live preview.
 *
 * Callers own the transaction: pass a connection that has begun one.
 */

import { mintSectionId, defaultSectionTitle } from '../../utils/academicIds.js';
import { attachCourseCasesToSection } from './caseVersionSync.js';

/** An error whose message is safe to show the instructor, with the HTTP status to use. */
export class ProvisioningError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Escape hatch for a hand-typed id: the charset legacy ids already use.
const OVERRIDE_ID_RE = /^[A-Za-z0-9_-]{1,20}$/;

/**
 * Next free section number for a course in a semester (MAX + 1, starting at 1).
 * @param {import('mysql2/promise').PoolConnection | import('mysql2/promise').Pool} executor
 */
export async function nextSectionNumber(executor, courseId, semesterId) {
  const [[row]] = await executor.execute(
    'SELECT COALESCE(MAX(section_number), 0) + 1 AS n FROM sections WHERE course_id = ? AND semester_id = ?',
    [courseId, semesterId]
  );
  return Number(row.n);
}

/**
 * Load the course + semester a section would belong to. Throws ProvisioningError(404).
 */
export async function loadCourseAndSemester(executor, courseId, semesterId) {
  const [courses] = await executor.execute(
    'SELECT id, course_code, course_name, primary_instructor_id FROM courses WHERE id = ?',
    [courseId]
  );
  if (courses.length === 0) throw new ProvisioningError(404, 'Course not found');
  const [semesters] = await executor.execute(
    'SELECT id, semester_code, semester_name FROM semesters WHERE id = ?',
    [semesterId]
  );
  if (semesters.length === 0) throw new ProvisioningError(404, 'Semester not found');
  return { course: courses[0], semester: semesters[0] };
}

/**
 * What POST would create, without writing: { section_number, section_id, section_title, error }.
 * `error` is set (and section_id empty) when the course or semester id cannot be minted.
 */
export async function previewSection(executor, courseId, semesterId, sectionNumber = null) {
  const { course, semester } = await loadCourseAndSemester(executor, courseId, semesterId);
  const n = sectionNumber ?? await nextSectionNumber(executor, courseId, semesterId);
  let sectionId = '';
  let error = null;
  try {
    sectionId = mintSectionId(semester.semester_code, course.course_code, n);
  } catch (err) {
    error = err.message;
  }
  return {
    section_number: n,
    section_id: sectionId,
    section_title: defaultSectionTitle(course.course_name, n),
    error,
  };
}

/**
 * Create a section of a course in a semester.
 *
 * @param {import('mysql2/promise').PoolConnection} connection  in a transaction
 * @param {object} input
 * @param {number} input.courseId
 * @param {number} input.semesterId
 * @param {number=} input.sectionNumber   default: next free number
 * @param {string=} input.sectionId       override the minted id (escape hatch)
 * @param {string=} input.sectionTitle    default: "{course_name} - Sec {n}"
 * @param {string=} input.chatModel
 * @param {string=} input.superModel
 * @param {string=} input.primaryInstructorId  default: the course owner
 * @param {boolean=} input.enabled        default true
 * @param {boolean=} input.acceptNewStudents default false
 * @param {string=} input.enrollmentKey
 * @returns {Promise<{section_id: string, section_number: number, cases_attached: number}>}
 */
export async function createCourseSection(connection, input) {
  const { course, semester } = await loadCourseAndSemester(connection, input.courseId, input.semesterId);

  let n;
  if (input.sectionNumber != null && input.sectionNumber !== '') {
    n = Number(input.sectionNumber);
    if (!Number.isInteger(n) || n < 1 || n > 999) {
      throw new ProvisioningError(400, 'Section number must be a whole number from 1 to 999.');
    }
  } else {
    n = await nextSectionNumber(connection, course.id, semester.id);
  }

  const [taken] = await connection.execute(
    'SELECT section_id FROM sections WHERE course_id = ? AND semester_id = ? AND section_number = ?',
    [course.id, semester.id, n]
  );
  if (taken.length > 0) {
    throw new ProvisioningError(409, `Section ${n} of ${course.course_code} already exists in ${semester.semester_name} (${taken[0].section_id}).`);
  }

  let sectionId;
  const override = typeof input.sectionId === 'string' ? input.sectionId.trim() : '';
  if (override) {
    if (!OVERRIDE_ID_RE.test(override)) {
      throw new ProvisioningError(400, 'Section ID may only contain letters, numbers, hyphens and underscores (20 characters max).');
    }
    sectionId = override;
  } else {
    try {
      sectionId = mintSectionId(semester.semester_code, course.course_code, n);
    } catch (err) {
      throw new ProvisioningError(400, err.message);
    }
  }

  const [existing] = await connection.execute('SELECT section_id FROM sections WHERE section_id = ?', [sectionId]);
  if (existing.length > 0) {
    throw new ProvisioningError(409, `Section ID "${sectionId}" already exists.`);
  }

  const title = (typeof input.sectionTitle === 'string' && input.sectionTitle.trim())
    || defaultSectionTitle(course.course_name, n)
    || sectionId;
  const trimmedKey = typeof input.enrollmentKey === 'string' ? input.enrollmentKey.trim() : '';

  await connection.execute(
    `INSERT INTO sections
       (section_id, course_id, semester_id, section_number, section_title, year_term,
        enabled, accept_new_students, enrollment_key, chat_model, super_model, primary_instructor_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sectionId,
      course.id,
      semester.id,
      n,
      title,
      semester.semester_name,
      input.enabled === false ? 0 : 1,
      input.acceptNewStudents ? 1 : 0,
      trimmedKey || null,
      input.chatModel || null,
      input.superModel || null,
      input.primaryInstructorId || course.primary_instructor_id || null,
    ]
  );

  // A new section starts with the course's case list, inactive, following each case's Main.
  const casesAttached = await attachCourseCasesToSection(connection, sectionId);

  return { section_id: sectionId, section_number: n, cases_attached: casesAttached };
}
