/**
 * Reading text as Markdown: the case-file editor's automatic formatting, "Text only", Remove
 * links / images, and the word check that guards Format with AI. Pure functions, shared by the
 * server (services/readingFormatAI.js) and the dashboard (components/caseFiles/ReadingEditor.tsx).
 *
 * Ported from Quizzer's ingest/to_markdown.py, which has the test suite behind these rules; see
 * its docs/2026-08-05_source_markdown.md. Rules that fail silently:
 *
 * - textToMarkdown() is the ONLY function here that guesses, and it is for text that carries no
 *   structure of its own (PDF, .txt, Text only). Web pages and Word files arrive as Markdown
 *   from their own structure (services/caseFileFetch.js, mammoth) and must never be run through
 *   it: re-deriving headings from flattened text is strictly worse than not flattening them.
 *   It is tuned to under-mark: a missed heading leaves a readable paragraph, a false one chops
 *   a sentence out of its paragraph.
 * - textToMarkdown() must be idempotent. An instructor will press Auto-format twice, and a
 *   second pass that finds new "headings" in a byline is the tool being broken.
 * - looksLikeMarkdown() is deliberately asymmetric: one unambiguous signal passes the text
 *   through untouched, because escaping real Markdown litters the reading with backslashes.
 * - Link and image patterns are LINE-BOUNDED ([^)\n]), so an unclosed bracket can never run a
 *   match across paragraphs, and every substitution keeps the line count (tidyChanged relies on
 *   it). A clickable image [![alt](img)](url) is handled FIRST everywhere, or the link pattern
 *   matches `[![alt](img)` and repoints the image at the link's page.
 * - Remove links keeps the link's TEXT (it is part of a sentence students are assessed on);
 *   Remove images drops the alt text too (it describes a picture, it is not prose).
 * - stripMarkdown() is lossy and for comparison only; markdownToText() is what Text only shows.
 *
 * MakeTheCase's PDF text (pdf-parse) usually has no blank lines, so a whole PDF is one block:
 * the rules that need a one-line block (Title Case headings) rarely fire there, while numbering,
 * keywords, ALL CAPS, bullets and reflow work as in Quizzer.
 */

// --- heuristic tuning (PDF and plain text only) -------------------------------------------

/** A heading is short. Above this a line is prose that happens to be alone. */
const HEADING_MAX_CHARS = 90;
/** A line shorter than this fraction of the block's typical width ended its paragraph. */
const SHORT_LINE_RATIO = 0.75;
/** Below this many lines there is no reliable typical width to measure against. */
const MIN_LINES_FOR_REFLOW = 3;

const TERMINAL_PUNCTUATION = ['.', '!', '?', '"', "'", '\u201d', '\u2019', ')', ']', ':', ';'];

// Bullet glyphs seen in PDF and Word exports, plus ASCII stand-ins. `o` is Word's default
// second-level bullet as it survives into a PDF text layer.
const BULLET_LINE = /^([ \t]*)(?:[\u2022\u2023\u25aa\u25ab\u25cf\u25e6\u00b7\u2043\u25b6\u2219]|[-*\u2013\u2014]|o)[ \t]+(?=\S)/;
// "1. ", "1) ", "(1) ", "a. ", "iv) ".
const ORDERED_LINE = /^([ \t]*)\(?(\d{1,3}|[ivxlcdm]{1,6}|[a-z])[).][ \t]+(?=\S)/i;
// "2 Title", "2.3 Title": numbering that states its own depth.
const NUMBERED_HEADING = /^(\d+(?:\.\d+)*)\.?[ \t]+(\S.*)$/;
// Structural vocabulary, not subject vocabulary: "Chapter" says nothing about the chapter.
const HEADING_KEYWORD = /^(chapter|section|part|appendix|unit|lesson|module|figure|table|exhibit|rule|step|question|example|case)\b[ \t]*[#\dIVXLC]*[ \t]*[:.\-\u2013]?[ \t]*/i;
// A line-initial character that would start a block construct it does not mean.
const LEADING_ESCAPE = /^([ \t]*)([#>+=|-]|\d+[.)])(\s)/;

// Word's default bullet sequence; a PDF loses the indentation, so the glyph carries the depth.
const BULLET_GLYPH_DEPTH = {
  '\u2022': 0, '-': 0, '*': 0, '\u2013': 0, '\u2014': 0, '\u25cf': 0,
  'o': 1, '\u25e6': 1, '\u25cb': 1,
  '\u25aa': 2, '\u25ab': 2, '\u2043': 2, '\u00b7': 2,
};

const LETTER = /\p{L}/u;
const UPPER = /^\p{Lu}$/u;
const LOWER = /^\p{Ll}$/u;
const ALNUM = /[\p{L}\p{N}]/u;

// --- Markdown patterns -------------------------------------------------------------------

const MD_IMAGE = /!\[[^\]\n]*\]\([^)\n]*\)/g;
const MD_LINK = /(?<!!)\[([^\]\n]*)\]\([^)\n]*\)/g;
const MD_LINKED_IMAGE = /\[(!\[[^\]\n]*\]\([^)\n]*\))\]\([^)\n]*\)/g;

