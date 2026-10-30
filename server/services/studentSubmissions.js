/**
 * The student's own work as an activity's material (`traits.material: student_submission`, DEFEND).
 * Minimal by decision (StudyChat plan D6): text pasted or a file uploaded, by the student on the
 * start screen or by an instructor, converted to text once.
 *
 * RULES THAT FAIL SILENTLY IF BROKEN
 *   - A chat pins the submission it started on (case_chats.submission_id). Re-uploading never
 *     changes a chat in progress or a grade already given.
 *   - Submission text is the student's, so it is UNTRUSTED: the engine wraps it as data
 *     (signals.js#submissionBlock), in the dynamic part of the prompt.
 *   - Never in packages. Removed with the student (foreign key).
 *   - An oversized text is refused, never cut: a silently shortened submission would be graded
 *     on what it no longer says.
 */

import crypto from 'node:crypto';
import { pool } from '../db.js';

export const MAX_SUBMISSION_CHARS = 60000;
export const MIN_SUBMISSION_CHARS = 20;

export class SubmissionError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Save a new submission. @returns {Promise<{ id: number, filename: string|null, characters: number }>} */
export async function saveSubmission({ sectionId, caseId, studentId, uploadedBy, uploadedByRole, filename = null, text }) {
  const clean = String(text ?? '').replace(/\r\n/g, '\n').trim();
  if (clean.length < MIN_SUBMISSION_CHARS) {
    throw new SubmissionError(400, 'SUBMISSION_TOO_SHORT', 'That is too short to be your work. Paste or upload the whole thing.');
  }
  if (clean.length > MAX_SUBMISSION_CHARS) {
    throw new SubmissionError(400, 'SUBMISSION_TOO_LONG', `That is ${clean.length.toLocaleString()} characters, and the limit is ${MAX_SUBMISSION_CHARS.toLocaleString()}. Please shorten it to the part to be discussed.`);
  }
  const sha = crypto.createHash('sha256').update(clean, 'utf8').digest('hex');
  const [result] = await pool.execute(
    `INSERT INTO student_submissions (section_id, case_id, student_id, uploaded_by, uploaded_by_role, filename, converted_text, text_sha256)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [sectionId, caseId, studentId, uploadedBy ?? null, uploadedByRole, filename ? String(filename).slice(0, 255) : null, clean, sha]
  );
  return { id: result.insertId, filename, characters: clean.length };
}

/** The newest submission for a student on an assignment, or null. */
export async function latestSubmission(sectionId, caseId, studentId, db = pool) {
  const [rows] = await db.execute(
    `SELECT id, filename, converted_text, uploaded_by_role, created_at FROM student_submissions
      WHERE section_id = ? AND case_id = ? AND student_id = ? ORDER BY id DESC LIMIT 1`,
    [sectionId, caseId, studentId]
  );
  return rows[0] || null;
}

/** The text a chat runs on: its pinned submission (by id at chat start, by chat afterwards). */
export async function submissionTextForChat(chat) {
  if (chat.submission_id) {
    const [rows] = await pool.execute('SELECT converted_text FROM student_submissions WHERE id = ?', [chat.submission_id]);
    return rows[0]?.converted_text ?? null;
  }
  if (!chat.id) return null;
  const [rows] = await pool.execute(
    `SELECT s.converted_text FROM case_chats cc JOIN student_submissions s ON s.id = cc.submission_id WHERE cc.id = ?`,
    [chat.id]
  );
  return rows[0]?.converted_text ?? null;
}
