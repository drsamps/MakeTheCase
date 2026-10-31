import express from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { generateToken, verifyToken } from '../middleware/auth.js';
import { writeAudit } from '../services/auditLog.js';
import { getSetting } from '../services/promptService.js';
import { isThrottled, recordFailure, clearFailures, THROTTLED_MESSAGE } from '../services/loginThrottle.js';
import { getPreviewStudent } from '../services/previewStudents.js';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

const INVALID_LOGIN = 'Invalid email or password';
const MIN_STUDENT_PASSWORD = 8;

function normEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function studentTokenFor(student, extra = {}) {
  return generateToken(student.id, student.email || null, 'student', {
    first_name: student.first_name,
    last_name: student.last_name,
    full_name: student.full_name,
    ...extra,
  });
}

async function selfRegisterEnabled() {
  const v = await getSetting('allow_student_self_register');
  return String(v ?? '').trim().toLowerCase() === 'true';
}

// POST /api/auth/login - Admin or Instructor login
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (isThrottled(req, email)) {
    return res.status(429).json({ error: THROTTLED_MESSAGE });
  }
  const fail = (status, message) => {
    recordFailure(req, email);
    return res.status(status).json({ error: message });
  };
  try {
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // First, check admins table (superusers and regular admins)
    const [adminRows] = await pool.execute(
      'SELECT id, email, password_hash, who, superuser, admin_access FROM admins WHERE email = ?',
      [email]
    );

    if (adminRows.length > 0) {
      const admin = adminRows[0];

      // Verify password
      const isValidPassword = await bcrypt.compare(password, admin.password_hash);
      if (!isValidPassword) {
        return fail(401, INVALID_LOGIN);
      }
      clearFailures(email);

      // Parse admin_access into array
      const adminAccess = admin.admin_access ? admin.admin_access.split(',').map(s => s.trim()) : [];

      // Generate JWT token with permissions
      const token = generateToken(admin.id, admin.email, 'admin', {
        superuser: Boolean(admin.superuser),
        adminAccess: adminAccess
      });

      // Audit successful admin login (best-effort; failures swallowed inside writeAudit)
      req.user = { id: admin.id, email: admin.email, role: 'admin' };
      writeAudit(req, { action: 'auth.login', details: { role: 'admin' } });

      return res.json({
        token,
        user: {
          id: admin.id,
          email: admin.email,
          who: admin.who,
          role: 'admin',
          superuser: Boolean(admin.superuser),
          adminAccess: adminAccess
        }
      });
    }

    // Second, check instructors table (primary instructors and TAs)
    const [instructorRows] = await pool.execute(
      'SELECT id, email, password_hash, first_name, last_name, full_name, active, auth_method FROM instructors WHERE email = ?',
      [email]
    );

    if (instructorRows.length > 0) {
      const instructor = instructorRows[0];

      // Check if account is active
      if (!instructor.active) {
        return res.status(401).json({ error: 'Account is disabled. Contact an administrator.' });
      }

      // CAS-only instructors must use the BYU NetID button, not email/password
      if (instructor.auth_method === 'cas' || !instructor.password_hash) {
        return res.status(403).json({ error: 'This account uses BYU CAS sign-in. Click "Sign in with BYU NetID" instead.' });
      }

      // Verify password
      const isValidPassword = await bcrypt.compare(password, instructor.password_hash);
      if (!isValidPassword) {
        return fail(401, INVALID_LOGIN);
      }
      clearFailures(email);

      // Update last_login timestamp
      await pool.execute(
        'UPDATE instructors SET last_login = NOW() WHERE id = ?',
        [instructor.id]
      );

      // Generate JWT token for instructor
      const token = generateToken(instructor.id, instructor.email, 'instructor', {
        firstName: instructor.first_name,
        lastName: instructor.last_name,
        fullName: instructor.full_name
      });

      req.user = { id: instructor.id, email: instructor.email, role: 'instructor' };
      writeAudit(req, { action: 'auth.login', details: { role: 'instructor' } });

      return res.json({
        token,
        user: {
          id: instructor.id,
          email: instructor.email,
          role: 'instructor',
          firstName: instructor.first_name,
          lastName: instructor.last_name,
          fullName: instructor.full_name
        }
      });
    }

    // No user found in either table
    return fail(401, INVALID_LOGIN);
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/auth/student-login - Email/password sign-in for students without a BYU NetID.
// Opened from the hidden form on the student page (Ctrl-click or long-press the NetID button).
router.post('/student-login', async (req, res) => {
  const email = normEmail(req.body?.email);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (isThrottled(req, email)) {
    return res.status(429).json({ error: THROTTLED_MESSAGE });
  }
  try {
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    const [rows] = await pool.execute(
      `SELECT id, email, first_name, last_name, full_name, password_hash
         FROM students
        WHERE email = ? AND password_hash IS NOT NULL AND preview_for IS NULL
        LIMIT 1`,
      [email]
    );
    const student = rows[0];
    const ok = student ? await bcrypt.compare(password, student.password_hash) : false;
    if (!ok) {
      recordFailure(req, email);
      return res.status(401).json({ error: INVALID_LOGIN });
    }
    clearFailures(email);

    const token = studentTokenFor(student);
    req.user = { id: student.id, email: student.email, role: 'student' };
    writeAudit(req, { action: 'auth.student_login', details: { method: 'password' } });
    return res.json({ token, user: { id: student.id, email: student.email, role: 'student', full_name: student.full_name } });
  } catch (error) {
    console.error('Student login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /api/auth/student-signup - Public: may students create their own email account?
router.get('/student-signup', async (req, res) => {
  try {
    res.json({ enabled: await selfRegisterEnabled() });
  } catch (error) {
    console.error('Student signup flag error:', error);
    res.json({ enabled: false });
  }
});

// POST /api/auth/student-register - A student without a BYU NetID creates an email account.
// Allowed only when the admin setting allow_student_self_register is 'true', and only into a
// section that has an enrollment key (a section without one could be joined by anyone).
router.post('/student-register', async (req, res) => {
  const b = req.body || {};
  const email = normEmail(b.email);
  if (isThrottled(req, email)) {
    return res.status(429).json({ error: THROTTLED_MESSAGE });
  }
  let conn = null; // taken only for the insert transaction
  try {
    if (!(await selfRegisterEnabled())) {
      return res.status(403).json({ error: 'Creating an account is not available. Ask your instructor to add you.' });
    }
    const first = typeof b.first_name === 'string' ? b.first_name.trim() : '';
    const last = typeof b.last_name === 'string' ? b.last_name.trim() : '';
    const password = typeof b.password === 'string' ? b.password : '';
    const sectionId = typeof b.section_id === 'string' ? b.section_id : '';
    const key = typeof b.enrollment_key === 'string' ? b.enrollment_key.trim() : '';

    if (!first || !last) return res.status(400).json({ error: 'First and last name are required.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }
    if (/@(.+\.)?byu\.edu$/.test(email)) {
      return res.status(403).json({ error: 'BYU students: please sign in with your BYU NetID instead.' });
    }
    if (password.length < MIN_STUDENT_PASSWORD) {
      return res.status(400).json({ error: `Password must be at least ${MIN_STUDENT_PASSWORD} characters.` });
    }
    if (!sectionId) return res.status(400).json({ error: 'Choose your course section.' });

    const [secRows] = await pool.execute(
      'SELECT section_id, enabled, accept_new_students, enrollment_key FROM sections WHERE section_id = ?',
      [sectionId]
    );
    const sec = secRows[0];
    if (!sec || !sec.enabled || !sec.accept_new_students) {
      return res.status(403).json({ error: 'That section is not accepting new students.' });
    }
    if (!sec.enrollment_key || key !== sec.enrollment_key) {
      recordFailure(req, email);
      return res.status(403).json({ error: 'The enrollment key is incorrect, or this section cannot be joined this way.' });
    }

    // email is a case-insensitive (_ci) column, so = matches any case and uses the unique index.
    const [dupe] = await pool.execute('SELECT id FROM students WHERE email = ? LIMIT 1', [email]);
    if (dupe.length) {
      return res.status(409).json({ error: 'An account with this email already exists. Sign in, or ask your instructor to reset your password.' });
    }

    const id = uuidv4();
    const fullName = `${first} ${last}`;
    const hash = await bcrypt.hash(password, 10);
    conn = await pool.getConnection();
    await conn.beginTransaction();
    await conn.execute(
      `INSERT INTO students (id, first_name, last_name, full_name, email, password_hash, section_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, first, last, fullName, email, hash, sectionId]
    );
    await conn.execute(
      'INSERT INTO student_sections (student_id, section_id, enrolled_by, is_primary) VALUES (?, ?, ?, 1)',
      [id, sectionId, 'self']
    );
    await conn.commit();

    const student = { id, email, first_name: first, last_name: last, full_name: fullName };
    const token = studentTokenFor(student);
    req.user = { id, email, role: 'student' };
    writeAudit(req, { action: 'auth.student_register', details: { section_id: sectionId } });
    return res.status(201).json({ token, user: { id, email, role: 'student', full_name: fullName } });
  } catch (error) {
    if (conn) { try { await conn.rollback(); } catch { /* not in a transaction */ } }
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'An account with this email already exists. Sign in, or ask your instructor to reset your password.' });
    }
    console.error('Student register error:', error);
    res.status(500).json({ error: 'Could not create the account.' });
  } finally {
    conn?.release();
  }
});

// POST /api/auth/student-view { fresh?: boolean } - Staff only.
// Returns a student token for the caller's own preview student (Dashboard > Student view).
// fresh=true deletes it first (with all its chats), so the caller starts as a new student.
router.post('/student-view', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'instructor') {
      return res.status(403).json({ error: 'Only instructors and admins can open Student view.' });
    }
    const fresh = req.body?.fresh === true;
    const student = await getPreviewStudent(req.user, { fresh });
    const token = studentTokenFor({ ...student, email: null }, { preview: true });
    writeAudit(req, { action: 'auth.student_view', details: { fresh, student_id: student.id } });
    res.json({ token, user: { id: student.id, role: 'student', full_name: student.full_name, preview: true } });
  } catch (error) {
    console.error('Student view error:', error);
    res.status(500).json({ error: 'Could not open Student view.' });
  }
});

// GET /api/auth/session - Check current session
// Instructors get can_publish + use_system_key here so the frontend
// VisibilityPicker can gate the Public option without an extra /me round-trip.
router.get('/session', verifyToken, async (req, res) => {
  const base = {
    id: req.user.id,
    email: req.user.email,
    role: req.user.role,
    first_name: req.user.first_name,
    last_name: req.user.last_name,
    full_name: req.user.full_name,
    section_id: req.user.section_id,
    superuser: req.user.superuser,
    adminAccess: req.user.adminAccess,
    preview: req.user.preview === true ? true : undefined,
  };

  if (req.user.role === 'admin') {
    return res.json({ user: { ...base, can_publish: true, use_system_key: true } });
  }

  if (req.user.role === 'instructor') {
    try {
      const [rows] = await pool.execute(
        'SELECT can_publish, use_system_key FROM instructors WHERE id = ? LIMIT 1',
        [req.user.id]
      );
      const r = rows[0] || {};
      return res.json({
        user: {
          ...base,
          can_publish: Boolean(r.can_publish),
          use_system_key: Boolean(r.use_system_key),
        },
      });
    } catch (err) {
      console.error('Error fetching instructor session flags:', err);
      // Fall through with conservative defaults rather than 500-ing the session.
      return res.json({ user: { ...base, can_publish: false, use_system_key: false } });
    }
  }

  res.json({ user: base });
});

// GET /api/auth/me - Caller's profile (role-aware). Includes can_publish for visibility UI.
router.get('/me', verifyToken, async (req, res) => {
  try {
    if (req.user.role === 'admin') {
      // Admins can always publish
      return res.json({
        data: {
          id: req.user.id,
          email: req.user.email,
          role: 'admin',
          superuser: Boolean(req.user.superuser),
          adminAccess: req.user.adminAccess || [],
          can_publish: true,
          use_system_key: true,
          effective_instructor_id: req.effectiveInstructorId || null,
        },
        error: null,
      });
    }

    if (req.user.role === 'instructor') {
      const [rows] = await pool.execute(
        'SELECT id, email, first_name, last_name, full_name, active, can_publish, use_system_key FROM instructors WHERE id = ?',
        [req.user.id]
      );
      if (rows.length === 0) {
        return res.status(404).json({ data: null, error: { message: 'Instructor not found' } });
      }
      const r = rows[0];
      return res.json({
        data: {
          id: r.id,
          email: r.email,
          role: 'instructor',
          first_name: r.first_name,
          last_name: r.last_name,
          full_name: r.full_name,
          can_publish: Boolean(r.can_publish),
          use_system_key: Boolean(r.use_system_key),
        },
        error: null,
      });
    }

    return res.json({
      data: { id: req.user.id, email: req.user.email, role: req.user.role, can_publish: false },
      error: null,
    });
  } catch (error) {
    console.error('Error fetching /me:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// POST /api/auth/refresh - Issue a fresh token for the same user, extending TTL.
// Reuses verifyToken so deactivated/invalid tokens are rejected.
router.post('/refresh', verifyToken, async (req, res) => {
  try {
    const u = req.user;
    if (!u || !u.id) {
      return res.status(401).json({ error: 'No session' });
    }
    const extra = { ...u };
    // jwt.sign rejects duplicate registered claims; strip them before re-signing.
    delete extra.iat;
    delete extra.exp;
    delete extra.nbf;
    delete extra.id;
    delete extra.email;
    delete extra.role;
    const token = generateToken(u.id, u.email, u.role, extra);
    res.json({ token });
  } catch (error) {
    console.error('Refresh error:', error);
    res.status(500).json({ error: 'Refresh failed' });
  }
});

// POST /api/auth/logout - Logout (client-side token removal)
router.post('/logout', (req, res) => {
  // JWT is stateless, so logout is handled client-side by removing the token
  res.json({ success: true });
});

export default router;

