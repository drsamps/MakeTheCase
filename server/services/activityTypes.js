/**
 * What each Study-Chat activity type does on the server: its chat prompt, its opening line and
 * how its chat is graded, rendered by the activity engine (utils/activityEngine/) from the type's
 * definition. The built-in definitions are utils/activityEngine/builtins/*.json; the list of types
 * and their static traits for the dashboard is utils/activityTypes.js.
 *
 * Every caller asks `activityBehaviour(type)` instead of testing a type key, so a new type is a
 * definition, not code. A missing or unknown type behaves as case chat (until Phase 2 adds data
 * types and the ACTIVITY_TYPE_UNAVAILABLE refusal).
 *
 * The type comes from the case (`cases.activity_type`). `loadCaseData()` returns it, so callers
 * that already hold the case data read `caseData.activity_type` and need no extra query.
 *
 * buildSystemPrompt(studentName, personaId, caseData, options)        -> string
 * buildGreeting(caseData, studentName, personaId)                     -> string (turn 0)
 * buildCoachPrompt(chatHistory, studentName, caseData, freeHints, rubric) -> string
 * prepareEvalInputs({ caseChatId, sectionId, caseId, caseData, rubric, rubricChosen })
 *                                                                      -> { caseData, rubric }
 * finishEvaluation(result, transcript, caseData)                      -> result
 * finalTurnNote / positionPickNote                                    -> string, appended to one
 *   student message for the model only; never stored or shown
 * openingWordFloor                                                    -> boolean: the student's
 *   first explanation must reach the chat option's word floor (enforced in /api/llm/chat)
 * savedOpenings                                                       -> boolean: the greeting
 *   uses the opening the instructor saved per persona (scenario settings, `student.personas`)
 * definition / version / studentView                                  -> the definition, its
 *   version tag (`case_chat@<sha12>`, recorded on each chat and evaluation) and the whitelist a
 *   student receives (utils/activityEngine/view.js)
 */

import crypto from 'node:crypto';
import { normalizeActivityType, listActivityTypes } from '../../utils/activityTypes.js';
import { BUILTIN_DEFINITIONS } from '../../utils/activityEngine/builtins/index.js';
import {
  buildSystemPrompt, buildGreeting, buildCoachPrompt, studentActivityView, validateDefinition, templateText,
} from '../../utils/activityEngine/index.js';
import { teachBackEvalInputs, verifyEvidence } from './teachBack.js';

// Grading inputs a definition can name (traits.grading_extras.eval_inputs). These read the
// database, so they live here rather than in the engine.
const EVAL_INPUTS = {
  none: async ({ caseData, rubric }) => ({ caseData, rubric }),
  // The listener's name is the persona the student picked; the type's own criteria apply unless
  // the assignment names a rubric; a clicked position is never credited (teachBack.js).
  chosen_persona: teachBackEvalInputs,
};

/** `case_chat@3f2a…`: changes whenever the definition's text does. */
const versionTag = (def) =>
  `${def.key}@${crypto.createHash('sha256').update(JSON.stringify(def), 'utf8').digest('hex').slice(0, 12)}`;

