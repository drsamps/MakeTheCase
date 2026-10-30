/**
 * Activity types: the built-ins (code) and the types defined as data (migration 091), in one
 * registry. Design: dev/StudyChat-plan.md §4.
 *
 * IN MEMORY, REFRESHED ON EVERY WRITE. The chat, grading and greeting code reads types
 * synchronously, and the server runs as one process (PM2, a single instance, as the model breaker
 * in chatFallback.js already assumes). server/index.js awaits loadActivityTypes() before it
 * listens, and every write below reloads. Until the first load only the built-ins are known.
 *
 * TIERS
 *   builtin  case_chat, teach_back. Definitions in utils/activityEngine/builtins/*.json; always
 *            enabled; locked (clone them). Version tag `<key>@<sha12 of the definition>`.
 *   system   seeded data rows (Phase 3). Locked, clonable. Version tag `<key>@v<version_no>`.
 *   custom   cloned by admins: draft -> publish, versioned. Key `c_<slug>_<8 hex>`.
 *
 * RULES THAT FAIL SILENTLY IF BROKEN
 *   - A chat runs and is graded on the version it started with (case_chats.activity_type_version;
 *     activityTypes.js#behaviourForChat). Published and retired versions are never edited or
 *     deleted. An unknown built-in sha falls back to the current built-in.
 *   - An unknown type, or one with no published version, is UNAVAILABLE: new chats and grading
 *     get 409 ACTIVITY_TYPE_UNAVAILABLE. Only a MISSING type (legacy rows) means case chat.
 *   - A disabled type still serves chats already in progress; it cannot start new ones.
 *   - Traits are fixed for a type key once it has been published (validate.js#sameTraits).
 *   - Every definition is validated on save, on publish and on load (fail closed: an invalid
 *     stored definition makes its type unavailable, never half-works).
 */

import crypto from 'node:crypto';
import { pool } from '../db.js';
import { BUILTIN_DEFINITIONS } from '../../utils/activityEngine/builtins/index.js';
import { validateDefinition, isCustomKey, customKeyFor, sameTraits } from '../../utils/activityEngine/index.js';

export const DEFAULT_ACTIVITY_TYPE = 'case_chat';

export class ActivityTypeError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const sha256 = (text) => crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');

// MySQL's JSON column reorders object keys, so "is this the same definition?" compares canonical
// JSON (keys sorted at every level), never the stored text.
const canonical = (value) => JSON.stringify(value, (k, v) =>
  (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((key) => [key, v[key]])) : v));
/**
 * The CONTENT hash of a definition (activity_type_versions.definition_sha256): canonical JSON with
 * the key left out, so the same type installed here under another key still compares equal.
 */
export const definitionSha256 = (definition) => sha256(canonical({ ...definition, key: null }));

// A definition read back from MySQL in the built-ins' key order (unknown keys last), so the admin
// form lists fields in a sensible order. Content is unchanged.
function orderLike(value, reference) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !reference || typeof reference !== 'object' || Array.isArray(reference)) return value;
  const keys = [...Object.keys(reference).filter((k) => k in value), ...Object.keys(value).filter((k) => !(k in reference))];
  return Object.fromEntries(keys.map((k) => [k, orderLike(value[k], reference[k])]));
}
const referenceFor = (def) => BUILTIN_DEFINITIONS[def?.based_on] || (def?.traits?.character === 'persona' ? BUILTIN_DEFINITIONS.teach_back : BUILTIN_DEFINITIONS.case_chat);
const parseJson = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
const parseDefinition = (v) => { const d = parseJson(v); return orderLike(d, referenceFor(d)); };

/** `case_chat@3f2a…`: changes whenever the built-in definition's text does. */
export const builtinVersionTag = (def) => `${def.key}@${sha256(JSON.stringify(def)).slice(0, 12)}`;
const dataVersionTag = (key, versionNo) => `${key}@v${versionNo}`;

// Fail closed at startup: a broken built-in must stop the server, not grade a chat wrongly.
for (const def of Object.values(BUILTIN_DEFINITIONS)) {
  const { ok, errors } = validateDefinition(def);
  if (!ok) throw new Error(`Built-in activity type "${def.key}" is invalid:\n  ${errors.join('\n  ')}`);
}

