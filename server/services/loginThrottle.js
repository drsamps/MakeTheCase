/**
 * Login throttle: limits failed password attempts, in memory (single server process).
 *
 * Failures are counted per email address (MAX_FAILURES) and per client IP (MAX_IP_FAILURES,
 * looser because classrooms share an address) in WINDOW_MS; past either limit, further
 * attempts get 429 until the window passes. A successful
 * sign-in clears the email's count (the IP's count stays, so one IP cannot cycle through
 * many accounts by mixing in a known-good one).
 */

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10; // per email address
// Per IP is looser: a classroom or campus network shares one address, and one person's
// typos must not lock out everyone there (instructors and admins included).
const MAX_IP_FAILURES = 50;

const failures = new Map(); // key -> array of failure timestamps (ms)

function recent(key, now) {
  const list = (failures.get(key) || []).filter((t) => now - t < WINDOW_MS);
  if (list.length) failures.set(key, list);
  else failures.delete(key);
  return list;
}

// The client's address as our own proxy saw it. Not req.ip: with `trust proxy` on, req.ip is
// the left-most X-Forwarded-For entry, which the client can write; Apache appends the real
// address last. Without a proxy (dev) there is no header and the socket address is used.
function clientIp(req) {
  const xff = req.headers?.['x-forwarded-for'];
  const last = typeof xff === 'string' ? xff.split(',').pop().trim() : '';
  return last || req.socket?.remoteAddress || 'unknown';
}

function keysFor(req, email) {
  const keys = [`ip:${clientIp(req)}`];
  if (email) keys.push(`email:${String(email).trim().toLowerCase()}`);
  return keys;
}

const limitFor = (key) => (key.startsWith('ip:') ? MAX_IP_FAILURES : MAX_FAILURES);

/** True when this IP or email has used up its failed attempts. */
export function isThrottled(req, email) {
  const now = Date.now();
  return keysFor(req, email).some((k) => recent(k, now).length >= limitFor(k));
}

export function recordFailure(req, email) {
  const now = Date.now();
  for (const k of keysFor(req, email)) {
    const list = recent(k, now);
    list.push(now);
    failures.set(k, list);
  }
}

export function clearFailures(email) {
  if (email) failures.delete(`email:${String(email).trim().toLowerCase()}`);
}

export const THROTTLED_MESSAGE = 'Too many sign-in attempts. Please wait 15 minutes and try again.';

// Drop stale entries now and then so the map cannot grow without bound.
setInterval(() => {
  const now = Date.now();
  for (const k of failures.keys()) recent(k, now);
}, WINDOW_MS).unref();
