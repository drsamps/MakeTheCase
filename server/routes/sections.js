import express from 'express';
import { pool } from '../db.js';

const router = express.Router();

// GET /api/sections - Get all sections (optionally filter by enabled)
router.get('/', async (req, res) => {
  try {
    const { enabled, orderBy } = req.query;
    
    let query = 'SELECT section_id, created_at, section_title, year_term, enabled, chat_model, super_model FROM sections';
    const params = [];
    
    if (enabled !== undefined) {
      query += ' WHERE enabled = ?';
      params.push(enabled === 'true' ? 1 : 0);
    }
    
    // Default ordering: year_term DESC, section_title ASC
    query += ' ORDER BY year_term DESC, section_title ASC';
    
    const [rows] = await pool.execute(query, params);
    res.json({ data: rows, error: null });
  } catch (error) {
    console.error('Error fetching sections:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/sections/:id - Get single section
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT section_id, created_at, section_title, year_term, enabled, chat_model, super_model FROM sections WHERE section_id = ?',
      [req.params.id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Section not found' } });
    }
    
    res.json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error fetching section:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

export default router;

