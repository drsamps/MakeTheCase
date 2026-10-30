/**
 * How many chats a student may have on an assignment: the ONE rule, used by POST /api/case-chats
 * (which refuses with 409 CHAT_LIMIT_REACHED) and by the start screen's completion check
 * (GET /api/evaluations/check-completion), so the page and the server never disagree.
 *
 *   - A student gets 1 + `chat_repeats` GRADED chats (chat option, default 0). Abandoned,
 *     cancelled and ungraded chats do not count.
 *   - Counted per scenario when the assignment uses scenarios and a scenario is named, else per
 *     case (the way completion has always been reported).
 *   - `allow_repeat` on means no limit.
 *   - The instructor's per-student re-chat switch (`evaluations.allow_rechat` on the latest
 *     graded chat) always grants one more: the next graded chat has the switch off again.
 *
 * Decided 2026-10-30 (dev/StudyChat-progress.md). Before then `chat_repeats` was stored but never
 * enforced, and only the page applied `allow_repeat` (and not to scenarios).
 */

import { pool } from '../db.js';
import { getSectionCaseChatOptions } from './chatOptions.js';

const isOn = (v) => v === true || v === 1 || v === '1' || v === 'true';

/**
 * @param {{ studentId: string, sectionId?: string|null, caseId: string, scenarioId?: number|string|null }} args
 * @returns {Promise<{ can_start_new: boolean, chats_used: number, chats_allowed: number|null,
 *   chats_left: number|null, rechat_granted: boolean, scope: 'scenario'|'case' }>}
 *   `chats_allowed` / `chats_left` are null when there is no limit.
 */
export async function chatAttemptStatus({ studentId, sectionId = null, caseId, scenarioId = null }) {
  let useScenarios = false;
  if (sectionId) {
    const [rows] = await pool.execute(
      'SELECT use_scenarios FROM section_cases WHERE section_id = ? AND case_id = ?',
      [sectionId, caseId]
    );
    useScenarios = isOn(rows[0]?.use_scenarios);
  }
  const options = (sectionId ? await getSectionCaseChatOptions(sectionId, caseId) : null) || {};
  const perScenario = useScenarios && scenarioId !== null && scenarioId !== undefined && scenarioId !== '';

  // Graded chats, newest first. Per case this includes evaluations with no chat record (older
  // rows), as completion always has.
  const [graded] = perScenario
    ? await pool.execute(
        `SELECT e.allow_rechat FROM evaluations e
           JOIN case_chats cc ON cc.id = e.case_chat_id
          WHERE e.student_id = ? AND e.case_id = ? AND cc.scenario_id = ?
          ORDER BY e.created_at DESC`,
        [studentId, caseId, scenarioId]
      )
    : await pool.execute(
        'SELECT allow_rechat FROM evaluations WHERE student_id = ? AND case_id = ? ORDER BY created_at DESC',
        [studentId, caseId]
      );

  const used = graded.length;
  const unlimited = isOn(options.allow_repeat);
  const allowed = unlimited ? null : 1 + Math.max(0, Math.floor(Number(options.chat_repeats) || 0));
  const withinLimit = unlimited || used < allowed;
  const rechatGranted = !withinLimit && used > 0 && isOn(graded[0].allow_rechat);
  return {
    can_start_new: withinLimit || rechatGranted,
    chats_used: used,
    chats_allowed: allowed,
    chats_left: unlimited ? null : Math.max(0, allowed - used),
    rechat_granted: rechatGranted,
    scope: perScenario ? 'scenario' : 'case',
  };
}
