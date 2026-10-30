/**
 * Student-facing wording for an activity: `copyFor()` and the intro bar's text. Pure, and the only
 * part of the engine the student page imports: it reads a STUDENT VIEW (`studentActivityView()`,
 * view.js), which carries labels and copy but never prompt templates.
 *
 * Copy may contain **bold** (rendered by the page). A copy entry may be `{ one, other }`, picked
 * by the count `n`.
 */

import { renderOnce } from './render.js';
import { introduceAudience, capitalise, pluralForm } from './resolvers.js';

/**
 * The text for one copy key, slots filled once. Unknown keys return '' (a definition always has
 * every key: validate.js refuses one without).
 * @param {{ copy?: object }|null|undefined} view
 * @param {string} key
 * @param {Record<string, string|number>} [vars]
 */
export function copyFor(view, key, vars = {}) {
  const entry = view?.copy?.[key];
  if (entry === undefined || entry === null) return '';
  return renderOnce(pluralForm(entry, vars.n), vars);
}

const unit = (entry, n) => renderOnce(pluralForm(entry, n), { n });

/**
 * The intro bar above the chat, for types whose copy has an `intro` (Teach-back). Null when the
 * type has none. `facts` is what the page knows about this chat's settings:
 *   caseTitle, scenarioName?, audienceName, intro?, topic, maxMessages, canKeepGoing,
 *   minMessages, timeLimitMinutes, autoEnd, allowFinish, positionFirst, showReading,
 *   readingWhere ('left' | 'above')
 * Strings may contain **bold**.
 */
export function activityIntroText(view, f) {
  const t = view?.copy?.intro;
  if (!t) return null;
  const audience = introduceAudience(f.audienceName) || t.ai_intro_fallback;
  const messages = (n) => unit(t.unit_message, n);
  const minutes = (n) => unit(t.unit_minute, n);
  const instructions = [];

  instructions.push(f.showReading
    ? renderOnce(t.reading_shown, { reading_where: f.readingWhere === 'left' ? t.reading_where_left : t.reading_where_above })
    : renderOnce(t.reading_hidden, {}));

  const pickNote = f.positionFirst ? t.pick_note : '';
  let pickNoted = false;
  if (f.maxMessages > 0) {
    pickNoted = true;
    const keepGoing = f.canKeepGoing ? t.keep_going : '';
    if (f.timeLimitMinutes > 0 && f.autoEnd) {
      instructions.push(renderOnce(t.max_or_time, { messages: messages(f.maxMessages), minutes: minutes(f.timeLimitMinutes), pick_note: pickNote, keep_going: keepGoing }));
    } else {
      instructions.push(renderOnce(t.max_only, { messages: messages(f.maxMessages), pick_note: pickNote, keep_going: keepGoing }));
      if (f.timeLimitMinutes > 0) instructions.push(renderOnce(t.aim_time, { minutes: minutes(f.timeLimitMinutes) }));
    }
  } else if (f.timeLimitMinutes > 0) {
    instructions.push(renderOnce(f.autoEnd ? t.time_limit : t.aim_time, { minutes: minutes(f.timeLimitMinutes) }));
  }
  if (f.timeLimitMinutes > 0) {
    instructions.push(renderOnce(t.clock, { clock_start: f.positionFirst ? t.clock_start_pick : t.clock_start_message }));
  }
  if (f.minMessages > 0) {
    instructions.push(renderOnce(t.min_messages, { messages: messages(f.minMessages), pick_note: pickNoted ? '' : pickNote }));
  }
  instructions.push(renderOnce(f.allowFinish ? t.finish_button : t.finish_phrase, {}));

  return {
    heading: renderOnce(f.scenarioName ? t.heading_scenario : t.heading, { case_title: f.caseTitle, scenario_name: f.scenarioName || '' }),
    teachLine: renderOnce(t.teach_line, { ai_intro: audience }),
    topic: f.topic,
    about: renderOnce(t.about, {
      about_intro: f.intro?.trim() || renderOnce(t.about_default, { ai_intro_capitalised: capitalise(audience) }),
    }),
    instructions,
    instructionsLabel: t.instructions_label,
    signOff: t.sign_off,
  };
}
