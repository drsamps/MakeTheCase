// Assertions for utils/academicIds.js. Run: node server/scripts/check-academic-ids.js
import assert from 'node:assert/strict';
import {
  mintSectionId, tryMintSectionId, defaultSectionTitle, sortSemesters, parseSemesterCode,
  buildSemesterCode, deriveSemesterName, approxTermStart, courseCodeError, semesterCodeError,
} from '../../utils/academicIds.js';

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

check('mints the house format', () => {
  assert.equal(mintSectionId('f26', 'gscm410', 1), 'f26-gscm410-1');
  assert.equal(mintSectionId('su26', 'mba530', 12), 'su26-mba530-12');
});

check('refuses hyphens, uppercase and blanks in parts', () => {
  assert.throws(() => mintSectionId('f26', 'emba-ao', 1));
  assert.throws(() => mintSectionId('f26', 'GSCM410', 1));
  assert.throws(() => mintSectionId('', 'gscm410', 1));
  assert.throws(() => mintSectionId('f26', 'gscm410', 0));
});

check('refuses ids longer than sections.section_id', () => {
  assert.throws(() => mintSectionId('unassigned', 'casechattest', 1));
  assert.ok(tryMintSectionId('unassigned', 'casechattest', 1).error);
});

check('parses codes and legacy names', () => {
  assert.equal(parseSemesterCode('sp26').term.code, 'sp');
  assert.equal(parseSemesterCode('Fall 2025').year, 2025);
  assert.equal(parseSemesterCode('ongoing'), null);
  assert.equal(buildSemesterCode('w', 2027), 'w27');
  assert.equal(deriveSemesterName('su26'), 'Summer 2026');
  assert.equal(deriveSemesterName('ongoing'), 'ongoing');
  assert.equal(approxTermStart('f26'), '2026-09-01');
});

check('sorts by start date, not code (fixture has sp26 AND su26 so no alphabetical order matches)', () => {
  const codes = ['w26', 'f26', 'sp26', 'su26'];
  const rows = [...codes.map((c) => ({ semester_code: c, start_date: approxTermStart(c) })),
    { semester_code: 'ongoing', start_date: null }];
  const sorted = sortSemesters(rows).map((r) => r.semester_code);
  assert.deepEqual(sorted, ['f26', 'su26', 'sp26', 'w26', 'ongoing']);
  // Vacuity guard: the expected order must differ from both alphabetical orders.
  const asc = [...codes].sort();
  assert.notDeepEqual(sorted.slice(0, 4), asc);
  assert.notDeepEqual(sorted.slice(0, 4), [...asc].reverse());
});

check('default title', () => {
  assert.equal(defaultSectionTitle('GSCM 410 - Ops Mgt', 1), 'GSCM 410 - Ops Mgt - Sec 1');
  assert.equal(defaultSectionTitle('', 1), '');
});

check('validators', () => {
  assert.equal(courseCodeError('gscm410'), null);
  assert.ok(courseCodeError('GSCM 410'));
  assert.ok(courseCodeError('averyveryverylongcode'));
  assert.equal(semesterCodeError('ongoing'), null);
  assert.ok(semesterCodeError('Fall 2026'));
});

console.log(`\n${passed} checks passed`);
