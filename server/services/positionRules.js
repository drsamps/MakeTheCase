/**
 * What an activity type allows for positions, enforced wherever settings or positions are written
 * (StudyChat Phase 3). The trait is the type's (`capture_methods`, `two_sided`), never a type key.
 *
 *   - A capture method must be one the type lists. `assigned` is listed only by types whose
 *     templates use {position}, so it can never reach a built-in.
 *   - `assigned` needs sides to assign: exactly two positions on a two-sided type, else at least
 *     two, on every scenario the assignment offers. Chat start checks again
 *     (sideAssignment.js#assignSide), because positions can change after the setting is saved.
 *   - A two-sided type never has more than two enabled positions on a scenario.
 */

import { typeTraits } from './activityTypeStore.js';

export class PositionRuleError extends Error {
  constructor(message, code = 'POSITION_RULE') {
    super(message);
    this.status = 409;
    this.code = code;
  }
}

/** A capture method this type does not list is refused. An unknown type is left to its own checks. */
export function assertCaptureAllowed(activityType, method) {
  const traits = typeTraits(activityType);
  if (!traits || !method) return;
  if (!traits.capture_methods.includes(method)) {
    throw new PositionRuleError(`This activity type does not offer the "${method}" position method.`, 'CAPTURE_METHOD_NOT_ALLOWED');
  }
}

const sidesNeeded = (traits) => (traits?.two_sided ? 'exactly two' : 'at least two');
const sidesOk = (traits, n) => (traits?.two_sided ? n === 2 : n >= 2);

/** Every scenario in `rows` ({ scenario_name, n }: its offered positions) must have sides to assign. */
function assertSides(traits, rows) {
  if (rows.length === 0) throw new PositionRuleError('Assigned positions need at least one scenario on this assignment.', 'POSITIONS_NOT_READY');
  const bad = rows.filter((r) => !sidesOk(traits, Number(r.n)));
  if (bad.length) {
    throw new PositionRuleError(
      `Assigned positions need ${sidesNeeded(traits)} enabled positions on each scenario. Check: ${bad.map((r) => `"${r.scenario_name}" (${r.n})`).join(', ')}.`,
      'POSITIONS_NOT_READY'
    );
  }
}

/** Can this section assignment use 'assigned'? Throws PositionRuleError when not. */
export async function assertSectionCaseCanAssign(db, sectionCaseId, activityType) {
  const [rows] = await db.execute(
    `SELECT cs.scenario_name,
            (SELECT COUNT(*) FROM scenario_positions sp
               LEFT JOIN section_case_positions scp ON scp.position_id = sp.position_id AND scp.section_case_id = scs.section_case_id
              WHERE sp.scenario_id = cs.id AND sp.position_enabled = 1 AND COALESCE(scp.enabled, 1) = 1) AS n
       FROM section_case_scenarios scs JOIN case_scenarios cs ON cs.id = scs.scenario_id
      WHERE scs.section_case_id = ? AND scs.enabled = 1`,
    [sectionCaseId]
  );
  assertSides(typeTraits(activityType), rows);
}

/** Can this course case version use 'assigned'? Throws PositionRuleError when not. */
export async function assertVersionCanAssign(db, versionId, activityType) {
  const [rows] = await db.execute(
    `SELECT cs.scenario_name,
            (SELECT COUNT(*) FROM scenario_positions sp
               LEFT JOIN course_case_version_positions vp ON vp.position_id = sp.position_id AND vp.version_id = vs.version_id
              WHERE sp.scenario_id = cs.id AND sp.position_enabled = 1 AND COALESCE(vp.enabled, 1) = 1) AS n
       FROM course_case_version_scenarios vs JOIN case_scenarios cs ON cs.id = vs.scenario_id
      WHERE vs.version_id = ? AND vs.enabled = 1`,
    [versionId]
  );
  assertSides(typeTraits(activityType), rows);
}

/** Refuse a third enabled position on a two-sided type. `excludePositionId`: the row being changed. */
export async function assertRoomForPosition(db, caseId, scenarioId, excludePositionId = null) {
  const [cases] = await db.execute('SELECT activity_type FROM cases WHERE case_id = ?', [caseId]);
  if (!typeTraits(cases[0]?.activity_type)?.two_sided) return;
  const [[row]] = await db.execute(
    'SELECT COUNT(*) AS n FROM scenario_positions WHERE scenario_id = ? AND position_enabled = 1 AND position_id <> ?',
    [scenarioId, excludePositionId ?? 0]
  );
  if (Number(row.n) >= 2) {
    throw new PositionRuleError('This activity type has exactly two sides per scenario. Disable or delete one before adding another.', 'TWO_SIDED');
  }
}
