// Best-effort PII scrubber for feedback bodies before they are passed to an LLM
// for summarization. Regex-only — NOT a guarantee. Intentionally conservative.

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
// Catches common North American phone shapes: 555-555-5555, (555) 555-5555,
// +1 555 555 5555, 5555555555. Avoids matching short numbers like dates.
const PHONE_RE = /(?<!\d)(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g;
// Long all-digit runs (likely IDs / SSNs / card numbers).
const LONG_DIGIT_RE = /(?<!\d)\d{9,}(?!\d)/g;

export function redactPii(text) {
  if (!text || typeof text !== 'string') return text;
  return text
    .replace(EMAIL_RE, '[email]')
    .replace(PHONE_RE, '[phone]')
    .replace(LONG_DIGIT_RE, '[number]');
}
