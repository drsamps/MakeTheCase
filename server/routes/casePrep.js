/**
 * Case Prep Routes
 * Handles file upload, AI processing, and outline editing for case preparation
 */

import express from 'express';
import { pool } from '../db.js';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { convertFile } from '../services/fileConverter.js';
import { getActivePrompt, renderPrompt } from '../services/promptService.js';
import { generateOutlineWithLLM } from '../services/llmRouter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CASE_FILES_DIR = path.join(__dirname, '../../case_files');

const router = express.Router();

// Test route to verify router is working
router.get('/test', (req, res) => {
  console.log('[CasePrep] Test route hit');
  res.json({ message: 'Case prep routes are working', timestamp: new Date().toISOString() });
});

// Configure multer for file uploads to uploads subdirectory
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const caseId = req.params.caseId;
    const uploadsDir = path.join(CASE_FILES_DIR, caseId, 'uploads');
    try {
      await fs.mkdir(uploadsDir, { recursive: true });
      cb(null, uploadsDir);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    // Preserve original filename with timestamp to avoid conflicts
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    const basename = path.basename(file.originalname, ext);
    cb(null, `${basename}-${timestamp}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.pdf', '.docx', '.doc', '.md', '.txt'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF, DOCX, MD, and TXT files are allowed'));
    }
  }
});

// POST /api/case-prep/:caseId/upload - Upload file for processing
router.post('/:caseId/upload', verifyToken, requireRole(['admin']), requirePermission('caseprep'), async (req, res) => {
  console.log('[CasePrep] Upload route hit, caseId:', req.params.caseId);
  
  // Handle file upload with multer
  upload.single('file')(req, res, async (err) => {
    if (err) {
      console.error('[CasePrep] Multer error:', err);
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            data: null,
            error: { message: 'File size exceeds 10MB limit' }
          });
        }
        return res.status(400).json({
          data: null,
          error: { message: `Upload error: ${err.message}` }
        });
      }
      return res.status(400).json({
        data: null,
        error: { message: err.message || 'File upload failed' }
      });
    }

    // File upload successful, process the request
    try {
      const { caseId } = req.params;
      const { file_type } = req.body; // 'case' or 'notes'

      console.log('[CasePrep] Upload request:', { caseId, file_type, hasFile: !!req.file });

      if (!file_type || !['case', 'notes'].includes(file_type)) {
        return res.status(400).json({
          data: null,
          error: { message: 'file_type must be either "case" or "notes"' }
        });
      }

      if (!req.file) {
        return res.status(400).json({
          data: null,
          error: { message: 'No file uploaded' }
        });
      }

      // Verify case exists
      const [cases] = await pool.execute('SELECT case_id FROM cases WHERE case_id = ?', [caseId]);
      if (cases.length === 0) {
        // Clean up uploaded file
        await fs.unlink(req.file.path);
        return res.status(404).json({
          data: null,
          error: { message: 'Case not found' }
        });
      }

      // Create case_files record with pending status
      const [result] = await pool.execute(
        `INSERT INTO case_files (case_id, filename, file_type, processing_status, created_at)
         VALUES (?, ?, ?, 'pending', NOW())`,
        [caseId, req.file.filename, file_type]
      );

      const fileId = result.insertId;

      // Return file info
      const [fileRecord] = await pool.execute(
        'SELECT id, case_id, filename, file_type, processing_status, created_at FROM case_files WHERE id = ?',
        [fileId]
      );

      res.status(201).json({
        data: fileRecord[0],
        error: null
      });

    } catch (error) {
      console.error('[CasePrep] Error uploading file:', error);
      console.error('[CasePrep] Error stack:', error.stack);
      res.status(500).json({
        data: null,
        error: { message: error.message || 'Upload failed' }
      });
    }
  }); // End of multer callback
});

// POST /api/case-prep/:caseId/process - Process uploaded file with AI
router.post('/:caseId/process', verifyToken, requireRole(['admin']), requirePermission('caseprep'), async (req, res) => {
  try {
    const { caseId } = req.params;
    const { file_id, model_id } = req.body;

    if (!file_id || !model_id) {
      return res.status(400).json({
        data: null,
        error: { message: 'file_id and model_id are required' }
      });
    }

    // Get file record
    const [files] = await pool.execute(
      'SELECT id, case_id, filename, file_type, processing_status FROM case_files WHERE id = ? AND case_id = ?',
      [file_id, caseId]
    );

    if (files.length === 0) {
      return res.status(404).json({
        data: null,
        error: { message: 'File not found' }
      });
    }

    const fileRecord = files[0];
    const filePath = path.join(CASE_FILES_DIR, caseId, 'uploads', fileRecord.filename);

    // Update status to processing
    await pool.execute(
      'UPDATE case_files SET processing_status = ?, processing_model = ?, processing_error = NULL WHERE id = ?',
      ['processing', model_id, file_id]
    );

    try {
      // Step 1: Convert file to text
      console.log('[CasePrep] Step 1: Converting file to text...');
      const ext = path.extname(fileRecord.filename);
      const { text: fileContent } = await convertFile(filePath, ext);
      console.log('[CasePrep] File converted, text length:', fileContent.length);

      // Step 2: Get active prompt template based on file type
      console.log('[CasePrep] Step 2: Getting active prompt template...');
      const promptUse = fileRecord.file_type === 'case' ? 'case_outline_generation' : 'notes_cleanup';
      const activePrompt = await getActivePrompt(promptUse);
      console.log('[CasePrep] Active prompt:', activePrompt ? `${activePrompt.use} v${activePrompt.version}` : 'NOT FOUND');

      if (!activePrompt) {
        throw new Error(`No active prompt found for ${promptUse}`);
      }

      // Step 3: Render prompt with file content
      console.log('[CasePrep] Step 3: Rendering prompt...');
      const variables = fileRecord.file_type === 'case'
        ? { case_content: fileContent }
        : { notes_content: fileContent };

      const renderedPrompt = renderPrompt(activePrompt.prompt_template, variables);
      console.log('[CasePrep] Rendered prompt length:', renderedPrompt.length);

      // Step 4: Get model config
      console.log('[CasePrep] Step 4: Getting model config for:', model_id);
      const [models] = await pool.execute(
        'SELECT model_id, temperature, reasoning_effort FROM models WHERE model_id = ? AND enabled = 1',
        [model_id]
      );

      if (models.length === 0) {
        throw new Error('Model not found or disabled');
      }

      const modelConfig = {
        temperature: models[0].temperature,
        reasoning_effort: models[0].reasoning_effort
      };
      console.log('[CasePrep] Model config:', modelConfig);

      // Step 5: Call LLM to generate outline
      console.log('[CasePrep] Step 5: Calling LLM to generate outline...');
      const { text: outline, meta } = await generateOutlineWithLLM({
        modelId: model_id,
        prompt: renderedPrompt,
        config: modelConfig
      });
      console.log('[CasePrep] LLM returned outline length:', outline ? outline.length : 0);

      // Step 6: Save outline and update status
      console.log('[CasePrep] Step 6: Saving outline to database...');
      await pool.execute(
        `UPDATE case_files
         SET outline_content = ?, processing_status = ?, processed_at = NOW(), processing_error = NULL
         WHERE id = ?`,
        [outline, 'completed', file_id]
      );
      console.log('[CasePrep] Database updated successfully');

      // Return generated outline
      const [updatedFile] = await pool.execute(
        `SELECT id, case_id, filename, file_type, processing_status, processing_model,
                outline_content, processed_at, created_at
         FROM case_files WHERE id = ?`,
        [file_id]
      );

      console.log('[CasePrep] Returning file record with outline_content length:', 
        updatedFile[0]?.outline_content?.length || 0);

      res.json({
        data: updatedFile[0],
        error: null
      });

    } catch (processingError) {
      // Update status to failed with error message
      await pool.execute(
        'UPDATE case_files SET processing_status = ?, processing_error = ? WHERE id = ?',
        ['failed', processingError.message, file_id]
      );

      throw processingError;
    }

  } catch (error) {
    console.error('Error processing file:', error);
    res.status(500).json({
      data: null,
      error: { message: error.message }
    });
  }
});

// GET /api/case-prep/:caseId/files - List all uploaded files for a case
router.get('/:caseId/files', verifyToken, requireRole(['admin']), requirePermission('caseprep'), async (req, res) => {
  try {
    const { caseId } = req.params;

    // Verify case exists
    const [cases] = await pool.execute('SELECT case_id FROM cases WHERE case_id = ?', [caseId]);
    if (cases.length === 0) {
      return res.status(404).json({
        data: null,
        error: { message: 'Case not found' }
      });
    }

    // Get all files for this case
    const [files] = await pool.execute(
      `SELECT id, case_id, filename, file_type, processing_status, processing_model,
              processing_error, outline_content, processed_at, created_at
       FROM case_files
       WHERE case_id = ?
       ORDER BY created_at DESC`,
      [caseId]
    );

    res.json({
      data: files,
      error: null
    });

  } catch (error) {
    console.error('Error fetching case prep files:', error);
    res.status(500).json({
      data: null,
      error: { message: error.message }
    });
  }
});

// PATCH /api/case-prep/files/:fileId/outline - Update outline content after manual editing
router.patch('/files/:fileId/outline', verifyToken, requireRole(['admin']), requirePermission('caseprep'), async (req, res) => {
  try {
    const { fileId } = req.params;
    const { outline_content } = req.body;

    if (outline_content === undefined) {
      return res.status(400).json({
        data: null,
        error: { message: 'outline_content is required' }
      });
    }

    // Update outline content
    await pool.execute(
      'UPDATE case_files SET outline_content = ? WHERE id = ?',
      [outline_content, fileId]
    );

    // Return updated record
    const [files] = await pool.execute(
      `SELECT id, case_id, filename, file_type, processing_status, processing_model,
              outline_content, processed_at, created_at
       FROM case_files WHERE id = ?`,
      [fileId]
    );

    if (files.length === 0) {
      return res.status(404).json({
        data: null,
        error: { message: 'File not found' }
      });
    }

    res.json({
      data: files[0],
      error: null
    });

  } catch (error) {
    console.error('Error updating outline:', error);
    res.status(500).json({
      data: null,
      error: { message: error.message }
    });
  }
});

// GET /api/case-prep/files/:fileId/original - Get original uploaded file for preview
router.get('/files/:fileId/original', verifyToken, requireRole(['admin']), requirePermission('caseprep'), async (req, res) => {
  try {
    const { fileId } = req.params;

    // Get file record
    const [files] = await pool.execute(
      'SELECT id, case_id, filename, file_type FROM case_files WHERE id = ?',
      [fileId]
    );

    if (files.length === 0) {
      return res.status(404).json({
        data: null,
        error: { message: 'File not found' }
      });
    }

    const fileRecord = files[0];
    const filePath = path.join(CASE_FILES_DIR, fileRecord.case_id, 'uploads', fileRecord.filename);

    // Check if file exists
    try {
      await fs.access(filePath);
    } catch {
      return res.status(404).json({
        data: null,
        error: { message: 'Original file not found on disk' }
      });
    }

    // Set appropriate content type
    const ext = path.extname(fileRecord.filename).toLowerCase();
    const contentType = {
      '.pdf': 'application/pdf',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.doc': 'application/msword',
      '.txt': 'text/plain',
      '.md': 'text/markdown'
    }[ext] || 'application/octet-stream';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${fileRecord.filename}"`);

    const fileStream = await fs.readFile(filePath);
    res.send(fileStream);

  } catch (error) {
    console.error('Error fetching original file:', error);
    res.status(500).json({
      data: null,
      error: { message: error.message }
    });
  }
});

