import express from 'express';
import { pool } from '../db.js';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { chatWithLLM } from '../services/llmRouter.js';
import { getEffectiveInstructorId } from '../services/resourceAccess.js';
import { getAvailableProviders } from '../services/keyResolver.js';

const router = express.Router();

const VALID_VENDORS = ['openai', 'anthropic', 'google', 'openrouter'];

const MODEL_FIELDS =
  'model_id, model_name, vendor, enabled, default_model AS `default`, ' +
  'cpm_input, cpm_input_cache, cpm_output, temperature, reasoning_effort, ' +
  'release_date, `type`, supported_parameters, default_parameters, parameter_settings, ' +
  'test_date, test_status, test_result, test_results, created_at, updated_at';

function parseJsonField(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function serializeRow(row) {
  if (!row) return row;
  return {
    ...row,
    supported_parameters: parseJsonField(row.supported_parameters, null),
    default_parameters: parseJsonField(row.default_parameters, null),
    parameter_settings: parseJsonField(row.parameter_settings, null),
    test_results: parseJsonField(row.test_results, null),
  };
}

function toJsonOrNull(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') {
    try {
      JSON.parse(value);
      return value;
    } catch {
      return null;
    }
  }
  return JSON.stringify(value);
}

async function fetchModelRow(modelId) {
  const [rows] = await pool.execute(
    `SELECT ${MODEL_FIELDS} FROM models WHERE model_id = ?`,
    [modelId]
  );
  return rows[0] ? serializeRow(rows[0]) : null;
}

