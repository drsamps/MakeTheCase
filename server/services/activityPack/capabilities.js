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
 * all of it), so today the tokens are the activity types: `activity_type:<id>`, one per type
 * in utils/activityTypes.js. A release that adds, say, a new kind of scenario setting adds a
 * token here and has the exporter write it whenever a package uses that setting.
 *
 * THIS MUST STAY FAIL-CLOSED. The refusal cannot be added later to servers already deployed,
 * so an unknown format_version or token is always an error, never a warning.
 */

import { listActivityTypes, getActivityType, isKnownActivityType } from '../../../utils/activityTypes.js';
import { getAppVersion } from '../appVersion.js';
import { FORMAT_VERSION, PACK_FORMAT, PackError } from './format.js';

export const SUPPORTED_FORMAT_VERSIONS = [FORMAT_VERSION];

export const activityTypeToken = (activityType) => `activity_type:${activityType}`;

/** Every `requires` token this server understands. */
export function serverCapabilities() {
  return listActivityTypes().map((type) => activityTypeToken(type.id));
}

/** The tokens a package with these activities needs: one per distinct activity type. */
export function requirementsFor(activities) {
  return [...new Set(activities.map((a) => activityTypeToken(a.activity_type)))].sort();
}

/** A token in words, for the refusal message. */
function describeToken(token) {
  const [kind, value] = String(token).split(':');
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
