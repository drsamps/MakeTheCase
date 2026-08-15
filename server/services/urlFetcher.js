/**
 * URL Fetcher — download an instructor-supplied web page and turn it into text.
 *
 * Used by the Case Writer "Fetch page text" action on `link` source material. Kept
 * free of Express and DB imports so the SSRF logic can be exercised in isolation.
 *
 * Threat model: the URL comes from an authenticated instructor, but the *server* is
 * the one making the request, so it can reach anything this host can reach —
 * localhost, the private network, and the cloud metadata endpoint. The defense has
 * two halves and needs both:
 *
 *   1. DNS resolution + address classification before every connection, repeated
 *      on every redirect hop because the origin controls the `Location` header.
 *   2. The *checked addresses* are what the socket connects to. Handing the
 *      hostname back to an HTTP client would resolve it a second time, and a host
 *      serving a short-TTL record can answer "public IP" to step 1 and
 *      "169.254.169.254" to the connection. See `pinnedLookup()`.
 *
 * That second half is why this uses node:http/node:https rather than fetch(): the
 * `lookup` option is the only way to tell the connection which address to use.
 */

import dns from 'node:dns/promises';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { JSDOM, VirtualConsole } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { convertFile } from './fileConverter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TMP_DIR = path.join(__dirname, '..', '..', 'case_files', '_cw-tmp');

export const FETCH_TIMEOUT_MS = 20000;
export const MAX_BYTES = 10 * 1024 * 1024;   // matches the 10 MB reference upload limit
export const MAX_REDIRECTS = 5;
const USER_AGENT = 'MakeTheCase-CaseWriter/1.0 (+instructor-initiated source material fetch)';

// Readability sometimes "succeeds" on a JS-rendered shell and returns a nav menu.
// Below this we treat the extraction as failed and fall back to the raw body text,
// flagging it so the route can warn instead of silently storing 40 characters.
const MIN_ARTICLE_CHARS = 200;

const PASTE_INSTEAD = 'Open the page in your browser, copy the text, and use "Paste text" instead.';

// ---------------------------------------------------------------------------
// Address classification
// ---------------------------------------------------------------------------

function ipv4Parts(ip) {
  const parts = ip.split('.').map(Number);
  return parts.length === 4 && parts.every(n => Number.isInteger(n) && n >= 0 && n <= 255)
    ? parts
    : null;
}

function blockedIpv4(ip) {
  const p = ipv4Parts(ip);
  if (!p) return 'unparseable IPv4 address';
  const [a, b] = p;
  if (a === 0) return 'unspecified address (0.0.0.0/8)';
  if (a === 127) return 'loopback address (127.0.0.0/8)';
  if (a === 10) return 'private address (10.0.0.0/8)';
  if (a === 172 && b >= 16 && b <= 31) return 'private address (172.16.0.0/12)';
  if (a === 192 && b === 168) return 'private address (192.168.0.0/16)';
  if (a === 169 && b === 254) return 'link-local / cloud metadata address (169.254.0.0/16)';
  if (a === 100 && b >= 64 && b <= 127) return 'carrier-grade NAT address (100.64.0.0/10)';
  if (a >= 224) return 'multicast or reserved address';
  return null;
}

/**
 * Expand an IPv6 address to its eight 16-bit groups.
 *
 * Textual matching is not good enough here: `new URL()` normalizes the hostname, so
 * "::ffff:127.0.0.1" arrives as "::ffff:7f00:1" and a regex looking for dotted quads
 * sails right past it. Returns null if the address will not parse.
 */
