/**
 * Activity type definition schema v1: the validator.
 *
 * Fail closed, like utils/scenarioSettings.js and activity packages: an unknown key, an unknown
 * enum value or a slot that is not allowed in a field's CHANNEL is refused, never ignored. It runs
 * on the built-ins in check-activity-engine.js now; from Phase 2 it also runs at save, publish
 * and package install.
 *
 * CHANNELS (the security rule). Every template field belongs to one:
 *   system      the chat system prompt            may use AI-only slots
 *   coach       the grading prompt                may use AI-only slots
 *   model_note  appended to one student message   no slots
 *   student     greeting, labels, copy            student-safe slots only
 * AI-only slots (scenario_instructions, persona_instructions, additional_instructions, hint_rule
 * and, from later phases, touchpoints) are listed only for system fields, so a student template
 * that names one is refused. That is what stops a template from putting AI-only text in a
 * greeting.
 */

import { slotsIn, templateText } from './render.js';
import { PERSONA_TEXT_RESOLVERS } from './resolvers.js';
import { GREETING_RESOLVERS } from './greeting.js';

export const DEFINITION_SCHEMA = 1;

const MAX_FIELD = 20000;
const MAX_TOTAL = 200000;

const ROLE_SLOTS = ['student_name', 'ai_name', 'ai_role', 'case_title', 'question', 'topic', 'situation',
  'scenario_instructions', 'persona_instructions', 'additional_instructions', 'hint_rule'];
const WRAPPABLE = ['ai_role', 'scenario_instructions', 'persona_instructions', 'additional_instructions', 'situation'];

/** Student copy keys and the variables each may use. Every definition has every key. */
export const COPY_KEYS = {
  start_row: ['ai_name', 'ai_role_suffix', 'topic', 'topic_or_question'],
  persona_picker_title: [],
  persona_picker_help: [],
  persona_picker_empty: [],
  start_no_persona: [],
  feedback_permission: ['first_name'],
  transcript_permission: ['first_name'],
  farewell: ['first_name'],
  min_exchanges_warning: [],
  opening_too_short: ['min_words'],
  hints_disabled: [],
  hints_exhausted: ['n'],
  helpful_score_question: [],
  transcript_permission_after_feedback: [],
  farewell_after_decline: [],
  liked_question: [],
  improve_question: [],
  farewell_after_feedback: [],
  goodbye: ['first_name'],
  position_prompt: [],
  position_reply_fallback: [],
  final_position_context: ['ai_name', 'question'],
  final_position_question: ['ai_name'],
  counter_used: ['used', 'max'],
  counter_past_limit: ['used', 'max'],
  limit_reached: ['max'],
  avatar_tooltip: ['ai_name', 'persona_name', 'case_title', 'model'],
  coverage_heading: [],
  coverage_count: ['met', 'total'],
  status_met: [],
  status_partial: [],
  status_not_met: [],
};

/** The intro bar's phrases (copy.intro, or null for no intro bar) and their variables. */
export const INTRO_KEYS = {
  heading: ['case_title'],
  heading_scenario: ['case_title', 'scenario_name'],
  teach_line: ['ai_intro'],
  ai_intro_fallback: [],
  about: ['about_intro'],
  about_default: ['ai_intro_capitalised'],
  reading_shown: ['reading_where'],
  reading_where_left: [],
  reading_where_above: [],
  reading_hidden: [],
  unit_message: ['n'],
  unit_minute: ['n'],
  pick_note: [],
  keep_going: [],
  max_or_time: ['messages', 'minutes', 'pick_note', 'keep_going'],
  max_only: ['messages', 'pick_note', 'keep_going'],
  aim_time: ['minutes'],
  time_limit: ['minutes'],
  clock: ['clock_start'],
  clock_start_pick: [],
  clock_start_message: [],
  min_messages: ['messages', 'pick_note'],
  finish_button: [],
  finish_phrase: [],
  instructions_label: [],
  sign_off: [],
};

