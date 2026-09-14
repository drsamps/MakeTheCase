/**
 * Semester / course / section identity: the formats, the derived names, and the ids minted
 * from them.
 *
 * ONE FILE FOR BOTH SIDES. The server imports it to mint and validate; the dashboard imports
 * it to preview. The preview is a live picture of the id the server will store, so a second
 * copy of these rules would eventually show the instructor one id and save another.
 * Plain ESM + JSDoc (root package.json is "type":"module", tsconfig has allowJs).
 * Ported from Quizzer's semesters.py.
 *
 * SEMESTER CODE FORMAT IS `tyy`: a term letter plus a two-digit year. BYU runs four:
 *     w26  Winter 2026    sp26  Spring 2026    su26  Summer 2026    f26  Fall 2026
 * No bare 's' is a term, so the alternation is unambiguous.
 *
 * NOTHING SORTS BY CODE. w26 < sp26 < su26 < f26 chronologically, but alphabetically f26
 * sorts first and w26 last. semesters.start_date is the sort field everywhere;
 * approxTermStart() exists to SEED it, not to replace it.
 *
 * NON-CONFORMING CODES ARE VALID. 'ongoing' and 'unassigned' are in live data. Everything
 * here is tolerant: what it recognises gets a derived name and date, what it does not is
 * passed through.
 *
 * IDS ARE MINTED FROM COLUMNS, NEVER PARSED AT RUNTIME. mintSectionId() builds the composite
 * from sections.semester_id -> semesters.semester_code, courses.course_code and
 * sections.section_number. Code that needs to know a section's semester, course or number
 * reads those columns -- legacy ids like 'w26-adv-ops-emba' do not follow the scheme.
 */

/** Term code -> display name and approximate first day (month, day), in calendar order.
 *  The start dates only order a new semester until an admin enters real ones.
 *  Keep in sync with the backfill in server/migrations/077_semester_codes_and_course_catalog.sql. */
export const TERMS = [
  { code: 'w', name: 'Winter', month: 1, day: 1 },
  { code: 'sp', name: 'Spring', month: 4, day: 25 },
  { code: 'su', name: 'Summer', month: 6, day: 20 },
  { code: 'f', name: 'Fall', month: 9, day: 1 },
];

const TERM_BY_CODE = Object.fromEntries(TERMS.map((t) => [t.code, t]));
const TERM_BY_NAME = Object.fromEntries(TERMS.map((t) => [t.name.toLowerCase(), t]));

const SEMESTER_CODE_RE = /^(sp|su|w|f)(\d{2})$/i;
const LEGACY_NAME_RE = /^(winter|spring|summer|fall)\s*(\d{4})$/i;

/** semesters.semester_code is VARCHAR(10). */
export const SEMESTER_CODE_MAX = 10;
/** courses.course_code is VARCHAR(20); 12 keeps '{su26}-{code}-{12}' within a section id. */
export const COURSE_CODE_MAX = 12;
/** sections.section_id is VARCHAR(20) with a CHECK constraint. */
export const SECTION_ID_MAX = 20;

const CODE_PART_RE = /^[a-z0-9_]+$/;

/**
 * Is this usable as one part of a minted id? Lowercase letters, digits, underscore.
 * Hyphens are reserved: they separate the parts.
 * @param {unknown} value
 */
export function isValidCodePart(value) {
  return typeof value === 'string' && CODE_PART_RE.test(value);
}

/**
 * Lowercase and strip everything outside [a-z0-9_]. For suggesting a code from free text.
 * @param {unknown} value
 */
export function normalizeCode(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '');
}

/**
 * Validate a semester code for create/update. Returns an error message or null.
 * Tolerant: 'ongoing' is fine; only the charset and length are enforced.
 * @param {unknown} code
 */
export function semesterCodeError(code) {
  if (!code) return 'Semester ID is required.';
  if (!isValidCodePart(code)) return 'Semester ID may only contain lowercase letters, numbers and underscores (e.g. f26).';
  if (String(code).length > SEMESTER_CODE_MAX) return `Semester ID must be ${SEMESTER_CODE_MAX} characters or fewer.`;
  return null;
}

/**
 * Validate a NEW course code. Returns an error message or null. Existing codes that break a
 * rule stay valid; only apply this where a code is being created or changed.
 * @param {unknown} code
 */
export function courseCodeError(code) {
  if (!code) return 'Course ID is required.';
  if (!isValidCodePart(code)) return 'Course ID may only contain lowercase letters, numbers and underscores (e.g. gscm410).';
  if (String(code).length > COURSE_CODE_MAX) return `Course ID must be ${COURSE_CODE_MAX} characters or fewer so section IDs fit.`;
  return null;
}

