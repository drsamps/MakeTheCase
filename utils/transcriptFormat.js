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
 * TIMING (2026-09). When the writer knows when each message entered the chat, every marker
 * carries a turn number and the minutes since the previous turn:
 *
 *   [PROTAGONIST Sylvia Cooper | 1] Hello Jane...
 *
 *   [STUDENT Jane Doe | 2 after 3.52m] I would refund the shipment...
 *
 * "| n" alone means turn n with no known gap (turn 1, or a missing time). A protagonist
 * turn's gap is the AI response time. parseTranscript() returns the parts as
 * turnNumber / elapsedMinutes and a clean speaker. The timing is for instructors only:
 * anything that sends a stored transcript to an LLM must pass it through
 * stripTurnTiming() first, so pacing cannot influence grading or analysis.
 *
 * LEGACY. Stored transcripts also use older shapes, all "Speaker: content" joined by blank
 * lines: "{student full name}: ", "{protagonist}: " and "CEO: " (the final save hardcoded
 * 'CEO' until 2026-09), plus "STUDENT: " once an admin has anonymized one.
 * parseTranscript() handles all of them.
 */

const MARKER_RE = /\[(STUDENT|PROTAGONIST) ([^\]\n]*)\] ?/g;
const MARKER_START_RE = /\[(\s*)(STUDENT|PROTAGONIST)\b/gi;
/** The optional " | n" / " | n after m.mmm" suffix at the end of a marker's name part. */
const TIMING_SUFFIX_RE = / \| (\d+)(?: after (\d+\.\d{2})m)?$/;
/** A whole marker with a timing suffix; used to strip it. */
const TIMED_MARKER_RE = /\[(STUDENT|PROTAGONIST) ([^\]\n]*?) \| \d+(?: after \d+\.\d{2}m)?\]/g;

/**
 * Minutes between two epoch-ms times as a 2-decimal string ("3.52"), or null when either
 * time is missing. Shared by transcripts and prompt logs so both use the same arithmetic.
 * Their turn NUMBERS can differ: the prompt log counts only messages sent to the model,
 * while the transcript also counts app-generated ones (hint refusals, retry notices).
 */
export function elapsedMinutes(prevAt, at) {
  if (!Number.isFinite(prevAt) || !Number.isFinite(at)) return null;
  return (Math.max(0, at - prevAt) / 60000).toFixed(2);
}

/** "12" or "12 after 3.52m": the turn label used by transcripts and prompt logs. */
export function turnLabel(n, prevAt, at) {
  const m = elapsedMinutes(prevAt, at);
  return m === null ? String(n) : `${n} after ${m}m`;
}

/** Remove turn timing from every marker, for text that will be sent to an LLM. */
export function stripTurnTiming(text) {
  return String(text ?? '').replace(TIMED_MARKER_RE, '[$1 $2]');
}

/** The timing suffix of a marker, through its closing bracket. */
const TIMING_IN_MARKER_RE = / \| \d+(?: after \d+\.\d{2}m)?\]/g;

/**
 * Apply a text rewrite (e.g. anonymization's word replacement) everywhere except inside
 * turn-timing suffixes, so a replaced word such as "after" cannot corrupt them.
 */
export function rewriteOutsideTurnTiming(text, rewrite) {
  const src = String(text ?? '');
  let out = '';
  let last = 0;
  for (const m of src.matchAll(TIMING_IN_MARKER_RE)) {
    out += rewrite(src.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return out + rewrite(src.slice(last));
}

/** Make text safe to place inside a transcript: no marker can start inside it. */
export function neutralizeMarkers(text) {
  return String(text ?? '').replace(MARKER_START_RE, '($1$2');
}

/** A name that can sit inside a marker: no brackets, no "|" (the timing delimiter), no line breaks. */
function markerName(name, fallback) {
  const clean = String(name ?? '').replace(/[[\]|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  return clean || fallback;
}

/** " | n" / " | n after m.mmm" per turn, or null when no turn has a time (legacy callers). */
function timingSuffixes(turns) {
  try {
    if (!turns.some(t => Number.isFinite(t.at))) return null;
    return turns.map((t, i) => ` | ${turnLabel(i + 1, i > 0 ? turns[i - 1].at : undefined, t.at)}`);
  } catch {
    // Timing is a convenience; it must never stop a transcript from being saved.
    return null;
  }
}

/**
 * Build a transcript blob.
 * @param {{ role: 'student' | 'protagonist', content: string, at?: number }[]} turns
 *   `at` (epoch ms, optional) adds the turn number and minutes since the prior turn.
 * @param {{ studentName?: string, protagonistName?: string }} names
 */
export function formatTranscript(turns, { studentName, protagonistName } = {}) {
  const student = markerName(studentName, 'Student');
  const protagonist = markerName(protagonistName, 'Protagonist');
  const suffixes = timingSuffixes(turns);
  return turns
    .map((t, i) => {
      const timing = suffixes ? suffixes[i] : '';
      return t.role === 'student'
        ? `[STUDENT ${student}${timing}] ${neutralizeMarkers(t.content)}`
        : `[PROTAGONIST ${protagonist}${timing}] ${neutralizeMarkers(t.content)}`;
    })
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
 *             turns: { role: 'student' | 'protagonist', speaker: string, start: number, end: number,
 *                      turnNumber?: number | null, elapsedMinutes?: number | null }[] }}
 *   turnNumber / elapsedMinutes come from the timing suffix (marked format only); null when absent.
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
      const timing = m[2].match(TIMING_SUFFIX_RE);
      return {
        role: m[1] === 'STUDENT' ? 'student' : 'protagonist',
        speaker: timing ? m[2].slice(0, timing.index) : m[2],
        turnNumber: timing ? Number(timing[1]) : null,
        elapsedMinutes: timing && timing[2] !== undefined ? Number(timing[2]) : null,
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
