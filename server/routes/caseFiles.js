/**
 * Case Files Routes
 * Handles comprehensive file management for cases including upload, download from URL,
 * metadata management, prompt ordering, and proprietary content confirmation
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CASE_FILES_DIR = path.join(__dirname, '../../case_files');

const router = express.Router();

// Predefined file types
const PREDEFINED_FILE_TYPES = ['case', 'teaching_note', 'chapter', 'reading', 'article', 'instructor_notes'];

// Configure multer for file uploads
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
    const allowedTypes = ['.pdf', '.docx', '.doc', '.md', '.txt', '.jpg', '.jpeg', '.png'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type. Allowed: PDF, DOCX, DOC, MD, TXT, JPG, PNG'));
    }
  }
});

/**
 * Helper: Detect file format from filename
 */
function detectFileFormat(filename) {
  const ext = path.extname(filename).toLowerCase().replace('.', '');
  return ext || null;
}

/**
 * Helper: Validate file_type (predefined or custom "other:Label" format)
 */
function validateFileType(fileType) {
  if (!fileType) return false;
  if (PREDEFINED_FILE_TYPES.includes(fileType)) return true;
  if (fileType.startsWith('other:') && fileType.length > 6) return true;
  return false;
}

/**
 * Helper: Get display label for file_type
 */
function getFileTypeLabel(fileType) {
  if (PREDEFINED_FILE_TYPES.includes(fileType)) {
    return fileType.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
  if (fileType.startsWith('other:')) {
    return fileType.substring(6);
  }
  return fileType;
}

// GET /api/case-files/:caseId - List all files for a case with full metadata
router.get('/:caseId', verifyToken, requireRole(['admin']), requirePermission('casefiles'), async (req, res) => {
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

    // Get all files with extended metadata
    const [files] = await pool.execute(
      `SELECT id, case_id, filename, file_type, file_format, file_source, source_url,
              proprietary, proprietary_confirmed_by, proprietary_confirmed_at,
              include_in_chat_prompt, prompt_order, file_version, original_filename,
              file_size, processing_status, processing_model, outline_content,
              processed_at, created_at
       FROM case_files
       WHERE case_id = ?
       ORDER BY prompt_order ASC, created_at ASC`,
      [caseId]
    );

    // Add display labels
    const filesWithLabels = files.map(f => ({
      ...f,
      file_type_label: getFileTypeLabel(f.file_type),
      proprietary: !!f.proprietary,
      include_in_chat_prompt: !!f.include_in_chat_prompt
    }));

    res.json({
      data: filesWithLabels,
      error: null
    });

  } catch (error) {
    console.error('[CaseFiles] Error fetching files:', error);
    res.status(500).json({
      data: null,
      error: { message: error.message }
    });
  }
});

