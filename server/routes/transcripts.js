import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db.js';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { writeAudit } from '../services/auditLog.js';

const router = express.Router();

/**
 * POST /api/transcripts
 * Create a new transcript for a case_chat
 */
router.post('/', async (req, res) => {
  try {
    const { case_chat_id, transcript, saved_with_permission } = req.body;

    if (!case_chat_id || !transcript) {
      return res.status(400).json({
        data: null,
        error: { message: 'case_chat_id and transcript are required' }
      });
    }

    // Verify case_chat exists
    const [chatExists] = await pool.execute(
      'SELECT id FROM case_chats WHERE id = ?',
      [case_chat_id]
    );

    if (chatExists.length === 0) {
      return res.status(404).json({
        data: null,
        error: { message: 'Case chat not found' }
      });
    }

    // Check if transcript already exists for this chat
    const [existing] = await pool.execute(
      'SELECT id FROM transcripts WHERE case_chat_id = ?',
      [case_chat_id]
    );

    if (existing.length > 0) {
      return res.status(409).json({
        data: null,
        error: { message: 'Transcript already exists for this case chat' }
      });
    }

    const id = uuidv4();

    // Calculate word count
    const wordCount = transcript.trim().split(/\s+/).length;

    await pool.execute(
      `INSERT INTO transcripts (id, case_chat_id, transcript, word_count, saved_with_permission)
       VALUES (?, ?, ?, ?, ?)`,
      [id, case_chat_id, transcript, wordCount, saved_with_permission || false]
    );

    // Update case_chats to link to this transcript
    await pool.execute(
      'UPDATE case_chats SET transcript_id = ? WHERE id = ?',
      [id, case_chat_id]
    );

    const [rows] = await pool.execute(
      'SELECT * FROM transcripts WHERE id = ?',
      [id]
    );

    res.status(201).json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error creating transcript:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

/**
 * PUT /api/transcripts/chat/:caseChatId
 * Upsert transcript for a case_chat (used by auto-save during active chat).
 * Creates the transcript row on first call; updates it on subsequent calls.
 */
router.put('/chat/:caseChatId', async (req, res) => {
  try {
    const { caseChatId } = req.params;
    const { transcript, saved_with_permission } = req.body;

    if (!transcript) {
      return res.status(400).json({
        data: null,
        error: { message: 'transcript is required' }
      });
    }

    // Verify case_chat exists
    const [chatExists] = await pool.execute(
      'SELECT id FROM case_chats WHERE id = ?',
      [caseChatId]
    );

    if (chatExists.length === 0) {
      return res.status(404).json({
        data: null,
        error: { message: 'Case chat not found' }
      });
    }

    const wordCount = transcript.trim().split(/\s+/).length;

    // Check if transcript already exists for this chat
    const [existing] = await pool.execute(
      'SELECT id FROM transcripts WHERE case_chat_id = ?',
      [caseChatId]
    );

    let transcriptId;

    if (existing.length > 0) {
      // Update existing transcript
      transcriptId = existing[0].id;
      const updateFields = ['transcript = ?', 'word_count = ?'];
      const updateParams = [transcript, wordCount];
      if (saved_with_permission !== undefined) {
        updateFields.push('saved_with_permission = ?');
        updateParams.push(saved_with_permission);
      }
      updateParams.push(transcriptId);
      await pool.execute(
        `UPDATE transcripts SET ${updateFields.join(', ')} WHERE id = ?`,
        updateParams
      );
    } else {
      // Insert new transcript
      transcriptId = uuidv4();
      await pool.execute(
        `INSERT INTO transcripts (id, case_chat_id, transcript, word_count, saved_with_permission)
         VALUES (?, ?, ?, ?, ?)`,
        [transcriptId, caseChatId, transcript, wordCount, saved_with_permission || false]
      );

      // Link to case_chats
      await pool.execute(
        'UPDATE case_chats SET transcript_id = ? WHERE id = ?',
        [transcriptId, caseChatId]
      );
    }

    res.json({ data: { id: transcriptId }, error: null });
  } catch (error) {
    console.error('Error upserting transcript:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

/**
 * GET /api/transcripts/:id
 * Get a transcript by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await pool.execute(
      `SELECT t.*, 
              cc.student_id, cc.case_id, cc.section_id,
              s.full_name as student_name,
              c.case_title
       FROM transcripts t
       JOIN case_chats cc ON t.case_chat_id = cc.id
       LEFT JOIN students s ON cc.student_id = s.id
       LEFT JOIN cases c ON cc.case_id = c.case_id
       WHERE t.id = ?`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        data: null,
        error: { message: 'Transcript not found' }
      });
    }

    res.json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error fetching transcript:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

/**
 * GET /api/transcripts/chat/:caseChatId
 * Get transcript by case_chat_id
 */
router.get('/chat/:caseChatId', async (req, res) => {
  try {
    const { caseChatId } = req.params;

    const [rows] = await pool.execute(
      `SELECT t.*, 
              cc.student_id, cc.case_id, cc.section_id,
              s.full_name as student_name,
              c.case_title
       FROM transcripts t
       JOIN case_chats cc ON t.case_chat_id = cc.id
       LEFT JOIN students s ON cc.student_id = s.id
       LEFT JOIN cases c ON cc.case_id = c.case_id
       WHERE t.case_chat_id = ?`,
      [caseChatId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        data: null,
        error: { message: 'Transcript not found for this case chat' }
      });
    }

    res.json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error fetching transcript by case_chat_id:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

/**
 * PATCH /api/transcripts/:id/anonymize
 * Anonymize a transcript (replace sensitive information)
 * Admin only
 */
router.patch('/:id/anonymize', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { anonymized_transcript } = req.body;

    const [existing] = await pool.execute(
      'SELECT id, is_anonymized FROM transcripts WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        data: null,
        error: { message: 'Transcript not found' }
      });
    }

    if (existing[0].is_anonymized) {
      return res.status(400).json({
        data: null,
        error: { message: 'Transcript is already anonymized' }
      });
    }

    // If anonymized_transcript provided, use it; otherwise just mark as anonymized
    const updates = ['is_anonymized = TRUE', 'anonymized_at = CURRENT_TIMESTAMP'];
    const params = [];

    if (anonymized_transcript) {
      updates.push('transcript = ?');
      params.push(anonymized_transcript);
      
      // Recalculate word count
      const wordCount = anonymized_transcript.trim().split(/\s+/).length;
      updates.push('word_count = ?');
      params.push(wordCount);
    }

    params.push(id);

    await pool.execute(
      `UPDATE transcripts SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    const [rows] = await pool.execute(
      'SELECT * FROM transcripts WHERE id = ?',
      [id]
    );

    await writeAudit(req, { action: 'transcript.anonymize', resourceType: 'transcript', resourceId: id });

    res.json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error anonymizing transcript:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

/**
 * DELETE /api/transcripts/:id
 * Delete a transcript (admin only)
 * This will set transcript_id to NULL in case_chats due to ON DELETE SET NULL
 */
router.delete('/:id', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;

    const [existing] = await pool.execute(
      'SELECT id FROM transcripts WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        data: null,
        error: { message: 'Transcript not found' }
      });
    }

    await pool.execute('DELETE FROM transcripts WHERE id = ?', [id]);

    await writeAudit(req, { action: 'transcript.delete', resourceType: 'transcript', resourceId: id });

    res.json({ data: { deleted: true }, error: null });
  } catch (error) {
    console.error('Error deleting transcript:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

/**
 * GET /api/transcripts
 * List transcripts with filters (admin only)
 */
router.get('/', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { 
      section_id, 
      case_id, 
      is_anonymized,
      older_than_days,
      limit = 50, 
      offset = 0 
    } = req.query;

    let query = `
      SELECT 
        t.*,
        cc.student_id,
        cc.case_id,
        cc.section_id,
        s.full_name as student_name,
        c.case_title,
        sec.section_title
      FROM transcripts t
      JOIN case_chats cc ON t.case_chat_id = cc.id
      LEFT JOIN students s ON cc.student_id = s.id
      LEFT JOIN cases c ON cc.case_id = c.case_id
      LEFT JOIN sections sec ON cc.section_id = sec.section_id
      WHERE 1=1
    `;
    const params = [];

    if (section_id) {
      query += ' AND cc.section_id = ?';
      params.push(section_id);
    }

    if (case_id) {
      query += ' AND cc.case_id = ?';
      params.push(case_id);
    }

    if (is_anonymized !== undefined) {
      query += ' AND t.is_anonymized = ?';
      params.push(is_anonymized === 'true' || is_anonymized === true);
    }

    if (older_than_days) {
      query += ' AND DATEDIFF(CURRENT_DATE, DATE(t.created_at)) > ?';
      params.push(parseInt(older_than_days));
    }

    query += ' ORDER BY t.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const [rows] = await pool.query(query, params);

    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(*) as total
      FROM transcripts t
      JOIN case_chats cc ON t.case_chat_id = cc.id
      WHERE 1=1
    `;
    const countParams = [];

    if (section_id) {
      countQuery += ' AND cc.section_id = ?';
      countParams.push(section_id);
    }

    if (case_id) {
      countQuery += ' AND cc.case_id = ?';
      countParams.push(case_id);
    }

    if (is_anonymized !== undefined) {
      countQuery += ' AND t.is_anonymized = ?';
      countParams.push(is_anonymized === 'true' || is_anonymized === true);
    }

    if (older_than_days) {
      countQuery += ' AND DATEDIFF(CURRENT_DATE, DATE(t.created_at)) > ?';
      countParams.push(parseInt(older_than_days));
    }

    const [countResult] = await pool.query(countQuery, countParams);

    res.json({
      data: rows,
      total: countResult[0]?.total || 0,
      limit: parseInt(limit),
      offset: parseInt(offset),
      error: null
    });
  } catch (error) {
    console.error('Error listing transcripts:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

/**
 * POST /api/transcripts/bulk-anonymize
 * Anonymize multiple transcripts at once (admin only)
 */
router.post('/bulk-anonymize', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { transcript_ids, older_than_days } = req.body;

    let query;
    let params;

    if (transcript_ids && Array.isArray(transcript_ids) && transcript_ids.length > 0) {
      // Anonymize specific transcripts
      const placeholders = transcript_ids.map(() => '?').join(',');
      query = `
        UPDATE transcripts 
        SET is_anonymized = TRUE, anonymized_at = CURRENT_TIMESTAMP
        WHERE id IN (${placeholders}) AND is_anonymized = FALSE
      `;
      params = transcript_ids;
    } else if (older_than_days) {
      // Anonymize transcripts older than X days
      query = `
        UPDATE transcripts 
        SET is_anonymized = TRUE, anonymized_at = CURRENT_TIMESTAMP
        WHERE DATEDIFF(CURRENT_DATE, DATE(created_at)) > ?
          AND is_anonymized = FALSE
      `;
      params = [parseInt(older_than_days)];
    } else {
      return res.status(400).json({
        data: null,
        error: { message: 'Either transcript_ids array or older_than_days is required' }
      });
    }

    const [result] = await pool.execute(query, params);

    res.json({
      data: {
        anonymized_count: result.affectedRows,
        message: `Successfully anonymized ${result.affectedRows} transcript(s)`
      },
      error: null
    });
  } catch (error) {
    console.error('Error bulk anonymizing transcripts:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

export default router;
