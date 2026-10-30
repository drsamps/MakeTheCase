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
 *   POST   /api/activity-types/:key/preview    { definition?, case_id?, scenario_id?, persona_id?, student_name? }
 *   POST   /api/activity-types/:key/test-chat  { definition?, case_id?, scenario_id?, persona_id?, history, message }
 *   POST   /api/activity-types/:key/test-grade { definition?, case_id?, scenario_id?, persona_id?, history }
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
import { previewBehaviour } from '../services/activityTypes.js';
import { extractSignals, neutralizeSignalTags } from '../../utils/activityEngine/signals.js';
import { chatWithFallback } from '../services/chatFallback.js';
import { evaluateWithLLM } from '../services/llmRouter.js';
import { defaultModel } from '../services/modelChoice.js';
import { getEffectiveInstructorId } from '../services/resourceAccess.js';
import { parseEvaluationResponse } from '../services/evaluationNormalizer.js';
import { settleTouchpoints } from '../services/teachBack.js';

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
      personal: Boolean(def.traits.personal),
      material: def.traits.material,
      two_sided: Boolean(def.traits.two_sided),
      signals_complete: Boolean(def.traits.signals.complete),
      ai_sees_arguments: Boolean(def.traits.ai_sees.arguments),
    },
    saved_openings: Boolean(def.greeting.saved_openings),
    labels: def.labels,
    start_row: def.copy.start_row,
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

/** Sample inputs for a preview or Test chat with no real case: every slot has something in it. */
function sampleContext(definition) {
  const behaviour = previewBehaviour(definition);
  const persona = definition.traits.character === 'persona';
  return {
    chat: { persona: null },
    behaviour,
    chatOptions: {},
    options: { freeHints: 1, personaData: { instructions: 'You are a thoughtful person who asks plain questions.' } },
    caseData: {
      case_title: 'Sample Reading',
      case_content: 'Safety stock protects a firm from demand variability. Holding more stock raises carrying cost. Acme sells 100 units a week, lost 12% of its sales last year to stockouts, and its carrying cost is 25% a year.',
      supplementary_content: '',
      teaching_note: 'Good answers weigh the carrying cost against the sales lost to stockouts.',
      arguments_for: 'Stockouts cost 12% of sales.',
      arguments_against: 'Carrying cost is 25% a year.',
      goal: 'Students can use evidence from the reading to reach a decision.',
      protagonist: persona ? 'Sam, a curious beginner' : 'Pat Ray',
      protagonist_role: persona ? undefined : 'COO of Acme',
      chat_topic: 'safety stock',
      chat_question: 'Should Acme double its safety stock?',
      prompt_instructions: undefined,
      position: definition.traits.positions === 'off' ? undefined : 'Acme should double its safety stock',
      opposing_position: definition.traits.positions === 'off' ? undefined : 'Acme should keep its safety stock as it is',
      position_assigned: definition.traits.capture_methods.includes('assigned'),
      scenario_student: { situation: '', personas: {} },
      touchpoints: [
        { key: 'carrying_cost', label: 'Carrying cost', description: 'What holding the stock costs' },
        { key: 'stockouts', label: 'Lost sales from stockouts', description: '' },
      ],
      submission_text: definition.traits.material === 'student_submission' ? 'Sample submission: I argue that Acme should double its safety stock, because stockouts cost more than carrying the stock.' : undefined,
    },
  };
}

/** The definition to preview or test: the one posted, else the draft, else the current version. */
async function definitionFor(req) {
  if (req.body?.definition) return req.body.definition;
  const detail = await getTypeDetail(req.params.key);
  return detail.draft?.definition || detail.current?.definition || null;
}

/** A real case, or the sample text when no case is chosen. */
async function testContext(req, definition) {
  const { case_id: caseId = null, scenario_id: scenarioId = null, persona_id: personaId = null } = req.body || {};
  if (!caseId) return sampleContext(definition);
  return loadChatContext(
    { id: null, case_id: caseId, section_id: null, scenario_id: scenarioId || null, persona: personaId || null, initial_position_id: null },
    { definition }
  );
}

const MAX_TEST_TURNS = 80;
const MAX_TEST_TEXT = 4000;

/** The posted test conversation, or an HTTP error: admins only, but still bounded. */
function testHistory(body) {
  const history = Array.isArray(body?.history) ? body.history : [];
  if (history.length > MAX_TEST_TURNS) throw new ActivityTypeError(400, 'TEST_TOO_LONG', 'This test chat is too long. Start over.');
  return history.map((t) => ({
    role: t?.role === 'student' ? 'student' : 'protagonist',
    content: String(t?.content ?? '').slice(0, MAX_TEST_TEXT * 4),
  }));
}

