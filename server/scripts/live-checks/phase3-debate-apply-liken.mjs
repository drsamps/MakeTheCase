// StudyChat Phase 3 end to end.
// Needs the API on 3011 (launch config makethecase-test-api-3011) and the dev ceochat database.
// Uses throwaway zz- rows and removes them. Makes real AI calls: a few cents.
// Run from the repo root: node server/scripts/live-checks/<this file>
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const root = process.cwd();
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const require = createRequire(path.join(root, 'package.json'));
require('dotenv').config({ path: '.env.local' });
const { pool } = await imp('server/db.js');
const { generateToken } = await imp('server/middleware/auth.js');

const API = 'http://localhost:3011/api';
const SECTION = 'case-chat-testers';
const noAI = process.argv.includes('--no-ai');
let failed = 0, passed = 0;
const ok = (name, cond, extra = '') => { if (cond) { passed++; console.log(`  ok  ${name}`); } else { failed++; console.log(`FAIL  ${name} ${extra}`); } };

const [admins] = await pool.query('SELECT id, email FROM admins WHERE superuser = 1 LIMIT 1');
const adminToken = generateToken(admins[0].id, admins[0].email, 'admin', { superuser: true });
const call = async (method, url, token, body) => {
  const res = await fetch(API + url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, data: json.data, error: json.error };
};
const admin = (m, u, b) => call(m, u, adminToken, b);

const STUDENTS = ['zz-sc-1', 'zz-sc-2', 'zz-sc-3', 'zz-sc-4'];
const CASES = ['zz-debate', 'zz-apply', 'zz-liken', 'zz-builtin'];
const tokens = {};

async function cleanup() {
  for (const c of CASES) {
    await pool.execute('DELETE FROM issue_analysis_runs WHERE case_id = ?', [c]).catch(() => {});
    await pool.execute('DELETE FROM evaluations WHERE case_id = ?', [c]).catch(() => {});
    await pool.execute('DELETE FROM cases WHERE case_id = ?', [c]).catch((e) => console.log('cleanup', e.message));
  }
  for (const s of STUDENTS) await pool.execute('DELETE FROM students WHERE id = ?', [s]).catch((e) => console.log('cleanup', e.message));
}

async function setup() {
  await cleanup();
  for (const [i, id] of STUDENTS.entries()) {
    await pool.execute(`INSERT INTO students (id, first_name, last_name, full_name, email, section_id) VALUES (?, 'Zed', ?, ?, ?, ?)`, [id, `Tester${i}`, `Zed Tester${i}`, `${id}@example.test`, SECTION]);
    await pool.execute('INSERT IGNORE INTO student_sections (student_id, section_id) VALUES (?, ?)', [id, SECTION]);
    tokens[id] = generateToken(id, `${id}@example.test`, 'student');
  }
}

async function makeCase(id, type, goal) {
  const r = await admin('POST', '/cases', { case_id: id, case_title: `ZZ ${id}`, activity_type: type, goal });
  if (r.status >= 300) throw new Error(`case ${id}: ${JSON.stringify(r.error)}`);
  await pool.execute(
    `INSERT INTO case_files (case_id, filename, file_type, file_format, converted_text, text_format, include_in_chat_prompt, prompt_order)
     VALUES (?, 'reading.md', 'case', 'md', ?, 'markdown', 1, 0)`,
    [id, 'Safety stock protects a firm from demand variability. Holding more stock raises carrying cost. Acme sells 100 units a week and lost 12% of sales last year to stockouts; its carrying cost is 25% a year.']
  );
}
const scenario = async (caseId, extra = {}) => {
  const r = await admin('POST', `/cases/${caseId}/scenarios`, { scenario_name: 'S1', protagonist: 'Pat Ray', protagonist_initials: 'PR', protagonist_role: 'COO of Acme', chat_topic: 'safety stock', chat_question: 'Should Acme double its safety stock?', ...extra });
  if (r.status >= 300) throw new Error(`scenario ${caseId}: ${JSON.stringify(r.error)}`);
  return r.data.id;
};
const start = (student, caseId, scenarioId, extra = {}) => call('POST', '/case-chats', tokens[student], { student_name: 'Zed', case_id: caseId, section_id: SECTION, scenario_id: scenarioId, ...extra });
const say = (student, chatId, message) => call('POST', '/llm/chat', tokens[student], { caseChatId: chatId, studentName: 'Zed', message });
const grade = (student, chatId) => call('POST', '/evaluations/run', tokens[student], { case_chat_id: chatId, feedback: {} });

