import express from 'express';
import { pool } from '../db.js';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';

const router = express.Router();

const MODEL_FIELDS =
  'model_id, model_name, enabled, default_model as `default`, input_cost, output_cost, temperature, reasoning_effort';

const LEGACY_MODEL_FIELDS =
  'model_id, model_name, enabled, default_model as `default`, input_cost, output_cost';

async function selectModels(queryBase, params = []) {
  // Try with extended fields; if the DB hasn't been migrated yet, fall back to legacy fields.
  try {
    const [rows] = await pool.execute(queryBase.replace('__FIELDS__', MODEL_FIELDS), params);
    return rows;
  } catch (err) {
    if (err.code === 'ER_BAD_FIELD_ERROR') {
      const [rowsLegacy] = await pool.execute(queryBase.replace('__FIELDS__', LEGACY_MODEL_FIELDS), params);
      return rowsLegacy;
    }
    throw err;
  }
}

// GET /api/models - Get all models (optionally filter by enabled)
router.get('/', async (req, res) => {
  try {
    const { enabled } = req.query;

    let query = `SELECT __FIELDS__ FROM models`;
    const params = [];

    if (enabled !== undefined) {
      query += ' WHERE enabled = ?';
      params.push(enabled === 'true' ? 1 : 0);
    }

    query += ' ORDER BY model_name ASC';

    const rows = await selectModels(query, params);
    res.json({ data: rows, error: null });
  } catch (error) {
    console.error('Error fetching models:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/models/:id - Get single model
router.get('/:id', async (req, res) => {
  try {
    const rows = await selectModels(
      `SELECT __FIELDS__ FROM models WHERE model_id = ?`,
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Model not found' } });
    }

    res.json({ data: rows[0], error: null });
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
      enabled = true,
      default: isDefault = false,
      input_cost,
      output_cost,
      temperature,
      reasoning_effort
    } = req.body;

    if (!model_id || !model_name) {
      return res.status(400).json({ data: null, error: { message: 'model_id and model_name are required' } });
    }

    const [existing] = await pool.execute('SELECT model_id FROM models WHERE model_id = ?', [model_id]);
    if (existing.length > 0) {
      return res.status(409).json({ data: null, error: { message: 'Model ID already exists' } });
    }

    if (isDefault) {
      await pool.execute('UPDATE models SET default_model = 0');
    }

    await pool.execute(
      'INSERT INTO models (model_id, model_name, enabled, default_model, input_cost, output_cost, temperature, reasoning_effort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        model_id,
        model_name,
        enabled ? 1 : 0,
        isDefault ? 1 : 0,
        input_cost ?? null,
        output_cost ?? null,
        temperature ?? null,
        reasoning_effort ?? null,
      ]
    );

    const [rows] = await pool.execute(`SELECT ${MODEL_FIELDS} FROM models WHERE model_id = ?`, [model_id]);
    res.status(201).json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error creating model:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PATCH /api/models/:id - Update model (admin only)
router.patch('/:id', verifyToken, requireRole(['admin']), requirePermission('models'), async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const [existing] = await pool.execute(`SELECT ${MODEL_FIELDS} FROM models WHERE model_id = ?`, [id]);
    if (existing.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Model not found' } });
    }

    const allowedFields = ['model_name', 'enabled', 'default', 'input_cost', 'output_cost', 'temperature', 'reasoning_effort'];
    const setClauses = [];
    const params = [];

    for (const [key, value] of Object.entries(updates)) {
      if (!allowedFields.includes(key)) continue;

      if (key === 'default') {
        setClauses.push('default_model = ?');
        params.push(value ? 1 : 0);
      } else if (key === 'enabled') {
        setClauses.push('enabled = ?');
        params.push(value ? 1 : 0);
      } else {
        setClauses.push(`${key} = ?`);
        params.push(value ?? null);
      }
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ data: null, error: { message: 'No valid fields to update' } });
    }

    // Ensure only one default_model = 1
    if (updates.default) {
      await pool.execute('UPDATE models SET default_model = 0');
    }

    params.push(id);
    await pool.execute(`UPDATE models SET ${setClauses.join(', ')} WHERE model_id = ?`, params);

    // If model was default but disabled, unset default
    if (updates.enabled === false) {
      await pool.execute('UPDATE models SET default_model = 0 WHERE model_id = ?', [id]);
    }

    const [rows] = await pool.execute(`SELECT ${MODEL_FIELDS} FROM models WHERE model_id = ?`, [id]);
    res.json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error updating model:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// DELETE /api/models/:id - Delete model (admin only)
router.delete('/:id', verifyToken, requireRole(['admin']), requirePermission('models'), async (req, res) => {
  try {
    const { id } = req.params;

    const [existing] = await pool.execute('SELECT model_id FROM models WHERE model_id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Model not found' } });
    }

    // Check if the model is referenced by sections
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

