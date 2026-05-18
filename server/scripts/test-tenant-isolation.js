/**
 * Tenant-isolation smoke test.
 *
 * Exercises `buildVisibilityScope()` and `canAccessResource()` against the
 * real database with two synthetic instructors, one team, and a small
 * matrix of cases/rubrics/personas at each visibility tier.
 *
 * Usage:
 *   node server/scripts/test-tenant-isolation.js
 *
 * The script:
 *   1. Creates two test instructors (A, B) and one team T containing A only.
 *   2. Creates resources owned by A at visibility = private / team / public.
 *   3. Asserts:
 *      - A sees all three of A's rows.
 *      - B sees only A's public row (and system defaults if any).
 *      - A can edit/delete; B can view public but not edit any of A's rows.
 *      - canAccessResource respects the rules above.
 *   4. After A invites B to team T and B accepts, B should now see A's team row.
 *   5. Cleans up every row it created (always — even on failure).
 *
 * Exits non-zero on any assertion failure.
 */
import { pool } from '../db.js';
import { v4 as uuidv4 } from 'uuid';
import { buildVisibilityScope, canAccessResource } from '../services/resourceAccess.js';

const TAG = 'TENANT-ISOLATION-TEST';
let failures = 0;
const created = {
  instructorIds: [],
  teamId: null,
  caseIds: [],
  rubricIds: [],
  personaIds: [],
  shareIds: [],
};

function assert(cond, msg) {
  if (cond) {
    console.log(`  ok  ${msg}`);
  } else {
    console.error(`  FAIL ${msg}`);
    failures += 1;
  }
}

function fakeReq(role, id, effectiveInstructorId = null) {
  return {
    user: { role, id },
    effectiveInstructorId,
    headers: {}
  };
}

async function createInstructor(emailPrefix) {
  const id = uuidv4();
  const email = `${emailPrefix}-${id.slice(0, 8)}@test.local`;
  await pool.execute(
    `INSERT INTO instructors (id, email, password_hash, first_name, last_name, full_name, active, can_publish)
     VALUES (?, ?, ?, ?, ?, ?, 1, 1)`,
    [id, email, 'x'.repeat(60), 'Test', emailPrefix, `Test ${emailPrefix} [${TAG}]`]
  );
  created.instructorIds.push(id);
  return id;
}

function shortId(label) {
  return `${label}-${Date.now().toString(36).slice(-6)}-${Math.random().toString(36).slice(2, 5)}`;
}

async function createCase(ownerId, visibility, label) {
  const caseId = shortId(`tic-${label}`).slice(0, 30);
  await pool.execute(
    `INSERT INTO cases (case_id, case_title, created_by, created_by_type, visibility, is_shared)
     VALUES (?, ?, ?, 'instructor', ?, ?)`,
    [caseId, `${TAG} ${label}`, ownerId, visibility, visibility === 'public' ? 1 : 0]
  );
  created.caseIds.push(caseId);
  return caseId;
}

async function createRubric(ownerId, visibility, label) {
  const [r] = await pool.execute(
    `INSERT INTO rubrics (rubric_name, criteria_ids, created_by, created_by_type, visibility, is_system_default)
     VALUES (?, ?, ?, 'instructor', ?, 0)`,
    [`${TAG} ${label}`, JSON.stringify([]), ownerId, visibility]
  );
  created.rubricIds.push(r.insertId);
  return r.insertId;
}

async function createPersona(ownerId, visibility, label) {
  const pid = shortId(`tip-${label}`).slice(0, 30);
  await pool.execute(
    `INSERT INTO personas (persona_id, persona_name, description, instructions, created_by, created_by_type, visibility, is_system_default)
     VALUES (?, ?, ?, ?, ?, 'instructor', ?, 0)`,
    [pid, `${TAG} ${label}`, '[test]', '[test instructions]', ownerId, visibility]
  );
  created.personaIds.push(pid);
  return pid;
}

