import express from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db.js';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';

const router = express.Router();

// GET /api/admins - List all admins (superuser only)
router.get('/', verifyToken, requireRole(['admin']), requirePermission('instructors'), async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, who, email, superuser, admin_access FROM admins ORDER BY who ASC'
    );

    // Parse admin_access into arrays for frontend
    const admins = rows.map(admin => ({
      ...admin,
      superuser: Boolean(admin.superuser),
      admin_access: admin.admin_access ? admin.admin_access.split(',').map(s => s.trim()) : []
    }));

    res.json({ data: admins, error: null });
  } catch (error) {
    console.error('Error fetching admins:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// POST /api/admins - Create new instructor (superuser only)
router.post('/', verifyToken, requireRole(['admin']), requirePermission('instructors'), async (req, res) => {
  try {
    const { email, password, who, superuser, admin_access } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Check if email already exists
    const [existing] = await pool.execute(
      'SELECT id FROM admins WHERE email = ?',
      [email]
    );

    if (existing.length > 0) {
      return res.status(409).json({ error: 'An admin with this email already exists' });
    }

    const id = uuidv4();
    const passwordHash = await bcrypt.hash(password, 10);
    const adminAccessStr = Array.isArray(admin_access) ? admin_access.join(',') : (admin_access || null);

    await pool.execute(
      'INSERT INTO admins (id, email, password_hash, who, superuser, admin_access) VALUES (?, ?, ?, ?, ?, ?)',
      [id, email, passwordHash, who || email, superuser ? 1 : 0, adminAccessStr]
    );

    res.json({
      data: {
        id,
        email,
        who: who || email,
        superuser: Boolean(superuser),
        admin_access: Array.isArray(admin_access) ? admin_access : []
      },
      error: null
    });
  } catch (error) {
    console.error('Error creating admin:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PATCH /api/admins/:id - Update instructor (superuser only)
router.patch('/:id', verifyToken, requireRole(['admin']), requirePermission('instructors'), async (req, res) => {
  try {
    const { id } = req.params;
    const { email, password, who, superuser, admin_access } = req.body;

    // Prevent self-demotion from superuser
    if (req.user.id === id && superuser === false) {
      return res.status(400).json({ error: 'Cannot remove your own superuser status' });
    }

    const updates = [];
    const values = [];

    if (email !== undefined) {
      updates.push('email = ?');
      values.push(email);
    }
    if (password) {
      const passwordHash = await bcrypt.hash(password, 10);
      updates.push('password_hash = ?');
      values.push(passwordHash);
    }
    if (who !== undefined) {
      updates.push('who = ?');
      values.push(who);
    }
    if (superuser !== undefined) {
      updates.push('superuser = ?');
      values.push(superuser ? 1 : 0);
    }
    if (admin_access !== undefined) {
      const adminAccessStr = Array.isArray(admin_access) ? admin_access.join(',') : (admin_access || null);
      updates.push('admin_access = ?');
      values.push(adminAccessStr);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(id);
    await pool.execute(
      `UPDATE admins SET ${updates.join(', ')} WHERE id = ?`,
      values
    );

    // Fetch updated record
    const [rows] = await pool.execute(
      'SELECT id, who, email, superuser, admin_access FROM admins WHERE id = ?',
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Admin not found' });
    }

    const admin = rows[0];
    res.json({
      data: {
        ...admin,
        superuser: Boolean(admin.superuser),
        admin_access: admin.admin_access ? admin.admin_access.split(',').map(s => s.trim()) : []
      },
      error: null
    });
  } catch (error) {
    console.error('Error updating admin:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// DELETE /api/admins/:id - Delete instructor (superuser only)
router.delete('/:id', verifyToken, requireRole(['admin']), requirePermission('instructors'), async (req, res) => {
  try {
    const { id } = req.params;

    // Prevent self-deletion
    if (req.user.id === id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    const [result] = await pool.execute(
      'DELETE FROM admins WHERE id = ?',
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Admin not found' });
    }

    res.json({ data: { success: true }, error: null });
  } catch (error) {
    console.error('Error deleting admin:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

export default router;