const MD_INLINE_STRIP = /[*_`~[\]()#>]/g;
const MD_LINK_TEXT = /!?\[([^\]]*)\]\([^)]*\)/g;
const MD_FENCE = /^\s*```.*$/gm;
const MD_TABLE_RULE = /^\s*\|?[\s:\-|]+\|[\s:\-|]*$/gm;
const MD_LEADING_MARKER = /^[ \t]*(?:[-*+]|\d+[.)]|#{1,6}|>)[ \t]+/gm;
const WORD_EDGE_PUNCTUATION = '.,;:!?"\'()[]{}<>|/\\\u2018\u2019\u201c\u201d\u2013\u2014-\u2022\u00b7';

const MD_ATX_HEADING = /^#{1,6}[ \t]+\S/m;
const MD_FENCED_CODE = /^```/m;
const MD_SIGNALS = [
  /^[-*+][ \t]+\S/m,
  /\*\*\S[^*]*\*\*/,
  /\[[^\]]+\]\([^)]+\)/,
  /^>[ \t]+\S/m,
  /^\|.+\|[ \t]*$/m,
];

const LIST_LINE = /^[ \t]*(?:[-*+]|\d+\.)[ \t]+\S/;
const QUOTE_LINE = /^>/;

const count = (text, pattern) => (text.match(pattern) || []).length;

// --- comparison --------------------------------------------------------------------------

/**
 * Markdown back to bare words, for comparison only (never shown): drops fences, link targets,
 * table rules, leading markers, escapes and inline syntax characters anywhere.
 * @param {string} text
 */
export function stripMarkdown(text) {
  if (!text) return '';
  return text
    .replace(MD_FENCE, '')
    .replace(MD_LINKED_IMAGE, '$1')
    .replace(MD_LINK_TEXT, '$1')
    .replace(MD_TABLE_RULE, '')
    .replace(MD_LEADING_MARKER, '')
    .replace(/\\/g, '')
    .replace(MD_INLINE_STRIP, '');
}

function trimEdges(token) {
  let start = 0;
  let end = token.length;
  while (start < end && WORD_EDGE_PUNCTUATION.includes(token[start])) start++;
  while (end > start && WORD_EDGE_PUNCTUATION.includes(token[end - 1])) end--;
  return token.slice(start, end);
}

/**
 * The words of some Markdown, lower-cased, with edge punctuation trimmed and tokens that carry
 * no letter or digit dropped (a replaced bullet glyph or a moved comma is not a lost word).
 * @param {string} text
 * @returns {string[]}
 */
export function markdownWords(text) {
  const words = [];
  for (const token of stripMarkdown(text).toLowerCase().split(/\s+/)) {
    const word = trimEdges(token);
    if (word && ALNUM.test(word)) words.push(word);
  }
  return words;
}

/**
 * How much of `original`'s wording survives in `formatted`, compared as multisets of words
 * (reordering is not the risk; deletion, paraphrase and additions are). `retained` is the
 * share of the original's words still present; `added` the share of the formatted text's
 * words that were not in the original.
 *
 * @returns {{ retained: number, added: number, missing: string[], extra: string[] }}
 */
export function wordRetention(original, formatted) {
  const before = markdownWords(original);
  const after = markdownWords(formatted);
  const tally = (words) => {
    const counts = new Map();
    for (const w of words) counts.set(w, (counts.get(w) || 0) + 1);
    return counts;
  };
  const diff = (words, against) => {
    const remaining = tally(against);
    const lost = [];
    let kept = 0;
    for (const w of words) {
      const n = remaining.get(w) || 0;
      if (n > 0) {
        remaining.set(w, n - 1);
        kept++;
      } else if (lost.length < 20) {
        lost.push(w);
      }
    }
    return { kept, lost };
  };
  const removed = diff(before, after);
  const inserted = diff(after, before);
  return {
    retained: before.length ? removed.kept / before.length : 1,
    added: after.length ? (after.length - inserted.kept) / after.length : 0,
    missing: removed.lost,
    extra: inserted.lost,
  };
}

// --- links and images --------------------------------------------------------------------

/**
 * Clean up after a removal, touching only the lines it changed: a line it emptied goes, a gap
 * left mid-sentence closes, blank runs collapse. Untouched lines pass through byte for byte,
 * and leading whitespace (list nesting) is kept even on changed lines.
 */
function tidyChanged(before, after) {
  const oldLines = before.split('\n');
  const newLines = after.split('\n');
  if (oldLines.length !== newLines.length) {
    return after.replace(/\n{3,}/g, '\n\n').trim();
  }
  const kept = [];
  oldLines.forEach((old, i) => {
    const line = newLines[i];
    if (old === line) {
      kept.push(line);
      return;
    }
    const stripped = line.replace(/^[ \t]+/, '');
    const indent = line.slice(0, line.length - stripped.length);
    const body = stripped.replace(/[ \t]{2,}/g, ' ').replace(/\s+$/, '');
    if (old.trim() && !body) return; // the removal emptied a line that had content
    kept.push(body ? indent + body : '');
  });
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** How many links removeLinks() would remove. */
export function countLinks(text) {
  if (!text) return 0;
  return count(text, MD_LINKED_IMAGE) + count(text.replace(MD_LINKED_IMAGE, '$1'), MD_LINK);
}

/** How many images removeImages() would remove. */
export function countImages(text) {
  if (!text) return 0;
  return count(text, MD_LINKED_IMAGE) + count(text.replace(MD_LINKED_IMAGE, ''), MD_IMAGE);
}

/**
 * Unwrap every link, keeping its text; a clickable image keeps its image and loses the link.
 * @returns {{ text: string, removed: number }}
 */
export function removeLinks(text) {
  if (!text) return { text: '', removed: 0 };
  const removed = countLinks(text);
  const out = text.replace(MD_LINKED_IMAGE, '$1').replace(MD_LINK, '$1');
  return { text: tidyChanged(text, out), removed };
}

/**
 * Delete every image, alt text included; a clickable image goes whole, link and all. An
 * ordinary empty link `[](url)` is a link and is left alone.
 * @returns {{ text: string, removed: number }}
 */
export function removeImages(text) {
  if (!text) return { text: '', removed: 0 };
  const removed = countImages(text);
  const out = text.replace(MD_LINKED_IMAGE, '').replace(MD_IMAGE, '');
  return { text: tidyChanged(text, out), removed };
}

// --- Markdown to readable plain text (Text only) -----------------------------------------

/**
 * Markdown as readable plain text, for Text only: what a student sees when the reading renders
 * line by line (components/ReadingText.tsx). Unlike stripMarkdown() it keeps every character
 * of the prose, including parentheses and `#` inside sentences; only syntax goes. Images go
 * (with their alt text, as in removeImages); a link becomes its text.
 * @param {string} text
 */
export function markdownToText(text) {
  if (!text) return '';
  const lines = text
    .replace(MD_LINKED_IMAGE, '')
    .replace(MD_IMAGE, '')
    .replace(MD_LINK, '$1')
    .split('\n');
  const out = [];
  for (const raw of lines) {
    if (/^\s*```/.test(raw)) continue; // fence lines; the code inside stays
    if (/^\s*\|?[\s:\-|]+\|[\s:\-|]*$/.test(raw) && raw.includes('-')) continue; // table rule
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(raw)) continue; // horizontal rule
    let line = raw
      .replace(/^\s{0,3}#{1,6}[ \t]+/, '')
      .replace(/[ \t]+#+[ \t]*$/, '')
      .replace(/^(\s*)(?:>[ \t]?)+/, '$1')
      .replace(/^(\s*)[-*+][ \t]+/, '$1\u2022 ');
    if (/^\s*\|.*\|\s*$/.test(line)) {
      line = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()).join(' | ');
    }
    line = line
      .replace(/(\*\*|__)(?=\S)([^\n]*?\S)\1/g, '$2')
      .replace(/(^|[^\p{L}\p{N}*])\*(?=\S)([^*\n]*?\S)\*(?![\p{L}\p{N}*])/gu, '$1$2')
      .replace(/(^|[^\p{L}\p{N}_])_(?=\S)([^_\n]*?\S)_(?![\p{L}\p{N}_])/gu, '$1$2')
      .replace(/~~(?=\S)([^\n]*?\S)~~/g, '$1')
      .replace(/`([^`\n]+)`/g, '$1')
      .replace(/\\([\\`*_{}[\]()#+\-.!|>~<])/g, '$1');
    out.push(line.replace(/\s+$/, ''));
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// --- plain text to Markdown (the part that guesses) --------------------------------------

function letters(line) {
  return Array.from(line).filter((c) => LETTER.test(c));
}

function isAllCaps(line) {
  const ls = letters(line);
  return ls.length >= 3 && ls.every((c) => UPPER.test(c));
}

function isTitleCase(line) {
  const words = line.split(/[ \t]+/).filter(Boolean);
  if (words.length < 2) return false;
  const significant = words.filter((w) => w.length > 3);
  if (significant.length === 0) return false;
  const capitalised = significant.filter((w) => UPPER.test(Array.from(w)[0])).length;
  return capitalised >= Math.max(2, Math.floor(significant.length * 0.8));
}

/** The heading level for a line, or 0. Strongest signal first. */
function headingLevel(line, aloneInBlock) {
  const stripped = line.trim();
  if (!stripped || stripped.length > HEADING_MAX_CHARS) return 0;
  if (!LETTER.test(stripped)) return 0;
  if (/[.,;]$/.test(stripped)) return 0;
  if (BULLET_LINE.test(line) || ORDERED_LINE.test(line)) return 0;

  const numbered = NUMBERED_HEADING.exec(stripped);
  if (numbered && LETTER.test(numbered[2])) {
    const depth = numbered[1].split('.').length;
    return Math.min(6, depth + 1);
  }
  if (HEADING_KEYWORD.test(stripped)) return 2;
  // Prose is not set in capitals, so this fires inside a block of running text.
  if (isAllCaps(stripped)) return 2;
  // A wrapped line is title-cased by accident often enough that this needs a one-line block.
  if (aloneInBlock && isTitleCase(stripped)) return 3;
  return 0;
}

function typicalLineLength(lines) {
  const lengths = lines.filter((l) => l.trim()).map((l) => l.replace(/\s+$/, '').length).sort((a, b) => a - b);
  return lengths.length ? lengths[Math.floor(lengths.length / 2)] : 0;
}

/** True when `following` continues a hard-wrapped `previous` line. */
function continues(previous, following, typical) {
  if (!previous || !following) return false;
  const head = Array.from(following.replace(/^\s+/, ''))[0];
  if (head && LOWER.test(head)) return true;
  const prev = previous.replace(/\s+$/, '');
  if (TERMINAL_PUNCTUATION.some((p) => prev.endsWith(p))) return false;
  if (typical && prev.length >= typical * SHORT_LINE_RATIO) return true;
  // No measurable width means do not join: a short block is often a heading and its first
  // paragraph, and joining welds them together.
  return false;
}

const expandTabs = (ws) => {
  let col = 0;
  for (const ch of ws) col = ch === '\t' ? col + 4 - (col % 4) : col + 1;
  return col;
};

/** [depth, marker, body] for a list line, or null. */
function listItem(line) {
  const bullet = BULLET_LINE.exec(line);
  if (bullet) {
    const glyph = line[bullet[1].length];
    const indent = Math.floor(expandTabs(bullet[1]) / 2);
    return [Math.max(indent, BULLET_GLYPH_DEPTH[glyph] ?? 0), '-', line.slice(bullet[0].length).trim()];
  }
  const ordered = ORDERED_LINE.exec(line);
  if (ordered) return [Math.floor(expandTabs(ordered[1]) / 2), '1.', line.slice(ordered[0].length).trim()];
  return null;
}

const escapeLeading = (line) => line.replace(LEADING_ESCAPE, (_, ws, mark, sp) => `${ws}\\${mark}${sp}`);

/** True when two blocks are items of one list or lines of one quote (joined with one newline). */
function sameRun(previous, following) {
  if (LIST_LINE.test(previous) && LIST_LINE.test(following)) return true;
  return QUOTE_LINE.test(previous) && QUOTE_LINE.test(following);
}

function joinBlocks(blocks) {
  const kept = blocks.filter((b) => b && b.trim());
  if (kept.length === 0) return '';
  let out = kept[0];
  for (const block of kept.slice(1)) {
    const last = out.split('\n').pop();
    out += (sameRun(last, block) ? '\n' : '\n\n') + block;
  }
  return out;
}

function blockToMarkdown(block) {
  const lines = block.split('\n').filter((l) => l.trim());
  if (lines.length === 0) return '';
  const alone = lines.length === 1;
  const typical = lines.length >= MIN_LINES_FOR_REFLOW ? typicalLineLength(lines) : 0;

  const out = [];
  let paragraph = [];
  // Per-depth counters, so an ordered list reads 1, 2, 3 in the editor (not 1, 1, 1).
  let ordered = new Map();

  const closeParagraph = () => {
    if (paragraph.length) {
      out.push(escapeLeading(paragraph.join(' ').trim()));
      paragraph = [];
    }
  };

  for (const line of lines) {
    // A rule of underscores or dashes (common under an HBS case's header) is not prose, and
    // joined to the next line it glues itself onto the first word of a paragraph.
    if (!ALNUM.test(line)) {
      closeParagraph();
      out.push(line.trim());
      continue;
    }

    const level = headingLevel(line, alone);
    if (level) {
      closeParagraph();
      ordered = new Map();
      let body = line.trim();
      const numbered = NUMBERED_HEADING.exec(body);
      if (numbered) body = `${numbered[1]} ${numbered[2]}`;
      out.push(`${'#'.repeat(level)} ${body}`);
      continue;
    }

    const item = listItem(line);
    if (item) {
      closeParagraph();
      let [depth, marker, body] = item;
      depth = Math.min(depth, 5);
      if (marker === '1.') {
        ordered.set(depth, (ordered.get(depth) || 0) + 1);
        for (const deeper of [...ordered.keys()]) if (deeper > depth) ordered.delete(deeper);
        marker = `${ordered.get(depth)}.`;
      }
      out.push(`${'  '.repeat(depth)}${marker} ${body}`);
      continue;
    }

    // A continuation of the list item immediately above keeps its indent.
    const last = out[out.length - 1];
    if (last !== undefined && paragraph.length === 0 && /^\s*(?:- |\d+\. )/.test(last) && continues(last, line, typical)) {
      out[out.length - 1] = `${last.replace(/\s+$/, '')} ${line.trim()}`;
      continue;
    }

    if (paragraph.length && !continues(paragraph[paragraph.length - 1], line, typical)) closeParagraph();
    paragraph.push(line.trim());
  }
  closeParagraph();
  return joinBlocks(out);
}

/**
 * True when text should be passed through rather than converted: one ATX heading or code fence
 * is enough, and otherwise two of the weaker signals must agree.
 * @param {string} text
 */
export function looksLikeMarkdown(text) {
  if (!text || !text.trim()) return false;
  if (MD_ATX_HEADING.test(text) || MD_FENCED_CODE.test(text)) return true;
  return MD_SIGNALS.filter((p) => p.test(text)).length >= 2;
}

/**
 * Markdown for text that carries no structure of its own (PDF, .txt, Text only). Blank lines
 * frame blocks; inside a block a heading, a list item and a wrapped line are told apart by
 * shape alone. Text that already looks like Markdown is returned unchanged.
 * @param {string} text
 */
export function textToMarkdown(text) {
  if (!text || !text.trim()) return '';
  if (looksLikeMarkdown(text)) return text;
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n/)
    .map(blockToMarkdown)
    .filter((b) => b.trim())
    .join('\n\n');
}
