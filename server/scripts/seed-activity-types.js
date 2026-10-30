/**
 * Seed the system activity types (Debate, Apply, Liken to Me, ...) with their personas and starter
 * rubrics. Data, not a migration, and safe to run more than once.
 *
 *   node server/scripts/seed-activity-types.js            # create what is missing
 *   node server/scripts/seed-activity-types.js --dry-run  # say what it would do
 *   node server/scripts/seed-activity-types.js --force    # also publish a new version where the
 *                                                         # definition here has changed
 *
 * Never overwrites: a changed definition under --force becomes a NEW published version, because
 * chats record the version they ran on. A rubric or persona that already exists is left alone, so
 * an instructor's edits stay. Restart a running server afterwards: its registry is in memory
 * (activityTypeStore.js).
 *
 * Definitions: server/scripts/seeds/systemActivityTypes.js.
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const { pool } = await import('../db.js');
const { loadActivityTypes, seedSystemType } = await import('../services/activityTypeStore.js');
const { SYSTEM_TYPES, SYSTEM_PERSONAS, STARTER_RUBRICS } = await import('./seeds/systemActivityTypes.js');

const dryRun = process.argv.includes('--dry-run');
const force = process.argv.includes('--force');

async function seedPersonas() {
  for (const [i, p] of SYSTEM_PERSONAS.entries()) {
    const [rows] = await pool.execute('SELECT persona_id FROM personas WHERE persona_id = ?', [p.persona_id]);
    if (rows.length) { console.log(`  skip    persona ${p.persona_id} (already exists)`); continue; }
    console.log(`  create  persona ${p.persona_id}${dryRun ? '   [dry run]' : ''}`);
    if (dryRun) continue;
    await pool.execute(
      `INSERT INTO personas (persona_id, persona_name, description, instructions, is_system_default, created_by, created_by_type, visibility, enabled, sort_order)
       VALUES (?, ?, ?, ?, 0, NULL, 'admin', 'public', 1, ?)`,
      [p.persona_id, p.persona_name, p.description, p.instructions, 70 + i]
    );
  }
}

const criterionPrompt = (index, c) => {
  const lines = [`*   **Q${index + 1}. ${c.question_text}**`];
  c.scoring.forEach((text, i) => lines.push(`    *   ${i + 1} = ${text}.`));
  return lines.join('\n');
};

async function seedRubrics() {
  for (const r of STARTER_RUBRICS) {
    const [rows] = await pool.execute('SELECT rubric_id FROM rubrics WHERE rubric_name = ?', [r.rubric_name]);
    if (rows.length) { console.log(`  skip    rubric "${r.rubric_name}" (already exists)`); continue; }
    console.log(`  create  rubric "${r.rubric_name}"${dryRun ? '   [dry run]' : ''}`);
    if (dryRun) continue;
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (const c of r.criteria) {
        const guide = Object.fromEntries(c.scoring.map((text, i) => [String(i + 1), text]));
        await conn.execute(
          `INSERT IGNORE INTO rubric_criteria (criteria_id, name, question_text, max_points, scoring_guide, prompt_text, is_system_default, created_by_type, visibility, enabled)
           VALUES (?, ?, ?, ?, ?, ?, 0, 'system', 'public', 1)`,
          [c.criteria_id, c.name, c.question_text, c.scoring.length, JSON.stringify(guide), criterionPrompt(0, c)]
        );
      }
      const prompt = `**Evaluation Criteria:**\n\n${r.criteria.map((c, i) => criterionPrompt(i, c)).join('\n')}`;
      const total = r.criteria.reduce((sum, c) => sum + c.scoring.length, 0);
      await conn.execute(
        `INSERT INTO rubrics (rubric_name, description, criteria_ids, total_points, criteria_prompt, is_system_default, created_by_type, visibility, enabled)
         VALUES (?, ?, ?, ?, ?, 0, 'system', 'public', 1)`,
        [r.rubric_name, r.description, JSON.stringify(r.criteria.map((c) => c.criteria_id)), total, prompt]
      );
      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }
}

try {
  await loadActivityTypes();
  for (const definition of SYSTEM_TYPES) {
    const result = await seedSystemType(definition, { force, dryRun });
    console.log(`  ${result.padEnd(7)} type ${definition.key}${dryRun ? '   [dry run]' : ''}`);
  }
  await seedPersonas();
  await seedRubrics();
  if (!dryRun) console.log('\nRestart a running server so it loads these types.');
} finally {
  await pool.end();
}
