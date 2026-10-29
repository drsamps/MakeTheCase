/**
 * Which model a student chat uses. The section's chat or supervisor model (Courses >
 * Sections), else the default model (models.default_model = 1, a RANK: never test it for
 * truthiness), else the first enabled model. The same choice the student app used to make in
 * App.tsx, made on the server so the browser cannot pick the model the instructor pays for.
 */

import { pool } from '../db.js';

/**
 * The default model's row, for instructor AI features with no section (Draft with AI, Format
 * with AI): the default (rank 1), else the first enabled model by id. 409 when none is enabled.
 * @returns {Promise<{ model_id: string, vendor: string|null, temperature: number|null, reasoning_effort: string|null }>}
 */
export async function defaultModel() {
  const [rows] = await pool.execute(
    `SELECT model_id, vendor, temperature, reasoning_effort FROM models
      WHERE enabled = 1 ORDER BY (default_model = 1) DESC, model_id ASC LIMIT 1`
  );
  if (rows.length === 0) throw Object.assign(new Error('No AI model is enabled.'), { status: 409 });
  return rows[0];
}

/**
 * @param {string|null} sectionId
 * @param {'chat_model'|'super_model'} kind
 * @returns {Promise<string|null>}
 */
export async function resolveSectionModel(sectionId, kind) {
  if (kind !== 'chat_model' && kind !== 'super_model') throw new Error(`Unknown model kind: ${kind}`);
  if (sectionId) {
    const [sections] = await pool.execute(`SELECT ${kind} AS model FROM sections WHERE section_id = ?`, [sectionId]);
    if (sections[0]?.model) return sections[0].model;
  }
  const [models] = await pool.execute(
    'SELECT model_id FROM models WHERE enabled = 1 ORDER BY (default_model = 1) DESC LIMIT 1'
  );
  return models[0]?.model_id || null;
}
