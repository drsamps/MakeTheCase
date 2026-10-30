/**
 * The one writer for a scenario's settings document (`case_scenarios.chat_options_override`).
 * What may be stored, and who may see it, is in utils/scenarioSettings.js.
 *
 * A subtree is written with JSON_SET (or removed with JSON_REMOVE) so the rest of the document
 * survives: the dashboard's scenario editor never sends the whole column, and the legacy
 * position keys in it are still read by routes/evaluations.js.
 */

import { pool } from '../db.js';

const SUBTREES = new Set(['student', 'ai']);

/**
 * @param {number|string} scenarioId
 * @param {'student'|'ai'} subtree
 * @param {object|null} value - already validated; null removes the subtree
 * @param {import('mysql2/promise').PoolConnection} [conn]
 */
export async function writeScenarioSettings(scenarioId, subtree, value, conn = pool) {
  if (!SUBTREES.has(subtree)) throw new Error(`Unknown scenario settings subtree "${subtree}"`);
  const path = `$.${subtree}`;
  if (value === null || value === undefined) {
    await conn.execute(
      `UPDATE case_scenarios
          SET chat_options_override = NULLIF(JSON_REMOVE(chat_options_override, ?), JSON_OBJECT())
        WHERE id = ? AND chat_options_override IS NOT NULL`,
      [path, scenarioId]
    );
    return;
  }
  await conn.execute(
    `UPDATE case_scenarios
        SET chat_options_override = JSON_SET(COALESCE(chat_options_override, JSON_OBJECT()), ?, CAST(? AS JSON))
      WHERE id = ?`,
    [path, JSON.stringify(value), scenarioId]
  );
}