// ---------------------------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------------------------

/**
 * @typedef {{ key: string, tier: 'builtin'|'system'|'custom', enabled: boolean, based_on: string|null,
 *   current: { definition: object, version: string } | null }} TypeEntry
 */

function buildRegistry(typeRows = [], versionRows = []) {
  const types = new Map();
  const versions = new Map();
  for (const def of Object.values(BUILTIN_DEFINITIONS)) {
    const version = builtinVersionTag(def);
    types.set(def.key, { key: def.key, tier: 'builtin', enabled: true, based_on: null, current: { definition: def, version } });
    versions.set(version, { key: def.key, definition: def });
  }
  const byId = new Map();
  for (const v of versionRows) {
    let definition;
    try {
      definition = parseDefinition(v.definition);
    } catch {
      continue;
    }
    const { ok, errors } = validateDefinition(definition);
    if (!ok || definition.key !== v.type_key) {
      console.error(`[activity types] ${v.type_key} v${v.version_no} is invalid and is not used:`, ok ? 'key mismatch' : errors.join('; '));
      continue;
    }
    const entry = { key: v.type_key, definition, version: dataVersionTag(v.type_key, v.version_no) };
    byId.set(v.version_id, entry);
    versions.set(entry.version, entry);
  }
  for (const row of typeRows) {
    if (row.tier === 'builtin') continue;
    const current = row.current_version_id ? byId.get(row.current_version_id) : null;
    types.set(row.type_key, {
      key: row.type_key,
      tier: row.tier,
      enabled: Boolean(row.enabled) && Boolean(current),
      based_on: row.based_on || null,
      current: current ? { definition: current.definition, version: current.version } : null,
    });
  }
  return { types, versions };
}

let registry = buildRegistry();

/** Load (or reload) the data types. Safe before migration 091: the built-ins stay. */
export async function loadActivityTypes() {
  try {
    const [typeRows] = await pool.query('SELECT type_key, tier, enabled, current_version_id, based_on FROM activity_types');
    const [versionRows] = await pool.query(
      "SELECT version_id, type_key, version_no, definition FROM activity_type_versions WHERE status IN ('published', 'retired')"
    );
    registry = buildRegistry(typeRows, versionRows);
  } catch (error) {
    if (error?.code !== 'ER_NO_SUCH_TABLE') throw error;
    console.warn('[activity types] tables missing (run migration 091); only the built-ins are available');
    registry = buildRegistry();
  }
  return registry.types.size;
}

/**
 * The type a case names. A MISSING type (null, '', legacy rows) is case chat; an unknown key is
 * null, never silently case chat.
 * @returns {TypeEntry|null}
 */
export function getTypeEntry(key) {
  if (key === null || key === undefined || key === '') return registry.types.get(DEFAULT_ACTIVITY_TYPE);
  return registry.types.get(key) || null;
}

/** A version a chat recorded (`case_chat@<sha12>`, `c_x_1a2b3c4d@v3`), or null when unknown here. */
export function getVersion(tag) {
  return (typeof tag === 'string' && registry.versions.get(tag)) || null;
}

/** Can a NEW chat start on this type, or a case be set to it? (Known, published, enabled.) */
export const isTypeUsable = (key) => {
  const entry = getTypeEntry(key);
  return Boolean(entry?.current && entry.enabled);
};

/** The current traits of a type, or null when it is unavailable. */
export const typeTraits = (key) => getTypeEntry(key)?.current?.definition.traits ?? null;

/** Every registered type (built-ins first). */
export const listTypeEntries = () => [...registry.types.values()];

// ---------------------------------------------------------------------------------------------
// Reading for the admin screen
// ---------------------------------------------------------------------------------------------

/** How many cases, sections and chats use a type. */
export async function typeUsage(key) {
  const [[c]] = await pool.execute('SELECT COUNT(*) AS n FROM cases WHERE activity_type = ?', [key]);
  const [[s]] = await pool.execute(
    'SELECT COUNT(DISTINCT sc.section_id) AS n FROM section_cases sc JOIN cases k ON k.case_id = sc.case_id WHERE k.activity_type = ?',
    [key]
  );
  const [[h]] = await pool.execute('SELECT COUNT(*) AS n FROM case_chats WHERE activity_type_version LIKE ?', [`${key.replace(/[\\%_]/g, '\\$&')}@%`]);
  return { cases: Number(c.n), sections: Number(s.n), chats: Number(h.n) };
}

