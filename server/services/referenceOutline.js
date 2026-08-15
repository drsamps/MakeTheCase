/**
 * Reference outline detection for the Case Writer.
 *
 * Splits an extracted reference document into selectable sections so an
 * instructor can pick which portions ground generation, instead of shipping a
 * whole textbook chapter to the model on every step.
 *
 * The hard constraint is that source documents arrive with wildly different
 * structure (see server/services/fileConverter.js):
 *
 *   .docx/.doc  → mammoth.convertToMarkdown  → real "#" headings
 *   .md         → passthrough                → real "#" headings
 *   .pdf        → pdf-parse + cleanPdfText   → plain text, NO headings, and
 *                                              cleanPdfText() strips standalone
 *                                              page numbers so there are no
 *                                              page markers either
 *   .txt        → passthrough                → plain text
 *
 * So detection is tiered, and the last tier is a dumb fixed-size chunker that
 * always succeeds. A PDF with no detectable structure is the common case, not
 * an error case — the chunk fallback is what makes the picker usable at all.
 *
 * Ranges are EXCLUSIVE, not nested: each section runs to the start of the next
 * heading regardless of level. Section char counts therefore sum to the
 * document length with no double-counting, and the UI needs no tri-state
 * checkbox. `level` is carried purely for indentation and "select subtree".
 */

// Target size for fallback chunks when no headings can be detected.
const CHUNK_TARGET_CHARS = 5000;
// A heading tier is only accepted if it finds at least this many headings...
const MIN_HEADINGS_FOR_TIER = 3;
// ...and the resulting sections average at least this many characters. Without
// this, a document with many short ALL-CAPS lines (figure labels, table
// headers) shatters into hundreds of useless one-line "sections".
const MIN_MEAN_SECTION_CHARS = 500;
// Sections below this are almost always false headings — a numbered list item
// or a stray capitalised line — so they get folded into the preceding section
// rather than offered as something to select.
const MIN_SECTION_CHARS = 400;
// Sections above this are split into parts. A 30,000-char blob is technically
// selectable but useless for staying under the 60,000-char generation budget.
const MAX_SECTION_CHARS = 12000;
// A "heading" whose normalised text repeats this many times across the document
// is a running page header, not a heading (PDF extraction preserves those even
// after cleanPdfText strips bare page numbers).
const RUNNING_HEADER_REPEATS = 3;

const MAX_TITLE_CHARS = 90;

/** Normalise a heading for running-header detection: drop trailing page refs. */
function headingKey(title) {
  return String(title || '')
    .replace(/\s+/g, ' ')
    .replace(/\bpages?\s+\d+\s*$/i, '')
    .trim()
    .toLowerCase();
}

function tidyTitle(raw) {
  const t = String(raw || '').replace(/\s+/g, ' ').trim();
  if (t.length <= MAX_TITLE_CHARS) return t;
  return `${t.slice(0, MAX_TITLE_CHARS - 1)}…`;
}

/**
 * Turn a list of heading positions into exclusive-range sections covering the
 * whole document. Any text before the first heading becomes a leading
 * "(front matter)" section so no content is unselectable.
 */
function sectionsFromHeadings(text, headings) {
  const sections = [];

  if (headings.length > 0 && headings[0].start > 0) {
    const end = headings[0].start;
    if (text.slice(0, end).trim()) {
      sections.push({ level: 1, title: '(front matter)', start: 0, end });
    }
  }

  headings.forEach((h, i) => {
    const end = i + 1 < headings.length ? headings[i + 1].start : text.length;
    sections.push({ level: h.level, title: tidyTitle(h.title), start: h.start, end });
  });

  return sections;
}

/** Tier 1 — real markdown headings (DOCX via mammoth, and .md files). */
function detectMarkdownHeadings(text) {
  const headings = [];
  const re = /^(#{1,4})[ \t]+(.+)$/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    headings.push({ level: m[1].length, title: m[2], start: m.index });
  }
  return headings;
}

/**
 * Tier 2 — structural heuristics for plain text. Deliberately conservative:
 * a false heading fragments the document and makes the picker worse than the
 * chunk fallback, so each pattern requires a whole line that looks like nothing
 * but a heading.
 */
