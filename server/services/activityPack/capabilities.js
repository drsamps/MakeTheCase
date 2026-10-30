/**
 * Can THIS server install a given activity package? The check that keeps a package made on a
 * newer MakeTheCase from being installed on an older one.
 *
 * It runs on the installing server, against what the exporting server wrote in the manifest:
 *
 *   format_version   the package layout. A number not in SUPPORTED_FORMAT_VERSIONS is refused.
 *   requires[]       tokens for things the installer must understand. Any token not in
 *                    serverCapabilities() is refused, and named in the message.
 *
 * WHY TOKENS AND NOT A VERSION NUMBER. An old server cannot know what a newer one added, so
 * "requires version 1.4" is a promise only the new server can check. A token is checked by the
 * old server itself: it either has the token or it does not. The app version in
 * `exported_from` is only used to word the message.
 *
 * WHAT GETS A TOKEN. Anything an installer that did not know about it would mishandle by
 * ignoring. Format 1 itself is the baseline (every server that can install at all understands
 * all of it), so the tokens are the BUILT-IN activity types (`activity_type:<id>`, one per type in
 * utils/activityTypes.js), `activity_definition:1` for a package that carries types defined as
 * data (activity_types.json, StudyChat Phase 2), and features added since
 * (`scenario_settings:student`, `document:text_format`). A release
 * that adds, say, a new kind of scenario setting adds a token here and has the exporter write
 * it whenever a package uses that setting.
 *
 * THIS MUST STAY FAIL-CLOSED. The refusal cannot be added later to servers already deployed,
 * so an unknown format_version or token is always an error, never a warning.
 */

import { listActivityTypes, getActivityType, isKnownActivityType } from '../../../utils/activityTypes.js';
import { DEFINITION_SCHEMA } from '../../../utils/activityEngine/validate.js';
import { getAppVersion } from '../appVersion.js';
import { FORMAT_VERSION, PACK_FORMAT, PackError, impliedTextFormat } from './format.js';

export const SUPPORTED_FORMAT_VERSIONS = [FORMAT_VERSION];

export const activityTypeToken = (activityType) => `activity_type:${activityType}`;

// A scenario carrying student-visible text (utils/scenarioSettings.js, `student` subtree:
// the audience's situation and per-audience intros and openings). Added 2026-10-15.
export const SCENARIO_STUDENT_TEXT_TOKEN = 'scenario_settings:student';

// A document whose text is in a different format from the one its original file implies
// (format.js#impliedTextFormat): a PDF auto-formatted into Markdown in the Case Files editor, or
// a web page turned into plain text. An older installer would render it in the implied format.
// Added 2026-10-29. Packages without such a document do not carry it and install anywhere.
export const DOCUMENT_TEXT_FORMAT_TOKEN = 'document:text_format';

// A package carrying activity type DEFINITIONS (activity_types.json): the activities use types
// defined as data, which the installer validates with utils/activityEngine/validate.js
// (DEFINITION_SCHEMA). Added 2026-10-30 (StudyChat Phase 2). An engine feature a definition can
// use in a later schema (signals, touchpoints, assigned positions, student submissions) gets its
// own token here, written only when a carried definition uses it.
export const ACTIVITY_DEFINITION_TOKEN = `activity_definition:${DEFINITION_SCHEMA}`;

// A case with a learning goal (cases.goal, StudyChat Phase 3). An older installer would drop it.
export const ACTIVITY_GOAL_TOKEN = 'activity:goal';

/**
 * One token per engine feature a carried definition uses, written only when one does: the installer
 * would otherwise refuse the definition with a validation error instead of saying "update this
 * server". Each is listed in FEATURE_TOKENS so this server accepts it.
 */
const FEATURE_TOKENS = {
  'positions:assigned': { words: 'assigned positions', uses: (d) => d.traits.capture_methods.includes('assigned') },
  'positions:two_sided': { words: 'two-sided activities', uses: (d) => Boolean(d.traits.two_sided) },
  'trait:personal': { words: 'activities about personal content', uses: (d) => Boolean(d.traits.personal) },
  'grading:type_criteria': { words: "grading on a type's own criteria", uses: (d) => d.traits.grading_extras.eval_inputs === 'type_criteria' },
};

/** Built-in types travel as a token; any other type travels as a definition. */
export const isBuiltinActivityType = (activityType) => isKnownActivityType(activityType);

