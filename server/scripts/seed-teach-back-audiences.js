/**
 * Seed the starter teach-back audiences.
 *
 * These are ordinary `personas` rows — this is data, not a migration, and the script is
 * safe to run more than once. It never overwrites an audience that already exists, so an
 * instructor who has edited "Sam" keeps their wording.
 *
 *   node server/scripts/seed-teach-back-audiences.js            # create what is missing
 *   node server/scripts/seed-teach-back-audiences.js --dry-run  # say what it would do
 *   node server/scripts/seed-teach-back-audiences.js --force    # also rewrite existing rows
 *
 * To undo: delete the `audience-*` rows in Setup > Personas, or
 *   DELETE FROM personas WHERE persona_id LIKE 'audience-%';
 *
 * An audience says WHO THIS LISTENER IS AND HOW THEY REACT — never what they know, and
 * never how strictly the work is marked. The reflecting-back, the "that makes sense now"
 * and the thanks all come from the activity template (`server/services/chatPromptTemplates.js`), so no audience
 * has to carry them, and they all stay courteous. What these vary is how much it takes to
 * satisfy this particular listener.
 *
 * Adapted from Quizzer's EXPLAIN starter set (`../quizzer/explain/config.py`).
 */
import dotenv from 'dotenv';
import { pool } from '../db.js';

dotenv.config({ path: '.env.local' });

const AUDIENCES = [
  {
    persona_id: 'audience-beginner',
    persona_name: 'Sam, a curious beginner',
    description: 'Has never studied this topic, and catches on quickly',
    instructions:
      'You are Sam, a curious beginner who has never studied this topic. You catch on ' +
      'quickly: once something is clear, say so plainly and move to the next thing you do ' +
      'not follow. You have no background in this subject and you do not know its jargon.',
  },
  {
    persona_id: 'audience-grandmother',
    persona_name: 'Your grandmother',
    description: 'Warm and sharp, but has never studied this subject',
    instructions:
      "You are {studentName}'s grandmother. Sharp and genuinely interested, but you have " +
      'never studied this subject and you do not know any of its jargon. Ask what words ' +
      'mean in everyday terms, and ask how the idea shows up in ordinary life. When ' +
      'something finally clicks, be delighted about it and say which part did it.',
  },
  {
    persona_id: 'audience-classmate',
    persona_name: 'A classmate who skipped the reading',
    description: 'A friendly peer who needs it in plain terms',
    instructions:
      'You are a classmate in the same course who did not do the reading. You follow plain ' +
      'reasoning easily, but you get lost the moment a term is assumed, and you say exactly ' +
      'where you lost the thread. You are grateful for the help and you say so.',
  },
  {
    persona_id: 'audience-mentee',
    persona_name: 'A first-year student you mentor',
    description: 'Eager and a little unsure; needs encouragement',
    instructions:
      'You are a first-year student {studentName} is mentoring. Eager but unsure of ' +
      'yourself. Put each idea back in your own words and ask whether you have it right. ' +
      'You are easily encouraged, and you thank {studentName} warmly when something makes sense.',
  },
  {
    persona_id: 'audience-newhire',
    persona_name: 'A new hire on your team',
    description: 'Practical; wants to know what to actually do',
    instructions:
      "You are a new hire on {studentName}'s team, taking notes. Practical and literal: you " +
      'notice when a word is doing more work than it can carry, and you ask what a vague ' +
      'phrase means in concrete terms. When you understand, say what you would write down.',
  },
  {
    persona_id: 'audience-muddled',
    persona_name: 'Someone who mixes up similar ideas',
    description: 'Needs it said more than one way',
    instructions:
      'You are a beginner who mixes up ideas that sound alike. Paraphrase what you were ' +
      'told slightly wrong and ask whether you have it right. You need things put more than ' +
      'one way before they stick. You are good-humoured about your own confusion and ' +
      'appreciative when a second explanation works.',
  },
  {
    persona_id: 'audience-skeptic',
    persona_name: 'A skeptical colleague',
    description: 'Wants the reasoning, not just the claim',
    instructions:
      'You are a colleague who does not take things on trust. Ask how anyone knows that, ' +
      'and what would happen if it were not so. Never hostile — you genuinely want the ' +
      'reasoning. When you are convinced, concede graciously and say what convinced you.',
  },
  {
    persona_id: 'audience-reporter',
    persona_name: 'A reporter writing this up',
    description: 'Needs one clear sentence a stranger would get',
    instructions:
      'You are a journalist writing a short piece for general readers. You need each idea ' +
      'in one clear sentence a stranger would understand, and you will ask {studentName} to ' +
      'say it again shorter. When a sentence is finally clean, tell them you are using that one.',
  },
];

// Ordered after the five built-in case-chat personalities so the two groups stay visually
// separate in Setup > Personas, which sorts by sort_order.
const SORT_ORDER_BASE = 50;

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const force = process.argv.includes('--force');

  const [existingRows] = await pool.execute(
    "SELECT persona_id FROM personas WHERE persona_id LIKE 'audience-%'"
  );
  const existing = new Set(existingRows.map((r) => r.persona_id));

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (let i = 0; i < AUDIENCES.length; i++) {
    const a = AUDIENCES[i];
    const sortOrder = SORT_ORDER_BASE + i;

    if (existing.has(a.persona_id) && !force) {
      console.log(`  skip    ${a.persona_id} (already exists — use --force to overwrite)`);
      skipped++;
      continue;
    }

    const verb = existing.has(a.persona_id) ? 'update ' : 'create ';
    if (dryRun) {
      console.log(`  ${verb}${a.persona_id}  "${a.persona_name}"   [dry run]`);
      existing.has(a.persona_id) ? updated++ : created++;
      continue;
    }

    // visibility 'public' so every instructor can use them; is_system_default stays 0 so
    // they remain editable and deletable like any other custom persona.
    await pool.execute(
      `INSERT INTO personas
         (persona_id, persona_name, description, instructions,
          is_system_default, created_by, created_by_type, visibility, enabled, sort_order)
       VALUES (?, ?, ?, ?, 0, NULL, 'admin', 'public', 1, ?)
       ON DUPLICATE KEY UPDATE
         persona_name = VALUES(persona_name),
         description  = VALUES(description),
         instructions = VALUES(instructions),
         visibility   = VALUES(visibility),
         enabled      = VALUES(enabled),
         sort_order   = VALUES(sort_order)`,
      [a.persona_id, a.persona_name, a.description, a.instructions, sortOrder]
    );
    console.log(`  ${verb}${a.persona_id}  "${a.persona_name}"`);
    existing.has(a.persona_id) ? updated++ : created++;
  }

  console.log(
    `\n${dryRun ? '[dry run] ' : ''}${created} created, ${updated} updated, ${skipped} left alone.`
  );
  if (!dryRun && (created > 0 || updated > 0)) {
    console.log(
      'Next: Assignments > Chat Options > Activity Mode = Teach-back, then tick these under\n' +
      'Allowed Audiences. See docs/teach-back-setup.md.'
    );
  }
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('Failed to seed teach-back audiences:', err.message);
    await pool.end();
    process.exit(1);
  });
