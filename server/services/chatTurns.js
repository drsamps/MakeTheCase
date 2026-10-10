/**
 * The server's own copy of each student chat (chat_turns, migration 082).
 *
 * Phase 3b of docs/security-student-data-access.md: the browser no longer sends the
 * conversation. /api/llm/chat sends the model this copy and appends each answered exchange;
 * /api/evaluations/run grades it; and the transcripts row instructors read (Results, Issue
 * Analytics) is written from it, never from the browser.
 */

import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db.js';
import { formatTranscript } from '../../utils/transcriptFormat.js';

/** @returns {Promise<{ turn_index: number, role: 'student'|'protagonist', content: string, at: number }[]>} */
export async function listTurns(caseChatId) {
  const [rows] = await pool.execute(
    'SELECT turn_index, role, content, created_at FROM chat_turns WHERE case_chat_id = ? ORDER BY turn_index ASC',
    [caseChatId]
  );
  return rows.map((r) => ({ turn_index: r.turn_index, role: r.role, content: r.content, at: new Date(r.created_at).getTime() }));
}

/**
 * Append turns in order. Locks the chat row so two requests for the same chat (a double
 * send) cannot take the same turn_index.
 * @param {{ role: 'student'|'protagonist', content: string, at?: Date }[]} turns
 */
export async function appendTurns(caseChatId, turns) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('SELECT id FROM case_chats WHERE id = ? FOR UPDATE', [caseChatId]);
    const [[{ next }]] = await conn.execute(
      'SELECT COALESCE(MAX(turn_index) + 1, 0) AS next FROM chat_turns WHERE case_chat_id = ?',
      [caseChatId]
    );
    let index = Number(next);
    for (const t of turns) {
      await conn.execute(
        'INSERT INTO chat_turns (case_chat_id, turn_index, role, content, created_at) VALUES (?, ?, ?, ?, ?)',
        [caseChatId, index++, t.role, t.content, t.at || new Date()]
      );
    }
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

/**
 * History in the shape the model routes expect ({ role: 'user'|'model', content }). `at` only
 * labels turns in the prompt log: llmRouter.js passes role + content alone to the model.
 */
export function historyForModel(turns) {
  return turns.map((t) => ({ role: t.role === 'student' ? 'user' : 'model', content: t.content, at: t.at }));
}

/** The conversation as the grader reads it: "Student: …" / "<protagonist>: …" blocks. */
export function historyForGrading(turns, label) {
  return turns.map((t) => `${t.role === 'student' ? 'Student' : label}: ${t.content}`).join('\n\n');
}

/**
 * Write the chat's transcripts row from its turns (create or replace), with the student's
 * full name and turn timing, through formatTranscript like every transcript writer.
 * @param {{ protagonistName: string, savedWithPermission?: boolean }} opts
 *   savedWithPermission is only changed when given (the student's consent to share with the
 *   developers, asked at the end of the chat).
 */
export async function writeTranscript(caseChatId, { protagonistName, savedWithPermission } = {}) {
  const turns = await listTurns(caseChatId);
  if (turns.length === 0) return null;
  const [[student]] = await pool.execute(
    'SELECT s.full_name FROM case_chats cc JOIN students s ON s.id = cc.student_id WHERE cc.id = ?',
    [caseChatId]
  );
  const transcript = formatTranscript(turns, { studentName: student?.full_name || 'Student', protagonistName });
  const wordCount = transcript.trim().split(/\s+/).length;

  const [existing] = await pool.execute('SELECT id FROM transcripts WHERE case_chat_id = ?', [caseChatId]);
  if (existing.length > 0) {
    const fields = ['transcript = ?', 'word_count = ?'];
    const params = [transcript, wordCount];
    if (savedWithPermission !== undefined) {
      fields.push('saved_with_permission = ?');
      params.push(Boolean(savedWithPermission));
    }
    await pool.execute(`UPDATE transcripts SET ${fields.join(', ')} WHERE id = ?`, [...params, existing[0].id]);
    return existing[0].id;
  }
  const id = uuidv4();
  await pool.execute(
    'INSERT INTO transcripts (id, case_chat_id, transcript, word_count, saved_with_permission) VALUES (?, ?, ?, ?, ?)',
    [id, caseChatId, transcript, wordCount, Boolean(savedWithPermission)]
  );
  await pool.execute('UPDATE case_chats SET transcript_id = ? WHERE id = ?', [id, caseChatId]);
  return id;
}