/** Every `requires` token this server understands. */
export function serverCapabilities() {
  return [...listActivityTypes().map((type) => activityTypeToken(type.id)), ACTIVITY_DEFINITION_TOKEN, SCENARIO_STUDENT_TEXT_TOKEN, DOCUMENT_TEXT_FORMAT_TOKEN, ACTIVITY_GOAL_TOKEN, ...Object.keys(FEATURE_TOKENS)];
}

const usesScenarioStudentText = (activity) =>
  (activity.scenarios || []).some((s) => s.chat_options_override?.student);

const usesStatedTextFormat = (activity) =>
  (activity.documents || []).some((d) => d.text_format && d.text_format !== impliedTextFormat(d));

/**
 * The tokens a package with these activities needs: one per distinct built-in type, the definition
 * token when any activity uses a type defined as data, plus one per feature used.
 */
export function requirementsFor(activities, definitions = []) {
  const tokens = activities.map((a) => (isBuiltinActivityType(a.activity_type) ? activityTypeToken(a.activity_type) : ACTIVITY_DEFINITION_TOKEN));
  if (activities.some(usesScenarioStudentText)) tokens.push(SCENARIO_STUDENT_TEXT_TOKEN);
  if (activities.some(usesStatedTextFormat)) tokens.push(DOCUMENT_TEXT_FORMAT_TOKEN);
  if (activities.some((a) => a.goal)) tokens.push(ACTIVITY_GOAL_TOKEN);
  for (const [token, feature] of Object.entries(FEATURE_TOKENS)) {
    if (definitions.some(feature.uses)) tokens.push(token);
  }
  return [...new Set(tokens)].sort();
}

/** A token in words, for the refusal message. */
function describeToken(token) {
  const [kind, value] = String(token).split(':');
  if (token === SCENARIO_STUDENT_TEXT_TOKEN) return 'saved openings and intro text on scenarios';
  if (token === DOCUMENT_TEXT_FORMAT_TOKEN) return 'documents formatted in the Case Files editor';
  if (token === ACTIVITY_GOAL_TOKEN) return 'learning goals on activities';
  if (FEATURE_TOKENS[token]) return FEATURE_TOKENS[token].words;
  if (kind === 'activity_definition') return `custom activity types (definition schema ${value})`;
  if (kind === 'activity_type') {
    return isKnownActivityType(value) ? `${getActivityType(value).label} activities` : `"${value}" activities`;
  }
  return `"${token}"`;
}

const madeWith = (manifest) => {
  const version = manifest?.exported_from?.app_version;
  return typeof version === 'string' && version ? ` It was made with MakeTheCase ${version.slice(0, 20)}; this server is ${getAppVersion()}.` : '';
};

/**
 * Refuse a package this server cannot install. Throws PackError; returns nothing.
 * Call this BEFORE format.js#assertValidPack, so a package from a newer server is refused for
 * the stated reason rather than for a field the strict check does not recognise.
 */
export function assertInstallable(manifest) {
  if (!manifest || typeof manifest !== 'object' || manifest.format !== PACK_FORMAT) {
    throw new PackError(400, 'NOT_A_PACK', 'This file is not a MakeTheCase activity package.');
  }
  if (!SUPPORTED_FORMAT_VERSIONS.includes(manifest.format_version)) {
    throw new PackError(422, 'UNSUPPORTED_FORMAT',
      `This package uses package format ${JSON.stringify(manifest.format_version)}, and this MakeTheCase server reads format ${SUPPORTED_FORMAT_VERSIONS.join(', ')}.${madeWith(manifest)} Update this server, then install the package again.`,
      { format_version: manifest.format_version, supported: SUPPORTED_FORMAT_VERSIONS });
  }
  if (!Array.isArray(manifest.requires) || manifest.requires.some((t) => typeof t !== 'string')) {
    throw new PackError(400, 'INVALID_PACK', 'This is not a valid activity package: its list of requirements is missing.');
  }
  const have = new Set(serverCapabilities());
  const missing = manifest.requires.filter((token) => !have.has(token));
  if (missing.length > 0) {
    throw new PackError(422, 'REQUIRES_NEWER_SERVER',
      `This package needs something this MakeTheCase server does not have: ${missing.map(describeToken).join(', ')}.${madeWith(manifest)} Update this server, then install the package again.`,
      { missing });
  }
}