async function listVisibleIds(req, resourceType, pkCol, table) {
  const { whereSql, params } = buildVisibilityScope(req, resourceType, 't');
  const [rows] = await pool.execute(
    `SELECT t.${pkCol} AS id FROM ${table} t WHERE ${whereSql}`,
    params
  );
  return new Set(rows.map(r => r.id));
}

async function run() {
  console.log(`\n=== ${TAG} ===`);

  // 1. Setup actors.
  const idA = await createInstructor('A');
  const idB = await createInstructor('B');
  console.log(`  instructors: A=${idA.slice(0, 8)}  B=${idB.slice(0, 8)}`);

  // 2. Team T (owned by A; B not yet a member).
  const teamId = uuidv4();
  await pool.execute(
    `INSERT INTO instructor_teams (id, team_name, description, created_by) VALUES (?, ?, ?, ?)`,
    [teamId, `${TAG} team`, '[test]', idA]
  );
  created.teamId = teamId;
  await pool.execute(
    `INSERT INTO instructor_team_members (team_id, instructor_id, role)
     VALUES (?, ?, 'owner')`,
    [created.teamId, idA]
  );

  // 3. Resources owned by A.
  const cPriv = await createCase(idA, 'private', 'priv');
  const cTeam = await createCase(idA, 'team', 'team');
  const cPub = await createCase(idA, 'public', 'pub');
  const rPriv = await createRubric(idA, 'private', 'priv');
  const pPriv = await createPersona(idA, 'private', 'priv');

  // Share cTeam with team T.
  const [shRes] = await pool.execute(
    `INSERT INTO resource_team_shares (resource_type, resource_id, team_id, access_level)
     VALUES ('case', ?, ?, 'view')`,
    [cTeam, created.teamId]
  );
  created.shareIds.push(shRes.insertId);

  // --- Visibility scope assertions ---
  console.log('\n[scope] A sees own private/team/public');
  const visA = await listVisibleIds(fakeReq('instructor', idA), 'case', 'case_id', 'cases');
  assert(visA.has(cPriv), 'A sees own private case');
  assert(visA.has(cTeam), 'A sees own team case');
  assert(visA.has(cPub),  'A sees own public case');

  console.log('\n[scope] B (not in team) sees only A\'s public');
  const visB = await listVisibleIds(fakeReq('instructor', idB), 'case', 'case_id', 'cases');
  assert(!visB.has(cPriv), 'B cannot see A private case');
  assert(!visB.has(cTeam), 'B cannot see A team case (not yet member)');
  assert(visB.has(cPub),   'B sees A public case');

  console.log('\n[scope] rubric/persona isolation');
  const rubA = await listVisibleIds(fakeReq('instructor', idA), 'rubric', 'rubric_id', 'rubrics');
  const rubB = await listVisibleIds(fakeReq('instructor', idB), 'rubric', 'rubric_id', 'rubrics');
  assert(rubA.has(rPriv),  'A sees own private rubric');
  assert(!rubB.has(rPriv), 'B cannot see A private rubric');
  const perA = await listVisibleIds(fakeReq('instructor', idA), 'persona', 'persona_id', 'personas');
  const perB = await listVisibleIds(fakeReq('instructor', idB), 'persona', 'persona_id', 'personas');
  assert(perA.has(pPriv),  'A sees own private persona');
  assert(!perB.has(pPriv), 'B cannot see A private persona');

  console.log('\n[scope] admin (no impersonation) sees everything');
  const visAdmin = await listVisibleIds(fakeReq('admin', 'admin-1'), 'case', 'case_id', 'cases');
  assert(visAdmin.has(cPriv), 'admin sees A private case');
  assert(visAdmin.has(cTeam), 'admin sees A team case');
  assert(visAdmin.has(cPub),  'admin sees A public case');

  console.log('\n[scope] admin impersonating B sees what B sees');
  const visImp = await listVisibleIds(fakeReq('admin', 'admin-1', idB), 'case', 'case_id', 'cases');
  assert(!visImp.has(cPriv), 'admin-as-B cannot see A private case');
  assert(visImp.has(cPub),   'admin-as-B sees A public case');

  // --- canAccessResource assertions ---
  console.log('\n[access] B cannot edit/delete A\'s private case');
  const r1 = await canAccessResource(fakeReq('instructor', idB), 'case', cPriv, 'view');
  assert(!r1.allowed, `B view A-private -> denied (${r1.reason})`);
  const r2 = await canAccessResource(fakeReq('instructor', idB), 'case', cPriv, 'edit');
  assert(!r2.allowed, `B edit A-private -> denied (${r2.reason})`);

  console.log('\n[access] B can view A public, cannot edit');
  const r3 = await canAccessResource(fakeReq('instructor', idB), 'case', cPub, 'view');
  assert(r3.allowed, `B view A-public -> allowed (${r3.reason})`);
  const r4 = await canAccessResource(fakeReq('instructor', idB), 'case', cPub, 'edit');
  assert(!r4.allowed, `B edit A-public -> denied (${r4.reason})`);

  console.log('\n[access] A can edit/delete own');
  const r5 = await canAccessResource(fakeReq('instructor', idA), 'case', cPriv, 'edit');
  assert(r5.allowed, `A edit A-private -> allowed (${r5.reason})`);
  const r6 = await canAccessResource(fakeReq('instructor', idA), 'case', cPriv, 'delete');
  assert(r6.allowed, `A delete A-private -> allowed (${r6.reason})`);

  // --- Team membership flips visibility for B ---
  console.log('\n[team] add B as member -> B sees A\'s team case');
  await pool.execute(
    `INSERT INTO instructor_team_members (team_id, instructor_id, role) VALUES (?, ?, 'viewer')`,
    [created.teamId, idB]
  );
  const visB2 = await listVisibleIds(fakeReq('instructor', idB), 'case', 'case_id', 'cases');
  assert(visB2.has(cTeam), 'B (now member) sees A team case');
  assert(!visB2.has(cPriv), 'B (member) still cannot see A private case');

  if (failures === 0) {
    console.log(`\n${TAG}: PASS (all assertions ok)\n`);
  } else {
    console.error(`\n${TAG}: ${failures} FAILURE(S)\n`);
  }
}