function behaviourFor(def) {
  // Fail closed at startup: a broken built-in must stop the server, not grade a chat wrongly.
  const { ok, errors } = validateDefinition(def);
  if (!ok) throw new Error(`Activity type "${def.key}" is invalid:\n  ${errors.join('\n  ')}`);
  // Chat-option keys a definition names are checked by check-activity-engine.js (importing
  // chatOptions.js here would be an import cycle: it reads the type defaults from this module).

  const version = versionTag(def);
  const evidence = Boolean(def.traits.grading_extras.evidence);
  return Object.freeze({
    definition: def,
    version,
    studentView: studentActivityView(def, version),
    buildSystemPrompt: (studentName, personaId, caseData, options) => buildSystemPrompt(def, studentName, personaId, caseData, options),
    buildGreeting: (caseData, studentName, personaId) => buildGreeting(def, caseData, studentName, personaId),
    buildCoachPrompt: (chatHistory, studentName, caseData, freeHints, rubric) => buildCoachPrompt(def, chatHistory, studentName, caseData, freeHints, rubric),
    prepareEvalInputs: EVAL_INPUTS[def.traits.grading_extras.eval_inputs],
    // Types that ask for verbatim evidence get it checked against the student's own turns
    // before it is saved or shown.
    finishEvaluation: evidence ? verifyEvidence : (result) => result,
    finalTurnNote: templateText(def.prompt.final_turn_note),
    positionPickNote: templateText(def.prompt.position_pick_note),
    openingWordFloor: Boolean(def.traits.opening_word_floor),
    savedOpenings: Boolean(def.greeting.saved_openings),
  });
}

const BEHAVIOUR = Object.fromEntries(Object.entries(BUILTIN_DEFINITIONS).map(([key, def]) => [key, behaviourFor(def)]));

/** The behaviour for an activity type (case chat when the type is missing or unknown). */
export function activityBehaviour(activityType) {
  return BEHAVIOUR[normalizeActivityType(activityType)];
}

/** The student-safe view of a type, for case rows and chat starts (never templates). */
export function studentActivityViewFor(activityType) {
  return activityBehaviour(activityType).studentView;
}

/**
 * The type's part of the Issue Analytics pass-1 cache key (issueAnalytics/common.js#extractCacheTag).
 * Built-ins give '': their definitions never reach the Issue Analytics prompts, and adding them to
 * the key would throw away every cached (paid-for) result. Types defined as data (Phase 2) will
 * return their version here, so editing one never reuses facts extracted under the old text.
 */
export function activityCacheVersion(activityType) {
  void activityType;
  return '';
}

/** The chat-option defaults a type layers over the section and global defaults (chatOptions.js). */
export function activityOptionDefaults(activityType) {
  return activityBehaviour(activityType).definition.chat_options.defaults;
}

/** The chat-option keys a type hides from editors (GET /api/chat-options/schema?activity_type=). */
export function activityHiddenOptions(activityType) {
  return activityBehaviour(activityType).definition.chat_options.hidden;
}

// Types whose AI character is the persona the student picked (Teach-back's audience), not the
// scenario's protagonist. Keys are code constants (utils/activityTypes.js), checked before use.
const PERSONA_CHARACTER_TYPES = listActivityTypes()
  .filter((t) => t.characterFrom === 'persona')
  .map((t) => t.id)
  .filter((id) => /^[a-z_]+$/.test(id));

/**
 * SQL for the name the AI went by in a chat, which is the name its transcript turns carry: the
 * picked persona's name for persona-character types, else the scenario's protagonist (as
 * services/chatPrompt.js#loadChatContext does). Needs the joins from aiSpeakerJoinsSql() and the
 * scenario joined as `scenario`.
 */
export function aiSpeakerNameSql({ kase = 'ai_case', persona = 'ai_persona', scenario = 'cs' } = {}) {
  if (PERSONA_CHARACTER_TYPES.length === 0) return `${scenario}.protagonist`;
  const types = PERSONA_CHARACTER_TYPES.map((id) => `'${id}'`).join(', ');
  return `CASE WHEN ${kase}.activity_type IN (${types}) THEN COALESCE(${persona}.persona_name, ${scenario}.protagonist) ELSE ${scenario}.protagonist END`;
}

/** The joins aiSpeakerNameSql() reads, for a query with case_chats as `chat`. */
export function aiSpeakerJoinsSql({ chat = 'cc', kase = 'ai_case', persona = 'ai_persona' } = {}) {
  return `LEFT JOIN cases ${kase} ON ${kase}.case_id = ${chat}.case_id
         LEFT JOIN personas ${persona} ON ${persona}.persona_id = ${chat}.persona`;
}

