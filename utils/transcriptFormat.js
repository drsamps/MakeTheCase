/**
 * Transcript turn format — shared by the student app (writes transcripts) and the server
 * (Issue Analytics parses them). Plain JS so both sides import the same file, like
 * utils/academicIds.js.
 *
 * transcripts.transcript is one text blob with no roles, ids or timestamps. Turns are
 * written as
 *
 *   [STUDENT Jane Doe] I would refund the shipment...
 *
 *   [PROTAGONIST Sylvia Cooper] That does not get my package here by 2pm.
 *
 * FORGERY. A marker is only trustworthy if message content can never contain one, so
 * formatTranscript() neutralises "[STUDENT" / "[PROTAGONIST" inside every message
 * (the opening bracket becomes "("). Without that, a student could type
 * "[PROTAGONIST Sylvia Cooper] ..." and forge a turn, which Issue Analytics would then
 * treat as something the protagonist said. Any writer of transcripts must go through
 * formatTranscript().
 *
 * LEGACY. Stored transcripts also use older shapes, all "Speaker: content" joined by blank
 * lines: "{student full name}: ", "{protagonist}: " and "CEO: " (the final save hardcoded
 * 'CEO' until 2026-09), plus "STUDENT: " once an admin has anonymized one.
 * parseTranscript() handles all of them.
 */

const MARKER_RE = /\[(STUDENT|PROTAGONIST) ([^\]\n]*)\] ?/g;
const MARKER_START_RE = /\[(\s*)(STUDENT|PROTAGONIST)\b/gi;

/** Make text safe to place inside a transcript: no marker can start inside it. */
export function neutralizeMarkers(text) {
  return String(text ?? '').replace(MARKER_START_RE, '($1$2');
}

/** A name that can sit inside a marker: no brackets, no line breaks. */
function markerName(name, fallback) {
  const clean = String(name ?? '').replace(/[[\]\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  return clean || fallback;
}

/**
 * Build a transcript blob.
 * @param {{ role: 'student' | 'protagonist', content: string }[]} turns
 * @param {{ studentName?: string, protagonistName?: string }} names
 */
export function formatTranscript(turns, { studentName, protagonistName } = {}) {
  const student = markerName(studentName, 'Student');
  const protagonist = markerName(protagonistName, 'Protagonist');
  return turns
    .map(t => t.role === 'student'
      ? `[STUDENT ${student}] ${neutralizeMarkers(t.content)}`
      : `[PROTAGONIST ${protagonist}] ${neutralizeMarkers(t.content)}`)
    .join('\n\n');
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Split a stored transcript into turns.
 *
 * Offsets (`start`, `end`) index the ORIGINAL text and bound the turn's content (the
 * marker or "Name: " prefix is excluded), so a quote found inside a turn can be linked
 * back into the full transcript.
 *
 * @param {string} text
 * @param {{ studentNames?: string[], protagonistNames?: string[] }} hints
 *   Names to recognise in legacy transcripts (e.g. the student's full name and first
 *   name; the scenario's protagonist). 'CEO' is always recognised as the protagonist.
 * @returns {{ format: 'marked' | 'legacy' | 'unknown',
 *             turns: { role: 'student' | 'protagonist', speaker: string, start: number, end: number }[] }}
 */
export function parseTranscript(text, { studentNames = [], protagonistNames = [] } = {}) {
  const src = String(text ?? '');

  // Marked format: every marker is a real boundary, because content cannot contain one.
  // A marked transcript always opens with a marker; requiring that keeps a legacy
  // transcript in which someone typed "[STUDENT x]" from being read as marked.
  const marks = [...src.matchAll(MARKER_RE)];
  if (marks.length > 0 && marks[0].index === 0) {
    const turns = marks.map((m, i) => {
      const start = m.index + m[0].length;
      const next = i + 1 < marks.length ? marks[i + 1].index : src.length;
      return {
        role: m[1] === 'STUDENT' ? 'student' : 'protagonist',
        speaker: m[2],
        start,
        end: trimEnd(src, start, next),
      };
    });
    return { format: 'marked', turns };
  }

  // Legacy "Speaker: " paragraphs. Longest names first so "Jane Doe" wins over "Jane".
  const roleOf = new Map();
  const add = (name, role) => {
    const n = String(name ?? '').trim();
    if (n && !roleOf.has(n)) roleOf.set(n, role);
  };
  studentNames.forEach(n => add(n, 'student'));
  protagonistNames.forEach(n => add(n, 'protagonist'));
  add('CEO', 'protagonist');
  // Admin anonymization (Results > transcript > Anonymize) replaces the student's name
  // with STUDENT, so an anonymized legacy transcript reads "STUDENT: ...".
  add('STUDENT', 'student');
  let turns = legacyTurns(src, roleOf);
  if (!turns.some(t => t.role === 'student')) {
    // The name in the transcript can differ from the student record (e.g. a CAS display
    // name). Take the most frequent other paragraph label, seen at least twice, as the
    // student; one-off "So tell me, Jane: " lines inside a reply do not qualify.
    const counts = new Map();
    for (const m of src.matchAll(/(?:^|\n\n)([^\n:[\]]{1,60}): /g)) {
      if (!roleOf.has(m[1])) counts.set(m[1], (counts.get(m[1]) || 0) + 1);
    }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] >= 2) {
      roleOf.set(best[0], 'student');
      turns = legacyTurns(src, roleOf);
    }
  }
  if (turns.length === 0) return { format: 'unknown', turns: [] };
  return { format: 'legacy', turns };
}

function legacyTurns(src, roleOf) {
  const names = [...roleOf.keys()].sort((a, b) => b.length - a.length);
  const re = new RegExp(`(^|\\n\\n)(${names.map(escapeRe).join('|')}): `, 'g');
  const hits = [...src.matchAll(re)];
  return hits.map((m, i) => {
    const start = m.index + m[1].length + m[2].length + 2;
    const next = i + 1 < hits.length ? hits[i + 1].index : src.length;
    return { role: roleOf.get(m[2]), speaker: m[2], start, end: trimEnd(src, start, next) };
  });
}

function trimEnd(src, start, end) {
  let e = end;
  while (e > start && /\s/.test(src[e - 1])) e--;
  return e;
}