async function typeRow(key, conn = pool) {
  const [rows] = await conn.execute('SELECT * FROM activity_types WHERE type_key = ?', [key]);
  return rows[0] || null;
}

/** One type for the admin editor: current definition, draft and history. */
export async function getTypeDetail(key) {
  const entry = getTypeEntry(key);
  const row = await typeRow(key);
  if (!row && !entry) throw new ActivityTypeError(404, 'ACTIVITY_TYPE_NOT_FOUND', 'Activity type not found');
  const [versionRows] = row && row.tier !== 'builtin'
    ? await pool.execute(
        `SELECT version_id, version_no, status, definition, definition_sha256, notes, created_by, created_at, updated_at, published_at
           FROM activity_type_versions WHERE type_key = ? ORDER BY version_no DESC`,
        [key]
      )
    : [[]];
  const versions = versionRows.map((v) => ({
    version_no: v.version_no,
    version: dataVersionTag(key, v.version_no),
    status: v.status,
    notes: v.notes,
    sha256: v.definition_sha256,
    created_at: v.created_at,
    updated_at: v.updated_at,
    published_at: v.published_at,
    definition: parseDefinition(v.definition),
  }));
  const draft = versions.find((v) => v.status === 'draft') || null;
  return {
    key,
    tier: row?.tier || entry?.tier || 'custom',
    enabled: Boolean(entry?.enabled),
    based_on: row?.based_on || null,
    locked: (row?.tier || entry?.tier) !== 'custom',
    current: entry?.current || null,
    draft,
    versions: versions.filter((v) => v.status !== 'draft'),
    usage: await typeUsage(key),
  };
}

// ---------------------------------------------------------------------------------------------
// Writing (admin, permission activity_types). Every write reloads the registry.
// ---------------------------------------------------------------------------------------------

function assertValid(definition) {
  const { ok, errors } = validateDefinition(definition);
  if (!ok) throw new ActivityTypeError(400, 'INVALID_DEFINITION', 'The definition is not valid.', { errors });
}

async function assertCustom(key, conn = pool) {
  const row = await typeRow(key, conn);
  if (!row) throw new ActivityTypeError(404, 'ACTIVITY_TYPE_NOT_FOUND', 'Activity type not found');
  if (row.tier !== 'custom') {
    throw new ActivityTypeError(409, 'ACTIVITY_TYPE_LOCKED', 'Built-in and system types cannot be edited. Clone it to make your own.');
  }
  return row;
}

async function nextVersionNo(conn, key) {
  const [[r]] = await conn.execute('SELECT COALESCE(MAX(version_no), 0) + 1 AS n FROM activity_type_versions WHERE type_key = ? FOR UPDATE', [key]);
  return Number(r.n);
}

/**
 * Create a custom type from another type's current definition (or one of its versions). The new
 * type is a draft, disabled, with its own key; its traits may differ from the source's until it
 * is first published.
 * @returns {Promise<string>} the new key
 */
export async function cloneType({ fromKey, fromVersion = null, label }, actor) {
  const source = fromVersion ? getVersion(fromVersion) : getTypeEntry(fromKey)?.current;
  if (!source) throw new ActivityTypeError(404, 'ACTIVITY_TYPE_NOT_FOUND', 'There is no published version of that type to clone.');
  const name = String(label || '').trim().slice(0, 80) || `${source.definition.label} (copy)`;
  const definition = { ...structuredClone(source.definition), label: name, based_on: source.definition.key };
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let key;
    for (let i = 0; i < 5; i++) {
      key = customKeyFor(name, crypto.randomBytes(4).toString('hex'));
      if (!(await typeRow(key, conn))) break;
    }
    definition.key = key;
    assertValid(definition);
    await conn.execute(
      `INSERT INTO activity_types (type_key, uid, tier, enabled, based_on, created_by, created_by_type)
       VALUES (?, ?, 'custom', 0, ?, ?, ?)`,
      [key, crypto.randomUUID(), source.definition.key, actor?.id ?? null, actor?.type ?? null]
    );
    await conn.execute(
      `INSERT INTO activity_type_versions (type_key, version_no, status, definition, definition_sha256, notes, created_by)
       VALUES (?, 1, 'draft', ?, ?, ?, ?)`,
      [key, JSON.stringify(definition), definitionSha256(definition), `Cloned from ${source.version}`, actor?.id ?? null]
    );
    await conn.commit();
    await loadActivityTypes();
    return key;
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
}