function ipv6Groups(addr) {
  let s = addr.toLowerCase();

  // A trailing dotted quad (mapped/compatible/NAT64 forms) becomes two hex groups.
  const dotted = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const p = ipv4Parts(dotted[1]);
    if (!p) return null;
    const hex = `${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
    s = s.slice(0, -dotted[1].length) + hex;
  }

  const halves = s.split('::');
  if (halves.length > 2) return null;

  const toNums = (part) => (part ? part.split(':').map(h => parseInt(h, 16)) : []);
  const head = toNums(halves[0]);
  const tail = halves.length === 2 ? toNums(halves[1]) : [];
  if ([...head, ...tail].some(n => !Number.isInteger(n) || n < 0 || n > 0xffff)) return null;

  if (halves.length === 1) return head.length === 8 ? head : null;
  const fill = 8 - head.length - tail.length;
  if (fill < 0) return null;
  return [...head, ...new Array(fill).fill(0), ...tail];
}

/**
 * Classify an address. Returns a human-readable reason string when the address must
 * not be contacted, or null when it is an ordinary public address.
 */
export function isBlockedAddress(ip) {
  const raw = String(ip || '').trim();
  if (!raw) return 'empty address';

  // Strip a zone index (fe80::1%eth0) before parsing.
  const addr = raw.replace(/%.*$/, '');

  if (net.isIPv4(addr)) return blockedIpv4(addr);
  if (!net.isIPv6(addr)) return 'unrecognized address format';

  const g = ipv6Groups(addr);
  if (!g) return 'unparseable IPv6 address';

  const leadingZeros = g.slice(0, 5).every(n => n === 0);

  // IPv4-mapped (::ffff:a.b.c.d), IPv4-compatible (::a.b.c.d), and NAT64
  // (64:ff9b::a.b.c.d) all tunnel a v4 address through a v6 literal — unwrap and
  // re-check, or every v4 rule above is bypassable by rewriting the literal.
  const embeddedV4 = (hi, lo) =>
    `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;

  if (leadingZeros && g[5] === 0xffff) return blockedIpv4(embeddedV4(g[6], g[7]));
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) {
    return blockedIpv4(embeddedV4(g[6], g[7])) || 'NAT64-translated address (64:ff9b::/96)';
  }
  if (leadingZeros && g[5] === 0) {
    if (g[6] === 0 && g[7] === 0) return 'unspecified address (::)';
    if (g[6] === 0 && g[7] === 1) return 'IPv6 loopback address (::1)';
    // ::a.b.c.d — deprecated IPv4-compatible form.
    return blockedIpv4(embeddedV4(g[6], g[7])) || 'deprecated IPv4-compatible IPv6 address';
  }

  // fe80::/10 — link-local, the IPv6 counterpart of 169.254/16.
  if ((g[0] & 0xffc0) === 0xfe80) return 'IPv6 link-local address (fe80::/10)';
  // fc00::/7 — unique-local, the IPv6 counterpart of RFC1918.
  if ((g[0] & 0xfe00) === 0xfc00) return 'IPv6 unique-local address (fc00::/7)';
  if ((g[0] & 0xff00) === 0xff00) return 'IPv6 multicast address (ff00::/8)';

  return null;
}

/**
 * Validate one URL immediately before it is contacted.
 *
 * Throws with a user-safe message. Returns the resolved addresses on success —
 * the caller MUST connect to those, not re-resolve the hostname (see
 * `pinnedLookup`). Every address the hostname resolves to is checked, not just
 * the first, because we do not control which one the socket ends up using.
 */
