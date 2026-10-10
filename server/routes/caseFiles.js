/**
 * Case Files Routes
 * Handles comprehensive file management for cases including upload, download from URL,
 * metadata management, prompt ordering, and proprietary content confirmation
 */

import express from 'express';
import { pool } from '../db.js';
import { verifyToken } from '../middleware/auth.js';
import { requireAdminOrInstructor, requireCaseAccess, requireCaseAccessByRow } from '../middleware/instructorAccess.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { convertFile } from '../services/fileConverter.js';
import { fetchForCaseFile } from '../services/caseFileFetch.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CASE_FILES_DIR = path.join(__dirname, '../../case_files');

const router = express.Router();

// Predefined file types (outline reserved for AI-generated derived files)
const PREDEFINED_FILE_TYPES = ['case', 'teaching_note', 'chapter', 'reading', 'article', 'instructor_notes', 'outline'];

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
    if (fileType === 'outline') return 'Outline';
    return fileType.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
  if (fileType.startsWith('other:')) {
    return fileType.substring(6);
  }
  return fileType;
}

/**
 * Helper: Find a file row's original on disk, or null if there is none.
 *
 * The path is built only from the row (never from the request), and each candidate
 * must stay inside case_files/<case_id>/ once resolved. Uploads live in uploads/;
 * Case Writer publishes case.md / teaching_note.md at the case root, and legacy
 * rows fall back to <file_type>.md there, the same lookup loadFileContent() uses.
 */
async function findOriginalPath(row) {
  if (!row.case_id || path.basename(row.case_id) !== row.case_id) return null;
  const caseDir = path.resolve(CASE_FILES_DIR, row.case_id);
  const name = row.filename ? path.basename(row.filename) : null;
  const candidates = [];
  if (name) {
    candidates.push(path.join(caseDir, 'uploads', name));
    candidates.push(path.join(caseDir, name));
  }
  if (row.file_type === 'case' || row.file_type === 'teaching_note') {
    candidates.push(path.join(caseDir, `${row.file_type}.md`));
  }
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (!resolved.startsWith(caseDir + path.sep)) continue;
    try {
      const stats = await fs.stat(resolved);
      if (stats.isFile()) return resolved;
    } catch {
      // Not here; try the next location.
    }
  }
  return null;
}

// Download types served with their own Content-Type; anything else is octet-stream
// so an uploaded or fetched HTML/SVG can never be rendered on our origin.
const DOWNLOAD_CONTENT_TYPES = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png'
};

