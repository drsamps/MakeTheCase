import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { pool } from '../db.js';

dotenv.config({ path: '.env.local' });

const JWT_SECRET = process.env.JWT_SECRET || 'default-secret-change-me';

// Small TTL cache so we don't run a SELECT on every authenticated request
// just to confirm the instructor is still active.
const ACTIVE_CACHE_MS = 15_000;
const activeCache = new Map(); // id -> { active: boolean, until: number }

async function isInstructorActive(id) {
  const now = Date.now();
  const hit = activeCache.get(id);
  if (hit && hit.until > now) return hit.active;
  try {
    const [rows] = await pool.execute(
      'SELECT active FROM instructors WHERE id = ? LIMIT 1',
      [id]
    );
    const active = rows.length > 0 && rows[0].active === 1;
    activeCache.set(id, { active, until: now + ACTIVE_CACHE_MS });
    return active;
  } catch (_) {
    return true;
  }
}

export const AUTH_TOKEN_TTL = '12h';

export function generateToken(id, email, role = 'admin', extra = {}) {
  return jwt.sign(
    { id, email, role, ...extra },
    JWT_SECRET,
    { expiresIn: AUTH_TOKEN_TTL }
  );
}

export async function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // Reject tokens belonging to deactivated instructors. Cached briefly so
  // this isn't a per-request DB hit.
  if (decoded.role === 'instructor' && decoded.id) {
    const active = await isInstructorActive(decoded.id);
    if (!active) {
      return res.status(401).json({ error: 'Account deactivated', code: 'INSTRUCTOR_DEACTIVATED' });
    }
  }

  req.user = decoded;
  req.admin = decoded; // backward compatibility

  // Admin impersonation: admins may scope a request to a specific
  // instructor via the X-Act-As-Instructor header (or the actAs claim
  // baked into a short-lived impersonation JWT).
  if (decoded.role === 'admin') {
    const headerActAs = req.headers['x-act-as-instructor'];
    const tokenActAs = decoded.actAs;
    const actAs = tokenActAs || headerActAs;
    if (actAs && typeof actAs === 'string') {
      req.effectiveInstructorId = actAs;
    }
  }

  next();
}

export function requireRole(roles = []) {
  const allowed = Array.isArray(roles) ? roles : [roles];
  return (req, res, next) => {
    if (!req.user || (allowed.length && !allowed.includes(req.user.role))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

