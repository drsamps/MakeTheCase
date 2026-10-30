// Byte-for-byte check of the activity engine (utils/activityEngine/) against the golden fixture.
// Run: node server/scripts/check-activity-engine.js        (offline)
//      node server/scripts/check-activity-engine.js --db   (also every recent real chat on the dev DB)
//
// fixtures/activity-engine-golden.json holds inputs and the exact text the hand-written builders
// produced (captured 2026-10-29, after the StudyChat Phase 0 fixes): system prompts, greetings,
// coach prompts, the per-turn notes, every student copy string and the Teach-back intro bar.
// For one release this asserts ENGINE = HAND BUILDER = GOLDEN (server/services/legacyActivityBuilders.js);
// when the hand builders are deleted, drop the "hand" comparisons.
//
// The system prompt is the provider prompt-cache prefix and prompt logs are compared across
// versions, so any difference matters. A DELIBERATE wording change edits the built-in JSON and the
// "expected" strings in the fixture in the same commit.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILTIN_DEFINITIONS } from '../../utils/activityEngine/builtins/index.js';
import {
  buildSystemPrompt, buildGreeting, buildCoachPrompt, copyFor, activityIntroText,
  studentActivityView, validateDefinition, templateText,
} from '../../utils/activityEngine/index.js';
import { LEGACY_BUILDERS } from '../services/legacyActivityBuilders.js';
import { ACTIVITY_TYPES } from '../../utils/activityTypes.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'activity-engine-golden.json'), 'utf8'));
const withDb = process.argv.includes('--db');

let failed = 0;
let total = 0;
function same(name, got, expected) {
  total++;
  try {
    assert.equal(got, expected);
    return true;
  } catch {
    failed++;
    const g = String(got);
    const e = String(expected);
    let i = 0;
    while (i < g.length && g[i] === e[i]) i++;
    console.log(`FAIL  ${name}: first difference at char ${i}`);
    console.log(`      expected: ${JSON.stringify(e.slice(Math.max(0, i - 20), i + 80))}`);
    console.log(`      got:      ${JSON.stringify(g.slice(Math.max(0, i - 20), i + 80))}`);
    return false;
  }
}
function section(title, rows, fn) {
  const before = failed;
  for (const r of rows) fn(r);
  console.log(`${failed === before ? '  ok' : 'FAIL'}  ${title} (${rows.length})`);
}

const def = (mode) => BUILTIN_DEFINITIONS[mode];

section('definitions validate', Object.values(BUILTIN_DEFINITIONS), (d) => {
  const { ok, errors } = validateDefinition(d);
  total++;
  if (!ok) { failed++; console.log(`FAIL  ${d.key}:\n      ${errors.join('\n      ')}`); }
});

const { KNOWN_CHAT_OPTION_KEYS } = await import('../services/chatOptions.js');
section('definitions name only known chat options', Object.values(BUILTIN_DEFINITIONS), (d) => {
  const unknown = [...Object.keys(d.chat_options.defaults), ...d.chat_options.hidden].filter((k) => !KNOWN_CHAT_OPTION_KEYS.has(k));
  same(`${d.key} chat option keys`, unknown.join(', '), '');
});

// The server adapter must hand out exactly the engine's output (activityBehaviour is what the
// chat, grading and greeting routes call).
const { activityBehaviour } = await import('../services/activityTypes.js');
section('server adapter = engine', golden.system.slice(0, 4).concat(golden.system.slice(-4)), (c) => {
  same(`adapter/${c.name}`, activityBehaviour(c.mode).buildSystemPrompt(c.studentName, c.persona, c.caseData, c.options), c.expected);
});

// utils/activityTypes.js keeps a small static traits table so the student page never bundles the
// definitions. It must agree with them.
section('utils/activityTypes.js agrees with the definitions', Object.values(BUILTIN_DEFINITIONS), (d) => {
  const t = ACTIVITY_TYPES[d.key];
  same(`${d.key} registered`, Boolean(t), true);
  if (!t) return;
  same(`${d.key} characterFrom`, t.characterFrom, d.traits.character);
  same(`${d.key} personaKind`, t.personaKind, d.traits.persona_kind);
  same(`${d.key} usesPositions`, t.usesPositions, d.traits.positions !== 'off');
  same(`${d.key} label`, t.label, d.label);
});

section('system prompts: engine = golden = hand builder', golden.system, (c) => {
  same(`system/${c.name} (engine)`, buildSystemPrompt(def(c.mode), c.studentName, c.persona, c.caseData, c.options), c.expected);
  same(`system/${c.name} (hand)`, LEGACY_BUILDERS[c.mode].buildSystemPrompt(c.studentName, c.persona, c.caseData, c.options), c.expected);
});

