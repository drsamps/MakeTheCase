import { pool } from '../db.js';

/**
 * True when allowed_personas is unset / blank (all enabled personas allowed).
 * @param {string|null|undefined} allowedPersonasCsv
 */
export function isAllowedPersonasUnrestricted(allowedPersonasCsv) {
  if (allowedPersonasCsv === null || allowedPersonasCsv === undefined) return true;
  if (typeof allowedPersonasCsv !== 'string') return false;
  return allowedPersonasCsv.trim() === '';
}

/**
 * Parse comma-separated persona ids (lowercase, trimmed, non-empty).
 * @param {string|null|undefined} allowedPersonasCsv
 * @returns {string[]|null} null = unrestricted
 */
export function parseAllowedPersonaIds(allowedPersonasCsv) {
  if (isAllowedPersonasUnrestricted(allowedPersonasCsv)) return null;
  return allowedPersonasCsv
    .split(',')
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Resolve personas available for student case chats.
 * Blank/unrestricted allowed_personas → all enabled personas.
 * @param {string|null|undefined} allowedPersonasCsv
 * @returns {Promise<Array<{persona_id, persona_name, description, instructions, sort_order}>>}
 */
export async function resolveAvailablePersonas(allowedPersonasCsv) {
  const allowedIds = parseAllowedPersonaIds(allowedPersonasCsv);

  if (allowedIds === null) {
    const [rows] = await pool.execute(
      `SELECT persona_id, persona_name, description, instructions, sort_order
       FROM personas WHERE enabled = 1
       ORDER BY is_system_default DESC, sort_order ASC, persona_id ASC`
    );
    return rows;
  }

  if (allowedIds.length === 0) {
    return [];
  }

  const placeholders = allowedIds.map(() => '?').join(',');
  const [rows] = await pool.execute(
    `SELECT persona_id, persona_name, description, instructions, sort_order
     FROM personas
     WHERE enabled = 1 AND persona_id IN (${placeholders})
     ORDER BY sort_order ASC, persona_id ASC`,
    allowedIds
  );
  return rows;
}

/**
 * Pick default_persona from chat options against resolved list.
 * @param {object|null} chatOptions
 * @param {Array<{persona_id: string}>} availablePersonas
 */
export function resolveDefaultPersonaId(chatOptions, availablePersonas) {
  if (!availablePersonas?.length) return null;
  const requested = chatOptions?.default_persona?.trim?.()?.toLowerCase?.();
  if (requested && availablePersonas.some((p) => p.persona_id === requested)) {
    return requested;
  }
  return availablePersonas[0].persona_id;
}

/**
 * Build a unique clone persona_id (max 30 chars, lowercase alphanumeric + hyphens).
 */
export function buildClonePersonaId(sourceId, instructorShort) {
  const short = (instructorShort || 'me').toString().replace(/[^a-z0-9]/gi, '').slice(0, 6).toLowerCase() || 'me';
  const rand4 = Math.random().toString(36).slice(2, 6);
  const suffix = `-${short}-${rand4}`;
  const maxBase = 30 - suffix.length;
  const base = sourceId.slice(0, Math.max(1, maxBase)).replace(/[^a-z0-9-]/g, '-');
  return `${base}${suffix}`;
}

/**
 * Clone a persona for the calling instructor.
 * @param {string} sourcePersonaId
 * @param {{ created_by: string|null, created_by_type: string, instructorShort?: string }} owner
 */
export async function clonePersona(sourcePersonaId, owner) {
  const { created_by, created_by_type, instructorShort = 'me' } = owner;

  const [sourceRows] = await pool.execute(
    'SELECT * FROM personas WHERE persona_id = ?',
    [sourcePersonaId]
  );
  if (sourceRows.length === 0) {
    throw new Error(`Persona not found: ${sourcePersonaId}`);
  }
  const source = sourceRows[0];

  let newId = buildClonePersonaId(sourcePersonaId, instructorShort);
  for (let attempt = 0; attempt < 5; attempt++) {
    const [existing] = await pool.execute(
      'SELECT persona_id FROM personas WHERE persona_id = ?',
      [newId]
    );
    if (existing.length === 0) break;
    newId = buildClonePersonaId(sourcePersonaId, instructorShort);
  }

  const copyName = source.persona_name.endsWith(' (copy)')
    ? source.persona_name
    : `${source.persona_name} (copy)`;

  await pool.execute(
    `INSERT INTO personas (persona_id, persona_name, description, instructions, enabled, sort_order,
                           is_system_default, created_by, created_by_type, visibility)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 'private')`,
    [
      newId,
      copyName,
      source.description,
      source.instructions,
      source.enabled ? 1 : 0,
      source.sort_order || 0,
      created_by || null,
      created_by_type || 'instructor',
    ]
  );

  const [rows] = await pool.execute('SELECT * FROM personas WHERE persona_id = ?', [newId]);
  return rows[0];
}
