import express from 'express';
import { pool } from '../db.js';
import { generateToken } from '../middleware/auth.js';

const router = express.Router();

const casServerUrl = (() => {
  const raw = process.env.CAS_SERVER_URL || 'https://cas.byu.edu/cas';
  return raw.endsWith('/') ? raw : `${raw}/`;
})();

function getServiceBase() {
  const base = process.env.CAS_SERVICE_BASE_URL || 'http://localhost:3001';
  return base.endsWith('/') ? base.slice(0, -1) : base;
}

function getRedirectBase() {
  // Use explicit CAS_REDIRECT_BASE_URL if set and not a localhost URL in production
  if (process.env.CAS_REDIRECT_BASE_URL) {
    const base = process.env.CAS_REDIRECT_BASE_URL;
    // In production (when CAS_SERVICE_BASE_URL is not localhost), ignore localhost redirect URLs
    const serviceBase = process.env.CAS_SERVICE_BASE_URL || '';
    const isProductionService = serviceBase && !serviceBase.includes('localhost');
    const isLocalhostRedirect = base.includes('localhost');
    
    if (!(isProductionService && isLocalhostRedirect)) {
      return base.endsWith('/') ? base.slice(0, -1) : base;
    }
    // Fall through to use CAS_SERVICE_BASE_URL if we're in production but redirect is localhost
  }
  
  // Default: use CAS_SERVICE_BASE_URL (API and frontend share same base in production)
  return getServiceBase();
}

function buildServiceUrl(roleParam) {
  const base = `${getServiceBase()}/api/cas/verify`;
  if (roleParam) {
    return `${base}?role=${encodeURIComponent(roleParam)}`;
  }
  return base;
}

function parseCasResponse(xml) {
  if (xml.includes('authenticationFailure')) {
    return { success: false, error: 'CAS authentication failed' };
  }

  const userMatch = xml.match(/<cas:user>([^<]+)<\/cas:user>/);
  const user = userMatch ? userMatch[1] : null;
  if (!user) return { success: false, error: 'Missing CAS user' };

  const attributes = {};
  const attrBlock = xml.match(/<cas:attributes>([\s\S]*?)<\/cas:attributes>/);
  if (attrBlock) {
    const attrRegex = /<cas:([A-Za-z0-9_]+)>([^<]+)<\/cas:\1>/g;
    let m;
    while ((m = attrRegex.exec(attrBlock[1])) !== null) {
      attributes[m[1]] = m[2];
    }
  }

  return { success: true, user, attributes };
}

async function validateTicket(ticket, serviceUrl) {
  const url = `${casServerUrl}p3/serviceValidate?service=${encodeURIComponent(serviceUrl)}&ticket=${encodeURIComponent(ticket)}`;
  const resp = await fetch(url);
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`CAS validation failed: ${resp.status}`);
  }
  return parseCasResponse(text);
}

function callbackRedirect(res, payload) {
  const base = getRedirectBase();
  const params = new URLSearchParams({
    token: payload.token,
    role: payload.role,
  });
  if (payload.fullName) params.append('fullName', payload.fullName);
  if (payload.email) params.append('email', payload.email);
  res.redirect(`${base}/?${params.toString()}`);
}

// GET /api/cas/login -> redirect to CAS
router.get('/login', (req, res) => {
  if (process.env.CAS_ENABLED !== 'true') {
    return res.status(400).json({ error: 'CAS is disabled' });
  }

  const requestedRole = req.query.role === 'student' ? 'student' : undefined;
  const serviceUrl = buildServiceUrl(requestedRole);
  const loginUrl = `${casServerUrl}login?service=${encodeURIComponent(serviceUrl)}`;
  res.redirect(loginUrl);
});

// GET /api/cas/verify -> CAS callback
router.get('/verify', async (req, res) => {
  if (process.env.CAS_ENABLED !== 'true') {
    return res.status(400).json({ error: 'CAS is disabled' });
  }

  const { ticket } = req.query;
  const requestedRole = req.query.role === 'student' ? 'student' : undefined;
  if (!ticket) {
    return res.status(400).json({ error: 'Missing CAS ticket' });
  }

  try {
    const serviceUrl = buildServiceUrl(requestedRole);
    const result = await validateTicket(ticket, serviceUrl);
    if (!result.success) {
      return res.status(401).json({ error: result.error });
    }

    const attrs = result.attributes || {};
    const netidField = process.env.CAS_ATTR_NETID_FIELD || 'user';
    const emailField = process.env.CAS_ATTR_EMAIL_FIELD || 'emailAddress';
    const preferredFirstField = process.env.CAS_ATTR_PREFERRED_FIRST_FIELD || 'preferredFirstName';
    const preferredLastField = process.env.CAS_ATTR_PREFERRED_LAST_FIELD || 'preferredSurname';
    const firstField = process.env.CAS_ATTR_FIRSTNAME_FIELD || 'givenName';
    const lastField = process.env.CAS_ATTR_LASTNAME_FIELD || 'sn';

    const netid = attrs[netidField] || result.user;
    const email = attrs[emailField] || `${netid}@byu.edu`;
    const firstName =
      attrs[preferredFirstField] ||
      attrs[firstField] ||
      netid;
    const lastName =
      attrs[preferredLastField] ||
      attrs[lastField] ||
      '';
    const fullName = `${firstName}${lastName ? ' ' + lastName : ''}`;

    // Check admin first
    const [admins] = await pool.execute('SELECT id, email, superuser, admin_access FROM admins WHERE email = ?', [email]);
    if (admins.length > 0 && requestedRole !== 'student') {
      const admin = admins[0];
      // Parse admin_access into array
      const adminAccess = admin.admin_access ? admin.admin_access.split(',').map(s => s.trim()) : [];
      // Generate JWT token with permissions
      const token = generateToken(admin.id, admin.email, 'admin', {
        superuser: Boolean(admin.superuser),
        adminAccess: adminAccess
      });
      const payload = { token, role: 'admin', email: admin.email, fullName };
      if ((req.headers.accept || '').includes('application/json')) {
        return res.json(payload);
      }
      return callbackRedirect(res, payload);
    }

    // Student path: ensure record exists (id anchored to CAS netid)
    const studentId = `cas:${netid}`;
    const [students] = await pool.execute(
      'SELECT id, full_name, section_id, favorite_persona FROM students WHERE id = ?',
      [studentId]
    );

    if (students.length === 0) {
      await pool.execute(
        'INSERT INTO students (id, first_name, last_name, full_name, email, favorite_persona, section_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [studentId, firstName, lastName, fullName || netid, email, null, null]
      );
    } else {
      // Update existing student record with latest info from CAS
      await pool.execute(
        'UPDATE students SET first_name = ?, last_name = ?, full_name = ?, email = ? WHERE id = ?',
        [firstName, lastName, fullName || netid, email, studentId]
      );
    }

    const token = generateToken(studentId, email, 'student', {
      first_name: firstName,
      last_name: lastName,
      full_name: fullName || netid,
    });

    const payload = {
      token,
      role: 'student',
      email,
      fullName: fullName || netid,
    };

    if ((req.headers.accept || '').includes('application/json')) {
      return res.json(payload);
    }
    return callbackRedirect(res, payload);
  } catch (err) {
    console.error('CAS verify error:', err);
    return res.status(500).json({ error: err.message || 'CAS verification failed' });
  }
});

// POST /api/cas/logout -> client can redirect to CAS logout
router.post('/logout', (req, res) => {
  const logoutUrl = `${casServerUrl}logout`;
  res.json({ success: true, logoutUrl });
});

export default router;

