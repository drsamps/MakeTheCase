/**
 * Template rendering for activity type definitions. Pure: shared by the server, the dashboard and
 * the student page, and copied verbatim by StudyChat-LTI.
 *
 * ONE PASS ONLY. Each `{slot}` is resolved against the template, never against a value already
 * put in, so a `{…}` inside case text, a student's name or an instructor's instructions is never
 * expanded. Values go in through a replacer function, so `$&` and `$1` in a value stay literal
 * (String.prototype.replace would otherwise expand them).
 *
 * Slots are snake_case. A `{name}` that is not in `values` is left as written: the validator
 * (validate.js) refuses unknown slots at save, publish and install, so at render time an
 * unmatched brace is text that merely looks like a slot.
 */

export const SLOT_RE = /\{([a-z_]+)\}/g;

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** A template field may be one string or an array of lines (joined with "\n" for readability). */
export const templateText = (field) => (Array.isArray(field) ? field.join('\n') : field ?? '');

/** Render once. `null`/`undefined` values render as empty text. */
export function renderOnce(template, values = {}) {
  return templateText(template).replace(SLOT_RE, (whole, key) =>
    has(values, key) ? String(values[key] ?? '') : whole);
}

/** The slot names a template uses, in order of first appearance. */
export function slotsIn(template) {
  const seen = [];
  for (const m of templateText(template).matchAll(SLOT_RE)) if (!seen.includes(m[1])) seen.push(m[1]);
  return seen;
}

/**
 * Optional wrappers: `wrappers[slot]` is rendered (with the slot's own value inside) only when
 * `present[slot]` is true, else the slot becomes empty text. Slots without a wrapper keep their
 * plain value. The result is the value map for the outer template, so wrappers are rendered
 * first and passed in as values (still one pass each).
 */
export function withWrappers(values, wrappers = {}, present = {}) {
  const out = { ...values };
  for (const [slot, wrapper] of Object.entries(wrappers || {})) {
    if (!has(values, slot)) continue;
    out[slot] = present[slot] ? renderOnce(wrapper, values) : '';
  }
  return out;
}