section('greetings: engine = golden = hand builder', golden.greeting, (c) => {
  same(`greeting/${c.name} (engine)`, buildGreeting(def(c.mode), c.caseData, c.studentName, c.personaId), c.expected);
  same(`greeting/${c.name} (hand)`, LEGACY_BUILDERS[c.mode].buildGreeting(c.caseData, c.studentName, c.personaId), c.expected);
});

section('coach prompts: engine = golden = hand builder', golden.coach, (c) => {
  same(`coach/${c.name} (engine)`, buildCoachPrompt(def(c.mode), c.chatHistory, c.studentName, c.caseData, c.freeHints, c.rubric), c.expected);
  same(`coach/${c.name} (hand)`, LEGACY_BUILDERS[c.mode].buildCoachPrompt(c.chatHistory, c.studentName, c.caseData, c.freeHints, c.rubric), c.expected);
});

section('per-turn notes', golden.notes, (n) => {
  same(`${n.mode} final_turn_note`, templateText(def(n.mode).prompt.final_turn_note), n.final_turn_note);
  same(`${n.mode} position_pick_note`, templateText(def(n.mode).prompt.position_pick_note), n.position_pick_note);
});

section('student copy', golden.copy, (c) => {
  const view = studentActivityView(def(c.mode), 'check');
  same(`copy/${c.mode}/${c.key}`, copyFor(view, c.key, c.vars), c.expected);
});

section('Teach-back intro bar', golden.intro, (c) => {
  const got = activityIntroText(studentActivityView(def('teach_back'), 'check'), c.facts);
  const { heading, teachLine, topic, about, instructions } = got;
  same(`intro/${c.name}`, JSON.stringify({ heading, teachLine, topic, about, instructions }), JSON.stringify(c.expected));
});

section('case chat has no intro bar', [1], () => same('case chat intro', activityIntroText(studentActivityView(def('case_chat'), 'check'), {}), null));

if (withDb) await checkRealChats();

console.log(failed ? `\n${failed} of ${total} checks FAILED` : `\nall ${total} checks passed`);
process.exit(failed ? 1 : 0);

/**
 * Every recent real chat on the dev database: its system prompt, greeting and (when graded) coach
 * prompt, built by the engine and by the hand builders from the same inputs. Read-only.
 */
async function checkRealChats() {
  const { pool } = await import('../db.js');
  const { loadChatContext } = await import('../services/chatPrompt.js');
  const { listTurns, historyForGrading } = await import('../services/chatTurns.js');
  const { protagonistLabel } = await import('../services/chatPrompt.js');
  try {
    const [chats] = await pool.query(
      `SELECT cc.id, cc.case_id, cc.section_id, cc.scenario_id, cc.persona, cc.initial_position_id
         FROM case_chats cc JOIN cases c ON c.case_id = cc.case_id
        WHERE cc.scenario_id IS NOT NULL
        ORDER BY cc.start_time DESC LIMIT 150`
    );
    const rows = [];
    for (const chat of chats) {
      let ctx;
      try { ctx = await loadChatContext(chat); } catch { continue; }
      rows.push({ chat, ctx });
    }
    section(`real chats on the dev database: system prompt and greeting`, rows, ({ chat, ctx }) => {
      const d = def(ctx.mode);
      const hand = LEGACY_BUILDERS[ctx.mode];
      for (const name of ['Sam', 'Student']) {
        same(`db/${chat.id}/system/${name}`, buildSystemPrompt(d, name, chat.persona, ctx.caseData, ctx.options), hand.buildSystemPrompt(name, chat.persona, ctx.caseData, ctx.options));
        same(`db/${chat.id}/greeting/${name}`, buildGreeting(d, ctx.caseData, name, chat.persona), hand.buildGreeting(ctx.caseData, name, chat.persona));
      }
    });
    // The server's turns where it kept them (migration 082), else the stored transcript, as
    // Re-evaluate reads it.
    const { stripTurnTiming } = await import('../../utils/transcriptFormat.js');
    const graded = [];
    for (const r of rows.slice(0, 60)) {
      const turns = await listTurns(r.chat.id);
      if (turns.some((t) => t.role === 'student')) {
        graded.push({ ...r, history: historyForGrading(turns, protagonistLabel(r.ctx)) });
        continue;
      }
      const [[t]] = await pool.query('SELECT transcript FROM transcripts WHERE case_chat_id = ? ORDER BY created_at DESC LIMIT 1', [r.chat.id]);
      if (t?.transcript) graded.push({ ...r, history: stripTurnTiming(t.transcript) });
    }
    section('real chats on the dev database: coach prompt', graded, ({ chat, ctx, history }) => {
      const d = def(ctx.mode);
      for (const fh of [0, 1, 2]) {
        same(`db/${chat.id}/coach/${fh}`, buildCoachPrompt(d, history, 'Sam', ctx.caseData, fh, null), LEGACY_BUILDERS[ctx.mode].buildCoachPrompt(history, 'Sam', ctx.caseData, fh, null));
      }
    });
  } finally {
    await pool.end();
  }
}