try {
  await setup();

  // ---------- types are listed
  const list = await admin('GET', '/activity-types');
  const byKey = Object.fromEntries((list.data || []).map((t) => [t.key, t]));
  ok('debate, apply, liken_to_me are published', byKey.debate && byKey.apply && byKey.liken_to_me, Object.keys(byKey).join());
  ok('debate lists assigned first, two-sided', byKey.debate?.traits.capture_methods[0] === 'assigned' && byKey.debate?.traits.two_sided);

  // ---------- built-ins never get 'assigned'
  await makeCase('zz-builtin', 'case_chat', null);
  await scenario('zz-builtin');
  await admin('POST', `/sections/${SECTION}/cases`, { case_id: 'zz-builtin' });
  const builtinAssigned = await admin('PATCH', `/sections/${SECTION}/cases/zz-builtin/position-settings`, { position_tracking_enabled: true, position_capture_method: 'assigned' });
  ok('case chat refuses assigned', builtinAssigned.status === 409 && builtinAssigned.error?.code === 'CAPTURE_METHOD_NOT_ALLOWED', JSON.stringify(builtinAssigned));

  // ---------- DEBATE
  await makeCase('zz-debate', 'debate', 'Students can argue from evidence.');
  const dS = await scenario('zz-debate');
  const noPositions = await admin('POST', `/sections/${SECTION}/cases`, { case_id: 'zz-debate' });
  ok('debate attaches', noPositions.status < 300, JSON.stringify(noPositions.error));
  const [[sc]] = await pool.execute('SELECT id, position_tracking_enabled, position_capture_method, use_scenarios FROM section_cases WHERE section_id = ? AND case_id = ?', [SECTION, 'zz-debate']);
  ok('attach seeds tracking + assigned + scenarios', sc.position_tracking_enabled === 1 && sc.position_capture_method === 'assigned' && sc.use_scenarios === 1, JSON.stringify(sc));
  const notReady = await start('zz-sc-1', 'zz-debate', dS);
  ok('no positions yet: chat refused', notReady.status === 409 && notReady.error?.code === 'POSITIONS_NOT_READY', JSON.stringify(notReady.error));
  const pA = await admin('POST', `/cases/zz-debate/scenarios/${dS}/positions`, { position_name: 'pro', position: 'Acme should double its safety stock', arguments_for: 'Stockouts cost 12% of sales.' });
  const pB = await admin('POST', `/cases/zz-debate/scenarios/${dS}/positions`, { position_name: 'con', position: 'Acme should keep its safety stock as it is', arguments_for: 'Carrying cost is 25% a year.' });
  const pC = await admin('POST', `/cases/zz-debate/scenarios/${dS}/positions`, { position_name: 'third', position: 'A third side' });
  ok('third position refused', pC.status === 409 && pC.error?.code === 'TWO_SIDED', JSON.stringify(pC.error));
  const pCoff = await admin('POST', `/cases/zz-debate/scenarios/${dS}/positions`, { position_name: 'third', position: 'A third side', position_enabled: false });
  ok('a disabled third may exist', pCoff.status === 201);
  const pCtoggle = await admin('PATCH', `/cases/zz-debate/scenarios/${dS}/positions/${pCoff.data?.position_id}/toggle`);
  ok('enabling it is refused', pCtoggle.status === 409, JSON.stringify(pCtoggle));
  await admin('DELETE', `/cases/zz-debate/scenarios/${dS}/positions/${pCoff.data?.position_id}`);
  const setAssigned = await admin('PATCH', `/sections/${SECTION}/cases/zz-debate/position-settings`, { position_capture_method: 'assigned' });
  ok('assigned accepted with two positions', setAssigned.status === 200, JSON.stringify(setAssigned.error));

  const starts = await Promise.all(STUDENTS.map((s) => start(s, 'zz-debate', dS)));
  ok('4 students started at once', starts.every((r) => r.status === 201), JSON.stringify(starts.map((r) => r.error)));
  const sides = starts.map((r) => r.data?.initial_position_id);
  const counts = {};
  sides.forEach((x) => { counts[x] = (counts[x] || 0) + 1; });
  ok('sides balanced 2/2', counts[pA.data.position_id] === 2 && counts[pB.data.position_id] === 2, JSON.stringify(counts));
  ok('method recorded', starts.every((r) => r.data?.position_method === 'assigned'));
  ok('greeting states the side', starts[0].data?.greeting?.includes(starts[0].data.assigned_position) && starts[0].data.assigned_position, starts[0].data?.greeting);
  ok('goal returned for a type that shows it', starts[0].data?.goal === 'Students can argue from evidence.');

  // Retry: cancel and start again, sending the other side: the same side comes back.
  const first = starts[0];
  await call('PATCH', `/case-chats/${first.data.id}/status`, tokens['zz-sc-1'], { status: 'canceled' });
  const other = sides[0] === pA.data.position_id ? pB.data.position_id : pA.data.position_id;
  const retry = await start('zz-sc-1', 'zz-debate', dS, { initial_position_id: other, position_method: 'explicit' });
  ok('retry keeps the side and ignores the client', retry.data?.initial_position_id === sides[0] && retry.data?.position_method === 'assigned', JSON.stringify(retry.data?.initial_position_id));
  const change = await call('PATCH', `/case-chats/${retry.data.id}/initial-position`, tokens['zz-sc-1'], { initial_position_id: other });
  ok('student cannot change an assigned side', change.status === 409 && change.error?.code === 'POSITION_ASSIGNED', JSON.stringify(change));

  // Student safety
  const rows = await call('GET', `/sections/${SECTION}/cases`, tokens['zz-sc-1']);
  const row = rows.data?.find((c) => c.case_id === 'zz-debate');
  const json = JSON.stringify(row || {});
  ok('student row has the view', row?.activity?.type === 'debate');
  ok('student row has no templates or goal', !json.includes('ROLE & INSTRUCTIONS') && !json.includes('Rebut, then advance') && !json.includes('Students can argue from evidence') && !json.includes('Stockouts cost 12%'));
  const data = await call('GET', '/llm/case-data/zz-debate', tokens['zz-sc-1']);
  ok('case-data has no goal for a student', data.status === 200 && data.data && !('goal' in data.data), Object.keys(data.data || {}).join());

  // Prompt preview shows sides
  const { loadChatContext, buildChatSystemPrompt } = await imp('server/services/chatPrompt.js');
  const { loadActivityTypes } = await imp('server/services/activityTypeStore.js');
  await loadActivityTypes();
  const [[chatRow]] = await pool.execute('SELECT * FROM case_chats WHERE id = ?', [retry.data.id]);
  const ctx = await loadChatContext(chatRow);
  const sys = buildChatSystemPrompt(ctx, 'Zed');
  ok('prompt names both sides and the goal', sys.includes(chatRow.initial_position === 'pro' ? 'Acme should double' : 'Acme should keep') && sys.includes('The Side You Argue') && sys.includes('Students can argue from evidence.'));
  ok('prompt has the position arguments', sys.includes('ARGUMENT FRAMEWORK'));
  ok('no unfilled slots in the prompt', !/\{[a-z_]+\}/.test(sys), (sys.match(/\{[a-z_]+\}/g) || []).join());
  const coach = ctx.behaviour.buildCoachPrompt('[STUDENT Zed] hi', 'Zed', ctx.caseData, 1, null);
  ok('coach prompt names the side, no unfilled slots', coach.includes('The side the student argued:') && !/\{[a-z_]+\}/.test(coach.replace(/\{\s*"|<[^>]*>/g, '').replace(/\{ "question[^\n]*/g, '')), '');

  // ---------- APPLY
  await makeCase('zz-apply', 'apply', null);
  const aS = await scenario('zz-apply', { protagonist: 'Lee Chan', protagonist_initials: 'LC', protagonist_role: 'owner of a bakery', chat_question: 'My bakery keeps running out of flour. What should I do?' });
  await admin('POST', `/sections/${SECTION}/cases`, { case_id: 'zz-apply' });
  await pool.execute('UPDATE section_cases SET use_scenarios = 1 WHERE section_id = ? AND case_id = ?', [SECTION, 'zz-apply']);
  const [[asc]] = await pool.execute('SELECT id FROM section_cases WHERE section_id = ? AND case_id = ?', [SECTION, 'zz-apply']);
  await pool.execute('INSERT IGNORE INTO section_case_scenarios (section_case_id, scenario_id, enabled) VALUES (?, ?, 1)', [asc.id, aS]);
  const aStart = await start('zz-sc-1', 'zz-apply', aS);
  ok('apply starts', aStart.status === 201 && aStart.data.greeting.includes('Lee Chan'), JSON.stringify(aStart.error));
  ok('apply has no side', aStart.data?.initial_position_id === null && aStart.data?.assigned_position === null);

  // ---------- LIKEN
  await makeCase('zz-liken', 'liken_to_me', 'Students connect the reading to their lives.');
  const lS = await scenario('zz-liken', { chat_question: 'What does planning for uncertainty mean in your own life?', protagonist: 'Liken to Me', protagonist_initials: 'AI' });
  await admin('POST', `/sections/${SECTION}/cases`, { case_id: 'zz-liken' });
  await pool.execute('UPDATE section_cases SET use_scenarios = 1 WHERE section_id = ? AND case_id = ?', [SECTION, 'zz-liken']);
  const [[lsc]] = await pool.execute('SELECT id FROM section_cases WHERE section_id = ? AND case_id = ?', [SECTION, 'zz-liken']);
  await pool.execute('INSERT IGNORE INTO section_case_scenarios (section_case_id, scenario_id, enabled) VALUES (?, ?, 1)', [lsc.id, lS]);
  const lRows = await call('GET', `/sections/${SECTION}/cases`, tokens['zz-sc-1']);
  const lRow = lRows.data?.find((c) => c.case_id === 'zz-liken');
  ok('liken: view says personal, with a notice', lRow?.activity?.traits?.personal === true && /your own life/.test(lRow?.activity?.copy?.personal_notice || ''));
  ok('liken offers the mentor only', lRow?.available_personas?.length === 1 && lRow.available_personas[0].persona_id === 'audience-mentor', JSON.stringify(lRow?.available_personas));
  const lStart = await start('zz-sc-1', 'zz-liken', lS, { persona: 'audience-mentor' });
  ok('liken starts with the mentor', lStart.status === 201 && lStart.data.greeting.includes('reflective mentor'), JSON.stringify(lStart.data?.greeting || lStart.error));

  if (!noAI) {
    // Real model turns and grading. A few cents. These chats are one message long, so no minimum.
    await pool.execute(`UPDATE section_cases SET chat_options = JSON_SET(COALESCE(chat_options, JSON_OBJECT()), '$.require_minimum_exchanges', 0) WHERE section_id = ? AND case_id IN ('zz-debate', 'zz-apply', 'zz-liken')`, [SECTION]);
    await pool.execute(`UPDATE section_cases SET chat_options = JSON_SET(chat_options, '$.allowed_personas', 'audience-mentor', '$.default_persona', 'audience-mentor') WHERE section_id = ? AND case_id = 'zz-liken'`, [SECTION]);
    const dChat = starts[1];
    const t1 = await say('zz-sc-2', dChat.data.id, 'Acme lost 12% of sales to stockouts, which costs more than carrying more stock at 25% a year on a small base. My side follows from those numbers.');
    ok('debate turn answered', t1.status === 200 && t1.data?.text?.length > 0, JSON.stringify(t1.error));
    console.log('      AI:', t1.data?.text?.slice(0, 200));
    const g1 = await grade('zz-sc-2', dChat.data.id);
    ok('debate graded on its own criteria', g1.status === 200 && g1.data?.criteria?.length === 3, JSON.stringify(g1.error));
    console.log('      criteria:', g1.data?.criteria?.map((c) => c.question?.slice(0, 40)).join(' | '));
    const [[e1]] = await pool.execute('SELECT activity_type_version FROM evaluations WHERE case_chat_id = ?', [dChat.data.id]);
    ok('evaluation records debate@v1', e1?.activity_type_version === 'debate@v1', JSON.stringify(e1));

    const t2 = await say('zz-sc-1', aStart.data.id, 'You should hold safety stock of flour sized to how variable your demand is, weighing the carrying cost of flour against lost sales when you run out.');
    ok('apply turn answered', t2.status === 200 && t2.data?.text?.length > 0, JSON.stringify(t2.error));
    console.log('      AI:', t2.data?.text?.slice(0, 200));
    const g2 = await grade('zz-sc-1', aStart.data.id);
    ok('apply graded', g2.status === 200 && g2.data?.criteria?.length === 3, JSON.stringify(g2.error));

    const t3 = await say('zz-sc-1', lStart.data.id, 'Zed here. The idea of safety stock reminds me that I keep no savings buffer, so a surprise car repair last month forced a loan from my sister.');
    ok('liken turn answered', t3.status === 200 && t3.data?.text?.length > 0, JSON.stringify(t3.error));
    console.log('      AI:', t3.data?.text?.slice(0, 200));
    const g3 = await grade('zz-sc-1', lStart.data.id);
    ok('liken graded', g3.status === 200 && g3.data?.criteria?.length === 3, JSON.stringify(g3.error));

    // Names hidden
    const res = await admin('GET', `/analytics/results?section_ids=${SECTION}&case_ids=zz-liken&statuses=all&limit=50&offset=0`);
    const hidden = res.data?.students?.find((s) => s.case_id === 'zz-liken');
    ok('results hide the name', hidden && hidden.names_hidden === true && hidden.student_name.startsWith('Student ') && hidden.email === null, JSON.stringify(hidden)?.slice(0, 200));
    const shown = await admin('GET', `/analytics/results?section_ids=${SECTION}&case_ids=zz-liken&statuses=all&limit=50&offset=0&show_personal=1`);
    ok('show_personal reveals', shown.data?.students?.find((s) => s.case_id === 'zz-liken')?.student_name === 'Zed Tester0');
    const tr = await admin('GET', `/transcripts/chat/${lStart.data.id}`);
    ok('transcript hides the name', tr.data?.transcript && !/Zed/.test(tr.data.transcript) && tr.data.names_hidden === true, tr.data?.transcript?.slice(0, 200));
    const trShown = await admin('GET', `/transcripts/chat/${lStart.data.id}?show_personal=1`);
    ok('transcript reveals on request', /Zed/.test(trShown.data?.transcript || ''));
    const live = await admin('GET', `/sections/${SECTION}/cases/zz-liken/live-session`);
    ok('monitor hides names', live.data?.students?.every((s) => s.names_hidden && !/Zed/.test(s.student_name)), JSON.stringify(live.data?.students?.[0])?.slice(0, 160));
    const debateRes = await admin('GET', `/analytics/results?section_ids=${SECTION}&case_ids=zz-debate&statuses=all&limit=50&offset=0`);
    ok('a non-personal type keeps names', debateRes.data?.students?.[0]?.student_name?.startsWith('Zed'));

    // Issue Analytics off by default
    const est = await admin('GET', `/issue-analytics/estimate?case_id=zz-liken&scenario_id=${lS}&section_ids=${SECTION}`);
    ok('estimate says personal', est.data?.personal_activity === true, JSON.stringify(est.error));
    const run = await admin('POST', '/issue-analytics/runs', { case_id: 'zz-liken', scenario_id: lS, section_ids: [SECTION], confirmed: true });
    ok('run refused until turned on', run.status === 400 && /personal/i.test(run.error?.message || ''), JSON.stringify(run));
  }

  // ---------- package round trip of a debate: tokens and goal
  const { collectPack } = await imp('server/services/activityPack/export.js');
  const pack = await collectPack({ user: { id: admins[0].id, role: 'admin', superuser: true }, effectiveInstructorId: null }, { items: [{ case_id: 'zz-debate', settings: { source: 'defaults' } }] });
  const req = pack.manifest.requires;
  ok('package requires the feature tokens', ['activity_definition:1', 'positions:assigned', 'positions:two_sided', 'activity:goal', 'grading:type_criteria'].every((t) => req.includes(t)), req.join());
  ok('package carries the goal and the definition', pack.activities[0].goal === 'Students can argue from evidence.' && pack.activityTypes.some((d) => d.key === 'debate'));
} catch (e) {
  failed++;
  console.log('ERROR', e);
} finally {
  if (!process.argv.includes('--keep')) await cleanup();
  await pool.end();
  console.log(failed ? `\n${failed} FAILED, ${passed} passed` : `\nall ${passed} passed`);
  process.exit(failed ? 1 : 0);
}
