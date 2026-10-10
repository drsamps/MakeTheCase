// Byte-for-byte check of server/services/chatPromptTemplates.js.
// Run: node server/scripts/check-chat-prompt.js
//
// fixtures/chat-prompt-golden.json holds inputs and the exact prompts the original browser
// builders (constants.ts#buildSystemPrompt, teachBackPrompt.ts) produced for them, captured
// 2026-10-09 before the move to the server. Any difference changes the provider prompt-cache
// prefix and makes old and new prompt logs disagree. A DELIBERATE wording change must update
// the "expected" strings in the fixture in the same commit.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSystemPrompt, buildTeachBackSystemPrompt } from '../services/chatPromptTemplates.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'chat-prompt-golden.json'), 'utf8'));

let failed = 0;
for (const c of cases) {
  const build = c.mode === 'teach_back' ? buildTeachBackSystemPrompt : buildSystemPrompt;
  const got = build(c.studentName, c.persona, c.caseData, c.options);
  try {
    assert.equal(got, c.expected);
    console.log(`  ok  ${c.name}`);
  } catch {
    failed++;
    let i = 0;
    while (i < got.length && got[i] === c.expected[i]) i++;
    console.log(`FAIL  ${c.name}: first difference at char ${i}`);
    console.log(`      expected: ${JSON.stringify(c.expected.slice(i, i + 80))}`);
    console.log(`      got:      ${JSON.stringify(got.slice(i, i + 80))}`);
  }
}
console.log(failed ? `\n${failed} of ${cases.length} FAILED` : `\nall ${cases.length} passed`);
process.exit(failed ? 1 : 0);
