/**
 * Student submissions (StudyChat Phase 6). Rules: services/studentSubmissions.js.
 *
 *   POST /api/submissions             multipart `file` or JSON/field `text`, with section_id, case_id;
 *                                     staff also send student_id
 *   GET  /api/submissions/mine        ?section_id=&case_id=  the student's newest (their own only)
 *   GET  /api/submissions/student     ?section_id=&case_id=&student_id=  staff who manage the section
 *   GET  /api/submissions/chat/:id    the submission a chat ran on, for staff who can view the chat
 */

import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import multer from 'multer';
import { pool } from '../db.js';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { canManageSectionCases, canViewChat } from '../middleware/instructorAccess.js';
import { typeTraits } from '../services/activityTypeStore.js';
import { convertFile } from '../services/fileConverter.js';
import { latestSubmission, saveSubmission, SubmissionError } from '../services/studentSubmissions.js';

const router = express.Router();

// Not .doc: the converter reads only .docx (mammoth), so a Word 97 file would always fail.
const ALLOWED = ['.pdf', '.docx', '.md', '.txt'];
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new SubmissionError(400, 'SUBMISSION_FILE_TYPE', `Upload one of: ${ALLOWED.join(', ')}. Or paste the text.`));
  },
});

function send(res, error, context) {
  if (error instanceof SubmissionError) {
    return res.status(error.status).json({ data: null, error: { code: error.code, message: error.message } });
  }
  console.error(context, error);
  return res.status(500).json({ data: null, error: { message: error.message } });
}

/** The assignment must exist and be on a type that takes a submission. */
async function assertTakesSubmission(sectionId, caseId) {
  if (!sectionId || !caseId) throw new SubmissionError(400, 'INVALID_REQUEST', 'section_id and case_id are required');
  const [rows] = await pool.execute(
    `SELECT c.activity_type FROM section_cases sc JOIN cases c ON c.case_id = sc.case_id WHERE sc.section_id = ? AND sc.case_id = ?`,
    [sectionId, caseId]
  );
  if (!rows.length) throw new SubmissionError(404, 'NOT_ASSIGNED', 'That activity is not assigned to this section.');
  if (typeTraits(rows[0].activity_type)?.material !== 'student_submission') {
    throw new SubmissionError(409, 'NO_SUBMISSION_HERE', 'This activity does not take a submission.');
  }
}

async function assertEnrolled(studentId, sectionId) {
  const [rows] = await pool.execute(
    `SELECT 1 FROM students s LEFT JOIN student_sections ss ON ss.student_id = s.id AND ss.section_id = ?
      WHERE s.id = ? AND (s.section_id = ? OR ss.section_id IS NOT NULL) LIMIT 1`,
    [sectionId, studentId, sectionId]
  );
  if (!rows.length) throw new SubmissionError(404, 'NOT_ENROLLED', 'That student is not in this section.');
}

const view = (row) => row && {
  id: row.id,
  filename: row.filename,
  text: row.converted_text,
  uploaded_by_role: row.uploaded_by_role,
  created_at: row.created_at,
};

router.post('/', verifyToken, requireRole(['student', 'instructor', 'admin']), (req, res) => {
  upload.single('file')(req, res, async (uploadError) => {
    const tempPath = req.file?.path;
    try {
      if (uploadError) {
        if (uploadError instanceof SubmissionError) throw uploadError;
        if (uploadError instanceof multer.MulterError && uploadError.code === 'LIMIT_FILE_SIZE') {
          throw new SubmissionError(400, 'SUBMISSION_FILE_TOO_LARGE', 'That file is over the 10MB limit.');
        }
        throw new SubmissionError(400, 'UPLOAD_FAILED', uploadError.message || 'The upload failed.');
      }
      const { section_id: sectionId, case_id: caseId } = req.body || {};
      await assertTakesSubmission(sectionId, caseId);

      // A student saves only their own. Staff save for a student in a section they manage.
      const isStudent = req.user.role === 'student';
      const studentId = isStudent ? req.user.id : req.body?.student_id;
      if (!studentId) throw new SubmissionError(400, 'INVALID_REQUEST', 'student_id is required');
      if (!isStudent && !(await canManageSectionCases(req, sectionId))) {
        throw new SubmissionError(403, 'FORBIDDEN', 'You do not manage this section.');
      }
      await assertEnrolled(studentId, sectionId);

      let text = req.body?.text;
      let filename = null;
      if (req.file) {
        // The name a browser sends is latin1-decoded by multer.
        filename = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
        try {
          text = (await convertFile(tempPath, path.extname(req.file.originalname))).text;
        } catch (conversionError) {
          console.warn('Submission file could not be read:', conversionError.message);
          throw new SubmissionError(400, 'SUBMISSION_UNREADABLE', 'That file could not be read. Save it as .docx or .pdf and try again, or paste the text.');
        }
      }
      const saved = await saveSubmission({
        sectionId, caseId, studentId, uploadedBy: req.user.id, uploadedByRole: isStudent ? 'student' : req.user.role, filename, text,
      });
      res.status(201).json({ data: saved, error: null });
    } catch (error) {
      send(res, error, 'Error saving submission:');
    } finally {
      if (tempPath) await fs.unlink(tempPath).catch(() => {});
    }
  });
});

router.get('/mine', verifyToken, requireRole(['student']), async (req, res) => {
  try {
    const { section_id: sectionId, case_id: caseId } = req.query;
    if (!sectionId || !caseId) return res.status(400).json({ data: null, error: { message: 'section_id and case_id are required' } });
    res.json({ data: view(await latestSubmission(String(sectionId), String(caseId), req.user.id)), error: null });
  } catch (error) {
    send(res, error, 'Error reading submission:');
  }
});

router.get('/student', verifyToken, requireRole(['instructor', 'admin']), async (req, res) => {
  try {
    const { section_id: sectionId, case_id: caseId, student_id: studentId } = req.query;
    if (!sectionId || !caseId || !studentId) return res.status(400).json({ data: null, error: { message: 'section_id, case_id and student_id are required' } });
    if (!(await canManageSectionCases(req, String(sectionId)))) return res.status(403).json({ data: null, error: { message: 'You do not manage this section.' } });
    res.json({ data: view(await latestSubmission(String(sectionId), String(caseId), String(studentId))), error: null });
  } catch (error) {
    send(res, error, 'Error reading submission:');
  }
});

router.get('/chat/:caseChatId', verifyToken, requireRole(['instructor', 'admin']), async (req, res) => {
  try {
    const { caseChatId } = req.params;
    if (!(await canViewChat(req, caseChatId))) return res.status(404).json({ data: null, error: { message: 'Chat not found' } });
    const [rows] = await pool.execute(
      `SELECT s.id, s.filename, s.converted_text, s.uploaded_by_role, s.created_at
         FROM case_chats cc JOIN student_submissions s ON s.id = cc.submission_id WHERE cc.id = ?`,
      [caseChatId]
    );
    res.json({ data: view(rows[0] || null), error: null });
  } catch (error) {
    send(res, error, 'Error reading submission:');
  }
});

export default router;
