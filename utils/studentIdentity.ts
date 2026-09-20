/**
 * Student identifier helpers shared by the dashboard.
 *
 * There is no `login_id` column on `students`. A student authenticates one of
 * two ways, and each leaves a different trace:
 *   - CAS: `server/routes/cas.js` mints the primary key as `cas:{netid}`, so the
 *     net id is encoded in `students.id` and nowhere else.
 *   - Self-registration: `students.email` + `password_hash`, with a UUID id.
 * So "the student's login id" is the net id for the first group and the email
 * for the second, and a report that needs to cover everyone wants both columns.
 */

/**
 * The bare net id behind a `cas:{netid}` primary key, with the `cas:` prefix
 * stripped: `cas:abc234` -> `abc234`. Returns '' for a self-registered student
 * (a UUID id), whose login is their email instead.
 *
 * The prefix must never reach an exported Net ID cell -- this value is what an
 * instructor pastes into an LMS gradebook to join on. Mirrors the derivation in
 * server/routes/students.js (the /lookup route) and components/StudentManager.tsx.
 */
export function netIdFromStudentId(id: string | null | undefined): string {
  return typeof id === 'string' && id.startsWith('cas:') ? id.slice(4) : '';
}
