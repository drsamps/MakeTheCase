/**
 * Case File Fetch — turn an instructor-supplied URL into case-file text.
 *
 * Used by Content > Case Files "Add from web page" and "Re-fetch". The network side
 * is urlFetcher.js#fetchUrlBytes, which carries all the SSRF defenses; never fetch
 * a URL here any other way.
 *
 * Web pages become Markdown (Readability's article HTML → turndown with GFM tables),
 * so headings, lists and tables survive into the chat prompt. Case Writer keeps its
 * own plain-text extraction (urlFetcher.js#fetchUrlAsText); its outline detector
 * depends on that.
 *
 * PDF / DOCX / text URLs are returned with their bytes so the route can keep the
 * original on disk, where it can be downloaded later.
 */

import os from 'os';
import path from 'path';
import fsp from 'fs/promises';
import { randomUUID } from 'crypto';
import { JSDOM, VirtualConsole } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { fetchUrlBytes, decodeText } from './urlFetcher.js';
import { convertFile } from './fileConverter.js';
import { MARKDOWN, PLAIN_TEXT, textFormatOfConversion } from '../../utils/readingFormat.js';

// Below this many characters of article text we assume Readability found a nav menu
// or a JS-rendered shell, fall back to the whole body, and flag the result.
const MIN_ARTICLE_CHARS = 200;

const PASTE_INSTEAD = 'Open the page in your browser, copy the text, and use "Paste text instead".';

// Content types kept as an original file, with the extension the converter expects.
const FILE_TYPES = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/msword': '.docx',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'text/x-markdown': '.md'
};

const HTML_TYPES = new Set(['text/html', 'application/xhtml+xml', '']);

// Elements that never carry article text, removed before the body-text fallback.
const NON_CONTENT_SELECTOR = 'script, style, noscript, template, svg, canvas, iframe, form, nav, header, footer, aside';

// Readability keeps one block of text and the blocks directly beside it. A page that splits
// its article across separate wrappers (one per section, each with its own FAQ) comes back as
// its first section only. When the page's own <article> (or <main>) holds this many times more
// text, keep that instead and flag it, so the instructor checks for leftovers.
const CONTAINER_RATIO = 3;

// Removed from that container: page furniture, nested articles (teaser cards for other
// stories) and anything the page hides.
const CONTAINER_NOISE_SELECTOR = `${NON_CONTENT_SELECTOR}, article, [hidden], [aria-hidden="true"]`;

const textLength = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim().length;

/**
 * The page's main content container, cleaned: the largest <article> that is not inside another
 * article, else the largest <main> / [role=main]. Works on clones; the document is untouched.
 *
 * @returns {{ element: Element, chars: number } | null}
 */
function mainContainer(doc) {
  const articles = Array.from(doc.querySelectorAll('article')).filter(a => !a.parentElement?.closest('article'));
  const candidates = articles.length > 0 ? articles : Array.from(doc.querySelectorAll('main, [role="main"]'));
  let best = null;
  for (const candidate of candidates) {
    const element = candidate.cloneNode(true);
    element.querySelectorAll(CONTAINER_NOISE_SELECTOR).forEach(el => el.remove());
    const chars = textLength(element);
    if (!best || chars > best.chars) best = { element, chars };
  }
  return best;
}

