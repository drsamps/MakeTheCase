/**
 * The activity engine: renders any activity type definition into its chat prompt, greeting,
 * grading prompt and student copy. Design: dev/StudyChat-plan.md §1–3.
 *
 *   render.js     renderOnce (one pass, snake_case slots), optional wrappers
 *   resolvers.js  named logic a definition can pick (persona text, trimming, plurals)
 *   prompt.js     chat system prompt (platform document blocks + the role template)
 *   greeting.js   turn 0
 *   grading.js    coach prompt (platform task list and JSON contract)
 *   copy.js       student copy and the intro bar (the only module the student page imports)
 *   view.js       studentActivityView(): the whitelist a student receives
 *   validate.js   schema v1, channels and slots (fail closed)
 *   builtins/     case_chat.json, teach_back.json (locked; byte-for-byte goldens)
 *
 * NO DATABASE OR NODE-ONLY IMPORTS anywhere in this folder: StudyChat-LTI copies it verbatim, and
 * the student page bundles copy.js. Built-in definitions are loaded by the server
 * (server/services/activityTypes.js), never by the page, so templates never reach a browser.
 */

export { renderOnce, slotsIn, templateText, withWrappers } from './render.js';
export { buildSystemPrompt, aiNameFor } from './prompt.js';
export { buildGreeting } from './greeting.js';
export { buildCoachPrompt } from './grading.js';
export { copyFor, activityIntroText } from './copy.js';
export { studentActivityView } from './view.js';
export { validateDefinition, DEFINITION_SCHEMA, COPY_KEYS, INTRO_KEYS } from './validate.js';