/** Save the type's draft (creating it when there is none). Validated; traits fixed once published. */
export async function saveDraft(key, definition, { notes = null } = {}, actor) {
  await assertCustom(key);
  if (!definition || typeof definition !== 'object' || definition.key !== key) {
    throw new ActivityTypeError(400, 'INVALID_DEFINITION', 'The definition must keep this type\'s key.', { errors: [`key: must be ${key}`] });
  }
  assertValid(definition);
  const published = getTypeEntry(key)?.current;
  if (published && !sameTraits(published.definition, definition)) {
    throw new ActivityTypeError(409, 'TRAITS_FIXED',
      'Traits are fixed once a type has been published (chats already ran on them). Clone the type to change its traits.');
  }
  const text = JSON.stringify(definition);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [drafts] = await conn.execute("SELECT version_id FROM activity_type_versions WHERE type_key = ? AND status = 'draft' FOR UPDATE", [key]);
    if (drafts.length) {
      await conn.execute('UPDATE activity_type_versions SET definition = ?, definition_sha256 = ?, notes = ?, created_by = ? WHERE version_id = ?',
        [text, definitionSha256(definition), notes ? String(notes).slice(0, 500) : null, actor?.id ?? null, drafts[0].version_id]);
    } else {
      await conn.execute(
        `INSERT INTO activity_type_versions (type_key, version_no, status, definition, definition_sha256, notes, created_by)
         VALUES (?, ?, 'draft', ?, ?, ?, ?)`,
        [key, await nextVersionNo(conn, key), text, definitionSha256(definition), notes ? String(notes).slice(0, 500) : null, actor?.id ?? null]
      );
    }
    await conn.commit();
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
}

/** Throw the draft away. */
export async function discardDraft(key) {
  await assertCustom(key);
  await pool.execute("DELETE FROM activity_type_versions WHERE type_key = ? AND status = 'draft'", [key]);
}

/** Publish the draft: it becomes the current version, the previous one is retired. */
export async function publishDraft(key, actor) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await assertCustom(key, conn);
    const [drafts] = await conn.execute(
      "SELECT version_id, version_no, definition FROM activity_type_versions WHERE type_key = ? AND status = 'draft' FOR UPDATE",
      [key]
    );
    if (!drafts.length) throw new ActivityTypeError(409, 'NO_DRAFT', 'There is no draft to publish.');
    const definition = parseDefinition(drafts[0].definition);
    assertValid(definition);
    const published = getTypeEntry(key)?.current;
    if (published && !sameTraits(published.definition, definition)) {
      throw new ActivityTypeError(409, 'TRAITS_FIXED', 'Traits are fixed once a type has been published. Clone the type to change its traits.');
    }
    await conn.execute("UPDATE activity_type_versions SET status = 'retired' WHERE type_key = ? AND status = 'published'", [key]);
    await conn.execute("UPDATE activity_type_versions SET status = 'published', published_at = NOW(), created_by = COALESCE(created_by, ?) WHERE version_id = ?",
      [actor?.id ?? null, drafts[0].version_id]);
    await conn.execute('UPDATE activity_types SET current_version_id = ? WHERE type_key = ?', [drafts[0].version_id, key]);
    await conn.commit();
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
  await loadActivityTypes();
  return getTypeEntry(key).current.version;
}

/** Copy an old version into the draft (publish it to make it current again). */
export async function restoreVersion(key, versionNo, actor) {
  await assertCustom(key);
  const [rows] = await pool.execute(
    "SELECT definition FROM activity_type_versions WHERE type_key = ? AND version_no = ? AND status IN ('published', 'retired')",
    [key, Number(versionNo)]
  );
  if (!rows.length) throw new ActivityTypeError(404, 'VERSION_NOT_FOUND', 'That version was not found.');
  await saveDraft(key, parseDefinition(rows[0].definition), { notes: `Restored from v${Number(versionNo)}` }, actor);
}

