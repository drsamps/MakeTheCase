/**
 * What each Study-Chat activity type does on the server: its chat prompt, its opening line and
 * how its chat is graded, rendered by the activity engine (utils/activityEngine/) from the type's
 * definition. Definitions come from the registry (activityTypeStore.js: the built-ins in code plus
 * the types defined as data).
 *
 * Every caller asks `activityBehaviour(type)` (or `behaviourForChat(chat, type)` for a chat in
 * progress) instead of testing a type key, so a new type is a definition, not code. A MISSING type
 * is case chat; an unknown or unpublished one throws 409 ACTIVITY_TYPE_UNAVAILABLE.
 *
 * The type comes from the case (`cases.activity_type`). `loadCaseData()` returns it, and
 * services/chatPrompt.js#loadChatContext resolves the chat's behaviour once (`ctx.behaviour`).
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

import {
  buildSystemPrompt, buildGreeting, buildCoachPrompt, studentActivityView, validateDefinition, templateText,
} from '../../utils/activityEngine/index.js';
import { teachBackEvalInputs, typeCriteriaInputs, verifyEvidence } from './teachBack.js';
import {
  ActivityTypeError, getTypeEntry, getVersion, isTypeUsable, listTypeEntries,
} from './activityTypeStore.js';

export { ActivityTypeError, isTypeUsable };

// Grading inputs a definition can name (traits.grading_extras.eval_inputs). These read the
// database, so they live here rather than in the engine.
const EVAL_INPUTS = {
  none: async ({ caseData, rubric }) => ({ caseData, rubric }),
  // The listener's name is the persona the student picked; the type's own criteria apply unless
  // the assignment names a rubric; a clicked position is never credited (teachBack.js).
  chosen_persona: teachBackEvalInputs,
  // The type's own criteria unless the assignment names a rubric: the system default rubric is
  // written for case chat. A position's wording is the instructor's, never credited.
  type_criteria: typeCriteriaInputs,
};

function makeBehaviour(def, version) {
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
    signals: def.traits.signals,
    savedOpenings: Boolean(def.greeting.saved_openings),
  });
}

// Behaviours by version tag. A version's definition never changes (activityTypeStore.js), so the
// cache needs no invalidation.
const behaviours = new Map();
function behaviourFor(def, version) {
  let b = behaviours.get(version);
  if (!b) {
    b = makeBehaviour(def, version);
    behaviours.set(version, b);
  }
  return b;
}

const unavailable = (activityType) => new ActivityTypeError(409, 'ACTIVITY_TYPE_UNAVAILABLE',
  'This activity is not available right now (its activity type is unknown on this server or not published). Please tell your instructor.',
  { activity_type: activityType ?? null });

/**
 * The current behaviour for an activity type. A MISSING type is case chat; an unknown type, or one
 * with no published version, throws 409 ACTIVITY_TYPE_UNAVAILABLE (never a silent case chat). A
 * disabled type still returns its behaviour: chats in progress keep working, and POST /case-chats
 * refuses new ones itself (isTypeUsable).
 */
export function activityBehaviour(activityType) {
  const entry = getTypeEntry(activityType);
  if (!entry?.current) throw unavailable(activityType);
  return behaviourFor(entry.current.definition, entry.current.version);
}

/**
 * The behaviour a chat runs and is graded on: the version it recorded at its start
 * (case_chats.activity_type_version), so a publish mid-chat changes nothing for it. A built-in
 * version whose text has since changed falls back to the current built-in; a chat from before
 * versions were recorded uses the case's current type.
 * @param {{ activity_type_version?: string|null }} chat
 * @param {string|null} caseActivityType
 */
export function behaviourForChat(chat, caseActivityType) {
  const tag = chat?.activity_type_version;
  if (tag) {
    const v = getVersion(tag);
    if (v) return behaviourFor(v.definition, tag);
    const entry = getTypeEntry(tag.split('@')[0]);
    if (entry?.tier === 'builtin') return activityBehaviour(entry.key);
  }
  return activityBehaviour(caseActivityType);
}

/**
 * A behaviour for a definition that is not published (the admin preview of a draft). Not cached
 * by a real version tag, so it can never be mistaken for one.
 */
export function previewBehaviour(definition) {
  const { ok, errors } = validateDefinition(definition);
  if (!ok) throw new ActivityTypeError(400, 'INVALID_DEFINITION', 'The definition is not valid.', { errors });
  return makeBehaviour(definition, `${definition.key}@preview`);
}

/** The student-safe view of a type for case rows (never templates); null when unavailable. */
export function studentActivityViewFor(activityType) {
  const entry = getTypeEntry(activityType);
  return entry?.current ? behaviourFor(entry.current.definition, entry.current.version).studentView : null;
}

/** The current traits of a type, or null when it is unavailable (activityTypeStore.js#typeTraits). */
export function activityTraits(activityType) {
  return getTypeEntry(activityType)?.current?.definition.traits ?? null;
}

/**
 * The type's part of the Issue Analytics pass-1 cache key (issueAnalytics/common.js#extractCacheTag).
 * Built-ins give '': their definitions never reach the Issue Analytics prompts, and adding them to
 * the key would throw away every cached (paid-for) result (decided 2026-10-30). Types defined as
 * data give their current version, so editing one never reuses facts extracted under the old text.
 */
export function activityCacheVersion(activityType) {
  const entry = getTypeEntry(activityType);
  return !entry || entry.tier === 'builtin' ? '' : (entry.current?.version || '');
}

/** The chat-option defaults a type layers over the section and global defaults (chatOptions.js). */
export function activityOptionDefaults(activityType) {
  return getTypeEntry(activityType)?.current?.definition.chat_options.defaults || {};
}

/** The chat-option keys a type hides from editors (GET /api/chat-options/schema?activity_type=). */
export function activityHiddenOptions(activityType) {
  return getTypeEntry(activityType)?.current?.definition.chat_options.hidden || [];
}

/**
 * SQL for the name the AI went by in a chat, which is the name its transcript turns carry: the
 * picked persona's name for persona-character types, else the scenario's protagonist (as
 * services/chatPrompt.js#loadChatContext does). Needs the joins from aiSpeakerJoinsSql() and the
 * scenario joined as `scenario`. Type keys are [a-z0-9_] (validate.js#isTypeKey), checked again
 * here before they are written into SQL.
 */
export function aiSpeakerNameSql({ kase = 'ai_case', persona = 'ai_persona', scenario = 'cs' } = {}) {
  const personaTypes = listTypeEntries()
    .filter((e) => e.current?.definition.traits.character === 'persona')
    .map((e) => e.key)
    .filter((key) => /^[a-z0-9_]+$/.test(key));
  if (personaTypes.length === 0) return `${scenario}.protagonist`;
  const types = personaTypes.map((id) => `'${id}'`).join(', ');
  return `CASE WHEN ${kase}.activity_type IN (${types}) THEN COALESCE(${persona}.persona_name, ${scenario}.protagonist) ELSE ${scenario}.protagonist END`;
}

/** The joins aiSpeakerNameSql() reads, for a query with case_chats as `chat`. */
export function aiSpeakerJoinsSql({ chat = 'cc', kase = 'ai_case', persona = 'ai_persona' } = {}) {
  return `LEFT JOIN cases ${kase} ON ${kase}.case_id = ${chat}.case_id
         LEFT JOIN personas ${persona} ON ${persona}.persona_id = ${chat}.persona`;
}

