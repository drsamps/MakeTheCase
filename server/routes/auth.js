import express from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { generateToken, verifyToken } from '../middleware/auth.js';
import { writeAudit } from '../services/auditLog.js';

const router = express.Router();

// POST /api/auth/login - Admin or Instructor login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

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
        return res.status(401).json({ error: 'Invalid email or password' });
      }

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
      'SELECT id, email, password_hash, first_name, last_name, full_name, active FROM instructors WHERE email = ?',
      [email]
    );

    if (instructorRows.length > 0) {
      const instructor = instructorRows[0];

      // Check if account is active
      if (!instructor.active) {
        return res.status(401).json({ error: 'Account is disabled. Contact an administrator.' });
      }

      // Verify password
      const isValidPassword = await bcrypt.compare(password, instructor.password_hash);
      if (!isValidPassword) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

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
    return res.status(401).json({ error: 'Invalid email or password' });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
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

