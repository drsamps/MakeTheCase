/**
 * Which side of a scenario a student argues, when the assignment's capture method is 'assigned'
 * (StudyChat Phase 3). The SERVER picks; any position the client sends is ignored.
 *
 * The pick runs inside the POST /case-chats transaction, holding the section_cases row lock, so
 * two students starting at once are counted one after the other:
 *   1. A student who already has an assigned chat on this assignment and scenario keeps that side,
 *      so a retry or a second chat never changes it.
 *   2. Otherwise the side with the fewest students so far.
 *   3. A tie goes to the lowest sha256(position_id:student_id:section_case_id). Never Math.random():
 *      the same inputs must give the same side.
 *
 * Positions are the ones this assignment offers (section_case_positions overrides included).
 */

import crypto from 'node:crypto';

export class SideAssignmentError extends Error {
  constructor(message) {
    super(message);
    this.status = 409;
    this.code = 'POSITIONS_NOT_READY';
  }
}

const tieBreak = (positionId, studentId, sectionCaseId) =>
  crypto.createHash('sha256').update(`${positionId}:${studentId}:${sectionCaseId}`, 'utf8').digest('hex');

/** The positions an assignment offers for a scenario, in order. */
export async function offeredPositions(db, sectionCaseId, scenarioId) {
  const [rows] = await db.execute(
    `SELECT sp.position_id, sp.position_name, sp.position
       FROM scenario_positions sp
       LEFT JOIN section_case_positions scp ON scp.position_id = sp.position_id AND scp.section_case_id = ?
      WHERE sp.scenario_id = ? AND sp.position_enabled = 1 AND COALESCE(scp.enabled, 1) = 1
      ORDER BY COALESCE(scp.sort_order, sp.position_order), sp.position_id`,
    [sectionCaseId, scenarioId]
  );
  return rows;
}

/**
 * @param {import('mysql2/promise').PoolConnection} conn - in a transaction
 * @returns {Promise<{ position_id: number, position_name: string, position: string }>}
 */
export async function assignSide(conn, { sectionCaseId, sectionId, caseId, scenarioId, studentId, twoSided }) {
  const positions = await offeredPositions(conn, sectionCaseId, scenarioId);
  if (positions.length < 2 || (twoSided && positions.length !== 2)) {
    throw new SideAssignmentError(`This activity is not ready: it needs ${twoSided ? 'exactly two' : 'at least two'} positions to assign sides. Please tell your instructor.`);
  }
  const offered = new Set(positions.map((p) => p.position_id));

  const [mine] = await conn.execute(
    `SELECT initial_position_id FROM case_chats
      WHERE student_id = ? AND section_id = ? AND case_id = ? AND scenario_id = ?
        AND position_method = 'assigned' AND initial_position_id IS NOT NULL
      ORDER BY start_time ASC LIMIT 1`,
    [studentId, sectionId, caseId, scenarioId]
  );
  if (mine[0] && offered.has(mine[0].initial_position_id)) {
    return positions.find((p) => p.position_id === mine[0].initial_position_id);
  }

  const [counts] = await conn.execute(
    `SELECT initial_position_id AS position_id, COUNT(DISTINCT student_id) AS n FROM case_chats
      WHERE section_id = ? AND case_id = ? AND scenario_id = ? AND position_method = 'assigned'
        AND student_id NOT IN (SELECT ps.id FROM students ps WHERE ps.preview_for IS NOT NULL)
      GROUP BY initial_position_id`,
    [sectionId, caseId, scenarioId]
  );
  const used = new Map(counts.map((c) => [c.position_id, Number(c.n)]));
  const ranked = positions
    .map((p) => ({ p, n: used.get(p.position_id) || 0, tie: tieBreak(p.position_id, studentId, sectionCaseId) }))
    .sort((a, b) => a.n - b.n || (a.tie < b.tie ? -1 : 1));
  return ranked[0].p;
}
