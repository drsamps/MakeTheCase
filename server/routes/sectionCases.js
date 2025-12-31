import express from 'express';
import { pool } from '../db.js';
import { verifyToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

// GET /api/sections/:sectionId/cases - List cases assigned to a section
router.get('/:sectionId/cases', async (req, res) => {
  try {
    const { sectionId } = req.params;
    
    const [rows] = await pool.execute(
      `SELECT sc.id, sc.section_id, sc.case_id, sc.active, sc.chat_options, sc.created_at,
              c.case_title, c.protagonist, c.protagonist_initials, c.chat_topic, c.chat_question, c.enabled as case_enabled
       FROM section_cases sc
       JOIN cases c ON sc.case_id = c.case_id
       WHERE sc.section_id = ?
       ORDER BY sc.active DESC, sc.created_at DESC`,
      [sectionId]
    );
    
    res.json({ data: rows, error: null });
  } catch (error) {
    console.error('Error fetching section cases:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/sections/:sectionId/active-case - Get the currently active case for a section (used by students)
router.get('/:sectionId/active-case', async (req, res) => {
  try {
    const { sectionId } = req.params;
    
    const [rows] = await pool.execute(
      `SELECT sc.id, sc.section_id, sc.case_id, sc.chat_options,
              c.case_title, c.protagonist, c.protagonist_initials, c.chat_topic, c.chat_question
       FROM section_cases sc
       JOIN cases c ON sc.case_id = c.case_id
       WHERE sc.section_id = ? AND sc.active = TRUE AND c.enabled = TRUE
       LIMIT 1`,
      [sectionId]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'No active case found for this section' } });
    }
    
    res.json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error fetching active case:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// POST /api/sections/:sectionId/cases - Assign a case to a section (admin only)
router.post('/:sectionId/cases', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { sectionId } = req.params;
    const { case_id, active, chat_options } = req.body;
    
    if (!case_id) {
      return res.status(400).json({ data: null, error: { message: 'case_id is required' } });
    }
    
    // Check if section exists
    const [sections] = await pool.execute('SELECT section_id FROM sections WHERE section_id = ?', [sectionId]);
    if (sections.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Section not found' } });
    }
    
    // Check if case exists
    const [cases] = await pool.execute('SELECT case_id FROM cases WHERE case_id = ?', [case_id]);
    if (cases.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Case not found' } });
    }
    
    // Check if assignment already exists
    const [existing] = await pool.execute(
      'SELECT id FROM section_cases WHERE section_id = ? AND case_id = ?',
      [sectionId, case_id]
    );
    if (existing.length > 0) {
      return res.status(409).json({ data: null, error: { message: 'Case is already assigned to this section' } });
    }
    
    // If setting this case as active, deactivate all others first
    if (active) {
      await pool.execute(
        'UPDATE section_cases SET active = FALSE WHERE section_id = ?',
        [sectionId]
      );
    }
    
    // Insert the assignment
    const chatOptionsJson = chat_options ? JSON.stringify(chat_options) : null;
    await pool.execute(
      'INSERT INTO section_cases (section_id, case_id, active, chat_options) VALUES (?, ?, ?, ?)',
      [sectionId, case_id, active ? 1 : 0, chatOptionsJson]
    );
    
    // Return the created assignment with case details
    const [rows] = await pool.execute(
      `SELECT sc.id, sc.section_id, sc.case_id, sc.active, sc.chat_options, sc.created_at,
              c.case_title, c.protagonist, c.protagonist_initials
       FROM section_cases sc
       JOIN cases c ON sc.case_id = c.case_id
       WHERE sc.section_id = ? AND sc.case_id = ?`,
      [sectionId, case_id]
    );
    
    res.status(201).json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error assigning case to section:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// DELETE /api/sections/:sectionId/cases/:caseId - Remove case from section (admin only)
router.delete('/:sectionId/cases/:caseId', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { sectionId, caseId } = req.params;
    
    const [existing] = await pool.execute(
      'SELECT id FROM section_cases WHERE section_id = ? AND case_id = ?',
      [sectionId, caseId]
    );
    
    if (existing.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Case assignment not found' } });
    }
    
    await pool.execute(
      'DELETE FROM section_cases WHERE section_id = ? AND case_id = ?',
      [sectionId, caseId]
    );
    
    res.json({ data: { deleted: true }, error: null });
  } catch (error) {
    console.error('Error removing case from section:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PATCH /api/sections/:sectionId/cases/:caseId/activate - Set this case as active (admin only)
router.patch('/:sectionId/cases/:caseId/activate', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { sectionId, caseId } = req.params;
    
    // Check if assignment exists
    const [existing] = await pool.execute(
      'SELECT id FROM section_cases WHERE section_id = ? AND case_id = ?',
      [sectionId, caseId]
    );
    
    if (existing.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Case assignment not found' } });
    }
    
    // Deactivate all cases for this section
    await pool.execute(
      'UPDATE section_cases SET active = FALSE WHERE section_id = ?',
      [sectionId]
    );
    
    // Activate the specified case
    await pool.execute(
      'UPDATE section_cases SET active = TRUE WHERE section_id = ? AND case_id = ?',
      [sectionId, caseId]
    );
    
    // Return updated assignment
    const [rows] = await pool.execute(
      `SELECT sc.id, sc.section_id, sc.case_id, sc.active, sc.chat_options, sc.created_at,
              c.case_title, c.protagonist, c.protagonist_initials
       FROM section_cases sc
       JOIN cases c ON sc.case_id = c.case_id
       WHERE sc.section_id = ? AND sc.case_id = ?`,
      [sectionId, caseId]
    );
    
    res.json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error activating case:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PATCH /api/sections/:sectionId/cases/:caseId/deactivate - Deactivate a case (admin only)
router.patch('/:sectionId/cases/:caseId/deactivate', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { sectionId, caseId } = req.params;
    
    await pool.execute(
      'UPDATE section_cases SET active = FALSE WHERE section_id = ? AND case_id = ?',
      [sectionId, caseId]
    );
    
    const [rows] = await pool.execute(
      `SELECT sc.id, sc.section_id, sc.case_id, sc.active, sc.chat_options, sc.created_at,
              c.case_title, c.protagonist, c.protagonist_initials
       FROM section_cases sc
       JOIN cases c ON sc.case_id = c.case_id
       WHERE sc.section_id = ? AND sc.case_id = ?`,
      [sectionId, caseId]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Case assignment not found' } });
    }
    
    res.json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error deactivating case:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PATCH /api/sections/:sectionId/cases/:caseId/options - Update chat_options (admin only) - Phase 2
router.patch('/:sectionId/cases/:caseId/options', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { sectionId, caseId } = req.params;
    const { chat_options } = req.body;
    
    // Validate chat_options structure (basic validation)
    if (chat_options !== null && typeof chat_options !== 'object') {
      return res.status(400).json({ data: null, error: { message: 'chat_options must be an object or null' } });
    }
    
    const chatOptionsJson = chat_options ? JSON.stringify(chat_options) : null;
    
    await pool.execute(
      'UPDATE section_cases SET chat_options = ? WHERE section_id = ? AND case_id = ?',
      [chatOptionsJson, sectionId, caseId]
    );
    
    const [rows] = await pool.execute(
      `SELECT sc.id, sc.section_id, sc.case_id, sc.active, sc.chat_options, sc.created_at,
              c.case_title, c.protagonist, c.protagonist_initials
       FROM section_cases sc
       JOIN cases c ON sc.case_id = c.case_id
       WHERE sc.section_id = ? AND sc.case_id = ?`,
      [sectionId, caseId]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Case assignment not found' } });
    }
    
    res.json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error updating chat options:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

export default router;
