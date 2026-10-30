/**
 * Activity types with `traits.personal` (LIKEN2ME): students write about their own lives, so
 * instructor views hide names BY DEFAULT and Issue Analytics stays off unless the instructor turns
 * it on for a run. An instructor may still reveal names (`?show_personal=1`, the "Show names"
 * checkbox) and read transcripts: this is a default that protects against shoulder-surfing and
 * bias, not an access rule, so the scoping of who can see a chat is unchanged.
 */

import crypto from 'node:crypto';
import { typeTraits } from './activityTypeStore.js';

export const isPersonalType = (activityType) => Boolean(typeTraits(activityType)?.personal);

/** A stable stand-in, so one student's rows can still be told apart. */
export const hiddenNameFor = (studentId) =>
  `Student ${crypto.createHash('sha256').update(String(studentId), 'utf8').digest('hex').slice(0, 6)}`;

/** A result row with the student's identity hidden. The student_id stays for actions on the row. */
export const hideStudentIdentity = (row) => ({
  ...row,
  student_name: hiddenNameFor(row.student_id),
  email: null,
  names_hidden: true,
});

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Transcript text with the student's name replaced: in the turn markers and wherever the AI or the
 * student used it. Best effort by design: a nickname or a family member's name stays.
 */
export function hideNameInTranscript(text, fullName, studentId) {
  if (!text || !fullName) return text;
  const label = hiddenNameFor(studentId);
  const names = [fullName, ...String(fullName).split(/\s+/)].map((n) => n.trim()).filter((n) => n.length >= 2);
  const unique = [...new Set(names)].sort((a, b) => b.length - a.length);
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${unique.map(escapeRe).join('|')})(?![\\p{L}\\p{N}])`, 'giu');
  return String(text).replace(re, () => label);
}