// POST /api/case-files/:caseId/upload - Upload file with extended metadata
router.post('/:caseId/upload', verifyToken, requireRole(['admin']), requirePermission('casefiles'), async (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      console.error('[CaseFiles] Multer error:', err);
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          data: null,
          error: { message: 'File size exceeds 10MB limit' }
        });
      }
      return res.status(400).json({
        data: null,
        error: { message: err.message || 'File upload failed' }
      });
    }

    try {
      const { caseId } = req.params;
      const {
        file_type,
        proprietary = '0',
        include_in_chat_prompt = '1',
        prompt_order = '0',
        file_version = null
      } = req.body;

      // Validate file_type
      if (!validateFileType(file_type)) {
        if (req.file) await fs.unlink(req.file.path);
        return res.status(400).json({
          data: null,
          error: {
            message: `Invalid file_type. Use one of: ${PREDEFINED_FILE_TYPES.join(', ')}, or "other:Custom Label"`
          }
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
        await fs.unlink(req.file.path);
        return res.status(404).json({
          data: null,
          error: { message: 'Case not found' }
        });
      }

      // Get file stats
      const stats = await fs.stat(req.file.path);
      const fileFormat = detectFileFormat(req.file.originalname);

      // Insert file record with extended metadata
      const [result] = await pool.execute(
        `INSERT INTO case_files (
          case_id, filename, file_type, file_format, file_source,
          proprietary, include_in_chat_prompt, prompt_order, file_version,
          original_filename, file_size, processing_status, created_at
        ) VALUES (?, ?, ?, ?, 'uploaded', ?, ?, ?, ?, ?, ?, 'pending', NOW())`,
        [
          caseId,
          req.file.filename,
          file_type,
          fileFormat,
          proprietary === 'true' || proprietary === '1' ? 1 : 0,
          include_in_chat_prompt === 'true' || include_in_chat_prompt === '1' ? 1 : 0,
          parseInt(prompt_order, 10) || 0,
          file_version || null,
          req.file.originalname,
          stats.size
        ]
      );

      // Return created file record
      const [fileRecord] = await pool.execute(
        `SELECT id, case_id, filename, file_type, file_format, file_source,
                proprietary, include_in_chat_prompt, prompt_order, file_version,
                original_filename, file_size, processing_status, created_at
         FROM case_files WHERE id = ?`,
        [result.insertId]
      );

      res.status(201).json({
        data: {
          ...fileRecord[0],
          file_type_label: getFileTypeLabel(file_type),
          proprietary: !!fileRecord[0].proprietary,
          include_in_chat_prompt: !!fileRecord[0].include_in_chat_prompt
        },
        error: null
      });

    } catch (error) {
      console.error('[CaseFiles] Error uploading file:', error);
      res.status(500).json({
        data: null,
        error: { message: error.message }
      });
    }
  });
});

// POST /api/case-files/:caseId/download-url - Download file from URL
router.post('/:caseId/download-url', verifyToken, requireRole(['admin']), requirePermission('casefiles'), async (req, res) => {
  try {
    const { caseId } = req.params;
    const {
      url,
      file_type,
      proprietary = false,
      include_in_chat_prompt = true,
      prompt_order = 0,
      file_version = null
    } = req.body;

    // Validate inputs
    if (!url || !file_type) {
      return res.status(400).json({
        data: null,
        error: { message: 'url and file_type are required' }
      });
    }

    if (!validateFileType(file_type)) {
      return res.status(400).json({
        data: null,
        error: {
          message: `Invalid file_type. Use one of: ${PREDEFINED_FILE_TYPES.join(', ')}, or "other:Custom Label"`
        }
      });
    }

    // Validate URL format
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new Error('Only HTTP/HTTPS URLs are supported');
      }
    } catch (e) {
      return res.status(400).json({
        data: null,
        error: { message: `Invalid URL: ${e.message}` }
      });
    }

    // Verify case exists
    const [cases] = await pool.execute('SELECT case_id FROM cases WHERE case_id = ?', [caseId]);
    if (cases.length === 0) {
      return res.status(404).json({
        data: null,
        error: { message: 'Case not found' }
      });
    }

    // Create uploads directory
    const uploadsDir = path.join(CASE_FILES_DIR, caseId, 'uploads');
    await fs.mkdir(uploadsDir, { recursive: true });

    // Download the file
    console.log('[CaseFiles] Downloading file from:', url);
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'MakeTheCase/1.0'
      },
      signal: AbortSignal.timeout(30000) // 30 second timeout
    });

    if (!response.ok) {
      return res.status(400).json({
        data: null,
        error: { message: `Failed to download file: HTTP ${response.status}` }
      });
    }

    // Get filename from URL or content-disposition
    let filename = path.basename(parsedUrl.pathname) || 'downloaded-file';
    const contentDisposition = response.headers.get('content-disposition');
    if (contentDisposition) {
      const match = contentDisposition.match(/filename="?([^";\n]+)"?/i);
      if (match) filename = match[1];
    }

    // Add timestamp to filename
    const timestamp = Date.now();
    const ext = path.extname(filename);
    const basename = path.basename(filename, ext);
    const storedFilename = `${basename}-${timestamp}${ext}`;
    const filePath = path.join(uploadsDir, storedFilename);

    // Save file
    const buffer = await response.arrayBuffer();
    await fs.writeFile(filePath, Buffer.from(buffer));

    const stats = await fs.stat(filePath);
    const fileFormat = detectFileFormat(filename);

    // Insert file record
    const [result] = await pool.execute(
      `INSERT INTO case_files (
        case_id, filename, file_type, file_format, file_source, source_url,
        proprietary, include_in_chat_prompt, prompt_order, file_version,
        original_filename, file_size, processing_status, created_at
      ) VALUES (?, ?, ?, ?, 'downloaded', ?, ?, ?, ?, ?, ?, ?, 'pending', NOW())`,
      [
        caseId,
        storedFilename,
        file_type,
        fileFormat,
        url,
        proprietary ? 1 : 0,
        include_in_chat_prompt ? 1 : 0,
        parseInt(prompt_order, 10) || 0,
        file_version || null,
        filename,
        stats.size
      ]
    );

    // Return created file record
    const [fileRecord] = await pool.execute(
      `SELECT id, case_id, filename, file_type, file_format, file_source, source_url,
              proprietary, include_in_chat_prompt, prompt_order, file_version,
              original_filename, file_size, processing_status, created_at
       FROM case_files WHERE id = ?`,
      [result.insertId]
    );

    res.status(201).json({
      data: {
        ...fileRecord[0],
        file_type_label: getFileTypeLabel(file_type),
        proprietary: !!fileRecord[0].proprietary,
        include_in_chat_prompt: !!fileRecord[0].include_in_chat_prompt
      },
      error: null
    });

  } catch (error) {
    console.error('[CaseFiles] Error downloading from URL:', error);
    res.status(500).json({
      data: null,
      error: { message: error.message }
    });
  }
});

