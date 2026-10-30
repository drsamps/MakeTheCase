/**
 * Activity types (StudyChat Phase 2): list, clone, draft, preview, publish, restore.
 * The rules live in services/activityTypeStore.js; the plan is dev/StudyChat-plan.md §4.
 *
 *   GET    /api/activity-types                 staff: the published types (case form picker, labels)
 *   GET    /api/activity-types?all=1           + drafts, disabled types, usage   (admin, activity_types)
 *   GET    /api/activity-types/:key            current, draft, history, usage    (admin, activity_types)
 *   POST   /api/activity-types/:key/clone      { label, from_version? } -> { key }
 *   PUT    /api/activity-types/:key/draft      { definition, notes? }   (validated; traits fixed once published)
 *   DELETE /api/activity-types/:key/draft
 *   POST   /api/activity-types/:key/preview    { definition?, case_id, scenario_id?, persona_id?, student_name? }
 *   POST   /api/activity-types/:key/publish
 *   POST   /api/activity-types/:key/restore    { version_no } -> copied into the draft
 *   PATCH  /api/activity-types/:key            { enabled }
 *   DELETE /api/activity-types/:key            only when no case or chat uses it
 *
 * Writes are admin-only with the grantable `activity_types` permission (superusers always).
 * Instructors pick from published, enabled types on the case form.
 */

import express from 'express';
import { pool } from '../db.js';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { requirePermission, hasPermission } from '../middleware/permissions.js';
import { requireAdminOrInstructor } from '../middleware/instructorAccess.js';
import { writeAudit } from '../services/auditLog.js';
import {
  ActivityTypeError, cloneType, deleteType, discardDraft, getTypeDetail, getTypeEntry, listTypeEntries,
  publishDraft, restoreVersion, saveDraft, setTypeEnabled, typeUsage,
} from '../services/activityTypeStore.js';
import { loadChatContext, buildChatSystemPrompt, buildGreeting, sanitizeStudentName } from '../services/chatPrompt.js';
import { formatTranscript } from '../../utils/transcriptFormat.js';

const router = express.Router();
const adminAuth = [verifyToken, requireRole(['admin']), requirePermission('activity_types')];
const KEY_RE = /^[a-z0-9_]{2,30}$/;

function sendError(res, error, context) {
  if (error instanceof ActivityTypeError) {
    return res.status(error.status).json({ data: null, error: { message: error.message, code: error.code, ...(error.details || {}) } });
  }
  console.error(context, error);
  return res.status(500).json({ data: null, error: { message: error.message } });
}

function checkKey(req, res, next) {
  if (!KEY_RE.test(req.params.key || '')) return res.status(400).json({ data: null, error: { message: 'Invalid activity type key' } });
  next();
}

const actorOf = (req) => ({ id: req.user?.id ?? null, type: req.user?.role === 'instructor' ? 'instructor' : 'admin' });

/** What staff need about a published type: its words and the traits the dashboard reads. */
function summaryOf(entry) {
  const def = entry.current.definition;
  return {
    key: entry.key,
    label: def.label,
    summary: def.summary,
    tier: entry.tier,
    enabled: entry.enabled,
    based_on: entry.based_on,
    version: entry.current.version,
    traits: {
      character: def.traits.character,
      persona_kind: def.traits.persona_kind,
      positions: def.traits.positions,
      capture_methods: def.traits.capture_methods,
    },
    saved_openings: Boolean(def.greeting.saved_openings),
    labels: def.labels,
  };
}

// GET /api/activity-types[?all=1]
router.get('/', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    const published = listTypeEntries().filter((e) => e.current).map(summaryOf);
    if (req.query.all !== '1') return res.json({ data: published, error: null });

    // The full list is the admin screen's: permission activity_types.
    if (!hasPermission(req.user, 'activity_types')) return res.status(403).json({ data: null, error: { message: 'You do not have access to manage activity types' } });
    const [drafts] = await pool.query(
      `SELECT t.type_key, t.tier, t.based_on, v.version_no, JSON_UNQUOTE(JSON_EXTRACT(v.definition, '$.label')) AS label,
              JSON_UNQUOTE(JSON_EXTRACT(v.definition, '$.summary')) AS summary, v.updated_at
         FROM activity_types t JOIN activity_type_versions v ON v.type_key = t.type_key AND v.status = 'draft'`
    );
    const draftByKey = new Map(drafts.map((d) => [d.type_key, d]));
    const rows = [];
    for (const entry of listTypeEntries()) {
      const draft = draftByKey.get(entry.key);
      rows.push({
        ...(entry.current ? summaryOf(entry) : {
          key: entry.key, label: draft?.label || entry.key, summary: draft?.summary || '', tier: entry.tier,
          enabled: false, based_on: entry.based_on, version: null, traits: null, saved_openings: false, labels: null,
        }),
        locked: entry.tier !== 'custom',
        draft: draft ? { version_no: draft.version_no, updated_at: draft.updated_at } : null,
        usage: await typeUsage(entry.key),
      });
    }
    res.json({ data: rows, error: null });
  } catch (error) {
    sendError(res, error, 'Error listing activity types:');
  }
});

