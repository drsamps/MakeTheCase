import express from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { generateToken, verifyToken } from '../middleware/auth.js';

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
router.get('/session', verifyToken, (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      role: req.user.role,
      first_name: req.user.first_name,
      last_name: req.user.last_name,
      full_name: req.user.full_name,
      section_id: req.user.section_id,
      superuser: req.user.superuser,
      adminAccess: req.user.adminAccess,
    }
  });
});

// POST /api/auth/logout - Logout (client-side token removal)
router.post('/logout', (req, res) => {
  // JWT is stateless, so logout is handled client-side by removing the token
  res.json({ success: true });
});

export default router;

