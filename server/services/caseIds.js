/**
 * Minting `cases.case_id` (VARCHAR(30), lowercase letters, digits and hyphens).
 *
 * Shared by the two places that create a case without an instructor typing its id: Case Writer
 * publish (server/routes/caseWriter.js) and installing an activity package
 * (server/services/activityPack/import.js).
 */

import { pool } from '../db.js';

export const CASE_ID_MAX_LENGTH = 30;

/** A title as a case id stem: at most 24 characters, leaving room for a "-2" style suffix. */
export function slugifyTitle(title) {
  return String(title || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'case';
}

/**
 * `baseSlug` if no case has it, else the first free `baseSlug-2`, `-3`, ...
 * The stem is shortened where needed so the suffix always fits: copying a case or installing
 * one passes a full case id (up to 30 characters) as `baseSlug`, and cutting the suffix off
 * instead would make every candidate equal the original.
 * `alsoTaken` holds ids promised earlier in the same operation (several activities installed
 * from one package) that are not in the table yet.
 */
export async function generateUniqueCaseId(baseSlug, { executor = pool, alsoTaken = [] } = {}) {
  const withSuffix = (i) => {
    const suffix = `-${i}`;
    return baseSlug.slice(0, CASE_ID_MAX_LENGTH - suffix.length).replace(/-+$/, '') + suffix;
  };
  // Every candidate starts with this ("-999" is the longest suffix tried).
  const prefix = baseSlug.slice(0, CASE_ID_MAX_LENGTH - 4).replace(/-+$/, '');
  const [existing] = await executor.execute(
    'SELECT case_id FROM cases WHERE case_id = ? OR case_id LIKE ?',
    [baseSlug, `${prefix.replace(/[\\%_]/g, '\\$&')}%`]
  );
  const taken = new Set([...existing.map(r => r.case_id), ...alsoTaken]);
  if (!taken.has(baseSlug)) return baseSlug;
  for (let i = 2; i < 1000; i++) {
    const candidate = withSuffix(i);
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(`Could not generate a unique case_id from base '${baseSlug}'`);
}
