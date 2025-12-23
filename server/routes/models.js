import express from 'express';
import { pool } from '../db.js';

const router = express.Router();

// GET /api/models - Get all models (optionally filter by enabled)
router.get('/', async (req, res) => {
  try {
    const { enabled } = req.query;
    
    let query = 'SELECT model_id, model_name, enabled, default_model as `default`, input_cost, output_cost FROM models';
    const params = [];
    
    if (enabled !== undefined) {
      query += ' WHERE enabled = ?';
      params.push(enabled === 'true' ? 1 : 0);
    }
    
    const [rows] = await pool.execute(query, params);
    res.json({ data: rows, error: null });
  } catch (error) {
    console.error('Error fetching models:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/models/:id - Get single model
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT model_id, model_name, enabled, default_model as `default`, input_cost, output_cost FROM models WHERE model_id = ?',
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

export default router;

