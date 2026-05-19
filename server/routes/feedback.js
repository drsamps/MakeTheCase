import express from 'express';
import { pool } from '../db.js';
import { verifyToken } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { getActivePrompt, renderPrompt, getSetting, updateSetting } from '../services/promptService.js';
import { generateOutlineWithLLM } from '../services/llmRouter.js';
import {
  resolveSubmitterRole,
  canSubmit,
  allowedSubmitterRolesForViewer,
  getSubmitterRolesSetting,
  getViewerRulesSetting,
  FEEDBACK_ROLES,
} from '../utils/feedbackRoles.js';
import { redactPii } from '../utils/redactPii.js';

const router = express.Router();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SUBMISSION_TYPES = ['bug', 'idea', 'question', 'praise'];
const SENTIMENTS = ['positive', 'neutral', 'negative'];
const SCOPE_TYPES = ['case', 'category', 'all'];
const MAX_BODY_LEN = 5000;
const MAX_NOTE_LEN = 2000;
const MAX_SUMMARY_ITEMS = 500;

// Whitelisted inbox sort fields → SQL ORDER BY expressions. Direction
// (asc|desc) is appended at query time. created_at is always a tiebreaker.
const SORT_FIELDS = {
  created: 'f.created_at',
  priority: 'f.priority',
  role: 'f.submitter_role',
  type: 'f.submission_type',
  category: 'c.name',
  read: 'f.is_read',
};

