import { Quote } from './types';

/**
 * Quote ordering for Present mode.
 *
 * The raw quote list arrives in `ORDER BY theme_id, case_chat_id, id`, so taking the first
 * three means the same handful of students are quoted on every slide of the deck. This
 * reorders them so that reading any consecutive window hears from as many different students
 * as possible.
 */

/** 32-bit string hash (FNV-1a), so a seed string can drive the PRNG. */
function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — small, fast, deterministic. Same seed, same deck, every time. */
function prng(seed: number): () => number {
  let a = seed || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], rand: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Order a theme's quotes so the whole class is heard from before anyone is quoted twice.
 * quoteWindow() then keeps each displayed set to different students.
 *
 * Quotes are grouped by chat (one chat = one student), the groups and their contents are
 * shuffled from `seed`, then flattened round-robin: everyone's first quote, then everyone's
 * second, and so on. Deterministic, so a deck never reshuffles under the presenter.
 */
export function buildQuoteRotation(quotes: Quote[], seed: string): Quote[] {
  if (quotes.length <= 1) return quotes.slice();
  const rand = prng(hashSeed(seed));

  const byStudent = new Map<string, Quote[]>();
  for (const q of quotes) {
    const list = byStudent.get(q.case_chat_id);
    if (list) list.push(q);
    else byStudent.set(q.case_chat_id, [q]);
  }

  const groups = shuffled([...byStudent.values()], rand).map(g => shuffled(g, rand));
  const deepest = Math.max(...groups.map(g => g.length));
  const out: Quote[] = [];
  for (let round = 0; round < deepest; round++) {
    for (const g of groups) if (round < g.length) out.push(g[round]);
  }
  return out;
}

/**
 * `count` quotes read from `cursor` onward, wrapping around, from `count` DIFFERENT students
 * whenever the theme has that many. The rotation alone cannot promise that: past its first
 * round it holds only students with several quotes (A×3, B, C rotates as A B C A A), so a plain
 * slice could show one student three times. Quotes from a student already in the set are
 * skipped; only when fewer than `count` students exist is the set topped up with repeats.
 */
export function quoteWindow(rotation: Quote[], cursor: number, count: number): Quote[] {
  const n = rotation.length;
  if (n === 0) return [];
  if (n <= count) return rotation;
  const start = ((cursor % n) + n) % n;
  const picked: Quote[] = [];
  const skipped: Quote[] = [];
  const students = new Set<string>();
  for (let k = 0; k < n && picked.length < count; k++) {
    const q = rotation[(start + k) % n];
    if (students.has(q.case_chat_id)) skipped.push(q);
    else { students.add(q.case_chat_id); picked.push(q); }
  }
  for (const q of skipped) {
    if (picked.length >= count) break;
    picked.push(q);
  }
  return picked;
}