function detectPlainTextHeadings(text) {
  const headings = [];
  // "Chapter 3", "CHAPTER III — Foo", "Part 2: Bar", "Section 4".
  // After the numeral we require end-of-line or a title separator. Body prose
  // that happens to open with a chapter reference ("Chapter 17 discuss ways
  // PCN Analysis can be used to...") is a whole line in PDF-extracted text and
  // would otherwise be indistinguishable from a real chapter heading.
  const chapterRe = /^[ \t]*((?:CHAPTER|Chapter|PART|Part|SECTION|Section|APPENDIX|Appendix)[ \t]+(?:\d{1,3}|[IVXLC]{1,7})(?:[ \t]*[-–—:.)][^\n]{0,80})?)[ \t]*$/gm;
  // "1.2.3 Heading text" — numbering depth becomes the level.
  const numberedRe = /^[ \t]*((\d{1,2}(?:\.\d{1,2}){0,3})[.)]?[ \t]+(?![ \t])[^\n]{2,80})$/gm;
  // Short ALL-CAPS lines with no sentence-ending punctuation.
  const allCapsRe = /^[ \t]*([A-Z][A-Z0-9 ,'&:()\/-]{3,70})$/gm;

  // Headings do not end like sentences, and they do not end mid-quotation.
  // Without this, numbered list items ("1. Provide a lean process ... costs.",
  // '2. "the work performed by one that serves"') are read as headings and
  // shatter the outline.
  const looksLikeProse = (s) => /[.!?,;"”']$/.test(s.trim());

  let m;
  while ((m = chapterRe.exec(text)) !== null) {
    headings.push({ level: 1, title: m[1], start: m.index });
  }
  while ((m = numberedRe.exec(text)) !== null) {
    if (looksLikeProse(m[1])) continue;
    const depth = (m[2].match(/\./g) || []).length + 1;
    headings.push({ level: Math.min(depth, 4), title: m[1], start: m.index });
  }
  while ((m = allCapsRe.exec(text)) !== null) {
    if (looksLikeProse(m[1])) continue;
    if (!/[A-Z]{2}/.test(m[1])) continue;
    headings.push({ level: 2, title: m[1], start: m.index });
  }

  // De-duplicate positions (a line can match more than one pattern) and order.
  const seen = new Set();
  const ordered = headings
    .sort((a, b) => a.start - b.start)
    .filter(h => (seen.has(h.start) ? false : (seen.add(h.start), true)));

  return dropRunningHeaders(ordered);
}

/**
 * PDF running headers repeat on every page ("Chapter 1 – The Importance of
 * Service Design page 5", "... page 7"). They look exactly like headings, so
 * without this every page break becomes a section boundary. Keep the first
 * occurrence — that one is the genuine chapter start — and drop the rest.
 */
function dropRunningHeaders(headings) {
  const counts = new Map();
  for (const h of headings) {
    const k = headingKey(h.title);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const kept = new Set();
  return headings.filter(h => {
    const k = headingKey(h.title);
    if ((counts.get(k) || 0) < RUNNING_HEADER_REPEATS) return true;
    if (kept.has(k)) return false;
    kept.add(k);
    return true;
  });
}

/**
 * Fold sections shorter than MIN_SECTION_CHARS into their predecessor. A short
 * section means the heading that produced it was almost certainly spurious.
 */
function absorbTinySections(sections) {
  const out = [];
  for (const s of sections) {
    const prev = out[out.length - 1];
    if (prev && (s.end - s.start) < MIN_SECTION_CHARS) {
      prev.end = s.end;
    } else {
      out.push({ ...s });
    }
  }
  // A tiny leading section has no predecessor to fold into; merge it forward.
  while (out.length > 1 && (out[0].end - out[0].start) < MIN_SECTION_CHARS) {
    out[1].start = out[0].start;
    out[1].title = out[0].title;
    out.shift();
  }
  return out;
}

/**
 * Split oversized sections into parts so every row in the picker is a
 * meaningful unit against the 60,000-char budget.
 */
function splitLargeSections(text, sections) {
  const out = [];
  for (const s of sections) {
    const size = s.end - s.start;
    if (size <= MAX_SECTION_CHARS) { out.push({ ...s }); continue; }

    const parts = chunkRanges(text, s.start, s.end, MAX_SECTION_CHARS);
    parts.forEach((p, i) => {
      out.push({
        level: s.level,
        title: `${s.title} (part ${i + 1}/${parts.length})`,
        start: p.start,
        end: p.end
      });
    });
  }
  return out;
}

/** Split [from,to) into chunks of ~target chars, preferring paragraph breaks. */
function chunkRanges(text, from, to, target) {
  const ranges = [];
  let start = from;
  while (start < to) {
    let end = Math.min(start + target, to);
    if (end < to) {
      const windowStart = start + Math.floor(target * 0.8);
      const br = text.lastIndexOf('\n\n', end);
      if (br > windowStart) {
        end = br + 2;
      } else {
        const nl = text.lastIndexOf('\n', end);
        if (nl > windowStart) end = nl + 1;
      }
    }
    ranges.push({ start, end });
    start = end;
  }
  // Fold a stub final chunk back into its predecessor — a 220-char "part 3/3"
  // is noise in the picker, not a choice.
  if (ranges.length > 1) {
    const last = ranges[ranges.length - 1];
    if (last.end - last.start < MIN_SECTION_CHARS) {
      ranges[ranges.length - 2].end = last.end;
      ranges.pop();
    }
  }
  return ranges;
}

/**
 * Tier 3 — fixed-size chunks, split at the nearest paragraph break so a chunk
 * rarely starts mid-sentence. Always succeeds; this is the path an unstructured
 * PDF takes.
 */
function chunkSections(text) {
  return chunkRanges(text, 0, text.length, CHUNK_TARGET_CHARS).map((r, i) => {
    const preview = text.slice(r.start, r.end).replace(/\s+/g, ' ').trim().slice(0, 60);
    return {
      level: 1,
      title: `Block ${i + 1} — "${preview}${preview.length >= 60 ? '…' : ''}"`,
      start: r.start,
      end: r.end
    };
  });
}

function acceptable(text, sections) {
  if (sections.length < MIN_HEADINGS_FOR_TIER) return false;
  const mean = text.length / sections.length;
  return mean >= MIN_MEAN_SECTION_CHARS;
}

/**
 * Detect selectable sections in a reference document.
 *
 * @param {string} text - extracted document text (the `content` column)
 * @param {string} [format] - fileConverter format hint: 'docx-markdown',
 *   'markdown', 'pdf', 'text', 'docx-text'. Only used to prefer the markdown
 *   tier; detection still falls through on its own if the hint is wrong.
 * @returns {{ strategy: string, sections: Array<{id,level,title,start,end,chars}> }}
 */
export function detectOutline(text, format) {
  const src = String(text || '');
  if (!src.trim()) return { strategy: 'empty', sections: [] };

  const tiers = [];
  const preferMarkdown = format === 'docx-markdown' || format === 'markdown';
  const mdHeadings = detectMarkdownHeadings(src);
  if (mdHeadings.length > 0) {
    tiers.push({ strategy: 'markdown_headings', sections: sectionsFromHeadings(src, mdHeadings) });
  }
  if (!preferMarkdown || mdHeadings.length === 0) {
    const plain = detectPlainTextHeadings(src);
    if (plain.length > 0) {
      tiers.push({ strategy: 'text_headings', sections: sectionsFromHeadings(src, plain) });
    }
  }

  for (const tier of tiers) {
    // Clean up before judging the tier: spurious headings produce tiny
    // sections, and a tier that looks fine on raw counts can still be junk.
    const cleaned = absorbTinySections(tier.sections);
    if (!acceptable(src, cleaned)) continue;
    return withIds(tier.strategy, splitLargeSections(src, cleaned));
  }
  return withIds('chunks', chunkSections(src));
}

function withIds(strategy, sections) {
  return {
    strategy,
    sections: sections.map((s, i) => ({
      id: `s${i + 1}`,
      level: s.level,
      title: s.title,
      start: s.start,
      end: s.end,
      chars: s.end - s.start
    }))
  };
}

/**
 * Merge a list of {start,end} ranges into sorted, non-overlapping ranges.
 * Used so an excerpt sitting inside an already-selected section does not cause
 * the same text to be sent twice.
 */
export function mergeRanges(ranges) {
  const sorted = ranges
    .filter(r => r && Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start)
    .map(r => ({ start: Math.max(0, r.start), end: r.end }))
    .sort((a, b) => a.start - b.start);

  const out = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) {
      last.end = Math.max(last.end, r.end);
    } else {
      out.push({ ...r });
    }
  }
  return out;
}

export const OUTLINE_CHUNK_TARGET_CHARS = CHUNK_TARGET_CHARS;