// GET /api/case-files/:caseId - List all files for a case with full metadata
router.get('/:caseId', verifyToken, requireAdminOrInstructor, requireCaseAccess('caseId', 'view'), async (req, res) => {
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
      `SELECT id, case_id, parent_file_id, filename, file_type, file_format, file_source, source_url,
              proprietary, proprietary_confirmed_by, proprietary_confirmed_at,
              include_in_chat_prompt, prompt_order, file_version, original_filename,
              file_size, processing_status, processing_model, outline_content,
              processed_at, created_at, is_outline, is_latest_outline,
              fetched_final_url, fetched_at, text_edited_at,
              converted_text IS NOT NULL AS has_text
       FROM case_files
       WHERE case_id = ?
       ORDER BY prompt_order ASC, created_at ASC`,
      [caseId]
    );

    // Add display labels, and whether there is an original to download
    const filesWithLabels = await Promise.all(files.map(async f => ({
      ...f,
      file_type_label: getFileTypeLabel(f.file_type),
      proprietary: !!f.proprietary,
      include_in_chat_prompt: !!f.include_in_chat_prompt,
      has_text: !!f.has_text,
      has_original: (await findOriginalPath(f)) !== null
    })));

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
router.post('/:caseId/upload', verifyToken, requireAdminOrInstructor, requireCaseAccess('caseId', 'edit'), async (req, res) => {
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

      // Convert file to text at upload time so we never re-parse PDFs later
      let convertedText = null;
      const textFormats = ['pdf', 'docx', 'doc', 'md', 'txt'];
      if (textFormats.includes(fileFormat)) {
        try {
          const ext = path.extname(req.file.originalname);
          const { text } = await convertFile(req.file.path, ext);
          convertedText = text || null;
        } catch (convErr) {
          console.warn('[CaseFiles] Text conversion at upload failed (will retry later):', convErr.message);
        }
      }

      // Insert file record with extended metadata
      const [result] = await pool.execute(
        `INSERT INTO case_files (
          case_id, filename, file_type, file_format, file_source,
          proprietary, include_in_chat_prompt, prompt_order, file_version,
          original_filename, file_size, processing_status,
          converted_text, converted_text_original, converted_at, created_at
        ) VALUES (?, ?, ?, ?, 'uploaded', ?, ?, ?, ?, ?, ?, 'pending',
                  ?, ?, ${convertedText ? 'NOW()' : 'NULL'}, NOW())`,
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
          stats.size,
          convertedText,
          convertedText
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

// ---------------------------------------------------------------------------
// Web pages and pasted text
//
// "Add from web page" is two calls: { preview: true } fetches and returns the text
// without saving anything; the second call saves the text the instructor reviewed.
// Web pages and pasted text are stored as text only (file_source 'web' / 'pasted',
// file_format 'md', a placeholder filename that never exists on disk). PDF / DOCX /
// text URLs keep their original in uploads/ (file_source 'downloaded'), so they can be
// downloaded later. Every fetch goes through services/caseFileFetch.js, which uses
// urlFetcher.js's SSRF-checked fetcher; never fetch a URL here any other way.
// ---------------------------------------------------------------------------

const MAX_TEXT_CHARS = 2_000_000;
const TEXT_ONLY_SOURCES = ['web', 'pasted'];

/** Gate for every route that makes this server fetch a URL. */
async function isUrlFetchEnabled() {
  const [rows] = await pool.execute(
    'SELECT setting_value FROM settings WHERE setting_key = ?',
    ['case_files_url_fetch_enabled']
  );
  return rows.length > 0 && String(rows[0].setting_value).trim() === '1';
}

/** An http(s) URL of sane length, or null. */
function parseHttpUrl(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2048) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** A display title: no control characters, at most 255 chars. */
function cleanTitle(value, fallback) {
  const title = (typeof value === 'string' ? value : '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .slice(0, 255);
  return title || fallback;
}

/** Placeholder `filename` for a text-only row (the column is NOT NULL). */
function textOnlyFilename(source) {
  return `${source}-${Date.now()}-${randomUUID().slice(0, 8)}.md`;
}

/** Validate the text and the metadata fields shared by fetch and paste saves. */
function readSaveFields(body) {
  const { file_type, text } = body;
  if (!validateFileType(file_type)) {
    return { error: `Invalid file_type. Use one of: ${PREDEFINED_FILE_TYPES.join(', ')}, or "other:Custom Label"` };
  }
  if (typeof text !== 'string' || !text.trim()) {
    return { error: 'The text is empty' };
  }
  if (text.length > MAX_TEXT_CHARS) {
    return { error: `The text is over the ${MAX_TEXT_CHARS.toLocaleString()} character limit` };
  }
  return {
    fields: {
      file_type,
      text,
      proprietary: body.proprietary === true || body.proprietary === '1' ? 1 : 0,
      include_in_chat_prompt: body.include_in_chat_prompt === false || body.include_in_chat_prompt === '0' ? 0 : 1,
      prompt_order: parseInt(body.prompt_order, 10) || 0,
      file_version: typeof body.file_version === 'string' && body.file_version.trim()
        ? body.file_version.trim().slice(0, 50)
        : null
    }
  };
}

/** Save fetched bytes under uploads/ with the usual `<name>-<timestamp><ext>` naming. */
async function storeFetchedBytes(caseId, title, ext, buffer) {
  const uploadsDir = path.join(CASE_FILES_DIR, caseId, 'uploads');
  await fs.mkdir(uploadsDir, { recursive: true });
  const stem = path.basename(title, path.extname(title))
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
    .slice(0, 120) || 'downloaded-file';
  const storedFilename = `${stem}-${Date.now()}${ext}`;
  await fs.writeFile(path.join(uploadsDir, storedFilename), buffer);
  return storedFilename;
}

async function caseExists(caseId) {
  const [cases] = await pool.execute('SELECT case_id FROM cases WHERE case_id = ?', [caseId]);
  return cases.length > 0;
}

async function selectFileForResponse(id) {
  const [rows] = await pool.execute(
    `SELECT id, case_id, filename, file_type, file_format, file_source, source_url,
            fetched_final_url, fetched_at, text_edited_at,
            proprietary, include_in_chat_prompt, prompt_order, file_version,
            original_filename, file_size, processing_status, created_at
     FROM case_files WHERE id = ?`,
    [id]
  );
  const row = rows[0];
  return {
    ...row,
    file_type_label: getFileTypeLabel(row.file_type),
    proprietary: !!row.proprietary,
    include_in_chat_prompt: !!row.include_in_chat_prompt
  };
}

// GET /api/case-files/config/web-fetch - Is fetching from URLs enabled?
// Two segments, so it cannot be shadowed by GET /:caseId.
router.get('/config/web-fetch', verifyToken, requireAdminOrInstructor, async (req, res) => {
  try {
    res.json({ data: { url_fetch_enabled: await isUrlFetchEnabled() }, error: null });
  } catch (error) {
    console.error('[CaseFiles] Error reading fetch setting:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// POST /api/case-files/:caseId/fetch-url - Preview a URL's text, or save the reviewed text
router.post('/:caseId/fetch-url', verifyToken, requireAdminOrInstructor, requireCaseAccess('caseId', 'edit'), async (req, res) => {
  try {
    const { caseId } = req.params;
    if (!(await isUrlFetchEnabled())) {
      return res.status(403).json({ data: null, error: { message: 'Fetching from URLs is turned off. An admin can turn it on in Settings.' } });
    }
    const url = parseHttpUrl(req.body.url);
    if (!url) {
      return res.status(400).json({ data: null, error: { message: 'Enter a full http:// or https:// address' } });
    }
    if (!(await caseExists(caseId))) {
      return res.status(404).json({ data: null, error: { message: 'Case not found' } });
    }

    // --- Preview: fetch and return, store nothing ---
    if (req.body.preview) {
      let fetched;
      try {
        fetched = await fetchForCaseFile(url);
      } catch (err) {
        // Paywalls, bot walls and JS-rendered pages land here; the message is the answer.
        console.warn('[CaseFiles] fetch failed:', url, err.message);
        return res.status(422).json({ data: null, error: { message: err.message } });
      }
      return res.json({
        data: {
          kind: fetched.kind,
          title: fetched.title,
          text: fetched.text,
          degraded: fetched.degraded,
          final_url: fetched.finalUrl,
          content_type: fetched.contentType
        },
        error: null
      });
    }

    // --- Save the reviewed text ---
    const { fields, error: fieldError } = readSaveFields(req.body);
    if (fieldError) {
      return res.status(400).json({ data: null, error: { message: fieldError } });
    }

    let row;
    if (req.body.kind === 'file') {
      // Fetch again for the original bytes; the reviewed text is what gets stored.
      let fetched;
      try {
        fetched = await fetchForCaseFile(url);
      } catch (err) {
        return res.status(422).json({ data: null, error: { message: err.message } });
      }
      if (fetched.kind !== 'file') {
        return res.status(409).json({ data: null, error: { message: 'That URL no longer serves a file. Fetch it again.' } });
      }
      const title = cleanTitle(req.body.title, fetched.title);
      const storedFilename = await storeFetchedBytes(caseId, title, fetched.ext, fetched.buffer);
      row = {
        filename: storedFilename,
        original_filename: title.toLowerCase().endsWith(fetched.ext) ? title : `${title}${fetched.ext}`,
        file_format: fetched.ext.slice(1),
        file_source: 'downloaded',
        file_size: fetched.buffer.length,
        final_url: fetched.finalUrl,
        content_type: fetched.contentType,
        original_text: fetched.text
      };
    } else {
      row = {
        filename: textOnlyFilename('web'),
        original_filename: cleanTitle(req.body.title, new URL(url).hostname),
        file_format: 'md',
        file_source: 'web',
        file_size: Buffer.byteLength(fields.text, 'utf8'),
        final_url: parseHttpUrl(req.body.final_url) || url,
        content_type: typeof req.body.content_type === 'string' ? req.body.content_type.slice(0, 120) : 'text/html',
        // The preview's text, for Revert. It came from this instructor's own preview.
        original_text: typeof req.body.original_text === 'string' && req.body.original_text.length <= MAX_TEXT_CHARS
          ? req.body.original_text
          : fields.text
      };
    }

    const [result] = await pool.execute(
      `INSERT INTO case_files (
        case_id, filename, file_type, file_format, file_source, source_url,
        fetched_final_url, fetched_content_type, fetched_at,
        proprietary, include_in_chat_prompt, prompt_order, file_version,
        original_filename, file_size, processing_status,
        converted_text, converted_text_original, converted_at, text_edited_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?, 'pending', ?, ?, NOW(), ?, NOW())`,
      [
        caseId, row.filename, fields.file_type, row.file_format, row.file_source, url,
        row.final_url, row.content_type,
        fields.proprietary, fields.include_in_chat_prompt, fields.prompt_order, fields.file_version,
        row.original_filename, row.file_size,
        fields.text, row.original_text, fields.text === row.original_text ? null : new Date()
      ]
    );

    res.status(201).json({ data: await selectFileForResponse(result.insertId), error: null });
  } catch (error) {
    console.error('[CaseFiles] Error saving fetched URL:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// POST /api/case-files/:caseId/paste - Save pasted text as a case file
router.post('/:caseId/paste', verifyToken, requireAdminOrInstructor, requireCaseAccess('caseId', 'edit'), async (req, res) => {
  try {
    const { caseId } = req.params;
    const { fields, error: fieldError } = readSaveFields(req.body);
    if (fieldError) {
      return res.status(400).json({ data: null, error: { message: fieldError } });
    }
    const title = cleanTitle(req.body.title, '');
    if (!title) {
      return res.status(400).json({ data: null, error: { message: 'Give the text a title' } });
    }
    let sourceUrl = null;
    if (typeof req.body.source_url === 'string' && req.body.source_url.trim()) {
      sourceUrl = parseHttpUrl(req.body.source_url);
      if (!sourceUrl) {
        return res.status(400).json({ data: null, error: { message: 'The source URL must start with http:// or https://' } });
      }
    }
    if (!(await caseExists(caseId))) {
      return res.status(404).json({ data: null, error: { message: 'Case not found' } });
    }

    const [result] = await pool.execute(
      `INSERT INTO case_files (
        case_id, filename, file_type, file_format, file_source, source_url,
        proprietary, include_in_chat_prompt, prompt_order, file_version,
        original_filename, file_size, processing_status,
        converted_text, converted_text_original, converted_at, created_at
      ) VALUES (?, ?, ?, 'md', 'pasted', ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, NOW(), NOW())`,
      [
        caseId, textOnlyFilename('pasted'), fields.file_type, sourceUrl,
        fields.proprietary, fields.include_in_chat_prompt, fields.prompt_order, fields.file_version,
        title, Buffer.byteLength(fields.text, 'utf8'),
        fields.text, fields.text
      ]
    );

    res.status(201).json({ data: await selectFileForResponse(result.insertId), error: null });
  } catch (error) {
    console.error('[CaseFiles] Error saving pasted text:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// POST /api/case-files/:fileId/refetch - Fetch source_url again, replacing the text (and file)
router.post('/:fileId/refetch', verifyToken, requireAdminOrInstructor, requireCaseAccessByRow('case_files', 'fileId', 'edit'), async (req, res) => {
  try {
    if (!(await isUrlFetchEnabled())) {
      return res.status(403).json({ data: null, error: { message: 'Fetching from URLs is turned off. An admin can turn it on in Settings.' } });
    }
    const [rows] = await pool.execute(
      'SELECT id, case_id, filename, file_source, source_url, original_filename FROM case_files WHERE id = ?',
      [req.params.fileId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'File not found' } });
    }
    const file = rows[0];
    const url = parseHttpUrl(file.source_url);
    if (!url) {
      return res.status(400).json({ data: null, error: { message: 'This file has no web address to fetch' } });
    }

    let fetched;
    try {
      fetched = await fetchForCaseFile(url);
    } catch (err) {
      console.warn('[CaseFiles] re-fetch failed:', url, err.message);
      return res.status(422).json({ data: null, error: { message: err.message } });
    }

    // The previous original (if any) is replaced: a page keeps no file, a file gets the new bytes.
    const oldUpload = TEXT_ONLY_SOURCES.includes(file.file_source)
      ? null
      : path.join(CASE_FILES_DIR, file.case_id, 'uploads', path.basename(file.filename));
    const title = cleanTitle(file.original_filename, fetched.title);
    let filename;
    let fileFormat;
    let fileSource;
    let fileSize;
    if (fetched.kind === 'file') {
      filename = await storeFetchedBytes(file.case_id, title, fetched.ext, fetched.buffer);
      fileFormat = fetched.ext.slice(1);
      fileSource = 'downloaded';
      fileSize = fetched.buffer.length;
    } else {
      filename = file.file_source === 'web' ? file.filename : textOnlyFilename('web');
      fileFormat = 'md';
      fileSource = 'web';
      fileSize = Buffer.byteLength(fetched.text, 'utf8');
    }

    await pool.execute(
      `UPDATE case_files
          SET filename = ?, file_format = ?, file_source = ?, file_size = ?,
              original_filename = ?,
              converted_text = ?, converted_text_original = ?, converted_at = NOW(), text_edited_at = NULL,
              fetched_final_url = ?, fetched_content_type = ?, fetched_at = NOW()
        WHERE id = ?`,
      [
        filename, fileFormat, fileSource, fileSize,
        file.original_filename || title,
        fetched.text, fetched.text,
        fetched.finalUrl, fetched.contentType,
        file.id
      ]
    );

    if (oldUpload && path.basename(oldUpload) !== filename) {
      await fs.unlink(oldUpload).catch(() => {});
    }

    res.json({
      data: {
        ...(await selectFileForResponse(file.id)),
        converted_text_length: fetched.text.length,
        degraded: fetched.degraded
      },
      error: null
    });
  } catch (error) {
    console.error('[CaseFiles] Error re-fetching:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// POST /api/case-files/:fileId/revert-text - Put back the text as first extracted
router.post('/:fileId/revert-text', verifyToken, requireAdminOrInstructor, requireCaseAccessByRow('case_files', 'fileId', 'edit'), async (req, res) => {
  try {
    const [result] = await pool.execute(
      `UPDATE case_files
          SET converted_text = converted_text_original, converted_at = NOW(), text_edited_at = NULL
        WHERE id = ? AND converted_text_original IS NOT NULL`,
      [req.params.fileId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ data: null, error: { message: 'There is no extracted text to revert to' } });
    }
    res.json({ data: { id: parseInt(req.params.fileId, 10), reverted: true }, error: null });
  } catch (error) {
    console.error('[CaseFiles] Error reverting text:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PATCH /api/case-files/:fileId - Update file metadata
router.patch('/:fileId', verifyToken, requireAdminOrInstructor, requireCaseAccessByRow('case_files', 'fileId', 'edit'), async (req, res) => {
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
router.patch('/:fileId/reorder', verifyToken, requireAdminOrInstructor, requireCaseAccessByRow('case_files', 'fileId', 'edit'), async (req, res) => {
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
router.delete('/:fileId', verifyToken, requireAdminOrInstructor, requireCaseAccessByRow('case_files', 'fileId', 'delete'), async (req, res) => {
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
router.post('/:fileId/confirm-proprietary', verifyToken, requireAdminOrInstructor, requireCaseAccessByRow('case_files', 'fileId', 'edit'), async (req, res) => {
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

// GET /api/case-files/:fileId/content - Get file content (text conversion)
router.get('/:fileId/content', verifyToken, requireAdminOrInstructor, requireCaseAccessByRow('case_files', 'fileId', 'view'), async (req, res) => {
  try {
    const { fileId } = req.params;

    // Get file record including cached text
    const [files] = await pool.execute(
      'SELECT id, case_id, filename, file_type, file_format, converted_text FROM case_files WHERE id = ?',
      [fileId]
    );

    if (files.length === 0) {
      return res.status(404).json({
        data: null,
        error: { message: 'File not found' }
      });
    }

    const fileRecord = files[0];

    // Use cached converted text if available
    if (fileRecord.converted_text) {
      return res.json({
        data: { text: fileRecord.converted_text, file_id: parseInt(fileId) },
        error: null
      });
    }

    // Fall back to on-the-fly conversion
    const filePath = path.join(CASE_FILES_DIR, fileRecord.case_id, 'uploads', fileRecord.filename);
    try {
      const ext = path.extname(fileRecord.filename);
      const { text } = await convertFile(filePath, ext);
      res.json({
        data: { text, file_id: parseInt(fileId) },
        error: null
      });
    } catch (e) {
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

// GET /api/case-files/:fileId/download - Download the original file as an attachment
router.get('/:fileId/download', verifyToken, requireAdminOrInstructor, requireCaseAccessByRow('case_files', 'fileId', 'view'), async (req, res) => {
  try {
    const [files] = await pool.execute(
      'SELECT id, case_id, filename, original_filename, file_type FROM case_files WHERE id = ?',
      [req.params.fileId]
    );
    if (files.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'File not found' } });
    }
    const row = files[0];
    const filePath = await findOriginalPath(row);
    if (!filePath) {
      return res.status(404).json({
        data: { textOnly: true },
        error: { message: 'There is no original file for this entry; download its text instead.' }
      });
    }

    const downloadName = row.original_filename || row.filename || path.basename(filePath);
    // Always an attachment, never inline.
    res.attachment(downloadName);
    res.set('Content-Type', DOWNLOAD_CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
    res.set('X-Content-Type-Options', 'nosniff');
    res.sendFile(filePath, (err) => {
      if (err && !res.headersSent) {
        console.error('[CaseFiles] Error sending file:', err);
        res.status(500).json({ data: null, error: { message: 'Download failed' } });
      }
    });
  } catch (error) {
    console.error('[CaseFiles] Error downloading file:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/case-files/:fileId/download-text - Download the extracted text (what the AI reads)
router.get('/:fileId/download-text', verifyToken, requireAdminOrInstructor, requireCaseAccessByRow('case_files', 'fileId', 'view'), async (req, res) => {
  try {
    const [files] = await pool.execute(
      'SELECT id, filename, original_filename, file_format, converted_text FROM case_files WHERE id = ?',
      [req.params.fileId]
    );
    if (files.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'File not found' } });
    }
    const row = files[0];
    if (row.converted_text == null) {
      return res.status(404).json({ data: null, error: { message: 'No extracted text for this file yet' } });
    }

    // Titles of web pages can contain characters that are not allowed in file names.
    const baseName = (row.original_filename || row.filename || `file-${row.id}`).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-');
    const stem = path.basename(baseName, path.extname(baseName)) || `file-${row.id}`;
    const ext = row.file_format === 'md' ? '.md' : '.txt';
    res.attachment(`${stem}${ext}`);
    res.set('Content-Type', DOWNLOAD_CONTENT_TYPES[ext]);
    res.set('X-Content-Type-Options', 'nosniff');
    res.send(row.converted_text);
  } catch (error) {
    console.error('[CaseFiles] Error downloading text:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/case-files/:fileId/converted-text - Get cached converted text and metadata
router.get('/:fileId/converted-text', verifyToken, requireAdminOrInstructor, requireCaseAccessByRow('case_files', 'fileId', 'view'), async (req, res) => {
  try {
    const { fileId } = req.params;

    const [files] = await pool.execute(
      `SELECT id, case_id, filename, original_filename, file_type, file_format,
              file_source, source_url, fetched_at, text_edited_at,
              converted_text, converted_at, converted_text_original IS NOT NULL AS has_original_text
       FROM case_files WHERE id = ?`,
      [fileId]
    );

    if (files.length === 0) {
      return res.status(404).json({
        data: null,
        error: { message: 'File not found' }
      });
    }

    const f = files[0];
    res.json({
      data: {
        id: f.id,
        filename: f.original_filename || f.filename,
        file_format: f.file_format,
        converted_text: f.converted_text,
        converted_at: f.converted_at,
        has_converted_text: f.converted_text != null,
        file_source: f.file_source,
        source_url: f.source_url,
        fetched_at: f.fetched_at,
        text_edited_at: f.text_edited_at,
        has_original_text: !!f.has_original_text
      },
      error: null
    });

  } catch (error) {
    console.error('[CaseFiles] Error fetching converted text:', error);
    res.status(500).json({
      data: null,
      error: { message: error.message }
    });
  }
});

// PUT /api/case-files/:fileId/converted-text - Save edited converted text
router.put('/:fileId/converted-text', verifyToken, requireAdminOrInstructor, requireCaseAccessByRow('case_files', 'fileId', 'edit'), async (req, res) => {
  try {
    const { fileId } = req.params;
    const { converted_text } = req.body;

    if (converted_text === undefined) {
      return res.status(400).json({
        data: null,
        error: { message: 'converted_text is required' }
      });
    }

    const [files] = await pool.execute(
      'SELECT id FROM case_files WHERE id = ?',
      [fileId]
    );

    if (files.length === 0) {
      return res.status(404).json({
        data: null,
        error: { message: 'File not found' }
      });
    }

    // SET runs left to right in MySQL: keep the first extraction before overwriting it,
    // then flag the row as edited unless the text matches that original.
    await pool.execute(
      `UPDATE case_files
          SET converted_text_original = COALESCE(converted_text_original, converted_text),
              converted_text = ?,
              converted_at = NOW(),
              text_edited_at = IF(converted_text <=> converted_text_original, NULL, NOW())
        WHERE id = ?`,
      [converted_text || null, fileId]
    );

    res.json({
      data: {
        id: parseInt(fileId),
        converted_text_length: converted_text ? converted_text.length : 0,
        converted_at: new Date().toISOString()
      },
      error: null
    });

  } catch (error) {
    console.error('[CaseFiles] Error saving converted text:', error);
    res.status(500).json({
      data: null,
      error: { message: error.message }
    });
  }
});

// POST /api/case-files/:fileId/reconvert - Re-extract text from the original file on disk
router.post('/:fileId/reconvert', verifyToken, requireAdminOrInstructor, requireCaseAccessByRow('case_files', 'fileId', 'edit'), async (req, res) => {
  try {
    const { fileId } = req.params;

    const [files] = await pool.execute(
      'SELECT id, case_id, filename, file_type, file_format, file_source FROM case_files WHERE id = ?',
      [fileId]
    );

    if (files.length === 0) {
      return res.status(404).json({
        data: null,
        error: { message: 'File not found' }
      });
    }

    const fileRecord = files[0];
    const filePath = await findOriginalPath(fileRecord);
    if (!filePath) {
      return res.status(400).json({
        data: null,
        error: {
          message: TEXT_ONLY_SOURCES.includes(fileRecord.file_source)
            ? 'This entry has no original file. Use Re-fetch for a web page.'
            : 'The original file is missing from the server.'
        }
      });
    }

    const { text } = await convertFile(filePath, path.extname(filePath));

    await pool.execute(
      `UPDATE case_files
          SET converted_text = ?, converted_text_original = ?, converted_at = NOW(), text_edited_at = NULL
        WHERE id = ?`,
      [text || null, text || null, fileId]
    );

    res.json({
      data: {
        id: parseInt(fileId),
        converted_text_length: text ? text.length : 0,
        converted_at: new Date().toISOString()
      },
      error: null
    });

  } catch (error) {
    console.error('[CaseFiles] Error reconverting file:', error);
    res.status(500).json({
      data: null,
      error: { message: error.message }
    });
  }
});

// POST /api/case-files/:caseId/sync - Sync database with filesystem
router.post('/:caseId/sync', verifyToken, requireAdminOrInstructor, requireCaseAccess('caseId', 'edit'), async (req, res) => {
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
      'SELECT id, filename, file_type, file_format, file_source, file_size, original_filename FROM case_files WHERE case_id = ?',
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
      // Web pages and pasted text are stored as text only; there is no file to find.
      if (TEXT_ONLY_SOURCES.includes(file.file_source)) continue;

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
