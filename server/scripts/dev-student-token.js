/**
 * DEV ONLY: print a sign-in link for an existing student, so the student chat screen can be
 * tested locally without a CAS round trip (the chat routes require a student token).
 * Usage: node server/scripts/dev-student-token.js <student id, e.g. cas:netid>
 *
 * Refuses to run when NODE_ENV is production or CAS redirects to a host other than localhost
 * (production's .env.local sets both). CAS_ENABLED is no guide: dev can have CAS on too.
 * The link uses the same ?token=…&role=student parameters as the CAS callback
 * (services/apiClient.ts applyCasCallbackFromUrl). The token lasts AUTH_TOKEN_TTL (12h).
 */

import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const casRedirect = process.env.CAS_REDIRECT_BASE_URL || '';
const casIsLocal = !casRedirect || /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(casRedirect.trim());
if (process.env.NODE_ENV === 'production' || !casIsLocal) {
  console.error('Refusing to run: dev-student-token is for local development only (NODE_ENV=production or CAS_REDIRECT_BASE_URL is not localhost).');
  process.exit(1);
}

const { pool } = await import('../db.js');
const { generateToken } = await import('../middleware/auth.js');

const studentId = process.argv[2];
if (!studentId) {
  console.log('Usage: node server/scripts/dev-student-token.js <student id, e.g. cas:netid>');
  process.exit(1);
}

try {
  const [rows] = await pool.execute(
    'SELECT id, first_name, last_name, full_name, email FROM students WHERE id = ?',
    [studentId]
  );
  if (rows.length === 0) {
    console.error(`No student with id "${studentId}".`);
    process.exit(1);
  }
  const s = rows[0];
  const token = generateToken(s.id, s.email, 'student', {
    first_name: s.first_name,
    last_name: s.last_name,
    full_name: s.full_name,
  });
  const params = new URLSearchParams({ token, role: 'student', fullName: s.full_name || '', email: s.email || '' });
  console.log(`http://localhost:3000/?${params.toString()}`);
} finally {
  await pool.end();
}