function safeHttpUrl(href, base) {
  try {
    const url = new URL(href, base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function buildTurndown(baseUrl) {
  const td = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '_'
  });
  td.use(gfm);
  td.remove(['script', 'style', 'noscript']);
  // Images would load remote content in the preview and mean nothing to the AI. This has to be
  // a rule, not td.remove(): turndown tries its built-in image rule before the remove list.
  td.addRule('dropMedia', {
    filter: ['img', 'picture', 'svg', 'canvas', 'iframe'],
    replacement: () => ''
  });
  // Links: absolute http(s) only, resolved against the final URL; anything else
  // (javascript:, mailto:, in-page anchors) keeps its text and drops the link.
  td.addRule('safeLinks', {
    filter: 'a',
    replacement(content, node) {
      const text = content.trim();
      if (!text) return '';
      const href = safeHttpUrl(node.getAttribute('href') || '', baseUrl);
      if (!href || href.split('#')[0] === baseUrl.split('#')[0]) return text;
      return `[${text}](${href})`;
    }
  });
  return td;
}

// textContent runs list items and lines together ("Chewa20.4% Tumbuka"), so mark
// those boundaries before reading the text.
const cellText = (cell) => {
  const doc = cell.ownerDocument;
  cell.querySelectorAll('br').forEach(br => br.replaceWith(doc.createTextNode(' ')));
  cell.querySelectorAll('li').forEach(li => li.append(doc.createTextNode('; ')));
  cell.querySelectorAll('p, div').forEach(el => {
    el.before(doc.createTextNode(' '));
    el.append(doc.createTextNode(' '));
  });
  return (cell.textContent || '')
    .replace(/\s+/g, ' ')
    .replace(/(\s*;)+/g, ';')
    .replace(/^[;\s]+|[;\s]+$/g, '')
    .trim();
};

/**
 * Reshape tables so turndown-plugin-gfm can convert them; it leaves any table it
 * can't express as raw HTML. Layout tables and infoboxes (nested tables, merged
 * cells) become one "Label: value" paragraph per row. Other tables without a
 * header row get their first row promoted to headers, which GFM requires.
 */
function prepareTables(root) {
  const doc = root.ownerDocument;
  // Innermost first, so a nested table is flattened before its parent is inspected.
  const tables = Array.from(root.querySelectorAll('table')).reverse();
  for (const table of tables) {
    const caption = table.querySelector(':scope > caption');
    const rows = Array.from(table.rows);
    const irregular = table.querySelector('table')
      || rows.some(r => Array.from(r.cells).some(c => c.colSpan > 1 || c.rowSpan > 1));

    if (irregular || rows.length === 0) {
      const box = doc.createElement('div');
      if (caption && cellText(caption)) {
        const p = doc.createElement('p');
        p.textContent = cellText(caption);
        box.appendChild(p);
      }
      for (const row of rows) {
        const cells = Array.from(row.cells).map(cellText).filter(Boolean);
        if (cells.length === 0) continue;
        const p = doc.createElement('p');
        p.textContent = cells.length === 2 ? `${cells[0]}: ${cells[1]}` : cells.join(' | ');
        box.appendChild(p);
      }
      table.replaceWith(box);
      continue;
    }

    if (caption) {
      const p = doc.createElement('p');
      p.textContent = cellText(caption);
      table.before(p);
      caption.remove();
    }
    // A line break inside a cell would end the Markdown table row.
    table.querySelectorAll('br').forEach(br => br.replaceWith(doc.createTextNode(' ')));
    const first = rows[0];
    if (!Array.from(first.cells).every(c => c.tagName === 'TH')) {
      for (const cell of Array.from(first.cells)) {
        const th = doc.createElement('th');
        th.innerHTML = cell.innerHTML;
        cell.replaceWith(th);
      }
    }
    // GFM only treats the first row as the header when it opens the table.
    if (first.parentElement?.tagName !== 'THEAD') {
      const thead = doc.createElement('thead');
      table.insertBefore(thead, table.firstChild);
      thead.appendChild(first);
    }
  }
}

function toMarkdown(td, doc, html) {
  const box = doc.createElement('div');
  box.innerHTML = html;
  prepareTables(box);
  return tidyMarkdown(td.turndown(box.innerHTML));
}

function tidyMarkdown(md) {
  return md
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Convert a web page's HTML to Markdown.
 *
 * `containerFallback` is set when Readability found only part of the article and the page's
 * whole main container was kept instead (it may carry captions or menus to trim).
 *
 * @returns {{ markdown: string, title: string|null, degraded: boolean, containerFallback: boolean }}
 */
export function htmlToMarkdown(html, finalUrl) {
  // JSDOM logs every CSS parse error the page contains; swallow them.
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', () => {});
  const dom = new JSDOM(html, { url: finalUrl, virtualConsole });
  const doc = dom.window.document;
  const td = buildTurndown(finalUrl);

  let title = (doc.title || '').trim() || null;
  let markdown = '';
  let articleChars = 0;

  try {
    // Readability mutates the document, so clone first; the fallback needs the original.
    const article = new Readability(doc.cloneNode(true)).parse();
    if (article?.content) {
      articleChars = (article.textContent || '').replace(/\s+/g, ' ').trim().length;
      markdown = toMarkdown(td, doc, article.content);
      if (article.title) title = article.title.trim();
    }
  } catch {
    // Readability throws on some malformed documents; the fallbacks handle it.
  }

  // Before the body fallback below, which strips the document in place.
  let containerFallback = false;
  const container = mainContainer(doc);
  if (container && container.chars >= MIN_ARTICLE_CHARS && container.chars >= CONTAINER_RATIO * articleChars) {
    markdown = toMarkdown(td, doc, container.element.innerHTML);
    articleChars = container.chars;
    containerFallback = true;
  }

  let degraded = false;
  if (articleChars < MIN_ARTICLE_CHARS) {
    // A JS-rendered shell, a paywall interstitial, or a layout Reader Mode can't parse.
    doc.querySelectorAll(NON_CONTENT_SELECTOR).forEach(el => el.remove());
    const bodyChars = (doc.body?.textContent || '').trim().length;
    if (bodyChars > articleChars) {
      markdown = toMarkdown(td, doc, doc.body.innerHTML);
    }
    degraded = Math.max(bodyChars, articleChars) < MIN_ARTICLE_CHARS;
  }

  dom.window.close();
  return { markdown, title, degraded, containerFallback };
}

async function convertBytes(buffer, ext) {
  const tmpPath = path.join(os.tmpdir(), `mtc-case-file-${randomUUID()}${ext}`);
  await fsp.writeFile(tmpPath, buffer);
  try {
    const result = await convertFile(tmpPath, ext);
    return { text: result?.text || '', textFormat: textFormatOfConversion(result?.format) };
  } finally {
    await fsp.unlink(tmpPath).catch(() => {});
  }
}

function titleFromUrl(finalUrl) {
  try {
    const url = new URL(finalUrl);
    const last = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || '');
    return last || url.hostname;
  } catch {
    return finalUrl;
  }
}

/**
 * Fetch a URL for Case Files.
 *
 * @returns {Promise<{
 *   kind: 'web'|'file', title: string, text: string, textFormat: 'markdown'|'text', degraded: boolean,
 *   containerFallback: boolean,
 *   finalUrl: string, contentType: string|null,
 *   ext: string|null, buffer: Buffer|null
 * }>} `ext` and `buffer` are set only for kind 'file'.
 */
export async function fetchForCaseFile(urlString) {
  const { buffer, contentType, contentTypeHeader, finalUrl } = await fetchUrlBytes(urlString);

  if (HTML_TYPES.has(contentType)) {
    // An origin that sends no Content-Type is almost always serving HTML.
    const { markdown, title, degraded, containerFallback } = htmlToMarkdown(decodeText(buffer, contentTypeHeader), finalUrl);
    if (!markdown.trim()) {
      throw new Error(
        'No readable text could be extracted from that page. It is likely built by JavaScript, '
        + `behind a paywall, or blocking automated readers. ${PASTE_INSTEAD}`
      );
    }
    return {
      kind: 'web',
      title: title || titleFromUrl(finalUrl),
      text: markdown,
      textFormat: MARKDOWN,
      degraded,
      containerFallback,
      finalUrl,
      contentType: contentType || null,
      ext: null,
      buffer: null
    };
  }

  const ext = FILE_TYPES[contentType];
  if (!ext) {
    throw new Error(
      `Unsupported content type "${contentType}". Web pages, PDF, DOCX and plain text can be fetched. `
      + 'Download the file and use Upload instead.'
    );
  }

  const converted = ext === '.txt' || ext === '.md'
    ? { text: decodeText(buffer, contentTypeHeader), textFormat: ext === '.md' ? MARKDOWN : PLAIN_TEXT }
    : await convertBytes(buffer, ext);
  const text = converted.text.trim();
  if (!text) {
    throw new Error(`No text could be extracted from that file (a scanned PDF has none). ${PASTE_INSTEAD}`);
  }
  return {
    kind: 'file',
    title: titleFromUrl(finalUrl),
    text,
    textFormat: converted.textFormat,
    degraded: false,
    containerFallback: false,
    finalUrl,
    contentType,
    ext,
    buffer
  };
}
