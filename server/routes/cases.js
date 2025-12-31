import express from 'express';
import { pool } from '../db.js';
import { verifyToken, requireRole } from '../middleware/auth.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CASE_FILES_DIR = path.join(__dirname, '../../case_files');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const caseId = req.params.id;
    const caseDir = path.join(CASE_FILES_DIR, caseId);
    try {
      await fs.mkdir(caseDir, { recursive: true });
      cb(null, caseDir);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    const fileType = req.body.file_type || 'case';
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${fileType}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.pdf', '.md', '.txt'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF, MD, and TXT files are allowed'));
    }
  }
});

// Helper: Convert PDF to markdown (basic text extraction)
async function convertPdfToMarkdown(pdfPath) {
  const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;
  const dataBuffer = await fs.readFile(pdfPath);
  const data = await pdfParse(dataBuffer);
  return data.text;
}

// GET /api/cases - List all cases
router.get('/', async (req, res) => {
  try {
    const { enabled } = req.query;
    let query = `
      SELECT c.case_id, c.case_title, c.protagonist, c.protagonist_initials, 
             c.chat_topic, c.chat_question, c.created_at, c.enabled
      FROM cases c
    `;
    const params = [];
    
    if (enabled !== undefined) {
      query += ' WHERE c.enabled = ?';
      params.push(enabled === 'true' ? 1 : 0);
    }
    
    query += ' ORDER BY c.created_at DESC';
    
    const [rows] = await pool.execute(query, params);
    res.json({ data: rows, error: null });
  } catch (error) {
    console.error('Error fetching cases:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/cases/:id - Get single case with files
router.get('/:id', async (req, res) => {
  try {
    const [cases] = await pool.execute(
      `SELECT case_id, case_title, protagonist, protagonist_initials, 
              chat_topic, chat_question, created_at, enabled
       FROM cases WHERE case_id = ?`,
      [req.params.id]
    );
    
    if (cases.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Case not found' } });
    }
    
    const [files] = await pool.execute(
      'SELECT id, filename, file_type, created_at FROM case_files WHERE case_id = ?',
      [req.params.id]
    );
    
    res.json({ data: { ...cases[0], files }, error: null });
  } catch (error) {
    console.error('Error fetching case:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// POST /api/cases - Create new case (admin only)
router.post('/', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { case_id, case_title, protagonist, protagonist_initials, chat_topic, chat_question, enabled } = req.body;
    
    if (!case_id || !case_title || !protagonist || !protagonist_initials || !chat_question) {
      return res.status(400).json({ 
        data: null, 
        error: { message: 'case_id, case_title, protagonist, protagonist_initials, and chat_question are required' } 
      });
    }
    
    // Check if case_id already exists
    const [existing] = await pool.execute('SELECT case_id FROM cases WHERE case_id = ?', [case_id]);
    if (existing.length > 0) {
      return res.status(409).json({ data: null, error: { message: 'Case ID already exists' } });
    }
    
    await pool.execute(
      `INSERT INTO cases (case_id, case_title, protagonist, protagonist_initials, chat_topic, chat_question, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [case_id, case_title, protagonist, protagonist_initials, chat_topic || null, chat_question, enabled !== false ? 1 : 0]
    );
    
    // Create case directory
    const caseDir = path.join(CASE_FILES_DIR, case_id);
    await fs.mkdir(caseDir, { recursive: true });
    
    // Return created case
    const [rows] = await pool.execute(
      `SELECT case_id, case_title, protagonist, protagonist_initials, chat_topic, chat_question, created_at, enabled
       FROM cases WHERE case_id = ?`,
      [case_id]
    );
    
    res.status(201).json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error creating case:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PATCH /api/cases/:id - Update case (admin only)
router.patch('/:id', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    const allowedFields = ['case_title', 'protagonist', 'protagonist_initials', 'chat_topic', 'chat_question', 'enabled'];
    const setClauses = [];
    const params = [];
    
    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        setClauses.push(`${key} = ?`);
        if (key === 'enabled') {
          params.push(value ? 1 : 0);
        } else {
          params.push(value === '' ? null : value);
        }
      }
    }
    
    if (setClauses.length === 0) {
      return res.status(400).json({ data: null, error: { message: 'No valid fields to update' } });
    }
    
    params.push(id);
    
    await pool.execute(`UPDATE cases SET ${setClauses.join(', ')} WHERE case_id = ?`, params);
    
    const [rows] = await pool.execute(
      `SELECT case_id, case_title, protagonist, protagonist_initials, chat_topic, chat_question, created_at, enabled
       FROM cases WHERE case_id = ?`,
      [id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Case not found' } });
    }
    
    res.json({ data: rows[0], error: null });
  } catch (error) {
    console.error('Error updating case:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// DELETE /api/cases/:id - Delete case (admin only)
router.delete('/:id', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if case exists
    const [existing] = await pool.execute('SELECT case_id FROM cases WHERE case_id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Case not found' } });
    }
    
    // Check if case is assigned to any sections
    const [assignments] = await pool.execute(
      'SELECT section_id FROM section_cases WHERE case_id = ?',
      [id]
    );
    if (assignments.length > 0) {
      return res.status(409).json({ 
        data: null, 
        error: { message: `Cannot delete case: it is assigned to ${assignments.length} section(s). Remove assignments first.` } 
      });
    }
    
    // Delete case files from disk
    const caseDir = path.join(CASE_FILES_DIR, id);
    try {
      await fs.rm(caseDir, { recursive: true, force: true });
    } catch (e) {
      // Directory might not exist, that's ok
    }
    
    // Delete from database (case_files will cascade)
    await pool.execute('DELETE FROM cases WHERE case_id = ?', [id]);
    
    res.json({ data: { deleted: true }, error: null });
  } catch (error) {
    console.error('Error deleting case:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// POST /api/cases/:id/upload - Upload case or teaching note file (admin only)
router.post('/:id/upload', verifyToken, requireRole(['admin']), upload.single('file'), async (req, res) => {
  try {
    const { id } = req.params;
    const fileType = req.body.file_type || 'case'; // 'case' or 'teaching_note'
    
    if (!['case', 'teaching_note'].includes(fileType)) {
      return res.status(400).json({ data: null, error: { message: 'file_type must be "case" or "teaching_note"' } });
    }
    
    // Check if case exists
    const [existing] = await pool.execute('SELECT case_id FROM cases WHERE case_id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Case not found' } });
    }
    
    if (!req.file) {
      return res.status(400).json({ data: null, error: { message: 'No file uploaded' } });
    }
    
    const uploadedPath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();
    let markdownContent;
    
    // Convert PDF to markdown if needed
    if (ext === '.pdf') {
      markdownContent = await convertPdfToMarkdown(uploadedPath);
      // Save as markdown
      const mdPath = path.join(CASE_FILES_DIR, id, `${fileType}.md`);
      await fs.writeFile(mdPath, markdownContent, 'utf-8');
      // Remove original PDF
      await fs.unlink(uploadedPath);
    } else {
      // For .md and .txt files, just rename to standard name
      const mdPath = path.join(CASE_FILES_DIR, id, `${fileType}.md`);
      if (uploadedPath !== mdPath) {
        await fs.rename(uploadedPath, mdPath);
      }
      markdownContent = await fs.readFile(mdPath, 'utf-8');
    }
    
    // Update or insert file record
    const [existingFile] = await pool.execute(
      'SELECT id FROM case_files WHERE case_id = ? AND file_type = ?',
      [id, fileType]
    );
    
    const filename = `${fileType}.md`;
    
    if (existingFile.length > 0) {
      await pool.execute(
        'UPDATE case_files SET filename = ?, created_at = CURRENT_TIMESTAMP WHERE case_id = ? AND file_type = ?',
        [filename, id, fileType]
      );
    } else {
      await pool.execute(
        'INSERT INTO case_files (case_id, filename, file_type) VALUES (?, ?, ?)',
        [id, filename, fileType]
      );
    }
    
    res.json({ 
      data: { 
        case_id: id, 
        file_type: fileType, 
        filename,
        content_preview: markdownContent.substring(0, 500) + (markdownContent.length > 500 ? '...' : '')
      }, 
      error: null 
    });
  } catch (error) {
    console.error('Error uploading file:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/cases/:id/content/:fileType - Get markdown content for case or teaching_note
router.get('/:id/content/:fileType', async (req, res) => {
  try {
    const { id, fileType } = req.params;
    
    if (!['case', 'teaching_note'].includes(fileType)) {
      return res.status(400).json({ data: null, error: { message: 'fileType must be "case" or "teaching_note"' } });
    }
    
    const mdPath = path.join(CASE_FILES_DIR, id, `${fileType}.md`);
    
    try {
      const content = await fs.readFile(mdPath, 'utf-8');
      res.json({ data: { case_id: id, file_type: fileType, content }, error: null });
    } catch (e) {
      if (e.code === 'ENOENT') {
        return res.status(404).json({ data: null, error: { message: `${fileType} file not found for this case` } });
      }
      throw e;
    }
  } catch (error) {
    console.error('Error reading case content:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

export default router;