// PATCH /api/case-files/:fileId - Update file metadata
router.patch('/:fileId', verifyToken, requireRole(['admin']), requirePermission('casefiles'), async (req, res) => {
  try {
    const { fileId } = req.params;
    const updates = req.body;

    // Check file exists
    const [existing] = await pool.execute(
      'SELECT id, case_id, proprietary, proprietary_confirmed_by FROM case_files WHERE id = ?',
      [fileId]
    );
    if (existing.length === 0) {
      return res.status(404).json({
        data: null,
        error: { message: 'File not found' }
      });
    }

    const currentFile = existing[0];

    // Allowed fields for update
    const allowedFields = ['file_type', 'proprietary', 'include_in_chat_prompt', 'prompt_order', 'file_version'];
    const setClauses = [];
    const params = [];

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        if (key === 'file_type') {
          if (!validateFileType(value)) {
            return res.status(400).json({
              data: null,
              error: { message: `Invalid file_type value` }
            });
          }
          setClauses.push('file_type = ?');
          params.push(value);
        } else if (key === 'proprietary' || key === 'include_in_chat_prompt') {
          setClauses.push(`${key} = ?`);
          params.push(value ? 1 : 0);

          // If turning off proprietary, clear confirmation
          if (key === 'proprietary' && !value) {
            setClauses.push('proprietary_confirmed_by = NULL');
            setClauses.push('proprietary_confirmed_at = NULL');
          }
        } else if (key === 'prompt_order') {
          setClauses.push('prompt_order = ?');
          params.push(parseInt(value, 10) || 0);
        } else {
          setClauses.push(`${key} = ?`);
          params.push(value === '' ? null : value);
        }
      }
    }

    if (setClauses.length === 0) {
      return res.status(400).json({
        data: null,
        error: { message: 'No valid fields to update' }
      });
    }

    params.push(fileId);
    await pool.execute(`UPDATE case_files SET ${setClauses.join(', ')} WHERE id = ?`, params);

    // Return updated record
    const [fileRecord] = await pool.execute(
      `SELECT id, case_id, filename, file_type, file_format, file_source, source_url,
              proprietary, proprietary_confirmed_by, proprietary_confirmed_at,
              include_in_chat_prompt, prompt_order, file_version, original_filename,
              file_size, processing_status, created_at
       FROM case_files WHERE id = ?`,
      [fileId]
    );

    res.json({
      data: {
        ...fileRecord[0],
        file_type_label: getFileTypeLabel(fileRecord[0].file_type),
        proprietary: !!fileRecord[0].proprietary,
        include_in_chat_prompt: !!fileRecord[0].include_in_chat_prompt
      },
      error: null
    });

  } catch (error) {
    console.error('[CaseFiles] Error updating file:', error);
    res.status(500).json({
      data: null,
      error: { message: error.message }
    });
  }
});

