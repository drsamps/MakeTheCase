/**
 * Admin > Backup: gzipped mysqldump snapshots kept on the server.
 * The rules that make this safe live in services/databaseBackup.js; see docs/database-backup.md.
 *
 *   GET    /api/admin/backups            list backups, newest first
 *   GET    /api/admin/backups/contents   tables a backup covers (estimated rows/bytes)
 *   POST   /api/admin/backups            take a backup now, then prune
 *   GET    /api/admin/backups/:name      download one (name must be a listed backup)
 *   DELETE /api/admin/backups/:name      delete one (same check)
 *
 * Admins with the `backups` permission only (superusers always). mysqldump's stderr is passed
 * through on failure: the person who can read it is the person who can fix it.
 */

import express from 'express';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { writeAudit } from '../services/auditLog.js';
import {
  BACKUP_DIR,
  BackupError,
  KEEP_BACKUPS,
  backupContents,
  createBackup,
  deleteBackup,
  listBackups,
  mysqldumpAvailable,
  resolveBackup,
} from '../services/databaseBackup.js';

const router = express.Router();

const adminAuth = [verifyToken, requireRole(['admin']), requirePermission('backups')];

function sendError(res, error, context) {
  if (error instanceof BackupError) {
    return res.status(error.status).json({ data: null, error: { message: error.message, code: error.code } });
  }
  console.error(context, error);
  return res.status(500).json({ data: null, error: { message: error.message } });
}

router.get('/', ...adminAuth, async (req, res) => {
  try {
    res.json({
      data: {
        backups: await listBackups(),
        keep: KEEP_BACKUPS,
        directory: BACKUP_DIR,
        mysqldump_available: await mysqldumpAvailable(),
      },
      error: null,
    });
  } catch (error) {
    sendError(res, error, 'Error listing backups:');
  }
});

// Defined before /:name so "contents" is never read as a filename (it could not match a
// listed backup anyway).
router.get('/contents', ...adminAuth, async (req, res) => {
  try {
    res.json({ data: await backupContents(), error: null });
  } catch (error) {
    sendError(res, error, 'Error reading backup contents:');
  }
});

router.post('/', ...adminAuth, async (req, res) => {
  try {
    const result = await createBackup({ userId: req.user.id });
    await writeAudit(req, {
      action: 'backup.create',
      resourceType: 'backup',
      resourceId: result.name,
      details: { bytes: result.bytes, pruned: result.pruned },
    });
    res.json({ data: result, error: null });
  } catch (error) {
    sendError(res, error, 'Error creating backup:');
  }
});

router.get('/:name', ...adminAuth, async (req, res) => {
  try {
    const target = await resolveBackup(req.params.name);
    if (!target) {
      return res.status(404).json({ data: null, error: { message: 'No such backup', code: 'not_found' } });
    }
    await writeAudit(req, { action: 'backup.download', resourceType: 'backup', resourceId: req.params.name });
    res.download(target, req.params.name, { headers: { 'Content-Type': 'application/gzip' } }, (err) => {
      if (err && !res.headersSent) sendError(res, err, 'Error sending backup:');
    });
  } catch (error) {
    sendError(res, error, 'Error downloading backup:');
  }
});

router.delete('/:name', ...adminAuth, async (req, res) => {
  try {
    const deleted = await deleteBackup(req.params.name);
    if (!deleted) {
      return res.status(404).json({ data: null, error: { message: 'No such backup', code: 'not_found' } });
    }
    await writeAudit(req, { action: 'backup.delete', resourceType: 'backup', resourceId: req.params.name });
    res.json({ data: { deleted: true, backups: await listBackups() }, error: null });
  } catch (error) {
    sendError(res, error, 'Error deleting backup:');
  }
});

export default router;