router.get('/:key', ...adminAuth, checkKey, async (req, res) => {
  try {
    res.json({ data: await getTypeDetail(req.params.key), error: null });
  } catch (error) {
    sendError(res, error, 'Error loading activity type:');
  }
});

router.post('/:key/clone', ...adminAuth, checkKey, async (req, res) => {
  try {
    const key = await cloneType({ fromKey: req.params.key, fromVersion: req.body?.from_version || null, label: req.body?.label }, actorOf(req));
    await writeAudit(req, { action: 'activity_type.clone', resourceType: 'activity_type', resourceId: key, details: { from: req.params.key } });
    res.status(201).json({ data: { key }, error: null });
  } catch (error) {
    sendError(res, error, 'Error cloning activity type:');
  }
});

router.put('/:key/draft', ...adminAuth, checkKey, async (req, res) => {
  try {
    await saveDraft(req.params.key, req.body?.definition, { notes: req.body?.notes ?? null }, actorOf(req));
    res.json({ data: await getTypeDetail(req.params.key), error: null });
  } catch (error) {
    sendError(res, error, 'Error saving activity type draft:');
  }
});

router.delete('/:key/draft', ...adminAuth, checkKey, async (req, res) => {
  try {
    await discardDraft(req.params.key);
    res.json({ data: await getTypeDetail(req.params.key), error: null });
  } catch (error) {
    sendError(res, error, 'Error discarding activity type draft:');
  }
});

/**
 * The prompts a definition produces for a real case and scenario, without starting a chat: the
 * chat system prompt, the greeting, the coach prompt (on a two-line sample transcript) and the
 * student view. Uses the posted definition, else the draft, else the current version.
 */
router.post('/:key/preview', ...adminAuth, checkKey, async (req, res) => {
  try {
    const { case_id: caseId, scenario_id: scenarioId = null, persona_id: personaId = null } = req.body || {};
    if (!caseId) return res.status(400).json({ data: null, error: { message: 'Choose a case to preview with' } });
    let definition = req.body?.definition;
    if (!definition) {
      const detail = await getTypeDetail(req.params.key);
      definition = detail.draft?.definition || detail.current?.definition;
    }
    if (!definition) return res.status(404).json({ data: null, error: { message: 'This type has nothing to preview' } });
    const ctx = await loadChatContext(
      { id: null, case_id: caseId, section_id: null, scenario_id: scenarioId || null, persona: personaId || null, initial_position_id: null },
      { definition }
    );
    const studentName = sanitizeStudentName(req.body?.student_name || 'Sam');
    const greeting = buildGreeting(ctx, studentName);
    const sample = formatTranscript(
      [{ role: 'protagonist', content: greeting }, { role: 'student', content: '(The student\'s messages appear here.)' }],
      { studentName, protagonistName: ctx.caseData.protagonist }
    );
    res.json({
      data: {
        system_prompt: buildChatSystemPrompt(ctx, studentName),
        greeting,
        coach_prompt: ctx.behaviour.buildCoachPrompt(sample, studentName, ctx.caseData, ctx.options.freeHints, null),
        final_turn_note: ctx.behaviour.finalTurnNote,
        position_pick_note: ctx.behaviour.positionPickNote,
        student_view: ctx.behaviour.studentView,
      },
      error: null,
    });
  } catch (error) {
    if (error?.status === 404) return res.status(404).json({ data: null, error: { message: error.message } });
    sendError(res, error, 'Error previewing activity type:');
  }
});

router.post('/:key/publish', ...adminAuth, checkKey, async (req, res) => {
  try {
    const version = await publishDraft(req.params.key, actorOf(req));
    const usage = await typeUsage(req.params.key);
    await writeAudit(req, { action: 'activity_type.publish', resourceType: 'activity_type', resourceId: req.params.key, details: { version, usage } });
    res.json({ data: { version, usage, detail: await getTypeDetail(req.params.key) }, error: null });
  } catch (error) {
    sendError(res, error, 'Error publishing activity type:');
  }
});

router.post('/:key/restore', ...adminAuth, checkKey, async (req, res) => {
  try {
    await restoreVersion(req.params.key, req.body?.version_no, actorOf(req));
    res.json({ data: await getTypeDetail(req.params.key), error: null });
  } catch (error) {
    sendError(res, error, 'Error restoring activity type version:');
  }
});

router.patch('/:key', ...adminAuth, checkKey, async (req, res) => {
  try {
    if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ data: null, error: { message: 'enabled must be true or false' } });
    await setTypeEnabled(req.params.key, req.body.enabled);
    await writeAudit(req, { action: req.body.enabled ? 'activity_type.enable' : 'activity_type.disable', resourceType: 'activity_type', resourceId: req.params.key });
    res.json({ data: { key: req.params.key, enabled: Boolean(getTypeEntry(req.params.key)?.enabled) }, error: null });
  } catch (error) {
    sendError(res, error, 'Error updating activity type:');
  }
});

router.delete('/:key', ...adminAuth, checkKey, async (req, res) => {
  try {
    await deleteType(req.params.key);
    await writeAudit(req, { action: 'activity_type.delete', resourceType: 'activity_type', resourceId: req.params.key });
    res.json({ data: { deleted: true }, error: null });
  } catch (error) {
    sendError(res, error, 'Error deleting activity type:');
  }
});

export default router;
