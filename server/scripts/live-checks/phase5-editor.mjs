// StudyChat Phase 5 end to end.
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
let failed = 0, passed = 0;
const ok = (name, cond, extra = '') => { if (cond) { passed++; console.log(`  ok  ${name}`); } else { failed++; console.log(`FAIL  ${name} ${extra}`); } };
const [admins] = await pool.query('SELECT id, email FROM admins WHERE superuser = 1 LIMIT 1');
const token = generateToken(admins[0].id, admins[0].email, 'admin', { superuser: true });
const call = async (method, url, body, t = token) => {
  const res = await fetch(API + url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, data: json.data, error: json.error };
};
try {
  for (const key of ['case_chat', 'teach_back', 'debate', 'apply', 'liken_to_me', 'pitch', 'roleplay']) {
    const r = await call('POST', `/activity-types/${key}/preview`, {});
    ok(`${key} previews on sample text`, r.status === 200 && r.data.greeting.length > 0, JSON.stringify(r.error));
    const all = `${r.data?.system_prompt}${r.data?.greeting}`;
    ok(`${key} sample has no unfilled slots`, !/\{[a-z_]+\}/.test(all), (all.match(/\{[a-z_]+\}/g) || []).join());
  }
  const [[{ cnt0: before }]] = await pool.query('SELECT COUNT(*) AS cnt0 FROM case_chats');
  const [[{ usageBefore }]] = await pool.query("SELECT COUNT(*) AS usageBefore FROM model_usage WHERE purpose = 'activity_type_test'");
  const greet = (await call('POST', '/activity-types/pitch/preview', {})).data.greeting;
  const t1 = await call('POST', '/activity-types/pitch/test-chat', { history: [{ role: 'protagonist', content: greet }], message: 'Stockouts cost 12% of sales, and carrying cost is 25% a year on far less money, so doubling safety stock pays.' });
  ok('test chat answers', t1.status === 200 && t1.data.text.length > 0, JSON.stringify(t1.error));
  console.log('      AI:', t1.data?.text?.slice(0, 160));
  console.log('      signals:', JSON.stringify(t1.data?.signals));
  ok('test chat strips and returns signals', !/studychat/i.test(t1.data?.text || '') && t1.data?.signals?.touchpoints?.length > 0, JSON.stringify(t1.data));
  const g = await call('POST', '/activity-types/pitch/test-grade', { history: [{ role: 'protagonist', content: greet }, { role: 'student', content: 'Stockouts cost 12% of sales, and carrying cost is 25% a year on far less money, so doubling safety stock pays.' }, { role: 'protagonist', content: t1.data?.text || '' }] });
  ok('test grade returns criteria', g.status === 200 && g.data.criteria?.length === 3, JSON.stringify(g.error));
  ok('test grade returns touchpoints', g.data?.touchpoints?.length === 2, JSON.stringify(g.data?.touchpoints));
  const [[{ cnt1: after }]] = await pool.query('SELECT COUNT(*) AS cnt1 FROM case_chats');
  ok('nothing recorded as a student chat', Number(before) === Number(after));
  await new Promise((r) => setTimeout(r, 1500));
  const [[{ usageAfter }]] = await pool.query("SELECT COUNT(*) AS usageAfter FROM model_usage WHERE purpose = 'activity_type_test'");
  ok('billed usage logged', Number(usageAfter) >= Number(usageBefore) + 2, `${usageBefore} -> ${usageAfter}`);
  // A draft with an unsafe template is refused even in a test
  const bad = structuredClone((await call('GET', '/activity-types/pitch')).data.current.definition);
  bad.greeting.template = 'Hello {persona_instructions}';
  const refused = await call('POST', '/activity-types/pitch/test-chat', { definition: bad, history: [], message: 'hi' });
  ok('an invalid draft is refused', refused.status === 400 && refused.error?.code === 'INVALID_DEFINITION', JSON.stringify(refused.error));
  // Students and instructors cannot reach it
  const st = await call('POST', '/activity-types/pitch/test-chat', { history: [], message: 'hi' }, generateToken('x', 'x@example.test', 'student'));
  ok('students refused', st.status === 403, String(st.status));
} catch (e) { failed++; console.log('ERROR', e); }
await pool.end();
console.log(failed ? `\n${failed} FAILED, ${passed} passed` : `\nall ${passed} passed`);
process.exit(failed ? 1 : 0);