// GET /api/case-prep/files/:fileId/content - Get converted text content (not outline)
router.get('/files/:fileId/content', verifyToken, requireRole(['admin']), requirePermission('caseprep'), async (req, res) => {
  try {
    const { fileId } = req.params;

    // Get file record
    const [files] = await pool.execute(
      'SELECT id, case_id, filename, file_type FROM case_files WHERE id = ?',
      [fileId]
    );

    if (files.length === 0) {
      return res.status(404).json({
        data: null,
        error: { message: 'File not found' }
      });
    }

    const fileRecord = files[0];
    const filePath = path.join(CASE_FILES_DIR, fileRecord.case_id, 'uploads', fileRecord.filename);

    // Convert file to text
    const ext = path.extname(fileRecord.filename);
    const { text } = await convertFile(filePath, ext);

    res.json({
      data: { text },
      error: null
    });

  } catch (error) {
    console.error('Error fetching file content:', error);
    res.status(500).json({
      data: null,
      error: { message: error.message }
    });
  }
});

// Log all registered routes
console.log('[CasePrep] Registered routes:');
router.stack.forEach((r) => {
  if (r.route) {
    console.log(`  ${Object.keys(r.route.methods).join(', ').toUpperCase()} ${r.route.path}`);
  }
});

export default router;