/**
 * Chat with a definition as a student would (Phase 5). Nothing is stored: the screen keeps the
 * conversation and sends it with each turn, so no case_chats or chat_turns row exists and no
 * Results, Monitor or Issue Analytics view can pick it up. Billed to the caller through the usual
 * guard (purpose 'activity_type_test'). Signals are returned so the author can see them.
 */
router.post('/:key/test-chat', ...adminAuth, checkKey, async (req, res) => {
  try {
    const message = String(req.body?.message ?? '').trim();
    if (!message) return res.status(400).json({ data: null, error: { message: 'Type a message first' } });
    if (message.length > MAX_TEST_TEXT) return res.status(400).json({ data: null, error: { message: `Keep test messages under ${MAX_TEST_TEXT} characters` } });
    const definition = await definitionFor(req);
    if (!definition) return res.status(404).json({ data: null, error: { message: 'This type has nothing to test' } });
    const ctx = await testContext(req, definition);
    const modelId = req.body?.model_id || (await defaultModel()).model_id;
    const signals = ctx.behaviour.signals || {};
    const usesSignals = Boolean(signals.complete || signals.touchpoints);
    const { text: rawText, modelIdUsed } = await chatWithFallback({
      modelId,
      systemPrompt: buildChatSystemPrompt(ctx, 'Sam'),
      history: testHistory(req.body).map((t) => ({ role: t.role === 'student' ? 'user' : 'model', content: t.content })),
      message: usesSignals ? neutralizeSignalTags(message) : message,
      config: { caseId: req.body?.case_id || null, instructorId: getEffectiveInstructorId(req), purpose: 'activity_type_test' },
    });
    const result = usesSignals
      ? extractSignals(rawText, signals, (ctx.caseData.touchpoints || []).map((t) => t.key))
      : { text: rawText, signals: null };
    res.json({ data: { text: result.text || '...', signals: result.signals, model_id: modelIdUsed }, error: null });
  } catch (error) {
    if (error?.code === 'INSTRUCTOR_COST_CAP_EXCEEDED') {
      return res.status(429).json({ data: null, error: { code: error.code, message: 'You have reached your weekly AI usage cap.' } });
    }
    if (error?.status === 404) return res.status(404).json({ data: null, error: { message: error.message } });
    sendError(res, error, 'Error in activity type test chat:');
  }
});

/** Grade a test conversation with the definition's grading prompt. Saves nothing. Billed to the caller. */
router.post('/:key/test-grade', ...adminAuth, checkKey, async (req, res) => {
  try {
    const definition = await definitionFor(req);
    if (!definition) return res.status(404).json({ data: null, error: { message: 'This type has nothing to test' } });
    const ctx = await testContext(req, definition);
    const history = testHistory(req.body);
    if (!history.some((t) => t.role === 'student')) return res.status(400).json({ data: null, error: { message: 'There is no conversation to grade yet' } });
    const label = ctx.caseData.protagonist || 'AI';
    const chatHistory = history.map((t) => `${t.role === 'student' ? 'Student' : label}: ${t.content}`).join('\n\n');
    const prompt = ctx.behaviour.buildCoachPrompt(chatHistory, 'Sam', ctx.caseData, ctx.options.freeHints ?? 1, null);
    const modelId = req.body?.model_id || (await defaultModel()).model_id;
    const { getModelConfig } = await import('./llm.js');
    const modelConfig = await getModelConfig(modelId);
    if (!modelConfig) return res.status(404).json({ data: null, error: { message: 'Model not found' } });
    const { text } = await evaluateWithLLM({
      modelId,
      vendor: modelConfig.vendor,
      prompt,
      config: { ...modelConfig, instructorId: getEffectiveInstructorId(req), caseId: req.body?.case_id || null, purpose: 'activity_type_test' },
    });
    const parsed = parseEvaluationResponse(text);
    const { touchpoints: reported, ...graded } = parsed;
    const finished = ctx.behaviour.finishEvaluation(graded, chatHistory, ctx.caseData);
    res.json({ data: { ...finished, touchpoints: settleTouchpoints(reported, ctx.caseData.touchpoints, chatHistory, ctx.caseData) }, error: null });
  } catch (error) {
    if (error?.status === 404) return res.status(404).json({ data: null, error: { message: error.message } });
    sendError(res, error, 'Error in activity type test grade:');
  }
});

/**
 * The prompts a definition produces, without starting a chat: the chat system prompt, the greeting,
 * the coach prompt (on a two-line sample transcript) and the student view. On a real case and
 * scenario, or on sample text when no case is chosen. Uses the posted definition, else the draft,
 * else the current version.
 */
router.post('/:key/preview', ...adminAuth, checkKey, async (req, res) => {
  try {
    const definition = await definitionFor(req);
    if (!definition) return res.status(404).json({ data: null, error: { message: 'This type has nothing to preview' } });
    const ctx = await testContext(req, definition);
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
