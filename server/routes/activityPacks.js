/**
 * Activity packages: download cases as a ZIP and install them on another MakeTheCase server.
 * The rules that make this safe are in services/activityPack/index.js; see
 * docs/activity-packages.md.
 *
 *   GET  /api/activity-packs/export-options?case_ids=a,b   what the download dialog shows
 *   POST /api/activity-packs/export                        build and download a package
 *   POST /api/activity-packs/inspect                       upload a package, get the plan (writes nothing)
 *   POST /api/activity-packs/install                       upload it again with the confirmed plan_hash
 *   GET  /api/version                                      (mounted in index.js) this server's version
 *
 * Any instructor or admin. Download needs view access to each case; an installed activity is
 * private to the installer and is never assigned or made active.
 *
 * inspect and install are multipart: `file` is the package, `options` is a JSON string
 * ({ activities, personas, add_to_course_id, plan_hash }). The package is held in memory, so
 * the upload limit is the package size limit.
 */

import express from 'express';
import multer from 'multer';
import { verifyToken } from '../middleware/auth.js';
import { requireAdminOrInstructor } from '../middleware/instructorAccess.js';
import { writeAudit } from '../services/auditLog.js';
import { getAppVersion, getSchemaLevel } from '../services/appVersion.js';
import {
  LIMITS,
  PACK_FORMAT,
  PackError,
  SUPPORTED_FORMAT_VERSIONS,
  buildPackFile,
  exportOptions,
  inspectPackFile,
  installPackFile,
  serverCapabilities,
} from '../services/activityPack/index.js';

const router = express.Router();
const staff = [verifyToken, requireAdminOrInstructor];

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: LIMITS.packBytes, files: 1 } });

function sendError(res, error, context) {
  if (error instanceof PackError) {
    return res.status(error.status).json({ data: null, error: { message: error.message, code: error.code, details: error.details } });
  }
  console.error(context, error);
  return res.status(500).json({ data: null, error: { message: error.message } });
}

/** Take the uploaded package and the JSON `options` field off a multipart request. */
function receivePack(req, res) {
  return new Promise((resolve) => {
    upload.single('file')(req, res, (err) => {
      if (err) {
        const tooLarge = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE';
        res.status(tooLarge ? 413 : 400).json({
          data: null,
          error: { message: tooLarge ? `The package is over the ${LIMITS.packBytes / (1024 * 1024)} MB limit.` : (err.message || 'Upload failed') },
        });
        return resolve(null);
      }
      if (!req.file?.buffer) {
        res.status(400).json({ data: null, error: { message: 'Choose a package file to upload.' } });
        return resolve(null);
      }
      let options = {};
      if (typeof req.body?.options === 'string' && req.body.options.trim()) {
        try {
          options = JSON.parse(req.body.options);
        } catch {
          res.status(400).json({ data: null, error: { message: 'The install options are not valid JSON.' } });
          return resolve(null);
        }
      }
      if (!options || typeof options !== 'object' || Array.isArray(options)) options = {};
      // Only these come from the browser. `internal`, `origin` and `titles` are for same-server copies.
      const { activities, personas, add_to_course_id, plan_hash } = options;
      resolve({ buffer: req.file.buffer, options: { activities, personas, add_to_course_id, plan_hash } });
    });
  });
}

// GET /api/activity-packs/export-options?case_ids=a,b
router.get('/export-options', ...staff, async (req, res) => {
  try {
    const caseIds = String(req.query.case_ids || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, LIMITS.activities);
    res.json({ data: await exportOptions(req, caseIds), error: null });
  } catch (error) {
    sendError(res, error, 'Error reading activity package options:');
  }
});

// POST /api/activity-packs/export
// Body: { items: [{ case_id, settings: { source: 'defaults'|'version'|'section'|'none', id? } }],
//         include_originals?, include_proprietary?, note? }
router.post('/export', ...staff, async (req, res) => {
  try {
    const { items, include_originals, include_proprietary, note } = req.body || {};
    const { buffer, filename, pack } = await buildPackFile(req, {
      items,
      includeOriginals: include_originals === true,
      includeProprietary: include_proprietary === true,
      note,
    });
    await writeAudit(req, {
      action: 'activity_pack.export',
      resourceType: 'case',
      resourceId: pack.activities.length === 1 ? pack.activities[0].suggested_id : null,
      details: {
        cases: (items || []).map((i) => i.case_id),
        include_originals: include_originals === true,
        include_proprietary: include_proprietary === true,
        bytes: buffer.length,
      },
    });
    // What was left out, for the dialog to show once the file has been saved. A header has a
    // size limit, so long lists are sent as counts (the package itself always has them all).
    const { omitted, warnings } = pack.manifest;
    let summary = encodeURIComponent(JSON.stringify({ omitted, warnings }));
    if (summary.length > 6000) {
      summary = encodeURIComponent(JSON.stringify({ omitted_count: omitted.length, warnings_count: warnings.length }));
    }
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Activity-Pack-Summary', summary);
    res.send(buffer);
  } catch (error) {
    sendError(res, error, 'Error building activity package:');
  }
});

// POST /api/activity-packs/inspect - multipart { file, options? }. Writes nothing.
router.post('/inspect', ...staff, async (req, res) => {
  const received = await receivePack(req, res);
  if (!received) return;
  try {
    res.json({ data: await inspectPackFile(req, received.buffer, received.options), error: null });
  } catch (error) {
    sendError(res, error, 'Error inspecting activity package:');
  }
});

// POST /api/activity-packs/install - multipart { file, options: { ..., plan_hash } }
router.post('/install', ...staff, async (req, res) => {
  const received = await receivePack(req, res);
  if (!received) return;
  try {
    const result = await installPackFile(req, received.buffer, received.options);
    for (const installed of result.installed) {
      await writeAudit(req, {
        action: 'activity_pack.install',
        resourceType: 'case',
        resourceId: installed.case_id,
        details: {
          personas_created: result.personas_created,
          criteria_created: result.criteria_created,
          rubrics_created: result.rubrics_created.map((r) => r.rubric_id),
          course_id: result.course?.course_id ?? null,
        },
      });
    }
    res.status(201).json({ data: result, error: null });
  } catch (error) {
    sendError(res, error, 'Error installing activity package:');
  }
});

/**
 * GET /api/version - this server's version, and the activity packages it can install.
 * Staff only. Mounted in server/index.js beside /api/health.
 */
export const versionRoute = [...staff, async (req, res) => {
  res.json({
    data: {
      app_version: getAppVersion(),
      schema: await getSchemaLevel(),
      activity_packs: {
        format: PACK_FORMAT,
        format_versions: SUPPORTED_FORMAT_VERSIONS,
        capabilities: serverCapabilities(),
      },
    },
    error: null,
  });
}];

export default router;
