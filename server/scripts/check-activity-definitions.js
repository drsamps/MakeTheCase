// What the activity type validator must refuse (utils/activityEngine/validate.js), offline.
// Run: node server/scripts/check-activity-definitions.js
//
// The validator runs at save, publish, package install and server start (activityTypeStore.js).
// Each refusal below is a rule that would otherwise fail silently: a student template that leaks
// AI-only text, a slot that renders as literal braces, a field too large for a prompt, or a type
// whose traits change under chats that already ran on them.
import assert from 'node:assert/strict';
import { BUILTIN_DEFINITIONS } from '../../utils/activityEngine/builtins/index.js';
import { validateDefinition, sameTraits, customKeyFor, isTypeKey, isCustomKey, COPY_KEYS } from '../../utils/activityEngine/index.js';

let failed = 0;
let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name}\n      ${String(e?.message || e).split('\n')[0]}`);
  }
}
const base = () => ({ ...structuredClone(BUILTIN_DEFINITIONS.teach_back), key: 'c_check_0a1b2c3d', based_on: 'teach_back', label: 'Check' });
function refused(def, pattern) {
  const { ok, errors } = validateDefinition(def);
  assert.equal(ok, false, 'expected the definition to be refused');
  assert.ok(errors.some((e) => pattern.test(e)), `no error matched ${pattern}: ${errors.join(' | ')}`);
}

check('both built-ins validate', () => {
  for (const def of Object.values(BUILTIN_DEFINITIONS)) assert.equal(validateDefinition(def).ok, true, def.key);
});
check('a clone of a built-in validates', () => assert.equal(validateDefinition(base()).ok, true));

check('an AI-only slot in the greeting', () => {
  const d = base();
  d.greeting.template = '{hello} I am {ai_intro}. {persona_instructions}';
  refused(d, /greeting\.template: slot \{persona_instructions\}/);
});
check('an AI-only slot in student copy', () => {
  const d = base();
  d.copy.farewell = 'Bye {first_name}. {additional_instructions}';
  refused(d, /copy\.farewell: slot \{additional_instructions\}/);
});
check('a slot a copy key does not offer (student-safe, but not this key\'s)', () => {
  const d = base();
  d.copy.goodbye = 'Bye {first_name}, about {case_title}.';
  refused(d, /copy\.goodbye: slot \{case_title\}/);
});
check('an unknown slot in the role template', () => {
  const d = base();
  d.prompt.role = [...d.prompt.role, 'Remember {student_mood}.'];
  refused(d, /prompt\.role: slot \{student_mood\}/);
});
check('a slot in a per-turn note (model_note takes none)', () => {
  const d = base();
  d.prompt.final_turn_note = '\n\n(Thank {student_name}.)';
  refused(d, /final_turn_note: slot \{student_name\}/);
});
check('an optional block that does not contain its own slot', () => {
  const d = base();
  d.prompt.optional.situation = '\nNo slot here.\n';
  refused(d, /prompt\.optional\.situation: must contain \{situation\}/);
});
check('an oversize field', () => {
  const d = base();
  d.copy.farewell = 'x'.repeat(20001);
  refused(d, /copy\.farewell: longer than/);
});
check('HTML in student copy', () => {
  const d = base();
  d.copy.farewell = 'Bye <script>alert(1)</script>';
  refused(d, /HTML is not allowed/);
});
check('an unknown key anywhere', () => {
  const d = base();
  d.copy.surprise = 'hi';
  refused(d, /copy\.surprise: unknown key/);
});
check('a missing copy key', () => {
  const d = base();
  delete d.copy.goodbye;
  refused(d, /copy\.goodbye: missing/);
});
check('an engine feature this server does not have (signals)', () => {
  const d = base();
  d.traits.signals.complete = true;
  refused(d, /not supported by this server yet/);
});
check('a key that does not fit cases.activity_type or the custom pattern', () => {
  const d = base();
  d.key = 'c_this_slug_is_far_too_long_for_it_0a1b2c3d';
  refused(d, /^key:/);
});
check('a traits change is detected (refused on a published key by the store)', () => {
  const a = base();
  const b = base();
  assert.equal(sameTraits(a, b), true);
  b.traits.opening_word_floor = !b.traits.opening_word_floor;
  assert.equal(sameTraits(a, b), false);
  const reordered = { ...a, traits: Object.fromEntries(Object.entries(a.traits).reverse()) };
  assert.equal(sameTraits(a, reordered), true, 'key order must not count as a change');
});
check('custom keys from labels fit the column and the pattern', () => {
  for (const label of ['Explain to a Reporter', 'Ünïcødé — and a very long name indeed for a type', '!!!', '']) {
    const key = customKeyFor(label, '0a1b2c3d');
    assert.ok(isTypeKey(key) && isCustomKey(key) && key.length <= 30, `${label} -> ${key}`);
  }
});
check('every copy key is in both built-ins', () => {
  for (const def of Object.values(BUILTIN_DEFINITIONS)) for (const k of Object.keys(COPY_KEYS)) assert.ok(k in def.copy, `${def.key}.copy.${k}`);
});

console.log(failed ? `\n${failed} FAILED, ${passed} passed` : `\nall ${passed} passed`);
process.exit(failed ? 1 : 0);