/** Enable or disable a custom type. Enabling needs a published version. */
export async function setTypeEnabled(key, enabled) {
  await assertCustom(key);
  if (enabled && !getTypeEntry(key)?.current) {
    throw new ActivityTypeError(409, 'NOT_PUBLISHED', 'Publish the type before enabling it.');
  }
  await pool.execute('UPDATE activity_types SET enabled = ? WHERE type_key = ?', [enabled ? 1 : 0, key]);
  await loadActivityTypes();
}

/** Delete a custom type that nothing uses (no case, no chat). A type in use can only be disabled. */
export async function deleteType(key) {
  await assertCustom(key);
  const usage = await typeUsage(key);
  if (usage.cases > 0 || usage.chats > 0) {
    throw new ActivityTypeError(409, 'ACTIVITY_TYPE_IN_USE', 'This type is used by cases or chats, so it cannot be deleted. Disable it instead.', { usage });
  }
  await pool.execute('DELETE FROM activity_types WHERE type_key = ?', [key]);
  await loadActivityTypes();
}

// ---------------------------------------------------------------------------------------------
// Installing from a package (activityPack/import.js)
// ---------------------------------------------------------------------------------------------

/**
 * Where a definition from a package would go here. DETERMINISTIC, because the install plan is
 * hashed when the person reviews it and again when they install (activityPack/import.js):
 *   reuse    a type here with the same key whose current version, or else its draft, has the same
 *            content (canonical sha256); or one already installed under the derived key below
 *   create   a custom key this server has never had: installed under the package's key
 *   new_key  anything else (other content under a key used here, or a system key): installed under
 *            c_<label slug>_<first 8 hex of the definition's sha256>, never overwriting
 * @returns {Promise<{ action: 'reuse'|'create'|'new_key', target_key: string, sha256: string }>}
 */
export async function planTypeInstall(definition) {
  const sha = definitionSha256(definition);
  const sameContentAt = async (key) => {
    const entry = registry.types.get(key);
    if (entry?.current && definitionSha256(entry.current.definition) === sha) return true;
    const [rows] = await pool.execute(
      "SELECT definition_sha256 FROM activity_type_versions WHERE type_key = ? AND status IN ('draft', 'published') ORDER BY version_no DESC",
      [key]
    );
    return rows.some((r) => r.definition_sha256 === sha);
  };
  if (await sameContentAt(definition.key)) return { action: 'reuse', target_key: definition.key, sha256: sha };
  const exists = registry.types.has(definition.key) || Boolean(await typeRow(definition.key));
  if (isCustomKey(definition.key) && !exists) return { action: 'create', target_key: definition.key, sha256: sha };
  const derived = customKeyFor(definition.label, sha.slice(0, 8));
  if (await sameContentAt(derived)) return { action: 'reuse', target_key: derived, sha256: sha };
  return { action: 'new_key', target_key: derived, sha256: sha };
}

/**
 * Create a type from a package inside the install transaction: DISABLED, as a DRAFT. An admin
 * reviews and publishes it before any chat can run on it. Call loadActivityTypes() after commit.
 */
export async function installTypeDraft(conn, definition, targetKey, actor, note) {
  const stored = { ...definition, key: targetKey, based_on: definition.based_on ?? null };
  assertValid(stored);
  await conn.execute(
    `INSERT INTO activity_types (type_key, uid, tier, enabled, based_on, created_by, created_by_type)
     VALUES (?, ?, 'custom', 0, ?, ?, ?)`,
    [targetKey, crypto.randomUUID(), stored.based_on, actor?.id ?? null, actor?.type ?? null]
  );
  await conn.execute(
    `INSERT INTO activity_type_versions (type_key, version_no, status, definition, definition_sha256, notes, created_by)
     VALUES (?, 1, 'draft', ?, ?, ?, ?)`,
    [targetKey, JSON.stringify(stored), definitionSha256(stored), String(note || 'Installed from an activity package').slice(0, 500), actor?.id ?? null]
  );
}

