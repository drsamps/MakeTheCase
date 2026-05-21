/**
 * Per-instructor API key management.
 *
 *   GET    /api/api-keys                    - list caller's keys (hint only)
 *   POST   /api/api-keys                    - add/replace a key for a provider
 *   DELETE /api/api-keys/:provider          - remove the caller's key
 *   PATCH  /api/api-keys/:provider/enabled  - toggle enabled flag
 *   POST   /api/api-keys/:provider/test     - server-side smoke test (best effort)
 *
 *   POST   /api/api-keys/admin/use-system-key/:instructorId  - admin-only:
 *          flip instructors.use_system_key
 *
 * Plaintext keys are NEVER returned to the client after creation. Reads
 * surface only the `key_hint` (last 4 chars) and bookkeeping fields. We do
 * not even include the encrypted blob — there's no client use case for it.
 */
import express from 'express';
import { pool } from '../db.js';
import { verifyToken } from '../middleware/auth.js';
import { requireAdminOrInstructor, requireSuperuser } from '../middleware/instructorAccess.js';
import { encryptKey, keyHint } from '../services/encryption.js';
import { writeAudit } from '../services/auditLog.js';

const router = express.Router();

const ALLOWED_PROVIDERS = ['openai', 'anthropic', 'google', 'openrouter'];

// Returns the instructor's allowed_vendors as an array, or null if unrestricted.
async function getAllowedVendors(instructorId) {
  const [rows] = await pool.execute(
    'SELECT allowed_vendors FROM instructors WHERE id = ? LIMIT 1',
    [instructorId]
  );
  const av = rows[0]?.allowed_vendors;
  if (av == null) return null;
  try { return typeof av === 'object' ? av : JSON.parse(av); } catch (_) { return null; }
}

function callerInstructorId(req) {
  // Admin acting as themselves doesn't own keys directly; they manage them via
  // impersonation (X-Act-As-Instructor) which sets req.effectiveInstructorId.
  if (req.user?.role === 'instructor') return req.user.id;
  if (req.user?.role === 'admin' && req.effectiveInstructorId) {
    return req.effectiveInstructorId;
  }
  return null;
}

// ============================================================
// GET /  - list caller's keys (hint + metadata only)
// ============================================================

router.get('/', verifyToken, requireAdminOrInstructor, async (req, res) => {
  const instructorId = callerInstructorId(req);
  if (!instructorId) {
    return res.status(400).json({
      error: 'No instructor identity. Admins must impersonate an instructor to view their keys.'
    });
  }
  try {
    const [rows] = await pool.execute(
      `SELECT provider, key_hint, enabled, last_validated_at, last_validation_error,
              created_at, updated_at
       FROM instructor_api_keys
       WHERE instructor_id = ?
       ORDER BY provider`,
      [instructorId]
    );
    const [iRows] = await pool.execute(
      'SELECT use_system_key, allowed_vendors FROM instructors WHERE id = ? LIMIT 1',
      [instructorId]
    );
    let allowedVendors = null;
    const av = iRows[0]?.allowed_vendors;
    if (av != null) {
      try { allowedVendors = typeof av === 'object' ? av : JSON.parse(av); } catch (_) { allowedVendors = null; }
    }
    res.json({
      data: {
        instructorId,
        useSystemKey: iRows[0]?.use_system_key === 1,
        allowedVendors,
        keys: rows
      },
      error: null
    });
  } catch (err) {
    console.error('[apiKeys/list]', err);
    res.status(500).json({ error: 'Failed to load keys' });
  }
});

// ============================================================
// POST /  - add or replace a key
// ============================================================