// PATCH /api/case-files/:fileId/reorder - Update prompt_order (for drag-and-drop)
router.patch('/:fileId/reorder', verifyToken, requireRole(['admin']), requirePermission('casefiles'), async (req, res) => {
  try {
    const { fileId } = req.params;
    const { prompt_order } = req.body;

    if (prompt_order === undefined || prompt_order === null) {
      return res.status(400).json({
        data: null,
        error: { message: 'prompt_order is required' }
      });
    }

    await pool.execute(
      'UPDATE case_files SET prompt_order = ? WHERE id = ?',
      [parseInt(prompt_order, 10), fileId]
    );

    res.json({
      data: { id: parseInt(fileId), prompt_order: parseInt(prompt_order, 10) },
      error: null
    });

  } catch (error) {
    console.error('[CaseFiles] Error reordering file:', error);
    res.status(500).json({
      data: null,
      error: { message: error.message }
    });
  }
});

// DELETE /api/case-files/:fileId - Delete a file
router.delete('/:fileId', verifyToken, requireRole(['admin']), requirePermission('casefiles'), async (req, res) => {
  try {
    const { fileId } = req.params;

    // Get file record
    const [files] = await pool.execute(
      'SELECT id, case_id, filename FROM case_files WHERE id = ?',
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

    // Delete file from disk
    try {
      await fs.unlink(filePath);
    } catch (e) {
      // File might not exist on disk, continue with DB deletion
      console.warn('[CaseFiles] File not found on disk:', filePath);
    }

    // Delete from database
    await pool.execute('DELETE FROM case_files WHERE id = ?', [fileId]);

    res.json({
      data: { deleted: true, id: parseInt(fileId) },
      error: null
    });

  } catch (error) {
    console.error('[CaseFiles] Error deleting file:', error);
    res.status(500).json({
      data: null,
      error: { message: error.message }
    });
  }
});

// POST /api/case-files/:fileId/confirm-proprietary - Confirm proprietary content usage
router.post('/:fileId/confirm-proprietary', verifyToken, requireRole(['admin']), requirePermission('casefiles'), async (req, res) => {
  try {
    const { fileId } = req.params;
    const adminId = req.user.id;

    // Check file exists and is proprietary
    const [files] = await pool.execute(
      'SELECT id, case_id, filename, proprietary FROM case_files WHERE id = ?',
      [fileId]
    );

    if (files.length === 0) {
      return res.status(404).json({
        data: null,
        error: { message: 'File not found' }
      });
    }

    if (!files[0].proprietary) {
      return res.status(400).json({
        data: null,
        error: { message: 'File is not marked as proprietary' }
      });
    }

    // Record confirmation
    await pool.execute(
      `UPDATE case_files
       SET proprietary_confirmed_by = ?, proprietary_confirmed_at = NOW()
       WHERE id = ?`,
      [adminId, fileId]
    );

    // Return updated record
    const [fileRecord] = await pool.execute(
      `SELECT id, case_id, filename, file_type, proprietary,
              proprietary_confirmed_by, proprietary_confirmed_at,
              include_in_chat_prompt, prompt_order
       FROM case_files WHERE id = ?`,
      [fileId]
    );

    res.json({
      data: {
        ...fileRecord[0],
        proprietary: !!fileRecord[0].proprietary,
        include_in_chat_prompt: !!fileRecord[0].include_in_chat_prompt
      },
      error: null
    });

  } catch (error) {
    console.error('[CaseFiles] Error confirming proprietary:', error);
    res.status(500).json({
      data: null,
      error: { message: error.message }
    });
  }
});

// GET /api/case-files/:caseId/prompt-context - Get ordered files for prompt building
router.get('/:caseId/prompt-context', verifyToken, async (req, res) => {
  try {
    const { caseId } = req.params;

    // Get files that should be included in prompt, ordered by prompt_order
    const [files] = await pool.execute(
      `SELECT id, case_id, filename, file_type, file_format,
              proprietary, proprietary_confirmed_by, prompt_order
       FROM case_files
       WHERE case_id = ? AND include_in_chat_prompt = 1
       ORDER BY prompt_order ASC, created_at ASC`,
      [caseId]
    );

    // Separate files into included and excluded (proprietary without confirmation)
    const includedFiles = [];
    const excludedFiles = [];

    for (const file of files) {
      if (file.proprietary && !file.proprietary_confirmed_by) {
        excludedFiles.push({
          ...file,
          exclusion_reason: 'Proprietary content not confirmed'
        });
      } else {
        includedFiles.push(file);
      }
    }

    // Load content for included files
    const filesWithContent = await Promise.all(
      includedFiles.map(async (file) => {
        try {
          const filePath = path.join(CASE_FILES_DIR, caseId, 'uploads', file.filename);

          // Check if it's a text-based file that can be included in prompt
          const textFormats = ['md', 'txt', 'pdf', 'docx', 'doc'];
          if (!textFormats.includes(file.file_format)) {
            return { ...file, content: null, content_error: 'Non-text file format' };
          }

          // Try to convert/read file content
          const ext = path.extname(file.filename);
          const { text } = await convertFile(filePath, ext);
          return { ...file, content: text };
        } catch (e) {
          // Try reading from standard location (case.md, teaching_note.md)
          if (file.file_type === 'case' || file.file_type === 'teaching_note') {
            try {
              const standardPath = path.join(CASE_FILES_DIR, caseId, `${file.file_type}.md`);
              const content = await fs.readFile(standardPath, 'utf-8');
              return { ...file, content };
            } catch (e2) {
              return { ...file, content: null, content_error: e2.message };
            }
          }
          return { ...file, content: null, content_error: e.message };
        }
      })
    );

    res.json({
      data: {
        included: filesWithContent,
        excluded: excludedFiles,
        total_included: includedFiles.length,
        total_excluded: excludedFiles.length
      },
      error: null
    });

  } catch (error) {
    console.error('[CaseFiles] Error getting prompt context:', error);
    res.status(500).json({
      data: null,
      error: { message: error.message }
    });
  }
});

// GET /api/case-files/:fileId/content - Get file content (text conversion)
router.get('/:fileId/content', verifyToken, requireRole(['admin']), requirePermission('casefiles'), async (req, res) => {
  try {
    const { fileId } = req.params;

    // Get file record
    const [files] = await pool.execute(
      'SELECT id, case_id, filename, file_type, file_format FROM case_files WHERE id = ?',
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
    try {
      const ext = path.extname(fileRecord.filename);
      const { text } = await convertFile(filePath, ext);
      res.json({
        data: { text, file_id: parseInt(fileId) },
        error: null
      });
    } catch (e) {
      // Try standard location as fallback
      if (fileRecord.file_type === 'case' || fileRecord.file_type === 'teaching_note') {
        const standardPath = path.join(CASE_FILES_DIR, fileRecord.case_id, `${fileRecord.file_type}.md`);
        try {
          const text = await fs.readFile(standardPath, 'utf-8');
          res.json({
            data: { text, file_id: parseInt(fileId) },
            error: null
          });
          return;
        } catch (e2) {
          // Fall through to error
        }
      }
      throw e;
    }

  } catch (error) {
    console.error('[CaseFiles] Error fetching file content:', error);
    res.status(500).json({
      data: null,
      error: { message: error.message }
    });
  }
});

// POST /api/case-files/:caseId/sync - Sync database with filesystem
router.post('/:caseId/sync', verifyToken, requireRole(['admin']), requirePermission('casefiles'), async (req, res) => {
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

    const report = {
      missing_files: [],
      unregistered_files: [],
      updated_files: [],
      errors: []
    };

    // Get all files from database
    const [dbFiles] = await pool.execute(
      'SELECT id, filename, file_type, file_format, file_size, original_filename FROM case_files WHERE case_id = ?',
      [caseId]
    );

    const caseDir = path.join(CASE_FILES_DIR, caseId);
    const uploadsDir = path.join(caseDir, 'uploads');

    // Check if directories exist
    try {
      await fs.access(caseDir);
    } catch (e) {
      await fs.mkdir(caseDir, { recursive: true });
    }

    try {
      await fs.access(uploadsDir);
    } catch (e) {
      await fs.mkdir(uploadsDir, { recursive: true });
    }

    // Check for missing files and update file_size
    for (const file of dbFiles) {
      // Try uploads directory first
      let filePath = path.join(uploadsDir, file.filename);
      let exists = false;

      try {
        await fs.access(filePath);
        exists = true;
      } catch (e) {
        // Try standard location for legacy files
        if (file.file_type === 'case' || file.file_type === 'teaching_note') {
          filePath = path.join(caseDir, `${file.file_type}.md`);
          try {
            await fs.access(filePath);
            exists = true;
          } catch (e2) {
            // File not found
          }
        }
      }

      if (!exists) {
        report.missing_files.push({
          id: file.id,
          filename: file.filename,
          file_type: file.file_type
        });
      } else {
        // File exists, check if we need to update file_size
        if (!file.file_size || file.file_size === 0) {
          try {
            const stats = await fs.stat(filePath);
            await pool.execute(
              'UPDATE case_files SET file_size = ? WHERE id = ?',
              [stats.size, file.id]
            );
            report.updated_files.push({
              id: file.id,
              filename: file.filename,
              file_size: stats.size
            });
          } catch (e) {
            report.errors.push({
              filename: file.filename,
              error: `Failed to update file size: ${e.message}`
            });
          }
        }
      }
    }

    // Check for unregistered files in uploads directory
    try {
      const uploadedFiles = await fs.readdir(uploadsDir);
      const dbFilenames = new Set(dbFiles.map(f => f.filename));

      for (const filename of uploadedFiles) {
        if (!dbFilenames.has(filename)) {
          // File exists but not in database
          const filePath = path.join(uploadsDir, filename);
          try {
            const stats = await fs.stat(filePath);

            // Only report files (not directories)
            if (stats.isFile()) {
              report.unregistered_files.push({
                filename,
                size: stats.size,
                location: 'uploads/'
              });
            }
          } catch (e) {
            // Skip files we can't stat
          }
        }
      }
    } catch (e) {
      // uploads directory doesn't exist or can't be read
    }

    // Check for standard files (case.md, teaching_note.md)
    const standardFiles = ['case.md', 'teaching_note.md'];
    for (const stdFile of standardFiles) {
      const filePath = path.join(caseDir, stdFile);
      try {
        await fs.access(filePath);
        const fileType = stdFile.replace('.md', '');

        // Check if it's registered
        const isRegistered = dbFiles.some(f =>
          f.filename === stdFile ||
          (f.file_type === fileType && f.filename.endsWith('.md'))
        );

        if (!isRegistered) {
          const stats = await fs.stat(filePath);
          report.unregistered_files.push({
            filename: stdFile,
            size: stats.size,
            location: 'root'
          });
        }
      } catch (e) {
        // File doesn't exist, that's ok
      }
    }

    res.json({
      data: report,
      error: null
    });

  } catch (error) {
    console.error('[CaseFiles] Error syncing files:', error);
    res.status(500).json({
      data: null,
      error: { message: error.message }
    });
  }
});

// GET /api/case-files/types - Get list of predefined file types
router.get('/types', verifyToken, async (req, res) => {
  res.json({
    data: PREDEFINED_FILE_TYPES.map(type => ({
      value: type,
      label: type.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())
    })),
    error: null
  });
});

export default router;