/**
 * Does this follow the house `tyy` format? Advisory -- drives a hint, never a rejection.
 * @param {unknown} code
 */
export function isWellFormedSemesterCode(code) {
  return SEMESTER_CODE_RE.test(String(code ?? ''));
}

/**
 * { term, year } for 'f26' or 'Fall 2026'; null for anything else.
 * @param {unknown} value
 * @returns {{ term: {code: string, name: string, month: number, day: number}, year: number } | null}
 */
export function parseSemesterCode(value) {
  const text = String(value ?? '').trim();
  let m = SEMESTER_CODE_RE.exec(text);
  if (m) return { term: TERM_BY_CODE[m[1].toLowerCase()], year: 2000 + Number(m[2]) };
  m = LEGACY_NAME_RE.exec(text);
  if (m) return { term: TERM_BY_NAME[m[1].toLowerCase()], year: Number(m[2]) };
  return null;
}

/**
 * 'f26' for (term 'f', year 2026).
 * @param {string} termCode
 * @param {number|string} year
 */
export function buildSemesterCode(termCode, year) {
  const y = Number(year);
  if (!TERM_BY_CODE[termCode] || !Number.isInteger(y)) return '';
  return `${termCode}${String(y % 100).padStart(2, '0')}`;
}

/**
 * 'Fall 2026' for a recognised code; the value itself otherwise, so 'ongoing' looks like itself.
 * @param {unknown} code
 */
export function deriveSemesterName(code) {
  const parsed = parseSemesterCode(code);
  if (!parsed) return String(code ?? '');
  return `${parsed.term.name} ${parsed.year}`;
}

/**
 * 'YYYY-MM-DD' approximate first day for a recognised code, or null. Seeds start_date only.
 * @param {unknown} code
 */
export function approxTermStart(code) {
  const parsed = parseSemesterCode(code);
  if (!parsed) return null;
  const { term, year } = parsed;
  return `${year}-${String(term.month).padStart(2, '0')}-${String(term.day).padStart(2, '0')}`;
}

/**
 * 'f26-gscm410-2'. Throws Error with a readable message when a part cannot be minted.
 * The section number is included even when it is 1: one shape for every section.
 * @param {string} semesterCode
 * @param {string} courseCode
 * @param {number|string} sectionNumber
 */
export function mintSectionId(semesterCode, courseCode, sectionNumber) {
  const parts = [
    ['semester ID', semesterCode],
    ['course ID', courseCode],
    ['section number', sectionNumber == null ? '' : String(sectionNumber)],
  ];
  for (const [label, part] of parts) {
    if (!part) throw new Error(`A section ID needs a ${label}.`);
    if (!isValidCodePart(part)) {
      throw new Error(`The ${label} "${part}" may only contain lowercase letters, numbers and underscores. Hyphens separate the parts.`);
    }
  }
  const n = Number(sectionNumber);
  if (!Number.isInteger(n) || n < 1 || n > 999) throw new Error('Section number must be a whole number from 1 to 999.');
  const id = `${semesterCode}-${courseCode}-${n}`;
  if (id.length > SECTION_ID_MAX) {
    throw new Error(`Section ID "${id}" is longer than ${SECTION_ID_MAX} characters. Shorten the course ID.`);
  }
  return id;
}

/**
 * mintSectionId without throwing: { id, error }.
 * @param {string} semesterCode
 * @param {string} courseCode
 * @param {number|string} sectionNumber
 */
export function tryMintSectionId(semesterCode, courseCode, sectionNumber) {
  try {
    return { id: mintSectionId(semesterCode, courseCode, sectionNumber), error: null };
  } catch (err) {
    return { id: '', error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 'GSCM 410 - Ops Mgt - Sec 1'. An untitled course suggests nothing, so a code-derived
 * placeholder is never saved as a real title.
 * @param {unknown} courseName
 * @param {number|string} sectionNumber
 */
export function defaultSectionTitle(courseName, sectionNumber) {
  const name = String(courseName ?? '').trim();
  if (!name || sectionNumber == null || sectionNumber === '') return '';
  return `${name} - Sec ${sectionNumber}`;
}

/**
 * Chronological, newest first, undated last (then by code). Never sorts on the code alone.
 * @template {{ start_date?: string|Date|null, semester_code?: string|null }} T
 * @param {T[]} rows
 * @returns {T[]}
 */
export function sortSemesters(rows) {
  const key = (r) => (r.start_date ? String(r.start_date instanceof Date ? r.start_date.toISOString() : r.start_date).slice(0, 10) : '');
  return [...rows].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka && kb && ka !== kb) return kb.localeCompare(ka);
    if (ka && !kb) return -1;
    if (!ka && kb) return 1;
    return String(a.semester_code ?? '').localeCompare(String(b.semester_code ?? ''));
  });
}