router.post('/', verifyToken, requireAdminOrInstructor, async (req, res) => {
  const instructorId = callerInstructorId(req);
  if (!instructorId) {
    return res.status(400).json({ error: 'No instructor identity' });
  }
  const { provider, apiKey } = req.body || {};
  if (!ALLOWED_PROVIDERS.includes(provider)) {
    return res.status(400).json({ error: `provider must be one of: ${ALLOWED_PROVIDERS.join(', ')}` });
  }
  if (typeof apiKey !== 'string' || apiKey.trim().length < 8) {
    return res.status(400).json({ error: 'apiKey is required and must be a non-trivial string' });
  }

  try {
    const allowedVendors = await getAllowedVendors(instructorId);
    if (Array.isArray(allowedVendors) && !allowedVendors.includes(provider)) {
      return res.status(403).json({
        error: `Your account is not permitted to store a key for "${provider}". Allowed vendors: ${allowedVendors.join(', ')}.`
      });
    }

    const blob = encryptKey(apiKey.trim());
    const hint = keyHint(apiKey.trim());

    // Upsert: UNIQUE(instructor_id, provider) — re-uploading overwrites.
    await pool.execute(
      `INSERT INTO instructor_api_keys
         (instructor_id, provider, api_key_encrypted, key_hint, enabled)
       VALUES (?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         api_key_encrypted = VALUES(api_key_encrypted),
         key_hint = VALUES(key_hint),
         enabled = 1,
         last_validated_at = NULL,
         last_validation_error = NULL`,
      [instructorId, provider, blob, hint]
    );

    await writeAudit(req, {
      action: 'apikey.set',
      resourceType: 'instructor_api_key',
      resourceId: `${instructorId}:${provider}`,
      details: { provider, hint }
    });

    res.json({ ok: true, provider, key_hint: hint });
  } catch (err) {
    console.error('[apiKeys/set]', err);
    if (err.message?.includes('MTC_KEY_ENCRYPTION_SECRET')) {
      return res.status(500).json({ error: 'Server encryption secret is not configured' });
    }
    res.status(500).json({ error: 'Failed to store key' });
  }
});

// ============================================================
// DELETE /:provider
// ============================================================

router.delete('/:provider', verifyToken, requireAdminOrInstructor, async (req, res) => {
  const instructorId = callerInstructorId(req);
  if (!instructorId) {
    return res.status(400).json({ error: 'No instructor identity' });
  }
  const provider = req.params.provider;
  if (!ALLOWED_PROVIDERS.includes(provider)) {
    return res.status(400).json({ error: 'Unknown provider' });
  }
  try {
    const [r] = await pool.execute(
      'DELETE FROM instructor_api_keys WHERE instructor_id = ? AND provider = ?',
      [instructorId, provider]
    );
    await writeAudit(req, {
      action: 'apikey.delete',
      resourceType: 'instructor_api_key',
      resourceId: `${instructorId}:${provider}`
    });
    res.json({ ok: true, deleted: r.affectedRows });
  } catch (err) {
    console.error('[apiKeys/delete]', err);
    res.status(500).json({ error: 'Failed to delete key' });
  }
});

// ============================================================
// PATCH /:provider/enabled
// ============================================================

router.patch('/:provider/enabled', verifyToken, requireAdminOrInstructor, async (req, res) => {
  const instructorId = callerInstructorId(req);
  if (!instructorId) {
    return res.status(400).json({ error: 'No instructor identity' });
  }
  const provider = req.params.provider;
  if (!ALLOWED_PROVIDERS.includes(provider)) {
    return res.status(400).json({ error: 'Unknown provider' });
  }
  const enabled = req.body?.enabled ? 1 : 0;
  try {
    if (enabled === 1) {
      const allowedVendors = await getAllowedVendors(instructorId);
      if (Array.isArray(allowedVendors) && !allowedVendors.includes(provider)) {
        return res.status(403).json({
          error: `Your account is not permitted to enable "${provider}". Allowed vendors: ${allowedVendors.join(', ')}.`
        });
      }
    }
    await pool.execute(
      'UPDATE instructor_api_keys SET enabled = ? WHERE instructor_id = ? AND provider = ?',
      [enabled, instructorId, provider]
    );
    res.json({ ok: true, enabled: enabled === 1 });
  } catch (err) {
    console.error('[apiKeys/toggle]', err);
    res.status(500).json({ error: 'Failed to toggle key' });
  }
});

// ============================================================
// POST /admin/use-system-key/:instructorId
// ============================================================
//
// Superuser grants or revokes the instructor's permission to fall back to the
// shared env key. This is the "use system key" toggle from the admin UI.

router.post('/admin/use-system-key/:instructorId', verifyToken, requireSuperuser, async (req, res) => {
  const { instructorId } = req.params;
  const enable = !!req.body?.enable;
  try {
    const [r] = await pool.execute(
      'UPDATE instructors SET use_system_key = ? WHERE id = ? AND is_system_account = 0',
      [enable ? 1 : 0, instructorId]
    );
    if (r.affectedRows === 0) {
      return res.status(404).json({ error: 'Instructor not found (or is a system account)' });
    }
    await writeAudit(req, {
      action: 'instructor.use_system_key',
      resourceType: 'instructor',
      resourceId: instructorId,
      details: { enable }
    });
    res.json({ ok: true, instructorId, useSystemKey: enable });
  } catch (err) {
    console.error('[apiKeys/use-system-key]', err);
    res.status(500).json({ error: 'Failed to update flag' });
  }
});

export default router;