const LABEL_KEYS = ['document', 'ai_character', 'question', 'ai_fallback'];
const CAPTURE_METHODS = ['explicit', 'ai_inferred', 'instructor_manual', 'none'];
const EVAL_INPUTS = ['none', 'chosen_persona'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v) => typeof v === 'string' || (Array.isArray(v) && v.every((x) => typeof x === 'string'));

/**
 * @param {unknown} def
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateDefinition(def) {
  const errors = [];
  const err = (path, msg) => errors.push(`${path}: ${msg}`);

  const keysOnly = (obj, path, allowed, required = allowed) => {
    if (!isObj(obj)) { err(path, 'must be an object'); return false; }
    for (const k of Object.keys(obj)) if (!allowed.includes(k)) err(`${path}.${k}`, 'unknown key');
    for (const k of required) if (!(k in obj)) err(`${path}.${k}`, 'missing');
    return true;
  };
  const text = (v, path, slots, { optional = false, channel = 'student' } = {}) => {
    if (v === null || v === undefined || v === '') {
      if (!optional) err(path, 'missing');
      return;
    }
    if (!isText(v)) { err(path, 'must be text or an array of lines'); return; }
    const s = templateText(v);
    if (s.length > MAX_FIELD) err(path, `longer than ${MAX_FIELD} characters`);
    for (const slot of slotsIn(s)) if (!slots.includes(slot)) err(path, `slot {${slot}} is not allowed in this ${channel} field`);
    if (channel === 'student' && /<\/?[a-z][^>]*>/i.test(s)) err(path, 'HTML is not allowed in student text');
  };
  const plural = (v, path, slots) => {
    if (isObj(v)) {
      keysOnly(v, path, ['one', 'other']);
      text(v.one, `${path}.one`, slots);
      text(v.other, `${path}.other`, slots);
    } else text(v, path, slots);
  };
  const bool = (v, path) => { if (typeof v !== 'boolean') err(path, 'must be true or false'); };
  const oneOf = (v, path, list) => { if (!list.includes(v)) err(path, `must be one of ${list.join(', ')}`); };

  if (!keysOnly(def, 'definition', ['schema', 'key', 'label', 'summary', 'based_on', 'traits', 'prompt', 'greeting', 'grading', 'labels', 'copy', 'chat_options'])) {
    return { ok: false, errors };
  }
  if (def.schema !== DEFINITION_SCHEMA) err('schema', `must be ${DEFINITION_SCHEMA}`);
  if (typeof def.key !== 'string' || !/^([a-z_]{2,40}|c_[a-z0-9_]{2,40}_[a-z0-9]{6,12})$/.test(def.key)) err('key', 'must be [a-z_] (built-in, system) or c_<slug>_<uid> (custom)');
  text(def.label, 'label', []);
  text(def.summary, 'summary', []);
  if (def.based_on !== null && typeof def.based_on !== 'string') err('based_on', 'must be a type key or null');

  // traits: fixed for the life of a type key
  const t = def.traits;
  if (keysOnly(t, 'traits', ['character', 'persona_kind', 'positions', 'capture_methods', 'material', 'ai_sees', 'signals', 'grading_extras', 'opening_word_floor'])) {
    oneOf(t.character, 'traits.character', ['scenario', 'persona']);
    oneOf(t.persona_kind, 'traits.persona_kind', ['protagonist', 'audience']);
    oneOf(t.positions, 'traits.positions', ['off', 'optional', 'required']);
    if (!Array.isArray(t.capture_methods) || !t.capture_methods.length || t.capture_methods.some((m) => !CAPTURE_METHODS.includes(m))) err('traits.capture_methods', `must list some of ${CAPTURE_METHODS.join(', ')}`);
    oneOf(t.material, 'traits.material', ['activity']);
    if (keysOnly(t.ai_sees, 'traits.ai_sees', ['case', 'supplementary', 'teaching_note', 'arguments', 'touchpoints'])) {
      for (const [k, v] of Object.entries(t.ai_sees)) bool(v, `traits.ai_sees.${k}`);
      if (t.ai_sees.case !== true) err('traits.ai_sees.case', 'must be true');
      if (t.ai_sees.touchpoints) err('traits.ai_sees.touchpoints', 'not supported by this server yet');
    }
    if (keysOnly(t.signals, 'traits.signals', ['complete', 'touchpoints'])) {
      for (const [k, v] of Object.entries(t.signals)) { bool(v, `traits.signals.${k}`); if (v) err(`traits.signals.${k}`, 'not supported by this server yet'); }
    }
    if (keysOnly(t.grading_extras, 'traits.grading_extras', ['evidence', 'eval_inputs'])) {
      bool(t.grading_extras.evidence, 'traits.grading_extras.evidence');
      oneOf(t.grading_extras.eval_inputs, 'traits.grading_extras.eval_inputs', EVAL_INPUTS);
    }
    bool(t.opening_word_floor, 'traits.opening_word_floor');
  }

  // prompt (system channel; notes are model_note)
  const p = def.prompt;
  if (keysOnly(p, 'prompt', ['documents', 'role', 'optional', 'hints', 'persona_text', 'ai_name_fallback', 'final_turn_note', 'position_pick_note'])) {
    const sees = isObj(t?.ai_sees) ? t.ai_sees : {};
    const docKeys = ['case', 'supplementary', ...(sees.teaching_note ? ['teaching_note'] : []), ...(sees.arguments ? ['arguments'] : [])];
    if (keysOnly(p.documents, 'prompt.documents', docKeys)) {
      const fields = { case: ['heading', 'end'], supplementary: ['heading', 'end', 'intro'], teaching_note: ['heading', 'end', 'intro'], arguments: ['heading', 'end', 'intro', 'for_label', 'against_label'] };
      for (const d of docKeys) {
        if (!keysOnly(p.documents[d], `prompt.documents.${d}`, fields[d])) continue;
        for (const f of fields[d]) text(p.documents[d][f], `prompt.documents.${d}.${f}`, [], { channel: 'system' });
      }
    }
    text(p.role, 'prompt.role', ROLE_SLOTS, { channel: 'system' });
    if (keysOnly(p.optional, 'prompt.optional', WRAPPABLE, [])) {
      for (const [slot, w] of Object.entries(p.optional)) {
        text(w, `prompt.optional.${slot}`, ROLE_SLOTS, { channel: 'system' });
        if (isText(w) && !slotsIn(w).includes(slot)) err(`prompt.optional.${slot}`, `must contain {${slot}}`);
      }
    }
    if (keysOnly(p.hints, 'prompt.hints', ['zero', 'one', 'many'])) {
      for (const k of ['zero', 'one', 'many']) text(p.hints[k], `prompt.hints.${k}`, ['free_hints'], { channel: 'system' });
    }
    oneOf(p.persona_text, 'prompt.persona_text', PERSONA_TEXT_RESOLVERS);
    if (p.ai_name_fallback !== null) text(p.ai_name_fallback, 'prompt.ai_name_fallback', [], { channel: 'system' });
    text(p.final_turn_note, 'prompt.final_turn_note', [], { channel: 'model_note' });
    text(p.position_pick_note, 'prompt.position_pick_note', [], { channel: 'model_note', optional: true });
  }

  // greeting (student channel)
  const g = def.greeting;
  if (isObj(g)) {
    oneOf(g.resolver, 'greeting.resolver', GREETING_RESOLVERS);
    if (g.resolver === 'audience_opening') {
      keysOnly(g, 'greeting', ['resolver', 'saved_openings', 'template', 'template_situation', 'hello_named', 'hello_anonymous', 'fallbacks']);
      text(g.template, 'greeting.template', ['hello', 'ai_intro', 'question']);
      text(g.template_situation, 'greeting.template_situation', ['hello', 'ai_intro', 'question', 'situation']);
      text(g.hello_named, 'greeting.hello_named', ['student_name']);
      text(g.hello_anonymous, 'greeting.hello_anonymous', []);
      if (keysOnly(g.fallbacks, 'greeting.fallbacks', ['ai_intro'])) text(g.fallbacks.ai_intro, 'greeting.fallbacks.ai_intro', []);
    } else if (g.resolver === 'plain') {
      keysOnly(g, 'greeting', ['resolver', 'saved_openings', 'template', 'fallbacks']);
      text(g.template, 'greeting.template', ['student_name', 'ai_name', 'ai_role', 'case_title', 'question']);
      if (keysOnly(g.fallbacks, 'greeting.fallbacks', ['ai_role'])) text(g.fallbacks.ai_role, 'greeting.fallbacks.ai_role', []);
    }
    bool(g.saved_openings, 'greeting.saved_openings');
  } else err('greeting', 'must be an object');

  // grading (coach channel; headings are student-visible)
  const gr = def.grading;
  if (keysOnly(gr, 'grading', ['framing', 'fallbacks', 'default_criteria', 'criteria_block', 'read_line', 'ai_word', 'summary_headings', 'picked_position_note'])) {
    text(gr.framing, 'grading.framing', ['ai_name', 'case_title'], { channel: 'coach' });
    if (keysOnly(gr.fallbacks, 'grading.fallbacks', ['ai_name', 'case_title'])) {
      text(gr.fallbacks.ai_name, 'grading.fallbacks.ai_name', [], { channel: 'coach' });
      text(gr.fallbacks.case_title, 'grading.fallbacks.case_title', [], { channel: 'coach' });
    }
    text(gr.default_criteria, 'grading.default_criteria', [], { channel: 'coach' });
    text(gr.criteria_block, 'grading.criteria_block', ['criteria', 'additional_evaluation'], { channel: 'coach' });
    if (isText(gr.criteria_block) && !slotsIn(gr.criteria_block).includes('criteria')) err('grading.criteria_block', 'must contain {criteria}');
    text(gr.read_line, 'grading.read_line', [], { channel: 'coach' });
    text(gr.ai_word, 'grading.ai_word', [], { channel: 'coach' });
    if (!Array.isArray(gr.summary_headings) || gr.summary_headings.length > 6) err('grading.summary_headings', 'must be a list of up to 6 headings');
    else gr.summary_headings.forEach((h, i) => text(h, `grading.summary_headings[${i}]`, []));
    text(gr.picked_position_note, 'grading.picked_position_note', ['position'], { channel: 'coach', optional: true });
  }

  if (keysOnly(def.labels, 'labels', LABEL_KEYS)) for (const k of LABEL_KEYS) text(def.labels[k], `labels.${k}`, []);

  const c = def.copy;
  if (keysOnly(c, 'copy', [...Object.keys(COPY_KEYS), 'intro'])) {
    for (const [k, vars] of Object.entries(COPY_KEYS)) plural(c[k], `copy.${k}`, vars);
    if (c.intro !== null && keysOnly(c.intro, 'copy.intro', Object.keys(INTRO_KEYS))) {
      for (const [k, vars] of Object.entries(INTRO_KEYS)) plural(c.intro[k], `copy.intro.${k}`, vars);
    }
  }

  const o = def.chat_options;
  if (keysOnly(o, 'chat_options', ['defaults', 'hidden', 'extra'])) {
    if (!isObj(o.defaults)) err('chat_options.defaults', 'must be an object');
    if (!Array.isArray(o.hidden) || o.hidden.some((k) => typeof k !== 'string')) err('chat_options.hidden', 'must be a list of option keys');
    if (!Array.isArray(o.extra) || o.extra.length) err('chat_options.extra', 'type-only options are not supported by this server yet');
  }

  if (JSON.stringify(def).length > MAX_TOTAL) err('definition', `larger than ${MAX_TOTAL} characters`);
  return { ok: errors.length === 0, errors };
}