export async function assertUrlAllowed(urlString) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error(`"${urlString}" is not a valid URL.`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Only http and https URLs can be fetched (got "${url.protocol}").`);
  }
  if (url.username || url.password) {
    throw new Error('URLs containing credentials cannot be fetched. Remove the user:password part of the URL.');
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '');

  // A bare IP literal never reaches DNS, so classify it directly.
  if (net.isIP(hostname)) {
    const reason = isBlockedAddress(hostname);
    if (reason) throw new Error(`Refusing to fetch ${url.host}: ${reason}. Only public web addresses can be fetched.`);
    return [hostname];
  }

  let records;
  try {
    records = await dns.lookup(hostname, { all: true });
  } catch (err) {
    throw new Error(`Could not resolve "${hostname}" (${err.code || err.message}). Check the URL and try again.`);
  }
  if (!records || records.length === 0) {
    throw new Error(`"${hostname}" did not resolve to any address.`);
  }

  for (const rec of records) {
    const reason = isBlockedAddress(rec.address);
    if (reason) {
      throw new Error(`Refusing to fetch ${url.host}: it resolves to a ${reason}. Only public web addresses can be fetched.`);
    }
  }

  return records.map(r => r.address);
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

function baseContentType(header) {
  return String(header || '').split(';')[0].trim().toLowerCase();
}

function charsetFrom(header) {
  const m = String(header || '').match(/charset=\s*"?([\w-]+)"?/i);
  return m ? m[1].toLowerCase() : null;
}

/**
 * A `lookup` implementation that hands back only the addresses `assertUrlAllowed`
 * already cleared for this hop, instead of consulting DNS again.
 *
 * This is what makes the address check binding. Without it the sequence is
 * "resolve, classify, throw the result away, resolve again inside the HTTP
 * client" — and a hostname whose record has a one-second TTL can answer with a
 * public address the first time and 127.0.0.1 or 169.254.169.254 the second.
 * Classifying an address the socket never uses proves nothing.
 *
 * Bare IP literals never reach here: node:net connects to them directly, and
 * `assertUrlAllowed` classifies them before the request is built.
 */
function pinnedLookup(addresses) {
  return function lookup(hostname, options, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    const family = options?.family;
    const entries = addresses
      .map(address => ({ address, family: net.isIPv6(address) ? 6 : 4 }))
      .filter(e => !family || family === 0 || e.family === family);

    if (entries.length === 0) {
      // Only reachable if the caller asked for a family the validated set does
      // not contain. Failing closed is the point — never fall back to DNS.
      callback(new Error(`No validated address for ${hostname}`));
      return;
    }
    if (options?.all) callback(null, entries);
    else callback(null, entries[0].address, entries[0].family);
  };
}

/**
 * Issue one GET, connecting only to `addresses`.
 *
 * Resolves with the IncomingMessage once headers arrive. The total-response
 * deadline covers the header phase; `readBodyCapped` installs its own inactivity
 * timeout for the body, so a slow trickle cannot hold the socket open forever.
 */
function httpGet(urlString, addresses) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const transport = url.protocol === 'https:' ? https : http;
    let deadline;

    const req = transport.request(
      url,
      {
        method: 'GET',
        // Not a hostname override: SNI and certificate validation still use the
        // hostname from the URL. Only the address selection is pinned.
        lookup: pinnedLookup(addresses),
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      },
      (res) => {
        clearTimeout(deadline);
        resolve(res);
      }
    );

    deadline = setTimeout(() => {
      req.destroy(Object.assign(new Error('response timed out'), { code: 'ETIMEDOUT' }));
    }, FETCH_TIMEOUT_MS);

    req.on('error', (err) => {
      clearTimeout(deadline);
      reject(err);
    });
    req.end();
  });
}

/**
 * Read a response body with a hard byte ceiling, aborting the transfer rather than
 * buffering whatever the origin decides to send. A `Content-Length` that lies is the
 * normal case here, so the running total is what actually enforces the limit.
 */
function readBodyCapped(res) {
  return new Promise((resolve, reject) => {
    const declared = Number(res.headers['content-length']);
    if (Number.isFinite(declared) && declared > MAX_BYTES) {
      res.destroy();
      reject(new Error(`That page is ${Math.round(declared / 1048576)} MB, over the ${MAX_BYTES / 1048576} MB limit. ${PASTE_INSTEAD}`));
      return;
    }

    const chunks = [];
    let total = 0;
    let settled = false;
    let idle;
    const done = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(idle);
      if (err) reject(err); else resolve(value);
    };

    // Inactivity timer rather than res.setTimeout: the socket is already detached
    // by the time 'end' fires, and touching it there throws.
    const arm = () => {
      clearTimeout(idle);
      idle = setTimeout(() => {
        res.destroy();
        done(new Error(`The page stopped sending data partway through. ${PASTE_INSTEAD}`));
      }, FETCH_TIMEOUT_MS);
    };
    arm();

    res.on('data', (chunk) => {
      arm();
      total += chunk.length;
      if (total > MAX_BYTES) {
        res.destroy();
        done(new Error(`That page is larger than the ${MAX_BYTES / 1048576} MB limit. ${PASTE_INSTEAD}`));
        return;
      }
      chunks.push(chunk);
    });
    res.on('end', () => done(null, Buffer.concat(chunks, total)));
    res.on('error', (err) => done(new Error(`The connection dropped while reading the page (${err.code || err.message}). ${PASTE_INSTEAD}`)));
  });
}

/**
 * Follow redirects by hand so `assertUrlAllowed` runs on every hop, and connect to
 * the addresses it returned.
 *
 * An automatic redirect follower would hand the whole chain to the HTTP client and
 * the address check would only ever have covered the first URL — which is exactly
 * the hole an open redirector walks through. The per-hop `pinnedLookup` closes the
 * companion hole, DNS rebinding between the check and the connection.
 */
async function fetchFollowingRedirects(startUrl) {
  let current = startUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const addresses = await assertUrlAllowed(current);

    let response;
    try {
      response = await httpGet(current, addresses);
    } catch (err) {
      // Both our own deadline and a kernel-level connect timeout land as ETIMEDOUT.
      if (err?.code === 'ETIMEDOUT') {
        throw new Error(`The page did not respond within ${FETCH_TIMEOUT_MS / 1000} seconds. ${PASTE_INSTEAD}`);
      }
      throw new Error(`Could not reach the page (${err?.code || err?.cause?.code || err.message}). ${PASTE_INSTEAD}`);
    }

    const status = response.statusCode;

    if (status >= 300 && status < 400) {
      const location = response.headers.location;
      response.resume();   // drain so the socket can be reused/closed
      if (!location) {
        throw new Error(`The page returned HTTP ${status} with no redirect target. ${PASTE_INSTEAD}`);
      }
      current = new URL(location, current).toString();
      continue;
    }

    if (status < 200 || status >= 300) {
      response.resume();
      const hint = status === 403 || status === 401
        ? ' The site is blocking automated requests or requires a login.'
        : status === 429
          ? ' The site is rate-limiting this server.'
          : status === 404
            ? ' Check that the URL is still valid.'
            : '';
      throw new Error(`The page returned HTTP ${status}.${hint} ${PASTE_INSTEAD}`);
    }

    return { response, finalUrl: current };
  }

  throw new Error(`The page redirected more than ${MAX_REDIRECTS} times. ${PASTE_INSTEAD}`);
}

// ---------------------------------------------------------------------------
// Body → text
// ---------------------------------------------------------------------------

function decodeText(buffer, contentTypeHeader) {
  const charset = charsetFrom(contentTypeHeader);
  if (charset && charset !== 'utf-8' && charset !== 'utf8') {
    try {
      return new TextDecoder(charset).decode(buffer);
    } catch {
      // Unknown label — fall through to UTF-8, which is right far more often
      // than it is wrong on the modern web.
    }
  }
  return buffer.toString('utf8');
}

function extractHtml(html, finalUrl) {
  // JSDOM logs every CSS parse error the page contains; a news site produces
  // hundreds. Swallow them — we only want the text.
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', () => {});

  const dom = new JSDOM(html, { url: finalUrl, virtualConsole });
  const doc = dom.window.document;
  const docTitle = (doc.title || '').trim();

  let text = '';
  let title = docTitle;
  let degraded = false;

  try {
    // Readability mutates the document, so clone first — the body-text fallback
    // below needs the original markup intact.
    const article = new Readability(doc.cloneNode(true)).parse();
    if (article?.textContent) {
      text = article.textContent.trim();
      if (article.title) title = article.title.trim();
    }
  } catch {
    // Readability throws on some malformed documents; the fallback handles it.
  }

  if (text.length < MIN_ARTICLE_CHARS) {
    // Either a JS-rendered shell, a paywall interstitial, or a page whose layout
    // defeats Reader Mode. Raw body text is worse but not nothing.
    const body = (doc.body?.textContent || '').replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim();
    if (body.length > text.length) text = body;
    // Flag on the final length, not on which source won: a SPA shell whose <nav>
    // yields 40 characters must warn rather than quietly become "source material".
    degraded = text.length < MIN_ARTICLE_CHARS;
  }

  dom.window.close();
  return { text, title, degraded };
}

/**
 * Download a binary document to a temp file and hand it to the existing converter,
 * which takes a path rather than a buffer. Always unlinks.
 */
async function extractBinary(buffer, extWithDot) {
  await fsp.mkdir(TMP_DIR, { recursive: true });
  const tmpPath = path.join(TMP_DIR, `url-fetch-${randomUUID()}${extWithDot}`);
  await fsp.writeFile(tmpPath, buffer);
  try {
    const result = await convertFile(tmpPath, extWithDot);
    return { text: result?.text || '', format: result?.format || 'text' };
  } finally {
    await fsp.unlink(tmpPath).catch(() => {});
  }
}

/**
 * Fetch a URL and return its text.
 *
 * @param {string} urlString
 * @returns {Promise<{text: string, format: string, finalUrl: string, contentType: string, title: string|null, degraded: boolean}>}
 */
export async function fetchUrlAsText(urlString) {
  const { response, finalUrl } = await fetchFollowingRedirects(urlString);
  const contentTypeHeader = response.headers['content-type'] || '';
  const type = baseContentType(contentTypeHeader);
  const buffer = await readBodyCapped(response);

  if (buffer.length === 0) {
    throw new Error(`The page returned an empty response. ${PASTE_INSTEAD}`);
  }

  let out;
  if (type === 'text/html' || type === 'application/xhtml+xml' || type === '') {
    // An origin that sends no Content-Type is almost always serving HTML.
    const html = decodeText(buffer, contentTypeHeader);
    const { text, title, degraded } = extractHtml(html, finalUrl);
    // Readability's textContent carries no '#' headings, so the outline detector
    // should use its plain-text heuristics tier rather than the markdown one.
    out = { text, format: 'text', title, degraded };
  } else if (type === 'application/pdf') {
    const { text, format } = await extractBinary(buffer, '.pdf');
    out = { text, format, title: null, degraded: false };
  } else if (
    type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    type === 'application/msword'
  ) {
    const { text, format } = await extractBinary(buffer, '.docx');
    out = { text, format, title: null, degraded: false };
  } else if (type === 'text/plain' || type === 'text/markdown' || type === 'text/x-markdown') {
    const text = decodeText(buffer, contentTypeHeader).trim();
    out = {
      text,
      format: type === 'text/plain' ? 'text' : 'markdown',
      title: null,
      degraded: false
    };
  } else {
    throw new Error(
      `Unsupported content type "${type}" — this server can read HTML, PDF, DOCX, and plain text pages. `
      + 'Download the file and use "Upload file" instead.'
    );
  }

  if (!out.text || !out.text.trim()) {
    throw new Error(
      `No readable text could be extracted from that page — it is likely rendered by JavaScript, `
      + `behind a paywall, or blocking automated readers. ${PASTE_INSTEAD}`
    );
  }

  return {
    text: out.text,
    format: out.format,
    finalUrl,
    contentType: type || null,
    title: out.title || null,
    degraded: out.degraded
  };
}