async function cleanup() {
  console.log('--- cleanup ---');
  try {
    if (created.shareIds.length) {
      await pool.execute(
        `DELETE FROM resource_team_shares WHERE id IN (${created.shareIds.map(() => '?').join(',')})`,
        created.shareIds
      );
    }
    if (created.caseIds.length) {
      await pool.execute(
        `DELETE FROM cases WHERE case_id IN (${created.caseIds.map(() => '?').join(',')})`,
        created.caseIds
      );
    }
    if (created.rubricIds.length) {
      await pool.execute(
        `DELETE FROM rubrics WHERE rubric_id IN (${created.rubricIds.map(() => '?').join(',')})`,
        created.rubricIds
      );
    }
    if (created.personaIds.length) {
      await pool.execute(
        `DELETE FROM personas WHERE persona_id IN (${created.personaIds.map(() => '?').join(',')})`,
        created.personaIds
      );
    }
    if (created.teamId) {
      await pool.execute(`DELETE FROM instructor_team_members WHERE team_id = ?`, [created.teamId]);
      await pool.execute(`DELETE FROM instructor_teams WHERE id = ?`, [created.teamId]);
    }
    if (created.instructorIds.length) {
      await pool.execute(
        `DELETE FROM instructors WHERE id IN (${created.instructorIds.map(() => '?').join(',')})`,
        created.instructorIds
      );
    }
    console.log('  cleanup ok');
  } catch (err) {
    console.error('  cleanup failed:', err.message);
  }
}

(async () => {
  try {
    await run();
  } catch (err) {
    console.error('FATAL:', err);
    failures += 1;
  } finally {
    await cleanup();
    await pool.end();
    process.exit(failures > 0 ? 1 : 0);
  }
})();
