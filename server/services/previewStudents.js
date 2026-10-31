/**
 * Student view: each admin or instructor gets one preview student
 * (students.preview_for = 'admin:<id>' | 'instructor:<id>').
 *
 * Rules (also in CLAUDE.md "Student email sign-in and Student view"):
 * - A preview student is a real students row, so the student page works unchanged; its
 *   token carries `preview: true` so the page can show the Student view bar.
 * - Instructor-facing counts and analytics exclude preview students (Results, Positions,
 *   Issue Analytics, side assignment, section student counts). Per-chat lists (Monitor,
 *   Students) show them with a badge. A new such query must do the same:
 *   use notPreviewChatSql('<case_chats alias>') or `<students alias>.preview_for IS NULL`.
 * - "Start as a new student" deletes the row and creates a new one; chats, turns,
 *   transcripts, evaluations, submissions and enrollments all cascade from students.
 * - A preview student enrolls by the CAS students' rules (key if the section has one),
 *   and may also join a section closed to new students when its owner manages it.
 */

import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db.js';
import { canManageStudentsAs, getAccessibleSectionIds } from '../middleware/instructorAccess.js';

/** SQL condition: the chat's student is not a preview student. Pass the case_chats alias. */
export function notPreviewChatSql(chatAlias = 'cc') {
  return `${chatAlias}.student_id NOT IN (SELECT ps.id FROM students ps WHERE ps.preview_for IS NOT NULL)`;
}

export function previewOwnerKey(user) {
  return `${user.role}:${user.id}`;
}

function parseOwnerKey(key) {
  const i = String(key || '').indexOf(':');
  if (i < 0) return null;
  return { role: key.slice(0, i), id: key.slice(i + 1) };
}

/** Can the staff member who owns this preview student manage students in the section? */
export async function previewOwnerManagesSection(previewFor, sectionId) {
  const owner = parseOwnerKey(previewFor);
  if (!owner) return false;
  if (owner.role === 'admin') return true;
  if (owner.role !== 'instructor') return false;
  return canManageStudentsAs({ isAdmin: false, instructorId: owner.id }, sectionId);
}

/** Sections closed to new students that the preview student's owner manages. */
export async function closedSectionsForPreview(previewFor) {
  const owner = parseOwnerKey(previewFor);
  if (!owner || (owner.role !== 'admin' && owner.role !== 'instructor')) return [];

  // An instructor can manage students only in sections they can access, so narrow to
  // those first instead of checking every closed section on the server.
  let scope = '';
  let params = [];
  if (owner.role === 'instructor') {
    const ids = await getAccessibleSectionIds(owner.id);
    if (!ids.length) return [];
    scope = ` AND s.section_id IN (${ids.map(() => '?').join(',')})`;
    params = ids;
  }
  const [rows] = await pool.execute(
    `SELECT s.section_id, s.section_title, s.year_term,
            (s.enrollment_key IS NOT NULL AND s.enrollment_key <> '') AS requires_enrollment_key
       FROM sections s
      WHERE s.enabled = 1 AND (s.accept_new_students = 0 OR s.accept_new_students IS NULL)${scope}`,
    params
  );
  const allowed = await Promise.all(rows.map((r) => previewOwnerManagesSection(previewFor, r.section_id)));
  return rows
    .filter((_, i) => allowed[i])
    .map((r) => ({ ...r, requires_enrollment_key: Boolean(r.requires_enrollment_key) }));
}

async function staffName(user) {
  if (user.role === 'admin') {
    const [rows] = await pool.execute('SELECT who, email FROM admins WHERE id = ?', [user.id]);
    const who = (rows[0]?.who || '').trim();
    const base = who && !who.includes('@') ? who : String(rows[0]?.email || user.email || 'Admin').split('@')[0];
    const [first, ...rest] = base.split(/\s+/);
    return { first: first || 'Admin', last: rest.join(' ') };
  }
  const [rows] = await pool.execute('SELECT first_name, last_name, full_name FROM instructors WHERE id = ?', [user.id]);
  const r = rows[0] || {};
  return { first: r.first_name || user.firstName || 'Instructor', last: r.last_name || user.lastName || '' };
}

/**
 * Find or create the caller's preview student. With fresh=true the old one (and all its
 * chats, evaluations and enrollments) is deleted first.
 * @returns {Promise<{ id: string, first_name: string, last_name: string, full_name: string }>}
 */
export async function getPreviewStudent(user, { fresh = false } = {}) {
  const key = previewOwnerKey(user);
  if (fresh) {
    await pool.execute('DELETE FROM students WHERE preview_for = ?', [key]);
  } else {
    const [rows] = await pool.execute(
      'SELECT id, first_name, last_name, full_name FROM students WHERE preview_for = ?',
      [key]
    );
    if (rows.length) return rows[0];
  }
  const { first, last } = await staffName(user);
  const full = `${[first, last].filter(Boolean).join(' ')} (Student view)`;
  const id = uuidv4();
  try {
    await pool.execute(
      'INSERT INTO students (id, first_name, last_name, full_name, email, preview_for) VALUES (?, ?, ?, ?, NULL, ?)',
      [id, first, last, full, key]
    );
  } catch (err) {
    // Two tabs asked at once: the other request created it.
    if (err.code !== 'ER_DUP_ENTRY') throw err;
    const [rows] = await pool.execute(
      'SELECT id, first_name, last_name, full_name FROM students WHERE preview_for = ?',
      [key]
    );
    if (rows.length) return rows[0];
    throw err;
  }
  return { id, first_name: first, last_name: last, full_name: full };
}
