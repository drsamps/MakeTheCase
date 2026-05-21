/**
 * Per-instructor API key resolver.
 *
 * Resolves which API key to use for a given provider on behalf of an
 * instructor. Resolution order:
 *
 *   1. If req.user/instructor has use_system_key=1, return the env key
 *      (process.env.<PROVIDER>_API_KEY).
 *   2. Otherwise look up instructor_api_keys for the (instructorId, provider)
 *      pair, decrypt the blob and return the plaintext key.
 *   3. Throw `MissingInstructorKeyError` if neither is available. Route
 *      callers translate that to a 409 with a "setup incomplete" hint so the
 *      student UI can show "this section isn't ready yet".
 *
 * The plaintext key is NEVER persisted, logged, or returned to a route.
 * Only this module knows the cleartext.
 */
import { pool } from '../db.js';
import { decryptKey } from './encryption.js';

export class MissingInstructorKeyError extends Error {
  constructor(provider, instructorId) {
    super(`No ${provider} key configured for instructor ${instructorId}`);
    this.name = 'MissingInstructorKeyError';
    this.code = 'INSTRUCTOR_SETUP_INCOMPLETE';
    this.provider = provider;
    this.instructorId = instructorId;
  }
}

const ENV_KEY_BY_PROVIDER = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GEMINI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY'
};

function getEnvKey(provider) {
  const name = ENV_KEY_BY_PROVIDER[provider];
  if (!name) return null;
  return process.env[name] || (provider === 'google' ? process.env.API_KEY : null) || null;
}

/**
 * Resolve a plaintext API key for the given (provider, instructorId).
 *
 *   - instructorId == null  -> falls back to the env key (legacy / system flows)
 *   - instructor.use_system_key=1  -> env key
 *   - otherwise              -> decrypted instructor_api_keys row
 *
 * @param {string} provider
 * @param {string|null} instructorId
 * @returns {Promise<string>}
 */
export async function resolveProviderKey(provider, instructorId = null) {
  if (!ENV_KEY_BY_PROVIDER[provider]) {
    throw new Error(`Unknown provider: ${provider}`);
  }

  if (!instructorId) {
    const env = getEnvKey(provider);
    if (!env) throw new MissingInstructorKeyError(provider, null);
    return env;
  }

  const [iRows] = await pool.execute(
    'SELECT use_system_key FROM instructors WHERE id = ? LIMIT 1',
    [instructorId]
  );
  if (iRows.length === 0) {
    throw new MissingInstructorKeyError(provider, instructorId);
  }
  if (iRows[0].use_system_key === 1) {
    const env = getEnvKey(provider);
    if (!env) throw new MissingInstructorKeyError(provider, instructorId);
    return env;
  }

  const [rows] = await pool.execute(
    `SELECT api_key_encrypted FROM instructor_api_keys
     WHERE instructor_id = ? AND provider = ? AND enabled = 1
     LIMIT 1`,
    [instructorId, provider]
  );
  if (rows.length === 0) {
    throw new MissingInstructorKeyError(provider, instructorId);
  }
  return decryptKey(rows[0].api_key_encrypted);
}

/**
 * Resolve the primary instructor for a section. Returns null if the section
 * is missing or has no primary instructor assigned (legacy data). Callers
 * that get null should fall back to the env key path (instructorId = null).
 *
 * @param {string} sectionId
 * @returns {Promise<string|null>}
 */
export async function resolveInstructorForSection(sectionId) {
  if (!sectionId) return null;
  const [rows] = await pool.execute(
    'SELECT primary_instructor_id FROM sections WHERE section_id = ? LIMIT 1',
    [sectionId]
  );
  return rows[0]?.primary_instructor_id || null;
}

/**
 * Resolve the instructor responsible for a given case_chat row (chat-id).
 * Used by the student chat path which doesn't carry section context.
 *
 * @param {string} caseChatId
 * @returns {Promise<string|null>}
 */
export async function resolveInstructorForCaseChat(caseChatId) {
  if (!caseChatId) return null;
  const [rows] = await pool.execute(
    `SELECT s.primary_instructor_id
       FROM case_chats cc
       JOIN sections s ON cc.section_id = s.section_id
      WHERE cc.id = ?
      LIMIT 1`,
    [caseChatId]
  );
  return rows[0]?.primary_instructor_id || null;
}

/**
 * Resolve the instructor for a (student, case) pair when the chat is being
 * started and we don't yet have a case_chats row. Picks the most-recent
 * section in which the student is enrolled that has this case assigned.
 *
 * @param {string} studentId
 * @param {string} caseId
 * @returns {Promise<string|null>}
 */
