#!/usr/bin/env node
/**
 * Multi-instructor ownership backfill.
 *
 * Once the schema migrations (047-053) have been applied, every existing row
 * in courses / sections / cases / rubrics / rubric_criteria / personas /
 * case_writer_projects needs an owner so that the per-instructor visibility
 * model has something to anchor on.
 *
 * Default behavior: assign all legacy rows to the shadow "admin_instructor"
 * account seeded by migration 053. The admin can later reassign specific
 * resources (or all of them) to real instructors via the admin UI.
 *
 * Alternative: pass --email to claim legacy ownership directly for a real
 * instructor (this is what an instructor would do if they want to self-claim
 * everything in one shot).
 *
 * Usage:
 *   node server/scripts/backfill-multi-instructor.js                          # use shadow
 *   node server/scripts/backfill-multi-instructor.js --dry-run                # preview
 *   node server/scripts/backfill-multi-instructor.js --email=you@example.com  # claim
 *
 * Or set MTC_FOUNDING_INSTRUCTOR_EMAIL in .env.local to override the default.
 *
 * Safe to re-run: every UPDATE is guarded by WHERE created_by IS NULL or
 * equivalent, so re-running this against a partially-migrated DB is a no-op
 * on already-claimed rows.
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local') });

const argValue = (flag) => {
  const eq = process.argv.find((a) => a.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : null;
};
const DRY_RUN = process.argv.includes('--dry-run');
const SHADOW_EMAIL = 'admin_instructor@system.local';
const email = argValue('--email') || process.env.MTC_FOUNDING_INSTRUCTOR_EMAIL || SHADOW_EMAIL;
const usingShadow = email === SHADOW_EMAIL;

const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST || 'localhost',
  port: parseInt(process.env.MYSQL_PORT || '3306'),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE || 'ceochat',
  multipleStatements: false
});

const [instRows] = await conn.execute(
  'SELECT id, email, can_publish, is_system_account FROM instructors WHERE email = ?',
  [email]
);

if (instRows.length === 0) {
  console.error(`error: no instructor found with email "${email}".`);
  if (usingShadow) {
    console.error('  the shadow account should have been seeded by migration 053.');
    console.error('  did migrations run? try: npm run migrate');
  } else {
    console.error('  create the instructor first (admin dashboard > Instructors)');
    console.error('  then re-run this script.');
  }
  await conn.end();
  process.exit(1);
}

const founding = instRows[0];
console.log(`backfill target: ${founding.email} (${founding.id})${usingShadow ? '  [SHADOW]' : ''}`);
if (usingShadow) {
  console.log('  legacy resources will be parked on the shadow account.');
  console.log('  reassign individual rows from the admin UI later.');
}
console.log(`mode: ${DRY_RUN ? 'DRY-RUN (no writes)' : 'APPLY'}`);
console.log('');

const summary = [];

async function backfill(label, sql, params) {
  if (DRY_RUN) {
    const previewSql = sql.replace(/^\s*UPDATE/i, 'SELECT COUNT(*) AS rows_affected FROM')
      .replace(/SET[\s\S]*?WHERE/i, 'WHERE');
    try {
      const [rows] = await conn.query(previewSql, params);
      const n = rows[0]?.rows_affected ?? 0;
      console.log(`  · ${label}: would update ${n} row(s)`);
      summary.push({ label, rows: n });
    } catch (e) {
      console.log(`  · ${label}: dry-run preview failed (${e.message}); will skip in dry-run`);
    }
    return;
  }
  const [r] = await conn.execute(sql, params);
  const n = r.affectedRows ?? 0;
  console.log(`  + ${label}: updated ${n} row(s)`);
  summary.push({ label, rows: n });
}

console.log('back-filling ownership ...');

// 1. Grant publish permission only when claiming for a real instructor.
//    The shadow doesn't need can_publish — it can't log in.
if (!usingShadow) {
  await backfill(
    'instructors.can_publish (founding)',
    'UPDATE instructors SET can_publish = 1 WHERE id = ? AND can_publish = 0',
    [founding.id]
  );
}

// 2. Courses with no primary instructor.
await backfill(
  'courses.primary_instructor_id',
  'UPDATE courses SET primary_instructor_id = ? WHERE primary_instructor_id IS NULL',
  [founding.id]
);

// 3. Sections with no primary instructor.
await backfill(
  'sections.primary_instructor_id',
  'UPDATE sections SET primary_instructor_id = ? WHERE primary_instructor_id IS NULL',
  [founding.id]
);

// 4. Cases without an owner: claim them and keep them publicly visible
//    (legacy is_shared=1 already mapped visibility -> 'public' in 048).
await backfill(
  'cases.created_by (legacy)',
  `UPDATE cases
   SET created_by = ?, created_by_type = 'instructor'
   WHERE created_by IS NULL`,
  [founding.id]
);
// Any case that was marked is_shared=1 but somehow still 'private' after 048
// should be normalized to 'public' (defensive — migration 048 already does this).
await backfill(
  "cases.visibility (legacy is_shared=1 -> 'public')",
  "UPDATE cases SET visibility = 'public' WHERE is_shared = 1 AND visibility = 'private'"
);

// 5. Rubrics: legacy non-system rows get founding owner; visibility=public
//    so existing usages don't break.
await backfill(
  'rubrics.created_by (legacy non-system)',
  `UPDATE rubrics
   SET created_by = ?, created_by_type = 'instructor', visibility = 'public'
   WHERE is_system_default = 0 AND created_by IS NULL`,
  [founding.id]
);

// 6. Rubric criteria: legacy non-system rows get founding owner; public.
await backfill(
  'rubric_criteria.created_by (legacy non-system)',
  `UPDATE rubric_criteria
   SET created_by = ?, created_by_type = 'instructor', visibility = 'public'
   WHERE is_system_default = 0 AND created_by IS NULL`,
  [founding.id]
);

// 7. Personas: any custom (non-system) persona gets founding owner; public.
await backfill(
  'personas.created_by (custom)',
  `UPDATE personas
   SET created_by = ?, created_by_type = 'instructor', visibility = 'public'
   WHERE is_system_default = 0 AND created_by IS NULL`,
  [founding.id]
);

// 8. Case Writer projects without an owner get founding owner.
await backfill(
  'case_writer_projects.owner_id (orphan)',
  `UPDATE case_writer_projects
   SET owner_id = ?, owner_type = 'instructor'
   WHERE owner_id IS NULL`,
  [founding.id]
);

// 9. Audit log entry recording this backfill.
if (!DRY_RUN) {
  await conn.execute(
    `INSERT INTO audit_log (actor_instructor_id, action, details)
     VALUES (?, 'backfill.multi_instructor', JSON_OBJECT('summary', CAST(? AS JSON)))`,
    [founding.id, JSON.stringify(summary)]
  );
}

console.log('');
console.log('done.');
if (DRY_RUN) console.log('(no rows were written; re-run without --dry-run to apply)');

await conn.end();