// GET /api/models - Get all models (optionally filter by enabled).
// When the caller is authenticated as an instructor (or admin impersonating
// one), each row is annotated with `available` indicating whether the caller
// has a usable API key for that vendor. `available_only=true` filters out
// rows where !available.
router.get('/', async (req, res) => {
  try {
    const { enabled, available_only } = req.query;
    let query = `SELECT ${MODEL_FIELDS} FROM models`;
    const params = [];
    if (enabled !== undefined) {
      query += ' WHERE enabled = ?';
      params.push(enabled === 'true' ? 1 : 0);
    }
    query += ' ORDER BY model_name ASC';
    const [rows] = await pool.execute(query, params);

    // Best-effort: only annotate when we can read instructor identity.
    let availableSet = null;
    try {
      const instructorId = getEffectiveInstructorId(req);
      if (instructorId !== undefined) {
        availableSet = await getAvailableProviders(instructorId);
      }
    } catch (_) { /* swallow — annotation is optional */ }

    let data = rows.map(serializeRow).map(r => ({
      ...r,
      available: availableSet ? availableSet.has(r.vendor) : true,
    }));
    if (available_only === 'true' && availableSet) {
      data = data.filter(r => r.available);
    }

    res.json({ data, error: null });
  } catch (error) {
    console.error('Error fetching models:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// POST /api/models/openrouter/lookup - Fetch metadata from OpenRouter for prefill
const OPENROUTER_LOOKUP_TTL_MS = 5 * 60 * 1000;
let openRouterCatalogCache = { fetchedAt: 0, models: null };

async function fetchOpenRouterCatalog() {
  const now = Date.now();
  if (openRouterCatalogCache.models && now - openRouterCatalogCache.fetchedAt < OPENROUTER_LOOKUP_TTL_MS) {
    return openRouterCatalogCache.models;
  }
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    const err = new Error('OPENROUTER_API_KEY not configured on the server');
    err.statusCode = 400;
    throw err;
  }
  const headers = { Authorization: `Bearer ${apiKey}` };
  if (process.env.OPENROUTER_HTTP_REFERER) headers['HTTP-Referer'] = process.env.OPENROUTER_HTTP_REFERER;
  if (process.env.OPENROUTER_X_TITLE) headers['X-Title'] = process.env.OPENROUTER_X_TITLE;

  const response = await fetch('https://openrouter.ai/api/v1/models', { headers });
  if (!response.ok) {
    const body = await response.text();
    const err = new Error(`OpenRouter returned ${response.status}: ${body.slice(0, 200)}`);
    err.statusCode = 502;
    throw err;
  }
  const json = await response.json();
  const models = Array.isArray(json?.data) ? json.data : [];
  openRouterCatalogCache = { fetchedAt: now, models };
  return models;
}

function toMillions(value) {
  if (value == null || value === '') return null;
  const num = parseFloat(value);
  if (Number.isNaN(num)) return null;
  return Math.round(num * 1_000_000 * 10000) / 10000;
}

function inferOpenRouterType(model) {
  const supported = new Set(model?.supported_parameters ?? []);
  if (supported.has('reasoning') || supported.has('reasoning_effort')) return 'reasoning';
  const out = new Set(model?.architecture?.output_modalities ?? []);
  if (out.has('image') || out.has('video')) return 'vision';
  if ((model?.name ?? '').toLowerCase().includes('code')) return 'code';
  return 'regular';
}

router.post(
  '/openrouter/lookup',
  verifyToken,
  requireRole(['admin']),
  requirePermission('models'),
  async (req, res) => {
    try {
      const { openrouter_model_id } = req.body || {};
      if (!openrouter_model_id || typeof openrouter_model_id !== 'string') {
        return res.status(400).json({ data: null, error: { message: 'openrouter_model_id is required' } });
      }
      const trimmedId = openrouter_model_id.trim();
      if (!trimmedId) {
        return res.status(400).json({ data: null, error: { message: 'openrouter_model_id is required' } });
      }

      const catalog = await fetchOpenRouterCatalog();
      const selected = catalog.find(
        (m) => typeof m?.id === 'string' && m.id.toLowerCase() === trimmedId.toLowerCase()
      );
      if (!selected) {
        return res.status(404).json({
          data: null,
          error: { message: `Model not found in OpenRouter catalog: ${trimmedId}` },
        });
      }

      const pricing = selected.pricing ?? {};
      const cachePrice = pricing.input_cache_read ?? pricing.input_cache_write ?? null;
      const releaseDate =
        typeof selected.created === 'number'
          ? new Date(selected.created * 1000).toISOString().slice(0, 10)
          : null;

      res.json({
        data: {
          prefill: {
            vendor: 'openrouter',
            model_id: selected.id ?? trimmedId,
            model_name: selected.name ?? selected.id ?? trimmedId,
            type: inferOpenRouterType(selected),
            release_date: releaseDate,
            cpm_input: toMillions(pricing.prompt),
            cpm_input_cache: toMillions(cachePrice),
            cpm_output: toMillions(pricing.completion),
            supported_parameters: selected.supported_parameters ?? [],
            default_parameters: selected.default_parameters ?? {},
            parameter_settings: {},
            enabled: true,
          },
          openrouter: {
            supported_parameters: selected.supported_parameters ?? [],
            default_parameters: selected.default_parameters ?? {},
            context_length: selected.context_length ?? null,
            description: selected.description ?? '',
          },
        },
        error: null,
      });
    } catch (error) {
      const status = error.statusCode || 500;
      console.error('OpenRouter lookup failed:', error);
      res.status(status).json({ data: null, error: { message: error.message } });
    }
  }
);

// GET /api/models/:id - Get single model
router.get('/:id', async (req, res) => {
  try {
    const row = await fetchModelRow(req.params.id);
    if (!row) return res.status(404).json({ data: null, error: { message: 'Model not found' } });
    res.json({ data: row, error: null });
  } catch (error) {
    console.error('Error fetching model:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// POST /api/models - Create model (admin only)
router.post('/', verifyToken, requireRole(['admin']), requirePermission('models'), async (req, res) => {
  try {
    const {
      model_id,
      model_name,
      vendor,
      enabled = true,
      default: isDefault = false,
      cpm_input,
      cpm_input_cache,
      cpm_output,
      temperature,
      reasoning_effort,
      release_date,
      type,
      supported_parameters,
      default_parameters,
      parameter_settings,
    } = req.body;

    if (!model_id || !model_name) {
      return res.status(400).json({ data: null, error: { message: 'model_id and model_name are required' } });
    }
    if (!vendor || !VALID_VENDORS.includes(vendor)) {
      return res.status(400).json({
        data: null,
        error: { message: `vendor must be one of: ${VALID_VENDORS.join(', ')}` },
      });
    }

    const [existing] = await pool.execute('SELECT model_id FROM models WHERE model_id = ?', [model_id]);
    if (existing.length > 0) {
      return res.status(409).json({ data: null, error: { message: 'Model ID already exists' } });
    }

    if (isDefault) await pool.execute('UPDATE models SET default_model = 0');

    await pool.execute(
      `INSERT INTO models
         (model_id, model_name, vendor, enabled, default_model,
          cpm_input, cpm_input_cache, cpm_output, temperature, reasoning_effort,
          release_date, \`type\`, supported_parameters, default_parameters, parameter_settings)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        model_id,
        model_name,
        vendor,
        enabled ? 1 : 0,
        isDefault ? 1 : 0,
        cpm_input ?? null,
        cpm_input_cache ?? null,
        cpm_output ?? null,
        temperature ?? null,
        reasoning_effort ?? null,
        release_date ?? null,
        type ?? 'regular',
        toJsonOrNull(supported_parameters),
        toJsonOrNull(default_parameters),
        toJsonOrNull(parameter_settings),
      ]
    );

    const row = await fetchModelRow(model_id);
    res.status(201).json({ data: row, error: null });
  } catch (error) {
    console.error('Error creating model:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PATCH /api/models/:id - Update model (admin only)
router.patch('/:id', verifyToken, requireRole(['admin']), requirePermission('models'), async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body || {};

    const existing = await fetchModelRow(id);
    if (!existing) return res.status(404).json({ data: null, error: { message: 'Model not found' } });

    const setClauses = [];
    const params = [];

    const simpleFields = [
      'model_name',
      'cpm_input',
      'cpm_input_cache',
      'cpm_output',
      'temperature',
      'reasoning_effort',
      'release_date',
      'test_date',
    ];
    for (const key of simpleFields) {
      if (key in updates) {
        setClauses.push(`${key} = ?`);
        params.push(updates[key] ?? null);
      }
    }

    if ('type' in updates) {
      setClauses.push('`type` = ?');
      params.push(updates.type ?? 'regular');
    }
    if ('vendor' in updates) {
      if (!VALID_VENDORS.includes(updates.vendor)) {
        return res.status(400).json({
          data: null,
          error: { message: `vendor must be one of: ${VALID_VENDORS.join(', ')}` },
        });
      }
      setClauses.push('vendor = ?');
      params.push(updates.vendor);
    }
    if ('default' in updates) {
      setClauses.push('default_model = ?');
      params.push(updates.default ? 1 : 0);
    }
    if ('enabled' in updates) {
      setClauses.push('enabled = ?');
      params.push(updates.enabled ? 1 : 0);
    }

    for (const jsonKey of ['supported_parameters', 'default_parameters', 'parameter_settings', 'test_results']) {
      if (jsonKey in updates) {
        setClauses.push(`${jsonKey} = ?`);
        params.push(toJsonOrNull(updates[jsonKey]));
      }
    }

    if ('test_status' in updates) {
      const val = updates.test_status;
      if (val !== null && val !== 'pass' && val !== 'fail') {
        return res.status(400).json({
          data: null,
          error: { message: "test_status must be 'pass', 'fail', or null" },
        });
      }
      setClauses.push('test_status = ?');
      params.push(val);
    }

    if ('test_result' in updates) {
      const val = updates.test_result == null ? null : String(updates.test_result).slice(0, 200);
      setClauses.push('test_result = ?');
      params.push(val);
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ data: null, error: { message: 'No valid fields to update' } });
    }

    if (updates.default) await pool.execute('UPDATE models SET default_model = 0');

    params.push(id);
    await pool.execute(`UPDATE models SET ${setClauses.join(', ')} WHERE model_id = ?`, params);

    if (updates.enabled === false) {
      await pool.execute('UPDATE models SET default_model = 0 WHERE model_id = ?', [id]);
    }

    const row = await fetchModelRow(id);
    res.json({ data: row, error: null });
  } catch (error) {
    console.error('Error updating model:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// POST /api/models/:id/test - Run live connectivity test against the model
router.post(
  '/:id/test',
  verifyToken,
  requireRole(['admin']),
  requirePermission('models'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const model = await fetchModelRow(id);
      if (!model) return res.status(404).json({ data: null, error: { message: 'Model not found' } });

      const prompt = 'What is the capital of France?';
      const systemPrompt = 'Answer with a short factual response.';
      const startedAt = Date.now();
      let status = 'fail';
      let payload;

      try {
        const result = await chatWithLLM({
          modelId: model.model_id,
          vendor: model.vendor,
          systemPrompt,
          history: [],
          message: prompt,
          config: { temperature: 0.2, instructorId: getEffectiveInstructorId(req) },
        });
        const text = (result?.text ?? '').trim();
        const passed = Boolean(text) && text.toLowerCase().includes('paris');
        status = passed ? 'pass' : 'fail';
        payload = {
          status,
          message: passed ? 'Model returned expected answer.' : "Model responded but 'Paris' not found.",
          tested_model: `${model.vendor}:${model.model_id}`,
          prompt,
          response_preview: text.slice(0, 300),
          seconds: (Date.now() - startedAt) / 1000,
          temperature_used: result?.meta?.temperature ?? 0.2,
          usage: result?.meta?.cacheMetrics ?? {},
        };
      } catch (err) {
        status = 'fail';
        payload = {
          status: 'fail',
          error: String(err?.message ?? err),
          tested_model: `${model.vendor}:${model.model_id}`,
          prompt,
        };
      }

      const legacyText = status === 'pass' ? 'success' : `failed: ${payload.error || payload.message || 'unknown'}`.slice(0, 200);
      await pool.execute(
        `UPDATE models
           SET test_date = NOW(),
               test_status = ?,
               test_results = ?,
               test_result = ?
         WHERE model_id = ?`,
        [status, JSON.stringify(payload), legacyText, id]
      );

      const updated = await fetchModelRow(id);
      res.status(status === 'pass' ? 200 : 502).json({
        data: {
          success: status === 'pass',
          status,
          model_name: model.model_name,
          test_date: updated.test_date,
          test_results: payload,
          model: updated,
        },
        error: status === 'pass' ? null : { message: payload.error || payload.message || 'Test failed' },
      });
    } catch (error) {
      console.error('Error running model test:', error);
      res.status(500).json({ data: null, error: { message: error.message } });
    }
  }
);

// DELETE /api/models/:id - Delete model (admin only)
router.delete('/:id', verifyToken, requireRole(['admin']), requirePermission('models'), async (req, res) => {
  try {
    const { id } = req.params;
    const [existing] = await pool.execute('SELECT model_id FROM models WHERE model_id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Model not found' } });
    }

    const [refs] = await pool.execute(
      'SELECT COUNT(*) as cnt FROM sections WHERE chat_model = ? OR super_model = ?',
      [id, id]
    );
    if (refs[0].cnt > 0) {
      return res.status(409).json({
        data: null,
        error: { message: 'Model is assigned to one or more sections. Reassign those sections before deleting this model.' },
      });
    }

    await pool.execute('DELETE FROM models WHERE model_id = ?', [id]);
    res.json({ data: { deleted: true }, error: null });
  } catch (error) {
    console.error('Error deleting model:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

export default router;