function parseSort(value) {
  const fallback = { field: 'f.created_at', dir: 'DESC' };
  if (!value || typeof value !== 'string') return fallback;
  const [fieldKey, dirRaw] = value.split(':');
  const sqlField = SORT_FIELDS[fieldKey];
  if (!sqlField) return fallback;
  const dir = (dirRaw || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  return { field: sqlField, dir };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nullOrEnum(value, allowed) {
  if (value === undefined || value === null || value === '') return null;
  return allowed.includes(value) ? value : undefined;
}

async function resolveModel(requestedModelId) {
  const candidate = requestedModelId || (await getSetting('feedback.summary_model_id')) || null;
  if (candidate) {
    const [rows] = await pool.execute(
      'SELECT model_id, vendor FROM models WHERE model_id = ? AND enabled = 1',
      [candidate]
    );
    if (rows.length > 0) return rows[0];
  }
  const fallback = await getSetting('default_model_id');
  if (fallback) {
    const [rows] = await pool.execute(
      'SELECT model_id, vendor FROM models WHERE model_id = ? AND enabled = 1',
      [fallback]
    );
    if (rows.length > 0) return rows[0];
  }
  const [rows] = await pool.execute(
    'SELECT model_id, vendor FROM models WHERE enabled = 1 ORDER BY model_id LIMIT 1'
  );
  if (rows.length === 0) throw new Error('No enabled model available');
  return rows[0];
}

// Resolve display names for submitter user IDs. Looks across students,
// instructors, and admins tables since user_id has no FK (mirrors case_chats).
async function loadSubmitterNames(rows) {
  const ids = [...new Set(rows.map(r => r.submitter_user_id).filter(Boolean))];
  if (ids.length === 0) return {};
  const placeholders = ids.map(() => '?').join(',');
  const out = {};
  const [students] = await pool.execute(
    `SELECT id, full_name, email FROM students WHERE id IN (${placeholders})`,
    ids
  );
  for (const s of students) out[s.id] = { name: s.full_name, email: s.email };
  const [instructors] = await pool.execute(
    `SELECT id, full_name, email FROM instructors WHERE id IN (${placeholders})`,
    ids
  );
  for (const i of instructors) out[i.id] = { name: i.full_name, email: i.email };
  const [admins] = await pool.execute(
    `SELECT id, who, email FROM admins WHERE id IN (${placeholders})`,
    ids
  );
  for (const a of admins) out[a.id] = { name: a.who, email: a.email };
  return out;
}

function viewerHasAdminFeedbackAccess(user) {
  if (!user || user.role !== 'admin') return false;
  if (user.superuser) return true;
  const adminAccess = user.adminAccess || [];
  return adminAccess.includes('feedback_admin');
}

// ---------------------------------------------------------------------------
// All routes require auth.
// ---------------------------------------------------------------------------
router.use(verifyToken);

// ---------------------------------------------------------------------------
// GET /api/feedback/categories — active categories (any auth)
// ---------------------------------------------------------------------------
router.get('/categories', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, name, description, sort_order
         FROM feedback_categories
        WHERE active = 1
        ORDER BY sort_order, name`
    );
    res.json({ categories: rows });
  } catch (err) {
    console.error('[feedback] categories error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/feedback/eligibility
// ---------------------------------------------------------------------------
router.get('/eligibility', async (req, res) => {
  try {
    const role = await resolveSubmitterRole(req.user);
    const submitterRoles = await getSubmitterRolesSetting();
    const viewerRules = await getViewerRulesSetting();
    const allowedSources = allowedSubmitterRolesForViewer(role, viewerRules);
    const widgetStyleRaw = await getSetting('feedback.widget_style');
    const allowedStyles = ['right_edge_tab', 'bottom_right_fab', 'header_link', 'hidden'];
    const widgetStyle = allowedStyles.includes(widgetStyleRaw) ? widgetStyleRaw : 'right_edge_tab';
    res.json({
      role,
      canSubmit: canSubmit(role, submitterRoles),
      viewerHasAnyAllowedSource: allowedSources.length > 0,
      isFeedbackAdmin: viewerHasAdminFeedbackAccess(req.user),
      widgetStyle,
    });
  } catch (err) {
    console.error('[feedback] eligibility error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/feedback/mine — current user's own submissions
// ---------------------------------------------------------------------------
router.get('/mine', async (req, res) => {
  try {
    if (!req.user?.id) return res.json({ items: [] });
    const [rows] = await pool.execute(
      `SELECT f.id, f.submitter_role, f.submission_type, f.sentiment,
              f.category_id, c.name AS category_name,
              f.body, f.context_route, f.context_screen, f.context_case_id,
              f.created_at, f.is_read, f.read_at,
              f.needs_follow_up, f.follow_up_resolved, f.resolved_at, f.resolution_note
         FROM feedback_submissions f
         LEFT JOIN feedback_categories c ON c.id = f.category_id
        WHERE f.submitter_user_id = ?
        ORDER BY f.created_at DESC
        LIMIT 200`,
      [req.user.id]
    );
    res.json({ items: rows });
  } catch (err) {
    console.error('[feedback] mine error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/feedback/unread-count — count of unread items the viewer can see
// ---------------------------------------------------------------------------
router.get('/unread-count', async (req, res) => {
  try {
    const role = await resolveSubmitterRole(req.user);
    const viewerRules = await getViewerRulesSetting();
    let allowedSources = allowedSubmitterRolesForViewer(role, viewerRules);
    if (viewerHasAdminFeedbackAccess(req.user)) {
      allowedSources = [...new Set([...allowedSources, ...FEEDBACK_ROLES])];
    }
    if (allowedSources.length === 0) return res.json({ count: 0 });
    const placeholders = allowedSources.map(() => '?').join(',');
    const [rows] = await pool.execute(
      `SELECT COUNT(*) AS n FROM feedback_submissions
        WHERE is_read = 0
          AND archived_at IS NULL
          AND submitter_role IN (${placeholders})`,
      allowedSources
    );
    res.json({ count: rows[0]?.n || 0 });
  } catch (err) {
    console.error('[feedback] unread-count error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/feedback — submit feedback
// ---------------------------------------------------------------------------
router.post('/', async (req, res) => {
  try {
    const role = await resolveSubmitterRole(req.user);
    const submitterRoles = await getSubmitterRolesSetting();
    if (!canSubmit(role, submitterRoles)) {
      return res.status(403).json({ error: 'Feedback submission is disabled for your role.' });
    }

    const {
      category_id,
      body,
      submission_type,
      sentiment,
      context_route,
      context_screen,
      context_case_id,
      user_agent,
      build_sha,
      viewport,
    } = req.body || {};

    const trimmedBody = typeof body === 'string' ? body.trim() : '';
    if (!trimmedBody) return res.status(400).json({ error: 'body is required' });
    if (trimmedBody.length > MAX_BODY_LEN) {
      return res.status(400).json({ error: `body must be at most ${MAX_BODY_LEN} chars` });
    }

    const submissionType = nullOrEnum(submission_type, SUBMISSION_TYPES);
    if (submissionType === undefined) return res.status(400).json({ error: 'invalid submission_type' });
    const sentimentVal = nullOrEnum(sentiment, SENTIMENTS);
    if (sentimentVal === undefined) return res.status(400).json({ error: 'invalid sentiment' });

    let categoryId = null;
    if (category_id !== undefined && category_id !== null && category_id !== '') {
      const n = Number(category_id);
      if (!Number.isInteger(n)) return res.status(400).json({ error: 'invalid category_id' });
      const [cat] = await pool.execute(
        'SELECT id FROM feedback_categories WHERE id = ? AND active = 1',
        [n]
      );
      if (cat.length === 0) return res.status(400).json({ error: 'category not found' });
      categoryId = n;
    }

    const [result] = await pool.execute(
      `INSERT INTO feedback_submissions
         (submitter_user_id, submitter_role, submission_type, sentiment,
          category_id, body, context_route, context_screen, context_case_id,
          user_agent, build_sha, viewport)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.id || null,
        role,
        submissionType,
        sentimentVal,
        categoryId,
        trimmedBody,
        context_route ? String(context_route).slice(0, 512) : null,
        context_screen ? String(context_screen).slice(0, 255) : null,
        context_case_id ? String(context_case_id).slice(0, 30) : null,
        user_agent ? String(user_agent).slice(0, 512) : null,
        build_sha ? String(build_sha).slice(0, 40) : null,
        viewport ? String(viewport).slice(0, 20) : null,
      ]
    );

    res.json({ id: result.insertId });
  } catch (err) {
    console.error('[feedback] submit error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Inbox helper: resolves the set of submitter_roles the viewer is allowed to
// see. Feedback admins always see everything.
// ---------------------------------------------------------------------------
async function resolveViewerScope(req) {
  if (viewerHasAdminFeedbackAccess(req.user)) {
    return { isAdmin: true, allowedSources: FEEDBACK_ROLES };
  }
  const role = await resolveSubmitterRole(req.user);
  const viewerRules = await getViewerRulesSetting();
  const allowedSources = allowedSubmitterRolesForViewer(role, viewerRules);
  return { isAdmin: false, allowedSources };
}

// ---------------------------------------------------------------------------
// GET /api/feedback — inbox listing, scoped by viewer rules
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const { allowedSources } = await resolveViewerScope(req);
    if (allowedSources.length === 0) return res.json({ items: [] });

    const where = [];
    const params = [];

    where.push(`f.submitter_role IN (${allowedSources.map(() => '?').join(',')})`);
    params.push(...allowedSources);

    const {
      status, category_id, case_id, submitter_role,
      submission_type, search, since, until, sort,
    } = req.query || {};

    // Archive visibility: hidden by default. status='archived' shows only
    // archived rows; status='all_including_archived' shows everything.
    if (status === 'archived') {
      where.push('f.archived_at IS NOT NULL');
    } else if (status !== 'all_including_archived') {
      where.push('f.archived_at IS NULL');
    }

    if (status === 'unread')  where.push('f.is_read = 0');
    if (status === 'read')    where.push('f.is_read = 1');
    if (status === 'followup') where.push('f.needs_follow_up = 1 AND f.follow_up_resolved = 0');
    if (status === 'resolved') where.push('f.follow_up_resolved = 1');

    if (category_id) { where.push('f.category_id = ?'); params.push(Number(category_id)); }
    if (case_id)     { where.push('f.context_case_id = ?'); params.push(String(case_id)); }
    if (submitter_role && FEEDBACK_ROLES.includes(submitter_role)) {
      where.push('f.submitter_role = ?'); params.push(submitter_role);
    }
    if (submission_type && SUBMISSION_TYPES.includes(submission_type)) {
      where.push('f.submission_type = ?'); params.push(submission_type);
    }
    if (search) { where.push('f.body LIKE ?'); params.push(`%${search}%`); }
    if (since)  { where.push('f.created_at >= ?'); params.push(since); }
    if (until)  { where.push('f.created_at <= ?'); params.push(until); }

    const { field: sortField, dir: sortDir } = parseSort(sort);
    const orderClause = sortField === 'f.created_at'
      ? `ORDER BY ${sortField} ${sortDir}`
      : `ORDER BY ${sortField} ${sortDir}, f.created_at DESC`;

    const sql =
      `SELECT f.id, f.submitter_user_id, f.submitter_role, f.submission_type, f.sentiment,
              f.category_id, c.name AS category_name,
              f.body, f.context_route, f.context_screen, f.context_case_id,
              f.created_at, f.is_read, f.read_at,
              f.needs_follow_up, f.follow_up_resolved, f.resolved_at, f.resolution_note,
              f.priority, f.archived_at
         FROM feedback_submissions f
         LEFT JOIN feedback_categories c ON c.id = f.category_id
        WHERE ${where.join(' AND ')}
        ${orderClause}
        LIMIT 500`;

    const [rows] = await pool.execute(sql, params);
    const names = await loadSubmitterNames(rows);
    const items = rows.map(r => ({
      ...r,
      submitter_name: r.submitter_user_id ? (names[r.submitter_user_id]?.name || null) : null,
      submitter_email: r.submitter_user_id ? (names[r.submitter_user_id]?.email || null) : null,
    }));
    res.json({ items });
  } catch (err) {
    console.error('[feedback] inbox error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/feedback/summaries — historical summaries (admin only)
// ---------------------------------------------------------------------------
router.get('/summaries', requirePermission('feedback_admin'), async (req, res) => {
  try {
    const { scope_type, scope_id } = req.query || {};
    const where = [];
    const params = [];
    if (scope_type && SCOPE_TYPES.includes(scope_type)) {
      where.push('scope_type = ?'); params.push(scope_type);
    }
    if (scope_id) { where.push('scope_id = ?'); params.push(String(scope_id)); }
    const sql =
      `SELECT id, scope_type, scope_id, summary_text, model_id,
              created_by_user_id, created_at, source_count
         FROM feedback_summaries
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY created_at DESC
        LIMIT 100`;
    const [rows] = await pool.execute(sql, params);
    res.json({ items: rows });
  } catch (err) {
    console.error('[feedback] summaries list error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/feedback/summarize — generate an AI digest (admin only)
// ---------------------------------------------------------------------------
router.post('/summarize', requirePermission('feedback_admin'), async (req, res) => {
  try {
    const { scope_type, scope_id, model_id } = req.body || {};
    if (!SCOPE_TYPES.includes(scope_type)) {
      return res.status(400).json({ error: 'invalid scope_type' });
    }
    if (scope_type !== 'all' && !scope_id) {
      return res.status(400).json({ error: 'scope_id required for case or category scope' });
    }

    const where = [];
    const params = [];
    let scopeLabel = 'all feedback';
    if (scope_type === 'case') {
      where.push('f.context_case_id = ?'); params.push(String(scope_id));
      scopeLabel = `case ${scope_id}`;
    } else if (scope_type === 'category') {
      where.push('f.category_id = ?'); params.push(Number(scope_id));
      const [cat] = await pool.execute(
        'SELECT name FROM feedback_categories WHERE id = ?',
        [Number(scope_id)]
      );
      if (cat.length > 0) scopeLabel = `category "${cat[0].name}"`;
    }

    const sql =
      `SELECT f.id, f.submitter_role, f.submission_type, f.sentiment,
              c.name AS category_name, f.body, f.context_route, f.context_screen, f.context_case_id, f.created_at
         FROM feedback_submissions f
         LEFT JOIN feedback_categories c ON c.id = f.category_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY f.created_at DESC
        LIMIT ${MAX_SUMMARY_ITEMS}`;
    const [items] = await pool.execute(sql, params);

    if (items.length === 0) {
      return res.json({
        id: null,
        summary_text: '_No feedback items match this scope yet._',
        source_count: 0,
        model_id: null,
      });
    }

    const formatted = items.map((it, idx) => {
      const tag = it.submission_type ? `[${it.submission_type}]` : '[—]';
      const cat = it.category_name ? `cat=${it.category_name}` : '';
      const screen = it.context_screen ? `screen="${it.context_screen}"` : '';
      const route = it.context_route ? `route=${it.context_route}` : '';
      const caseRef = it.context_case_id ? `case=${it.context_case_id}` : '';
      const sentiment = it.sentiment ? `sentiment=${it.sentiment}` : '';
      const meta = [cat, screen, route, caseRef, `role=${it.submitter_role}`, sentiment].filter(Boolean).join(', ');
      const safeBody = redactPii(it.body).replace(/\s+/g, ' ').trim();
      return `${idx + 1}. ${tag} (${meta}) "${safeBody}"`;
    }).join('\n');

    const promptRow = await getActivePrompt('feedback_summary');
    const prompt = renderPrompt(promptRow.prompt_template, {
      items: formatted,
      scope_label: scopeLabel,
    });

    const model = await resolveModel(model_id);
    const llmResult = await generateOutlineWithLLM({
      modelId: model.model_id,
      vendor: model.vendor,
      prompt,
      config: { maxTokens: 4000 },
    });

    const summaryText = (llmResult?.text || '').trim() || '_The model returned an empty summary._';

    const [insert] = await pool.execute(
      `INSERT INTO feedback_summaries
         (scope_type, scope_id, summary_text, model_id, created_by_user_id, source_count)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        scope_type,
        scope_type === 'all' ? null : String(scope_id),
        summaryText,
        model.model_id,
        req.user.id || null,
        items.length,
      ]
    );

    res.json({
      id: insert.insertId,
      summary_text: summaryText,
      source_count: items.length,
      model_id: model.model_id,
      scope_type,
      scope_id: scope_type === 'all' ? null : String(scope_id),
    });
  } catch (err) {
    console.error('[feedback] summarize error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Settings — feedback-specific config keys (feedback_admin only).
// Separate from /api/settings/:key (which requires the `settings` permission)
// so a non-superuser feedback admin can manage these without broader access.
// ---------------------------------------------------------------------------
const FEEDBACK_SETTING_KEYS = [
  'feedback.submitter_roles',
  'feedback.viewer_rules',
  'feedback.summary_model_id',
  'feedback.summary_prompt_use',
  'feedback.widget_style',
];

router.get('/settings', requirePermission('feedback_admin'), async (req, res) => {
  try {
    const out = {};
    for (const key of FEEDBACK_SETTING_KEYS) {
      out[key] = await getSetting(key);
    }
    res.json({ settings: out });
  } catch (err) {
    console.error('[feedback] get settings error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.patch('/settings/:key', requirePermission('feedback_admin'), async (req, res) => {
  try {
    const { key } = req.params;
    if (!FEEDBACK_SETTING_KEYS.includes(key)) {
      return res.status(400).json({ error: 'unknown settings key' });
    }
    const { value } = req.body || {};
    if (value === undefined) return res.status(400).json({ error: 'value is required' });
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    await updateSetting(key, stringValue);
    res.json({ ok: true, key, value: stringValue });
  } catch (err) {
    console.error('[feedback] patch settings error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Categories admin — CRUD (feedback_admin only)
// ---------------------------------------------------------------------------
router.get('/categories/admin', requirePermission('feedback_admin'), async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, name, description, sort_order, active, created_at, updated_at
         FROM feedback_categories
        ORDER BY active DESC, sort_order, name`
    );
    res.json({ categories: rows });
  } catch (err) {
    console.error('[feedback] admin categories error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/categories', requirePermission('feedback_admin'), async (req, res) => {
  try {
    const { name, description, sort_order } = req.body || {};
    const trimmedName = typeof name === 'string' ? name.trim() : '';
    if (!trimmedName) return res.status(400).json({ error: 'name is required' });
    const [result] = await pool.execute(
      `INSERT INTO feedback_categories (name, description, sort_order)
       VALUES (?, ?, ?)`,
      [trimmedName.slice(0, 100), description || null, Number.isInteger(sort_order) ? sort_order : 0]
    );
    res.json({ id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'A category with that name already exists' });
    }
    console.error('[feedback] create category error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/categories/:id', requirePermission('feedback_admin'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
    const { name, description, sort_order, active } = req.body || {};
    const updates = [];
    const params = [];
    if (name !== undefined) {
      const trimmedName = String(name).trim();
      if (!trimmedName) return res.status(400).json({ error: 'name cannot be empty' });
      updates.push('name = ?'); params.push(trimmedName.slice(0, 100));
    }
    if (description !== undefined) { updates.push('description = ?'); params.push(description); }
    if (sort_order !== undefined && Number.isInteger(sort_order)) {
      updates.push('sort_order = ?'); params.push(sort_order);
    }
    if (active !== undefined) { updates.push('active = ?'); params.push(active ? 1 : 0); }
    if (updates.length === 0) return res.status(400).json({ error: 'no fields to update' });
    params.push(id);
    await pool.execute(
      `UPDATE feedback_categories SET ${updates.join(', ')} WHERE id = ?`,
      params
    );
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'A category with that name already exists' });
    }
    console.error('[feedback] update category error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Soft-delete: set active=0 so historical submissions keep their label.
router.delete('/categories/:id', requirePermission('feedback_admin'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
    await pool.execute(
      'UPDATE feedback_categories SET active = 0 WHERE id = ?',
      [id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[feedback] delete category error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/feedback/:id — full row (viewer-scoped)
// ---------------------------------------------------------------------------
router.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
    const { allowedSources } = await resolveViewerScope(req);

    const [rows] = await pool.execute(
      `SELECT f.*, c.name AS category_name
         FROM feedback_submissions f
         LEFT JOIN feedback_categories c ON c.id = f.category_id
        WHERE f.id = ?`,
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'not found' });
    const row = rows[0];

    const isOwnSubmission = req.user?.id && row.submitter_user_id === req.user.id;
    if (!isOwnSubmission && !allowedSources.includes(row.submitter_role)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const names = await loadSubmitterNames([row]);
    res.json({
      item: {
        ...row,
        submitter_name: row.submitter_user_id ? (names[row.submitter_user_id]?.name || null) : null,
        submitter_email: row.submitter_user_id ? (names[row.submitter_user_id]?.email || null) : null,
      },
    });
  } catch (err) {
    console.error('[feedback] get item error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/feedback/:id — triage actions (viewer-scoped)
// ---------------------------------------------------------------------------
router.patch('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
    const { allowedSources } = await resolveViewerScope(req);

    const [existing] = await pool.execute(
      'SELECT submitter_role FROM feedback_submissions WHERE id = ?',
      [id]
    );
    if (existing.length === 0) return res.status(404).json({ error: 'not found' });
    if (!allowedSources.includes(existing[0].submitter_role)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const { is_read, needs_follow_up, follow_up_resolved, resolution_note, priority, archived } = req.body || {};
    const updates = [];
    const params = [];

    if (is_read !== undefined) {
      if (is_read) {
        updates.push('is_read = 1', 'read_by_user_id = ?', 'read_at = CURRENT_TIMESTAMP');
        params.push(req.user.id || null);
      } else {
        updates.push('is_read = 0', 'read_by_user_id = NULL', 'read_at = NULL');
      }
    }
    if (needs_follow_up !== undefined) {
      updates.push('needs_follow_up = ?');
      params.push(needs_follow_up ? 1 : 0);
    }
    if (follow_up_resolved !== undefined) {
      if (follow_up_resolved) {
        updates.push('follow_up_resolved = 1', 'resolved_by_user_id = ?', 'resolved_at = CURRENT_TIMESTAMP');
        params.push(req.user.id || null);
      } else {
        updates.push('follow_up_resolved = 0', 'resolved_by_user_id = NULL', 'resolved_at = NULL');
      }
    }
    if (resolution_note !== undefined) {
      const note = resolution_note === null ? null : String(resolution_note).slice(0, MAX_NOTE_LEN);
      updates.push('resolution_note = ?');
      params.push(note);
    }
    if (priority !== undefined) {
      const n = Number(priority);
      if (!Number.isInteger(n) || n < 0 || n > 3) {
        return res.status(400).json({ error: 'priority must be 0..3' });
      }
      updates.push('priority = ?');
      params.push(n);
    }
    if (archived !== undefined) {
      if (archived) {
        updates.push('archived_at = CURRENT_TIMESTAMP', 'archived_by_user_id = ?');
        params.push(req.user.id || null);
      } else {
        updates.push('archived_at = NULL', 'archived_by_user_id = NULL');
      }
    }

    if (updates.length === 0) return res.status(400).json({ error: 'no fields to update' });
    params.push(id);

    await pool.execute(
      `UPDATE feedback_submissions SET ${updates.join(', ')} WHERE id = ?`,
      params
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[feedback] patch error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/feedback/:id — hard delete (feedback_admin only)
// ---------------------------------------------------------------------------
router.delete('/:id', requirePermission('feedback_admin'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
    const [result] = await pool.execute(
      'DELETE FROM feedback_submissions WHERE id = ?',
      [id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[feedback] delete error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/feedback/bulk — bulk archive/unarchive/delete/mark_read
// Body: { action: 'archive'|'unarchive'|'delete'|'mark_read', ids: number[] }
// Delete requires feedback_admin; other actions honor viewer scope.
// ---------------------------------------------------------------------------
router.post('/bulk', async (req, res) => {
  try {
    const { action, ids } = req.body || {};
    const allowedActions = ['archive', 'unarchive', 'delete', 'mark_read'];
    if (!allowedActions.includes(action)) {
      return res.status(400).json({ error: 'invalid action' });
    }
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids required' });
    }
    const intIds = ids.map(Number).filter(Number.isInteger);
    if (intIds.length === 0) return res.status(400).json({ error: 'invalid ids' });
    if (intIds.length > 500) return res.status(400).json({ error: 'too many ids' });

    if (action === 'delete' && !viewerHasAdminFeedbackAccess(req.user)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    // Scope: only operate on rows the viewer can see.
    const { allowedSources } = await resolveViewerScope(req);
    if (allowedSources.length === 0) return res.json({ ok: true, affected: 0 });

    const idPlaceholders = intIds.map(() => '?').join(',');
    const rolePlaceholders = allowedSources.map(() => '?').join(',');
    const [scoped] = await pool.execute(
      `SELECT id FROM feedback_submissions
        WHERE id IN (${idPlaceholders})
          AND submitter_role IN (${rolePlaceholders})`,
      [...intIds, ...allowedSources]
    );
    const targetIds = scoped.map(r => r.id);
    if (targetIds.length === 0) return res.json({ ok: true, affected: 0 });
    const targetPlaceholders = targetIds.map(() => '?').join(',');

    let affected = 0;
    if (action === 'delete') {
      const [result] = await pool.execute(
        `DELETE FROM feedback_submissions WHERE id IN (${targetPlaceholders})`,
        targetIds
      );
      affected = result.affectedRows;
    } else if (action === 'archive') {
      const [result] = await pool.execute(
        `UPDATE feedback_submissions
            SET archived_at = CURRENT_TIMESTAMP, archived_by_user_id = ?
          WHERE id IN (${targetPlaceholders}) AND archived_at IS NULL`,
        [req.user.id || null, ...targetIds]
      );
      affected = result.affectedRows;
    } else if (action === 'unarchive') {
      const [result] = await pool.execute(
        `UPDATE feedback_submissions
            SET archived_at = NULL, archived_by_user_id = NULL
          WHERE id IN (${targetPlaceholders}) AND archived_at IS NOT NULL`,
        targetIds
      );
      affected = result.affectedRows;
    } else if (action === 'mark_read') {
      const [result] = await pool.execute(
        `UPDATE feedback_submissions
            SET is_read = 1, read_by_user_id = ?, read_at = CURRENT_TIMESTAMP
          WHERE id IN (${targetPlaceholders}) AND is_read = 0`,
        [req.user.id || null, ...targetIds]
      );
      affected = result.affectedRows;
    }

    res.json({ ok: true, affected });
  } catch (err) {
    console.error('[feedback] bulk error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
