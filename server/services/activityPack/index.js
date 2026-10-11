/**
 * Activity packages: download cases from one MakeTheCase server, install them on another.
 * This file is the entry point the routes use; the work is in the files beside it.
 *
 *   format.js        the package format, its limits and the strict validity check
 *   capabilities.js  whether THIS server can install a given package (fails closed)
 *   zip.js           reading and writing the ZIP (reading is untrusted input)
 *   export.js        building a package from cases here
 *   import.js        planning and executing an install
 *
 * Design, format reference and how to add to it: docs/activity-packages.md.
 *
 * THE RULES. Each one fails silently if broken, so keep them when changing this code:
 *   1. Fail closed. An unknown format version, `requires` token, activity type, chat option,
 *      document role, persona kind or enum is refused, never ignored (format.js,
 *      capabilities.js). This cannot be added later to servers already deployed.
 *   2. The ZIP is untrusted. Entry names are never used as paths; only entries the manifest
 *      names are read; sizes are capped while inflating (zip.js).
 *   3. A package never sets an owner, visibility, id, system-default flag or proprietary
 *      confirmation, and never carries students, chats, grades, sections, dates, models or
 *      keys (export.js, import.js).
 *   4. Installing only creates rows or reuses identical ones. It never overwrites a case,
 *      persona, criterion or rubric (import.js).
 *   5. Download checks view access to each case, to the course or section its settings come
 *      from, and to each persona and rubric bundled (export.js).
 *   6. Install must match the plan the person confirmed (plan_hash, import.js).
 *   7. Package text is untrusted: it is shown for review before install and is rendered only
 *      through the sanitized Markdown renderers.
 */

import { isKnownActivityType } from '../../../utils/activityTypes.js';
import { PackError, assertValidPack } from './format.js';
import { openPack } from './zip.js';
import { buildPackFile, collectPack, exportOptions, loadSettingsChoice, sealPack } from './export.js';
import { executeInstall, planInstall } from './import.js';

export { PackError, buildPackFile, exportOptions, loadSettingsChoice };
export { LIMITS, PACK_FILE_EXTENSION, PACK_FORMAT } from './format.js';
export { SUPPORTED_FORMAT_VERSIONS, serverCapabilities } from './capabilities.js';

/** Read an uploaded package and say what installing it here would do. Writes nothing. */
export async function inspectPackFile(req, buffer, options = {}) {
  const pack = await openPack(buffer);
  assertValidPack(pack);
  return planInstall(req, pack, options);
}

/** Install an uploaded package. `options.plan_hash` must be the hash of the confirmed plan. */
export async function installPackFile(req, buffer, options = {}) {
  const pack = await openPack(buffer);
  assertValidPack(pack);
  return executeInstall(req, pack, { ...options, internal: false });
}

/**
 * Copy a case on this server: documents (with originals), scenarios, positions and its default
 * settings, as a new private case owned by the caller. Nothing that is assigned changes.
 *
 * With a different `activityType` the copy is the same reading as another kind of activity.
 * Its default settings are left behind, because chat options, personas and rubric are written
 * for one type.
 *
 * Proprietary documents are copied but arrive unconfirmed, like any installed document.
 *
 * @returns {Promise<{case_id: string, case_title: string}>}
 */
export async function duplicateCase(req, caseId, { title = null, activityType = null } = {}) {
  if (activityType !== null && activityType !== undefined && !isKnownActivityType(activityType)) {
    throw new PackError(400, 'INVALID_REQUEST', `Unknown activity type: ${activityType}`);
  }
  const pack = await collectPack(req, {
    items: [{ case_id: caseId, settings: { source: 'defaults' } }],
    includeOriginals: true,
    includeProprietary: true,
  });
  const activity = pack.activities[0];
  if (activityType && activityType !== activity.activity_type) {
    activity.activity_type = activityType;
    activity.settings = null;
    activity.personas = [];
    activity.persona_selection = 'all_enabled';
    sealPack(pack);
  }
  const result = await executeInstall(req, pack, {
    internal: true,
    activities: { [activity.key]: 'copy' },
    titles: typeof title === 'string' && title.trim() ? { [activity.key]: title } : undefined,
    origin: { duplicated_from: caseId },
    defaults_source: `Copied from ${caseId}`,
  });
  return result.installed[0];
}