export async function resolveInstructorForStudentCase(studentId, caseId) {
  if (!studentId || !caseId) return null;
  const [rows] = await pool.execute(
    `SELECT s.primary_instructor_id
       FROM student_sections ss
       JOIN sections s ON ss.section_id = s.section_id
       JOIN section_cases sc ON sc.section_id = s.section_id
      WHERE ss.student_id = ? AND sc.case_id = ?
      ORDER BY ss.is_primary DESC, ss.enrolled_at DESC
      LIMIT 1`,
    [studentId, caseId]
  );
  return rows[0]?.primary_instructor_id || null;
}

/**
 * Resolve the section_id for a student/case pair (same lookup logic as
 * resolveInstructorForStudentCase). Used to stamp section_id on model_usage
 * rows for student-facing LLM calls.
 *
 * @returns {Promise<string|null>}
 */
export async function resolveSectionForStudentCase(studentId, caseId) {
  if (!studentId || !caseId) return null;
  const [rows] = await pool.execute(
    `SELECT s.section_id
       FROM student_sections ss
       JOIN sections s ON ss.section_id = s.section_id
       JOIN section_cases sc ON sc.section_id = s.section_id
      WHERE ss.student_id = ? AND sc.case_id = ?
      ORDER BY ss.is_primary DESC, ss.enrolled_at DESC
      LIMIT 1`,
    [studentId, caseId]
  );
  return rows[0]?.section_id || null;
}

/**
 * Resolve the section_id for a given case_chat row.
 *
 * @returns {Promise<string|null>}
 */
export async function resolveSectionForCaseChat(caseChatId) {
  if (!caseChatId) return null;
  const [rows] = await pool.execute(
    'SELECT section_id FROM case_chats WHERE id = ? LIMIT 1',
    [caseChatId]
  );
  return rows[0]?.section_id || null;
}

/**
 * Lightweight readiness probe used by the student chat-start gate.
 * Returns true if `resolveProviderKey` would succeed for every required
 * provider. Never throws — callers want a boolean.
 *
 * @param {string} instructorId
 * @param {string[]} providers - e.g. ['openai', 'anthropic']
 */
export async function hasAllProviderKeys(instructorId, providers) {
  for (const p of providers) {
    try {
      await resolveProviderKey(p, instructorId);
    } catch (_) {
      return false;
    }
  }
  return true;
}

/**
 * Return the set of providers for which the given instructor has a usable key.
 * If instructorId is null/undefined, returns the set of providers backed by
 * env keys (legacy / pure-admin path).
 *
 * @param {string|null} instructorId
 * @returns {Promise<Set<string>>}
 */
export async function getAvailableProviders(instructorId) {
  const providers = ['openai', 'anthropic', 'google', 'openrouter'];
  const available = new Set();
  for (const p of providers) {
    try {
      await resolveProviderKey(p, instructorId || null);
      available.add(p);
    } catch (_) {
      // skip
    }
  }
  return available;
}

/**
 * Probe whether the primary instructor of a section has every provider key
 * the section will need (chat_model + super_model). Sections with no
 * primary_instructor_id (legacy data) are treated as ready and fall back to
 * the env key path. Used by the student chat-start endpoint.
 *
 * @param {string} sectionId
 * @returns {Promise<{ready: boolean, missing: string[], instructorId: string|null}>}
 */
export async function checkSectionReadiness(sectionId) {
  if (!sectionId) {
    return { ready: true, missing: [], instructorId: null };
  }
  const [rows] = await pool.execute(
    `SELECT s.primary_instructor_id, s.chat_model, s.super_model,
            mc.vendor AS chat_vendor, ms.vendor AS super_vendor
       FROM sections s
       LEFT JOIN models mc ON mc.model_id = s.chat_model
       LEFT JOIN models ms ON ms.model_id = s.super_model
      WHERE s.section_id = ?
      LIMIT 1`,
    [sectionId]
  );
  if (rows.length === 0) {
    return { ready: true, missing: [], instructorId: null };
  }
  const { primary_instructor_id, chat_vendor, super_vendor } = rows[0];
  if (!primary_instructor_id) {
    return { ready: true, missing: [], instructorId: null };
  }
  const providers = Array.from(new Set([chat_vendor, super_vendor].filter(Boolean)));
  const missing = [];
  for (const p of providers) {
    try {
      await resolveProviderKey(p, primary_instructor_id);
    } catch (_) {
      missing.push(p);
    }
  }
  return { ready: missing.length === 0, missing, instructorId: primary_instructor_id };
}
