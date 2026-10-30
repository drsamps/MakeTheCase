import express from 'express';
import { pool } from '../db.js';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { chatWithFallback } from '../services/chatFallback.js';
import { logPromptIfEnabled } from '../services/promptLogger.js';
import { resolveInstructorForStudentCase, resolveSectionForStudentCase } from '../services/keyResolver.js';
import { loadChatContext, buildChatSystemPrompt, protagonistLabel, sanitizeStudentName } from '../services/chatPrompt.js';
import { listTurns, appendTurns, historyForModel, writeTranscript } from '../services/chatTurns.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { convertFile } from '../services/fileConverter.js';
import { MARKDOWN, readingFormatOf, textFormatOfConversion } from '../../utils/readingFormat.js';
import { isStudentVisibleRole } from '../../utils/documentRoles.js';
// The page counts with the same helper.
import { countWords, minOpeningWords } from '../../utils/openingWords.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CASE_FILES_DIR = path.join(__dirname, '../../case_files');

async function getModelConfig(modelId) {
  const [rows] = await pool.execute(
    'SELECT model_id, vendor, temperature, reasoning_effort FROM models WHERE model_id = ?',
    [modelId]
  );
  return rows[0] || null;
}

// Helper: Load content from a file (handles different formats).
// If convertedText is provided (from DB cache), returns it directly to avoid re-parsing PDFs.
// When fileId is provided and we fall back to disk conversion, the result is written back
// to the DB so legacy files are automatically backfilled on first access.
async function loadFileContent(caseId, filename, fileType, convertedText, fileId) {
  if (convertedText) {
    console.log(`[loadFileContent] Using cached converted_text for ${filename} (${convertedText.length} chars)`);
    return convertedText;
  }

  let text = null;
  let textFormat = null;

  // First try the uploads directory (new files)
  const uploadsPath = path.join(CASE_FILES_DIR, caseId, 'uploads', filename);
  try {
    await fs.access(uploadsPath);
    console.log(`[loadFileContent] Found file at: ${uploadsPath}`);
    const ext = path.extname(filename);
    const result = await convertFile(uploadsPath, ext);
    text = result.text;
    textFormat = textFormatOfConversion(result.format);
    console.log(`[loadFileContent] Converted ${filename}: ${text ? text.length + ' chars' : 'empty'}`);
  } catch (e) {
    console.log(`[loadFileContent] File not in uploads or conversion failed for ${filename}:`, e.message);
  }

  // Try standard location for case.md or teaching_note.md
  if (!text && (fileType === 'case' || fileType === 'teaching_note')) {
    const standardPath = path.join(CASE_FILES_DIR, caseId, `${fileType}.md`);
    try {
      text = await fs.readFile(standardPath, 'utf-8');
      textFormat = MARKDOWN;
      console.log(`[loadFileContent] Loaded from standard path: ${standardPath}`);
    } catch (e) {
      console.log(`[loadFileContent] Standard path not found: ${standardPath}`);
    }
  }

  // Lazy backfill: store the converted text so we don't repeat this work
  if (text && fileId) {
    pool.execute(
      'UPDATE case_files SET converted_text = ?, text_format = ?, converted_at = NOW() WHERE id = ? AND converted_text IS NULL',
      [text, textFormat, fileId]
    ).then(() => {
      console.log(`[loadFileContent] Backfilled converted_text for file ${fileId} (${text.length} chars)`);
    }).catch(err => {
      console.warn(`[loadFileContent] Failed to backfill converted_text for file ${fileId}:`, err.message);
    });
  }

  return text;
}

// Load case data including markdown content for prompts
// Now uses ordered prompt context from case_files table
//
// With { readingParts: true } it also returns `reading_parts`: the same case text as
// case_content, one part per file or outline, each with its reading format
// (utils/readingFormat.js), so the student reading panel can render Markdown as Markdown and
// PDF / plain text line by line (components/ReadingText.tsx). case_content itself is unchanged: it builds the chat prompt,
// which must stay byte-for-byte stable (server/scripts/check-chat-prompt.js).
async function loadCaseData(caseId, { readingParts = false } = {}) {
  const [cases] = await pool.execute(
    `SELECT case_id, case_title, activity_type, goal
     FROM cases WHERE case_id = ?`,
    [caseId]
  );

  if (cases.length === 0) return null;

  const caseData = cases[0];
  caseData.case_content = '';
  caseData.teaching_note = '';
  caseData.supplementary_content = '';
  const parts = [];
  // The supplementary text a student may read: supplementary_content without ai_only roles such
  // as instructor notes (utils/documentRoles.js). supplementary_content itself goes to the AI.
  let studentSupplementary = '';
  const addSupplementary = (role, text) => {
    caseData.supplementary_content += text;
    if (isStudentVisibleRole(role)) studentSupplementary += text;
  };

  // Try to load files from database with ordering
  let [baseFiles] = await pool.execute(
    `SELECT id, filename, file_type, file_format, proprietary, proprietary_confirmed_by,
            include_in_chat_prompt, prompt_order, converted_text, text_format
     FROM case_files
     WHERE case_id = ? AND include_in_chat_prompt = 1 AND is_outline = 0
     ORDER BY prompt_order ASC, created_at ASC`,
    [caseId]
  );

  const [outlineFiles] = await pool.execute(
    `SELECT cf.id, cf.parent_file_id, cf.filename, cf.file_type, cf.file_format,
            cf.include_in_chat_prompt, cf.prompt_order, cf.is_latest_outline,
            cf.outline_content, cf.converted_text,
            parent.file_type AS parent_file_type
     FROM case_files cf
     LEFT JOIN case_files parent ON cf.parent_file_id = parent.id
     WHERE cf.case_id = ? AND cf.include_in_chat_prompt = 1
       AND cf.is_outline = 1 AND cf.is_latest_outline = 1
     ORDER BY cf.prompt_order ASC, cf.created_at ASC`,
    [caseId]
  );

  // Fallback: if nothing is explicitly marked include_in_chat_prompt, pull the first available case file
  if (baseFiles.length === 0) {
    console.log(`[loadCaseData] No files with include_in_chat_prompt=1 found for ${caseId}, trying fallback...`);
    
    // First try file_type='case'
    let [fallbackCaseFiles] = await pool.execute(
      `SELECT id, filename, file_type, file_format, proprietary, proprietary_confirmed_by,
              include_in_chat_prompt, prompt_order, converted_text, text_format
       FROM case_files
       WHERE case_id = ? AND file_type = 'case' AND is_outline = 0
       ORDER BY prompt_order ASC, created_at ASC
       LIMIT 1`,
      [caseId]
    );
    
    // If still nothing, try ANY file for this case (might be uploaded with wrong type)
    if (fallbackCaseFiles.length === 0) {
      console.log(`[loadCaseData] No file_type='case' found, trying any file for ${caseId}...`);
      [fallbackCaseFiles] = await pool.execute(
        `SELECT id, filename, file_type, file_format, proprietary, proprietary_confirmed_by,
                include_in_chat_prompt, prompt_order, converted_text, text_format
         FROM case_files
         WHERE case_id = ? AND is_outline = 0
         ORDER BY prompt_order ASC, created_at ASC`,
        [caseId]
      );
      console.log(`[loadCaseData] Found ${fallbackCaseFiles.length} files for ${caseId}:`, 
        fallbackCaseFiles.map(f => `${f.filename} (type: ${f.file_type})`));
    }
    
    baseFiles = fallbackCaseFiles;
  }

  if (baseFiles.length > 0) {
    // Organize outlines by parent
    const outlinesByParent = outlineFiles.reduce((acc, outline) => {
      if (!acc[outline.parent_file_id]) acc[outline.parent_file_id] = [];
      acc[outline.parent_file_id].push(outline);
      return acc;
    }, {});

    // Load content from each file in order, then its outlines immediately after
    for (const file of baseFiles) {
      // Skip proprietary files without confirmation
      if (file.proprietary && !file.proprietary_confirmed_by) {
        console.warn(`[loadCaseData] Skipping unconfirmed proprietary file: ${file.filename}`);
        continue;
      }

      try {
        const content = await loadFileContent(caseId, file.filename, file.file_type, file.converted_text, file.id);
        if (content) {
          if (file.file_type === 'case') {
            caseData.case_content += (caseData.case_content ? '\n\n' : '') + content;
            parts.push({ kind: 'file', format: readingFormatOf(file), content });
          } else if (file.file_type === 'teaching_note') {
            caseData.teaching_note += (caseData.teaching_note ? '\n\n' : '') + content;
          } else {
            const typeLabel = file.file_type.startsWith('other:')
              ? file.file_type.substring(6)
              : file.file_type.replace('_', ' ').toUpperCase();
            addSupplementary(file.file_type, `\n\n=== ${typeLabel}: ${file.filename} ===\n${content}`);
          }
        }
      } catch (e) {
        console.error(`[loadCaseData] Failed to load file ${file.filename}:`, e.message);
      }

      // Append outlines tied to this file, if any
      const outlines = outlinesByParent[file.id] || [];
      for (const outline of outlines) {
        try {
          const outlineContent =
            (await loadFileContent(caseId, outline.filename, outline.file_type, outline.converted_text, outline.id)) ||
            outline.outline_content ||
            '';
          if (!outlineContent) continue;

          const outlineLabel = `=== OUTLINE FOR ${file.filename} ===`;

          if (file.file_type === 'case') {
            caseData.case_content += `\n\n${outlineLabel}\n${outlineContent}`;
            parts.push({ kind: 'outline', format: MARKDOWN, content: outlineContent });
          } else if (file.file_type === 'teaching_note') {
            caseData.teaching_note += `\n\n${outlineLabel}\n${outlineContent}`;
          } else {
            const typeLabel = file.file_type.startsWith('other:')
              ? file.file_type.substring(6)
              : file.file_type.replace('_', ' ').toUpperCase();
            addSupplementary(file.file_type, `\n\n=== ${typeLabel}: ${file.filename} ===\n${outlineLabel}\n${outlineContent}`);
          }
        } catch (e) {
          console.error(`[loadCaseData] Failed to load outline ${outline.filename}:`, e.message);
        }
      }
    }

    // Include outlines whose parent has include_in_chat_prompt=0
    // (parent absent from baseFiles, so outline was not processed above)
    const processedParentIds = new Set(baseFiles.map(f => f.id));
    for (const outline of outlineFiles) {
      if (processedParentIds.has(outline.parent_file_id)) continue;
      try {
        const outlineContent =
          (await loadFileContent(caseId, outline.filename, outline.file_type, outline.converted_text, outline.id)) ||
          outline.outline_content ||
          '';
        if (!outlineContent) continue;

        const parentType = outline.parent_file_type || 'case';
        if (parentType === 'case') {
          caseData.case_content += (caseData.case_content ? '\n\n' : '') + outlineContent;
          parts.push({ kind: 'outline', format: MARKDOWN, content: outlineContent });
        } else if (parentType === 'teaching_note') {
          caseData.teaching_note += (caseData.teaching_note ? '\n\n' : '') + outlineContent;
        } else {
          const typeLabel = parentType.startsWith('other:')
            ? parentType.substring(6)
            : parentType.replace('_', ' ').toUpperCase();
          addSupplementary(parentType, `\n\n=== ${typeLabel} OUTLINE ===\n${outlineContent}`);
        }
        console.log(`[loadCaseData] Included standalone outline ${outline.filename} (parent excluded from prompt)`);
      } catch (e) {
        console.error(`[loadCaseData] Failed to load standalone outline ${outline.filename}:`, e.message);
      }
    }
  } else {
    // Fallback: Load from standard file locations (legacy behavior)
    try {
      const casePath = path.join(CASE_FILES_DIR, caseId, 'case.md');
      caseData.case_content = await fs.readFile(casePath, 'utf-8');
      parts.push({ kind: 'file', format: MARKDOWN, content: caseData.case_content });
    } catch (e) {
      console.error(`[loadCaseData] Failed to read case file: ${path.join(CASE_FILES_DIR, caseId, 'case.md')}`, e.message);
    }

    try {
      const notePath = path.join(CASE_FILES_DIR, caseId, 'teaching_note.md');
      caseData.teaching_note = await fs.readFile(notePath, 'utf-8');
    } catch (e) {
      // Teaching note is optional
    }
  }

  if (!caseData.case_content || caseData.case_content.trim() === '') {
    console.warn(`[loadCaseData] No case content loaded for: ${caseId}`);
  }

  if (readingParts) {
    caseData.reading_parts = parts;
    caseData.student_supplementary_content = studentSupplementary;
  }
  return caseData;
}

const router = express.Router();

// GET /api/llm/case-data/:caseId - The case's text for the student's reading panel (any login).
// Staff get the teaching note too; students never do.
router.get('/case-data/:caseId', verifyToken, async (req, res) => {
  const caseId = req.params.caseId;
  console.log(`[case-data] Loading case data for: ${caseId}`);
  
  try {
    const caseData = await loadCaseData(caseId, { readingParts: true });
    if (!caseData) {
      console.error(`[case-data] Case not found in database: ${caseId}`);
      return res.status(404).json({ data: null, error: { message: `Case "${caseId}" not found in database` } });
    }
    
    // Check if case content was loaded
    if (!caseData.case_content || caseData.case_content.trim() === '') {
      // Check what files exist in the database for this case
      const [dbFiles] = await pool.execute(
        'SELECT filename, file_type, include_in_chat_prompt, proprietary, proprietary_confirmed_by FROM case_files WHERE case_id = ?',
        [caseId]
      );
      console.error(`[case-data] Case content is empty for: ${caseId}`);
      console.error(`[case-data] Files in database:`, dbFiles);
      
      let errorMsg = `No case content found for "${caseId}". `;
      if (dbFiles.length === 0) {
        errorMsg += 'No files have been uploaded. Please upload case files via the Case Files manager.';
      } else {
        // Check if files are blocked due to proprietary status
        const proprietaryUnconfirmed = dbFiles.filter(f => f.proprietary && !f.proprietary_confirmed_by);
        if (proprietaryUnconfirmed.length > 0) {
          errorMsg += `Found ${dbFiles.length} file(s) but ${proprietaryUnconfirmed.length} are marked as proprietary and require admin confirmation in the Case Files manager before they can be used.`;
        } else {
          errorMsg += `Found ${dbFiles.length} file(s) in database but none could be loaded. Check that files have file_type='case' and include_in_chat_prompt=1, or verify the file exists on disk.`;
        }
      }
      
      return res.status(500).json({ 
        data: null, 
        error: { message: errorMsg } 
      });
    }
    
    console.log(`[case-data] Successfully loaded case: ${caseId} (${caseData.case_content.length} chars)`);
    // Students get what their screen shows: the case and supplementary materials, never the
    // teaching note (the server builds the chat prompt, services/chatPrompt.js). The case text
    // goes once, as reading_parts; the joined case_content is the prompt's copy and stays here.
    // Instructor notes are AI-only like the teaching note (utils/documentRoles.js), so students
    // get the supplementary text without them.
    // The goal is written for the AI and the grader; a student sees it only through the intro bar
    // of a type that shows it (POST /case-chats).
    const { teaching_note, case_content, student_supplementary_content, goal, ...rest } = caseData;
    const studentView = { ...rest, supplementary_content: student_supplementary_content };
    res.json({ data: req.user.role === 'student' ? studentView : { ...rest, goal, teaching_note }, error: null });
  } catch (error) {
    console.error(`[case-data] Error loading case data for ${caseId}:`, error);
    console.error(`[case-data] CASE_FILES_DIR: ${CASE_FILES_DIR}`);
    console.error(`[case-data] Expected path: ${path.join(CASE_FILES_DIR, caseId, 'case.md')}`);
    res.status(500).json({ 
      data: null, 
      error: { 
        message: error.message || 'Failed to load case data. Check server logs for details.' 
      } 
    });
  }
});

/**
 * Count one reply served by a backup model on the chat (case_chats.backup_models_used stays
 * NULL while every reply comes from chat_model). modelIdUsed comes from the models table,
 * never the request; the student_id match stops a caller from stamping someone else's chat.
 */
function recordBackupReply(caseChatId, studentId, modelIdUsed) {
  const path = `$."${String(modelIdUsed).replace(/["\\]/g, '')}"`;
  pool
    .execute(
      `UPDATE case_chats
          SET backup_models_used = JSON_SET(
                COALESCE(backup_models_used, JSON_OBJECT()), ?,
                CAST(COALESCE(JSON_EXTRACT(backup_models_used, ?), 0) AS UNSIGNED) + 1)
        WHERE id = ? AND student_id = ?`,
      [path, path, caseChatId, studentId]
    )
    .catch((e) => console.error('[llm/chat] failed to record backup reply:', e.message));
}

// POST /api/llm/chat - One student chat turn: { caseChatId, studentName, message }.
// Students only, on their own chat. The server builds the system prompt from the chat record
// (services/chatPrompt.js) and sends the model its own copy of the conversation
// (services/chatTurns.js), never one from the browser; the answered exchange is appended there
// and the transcript rewritten from it. The model and case come from the chat record, and the
// billed instructor from the token's student and that case.
router.post('/chat', verifyToken, requireRole(['student']), async (req, res) => {
  try {
    const { systemPrompt: clientSystemPrompt, studentName, message, caseChatId } = req.body || {};
    const studentId = req.user.id;
    // A page loaded before the server built prompts still sends its own. Refuse it rather
    // than run a student-supplied prompt (docs/server-side-chat-prompt.md, decision 2).
    if (clientSystemPrompt !== undefined) {
      return res.status(409).json({ data: null, error: { code: 'CLIENT_OUTDATED', message: 'This page was updated. Please refresh it to continue.' } });
    }
    if (!caseChatId || !message) {
      return res.status(400).json({ data: null, error: { message: 'caseChatId and message are required' } });
    }
    const [chats] = await pool.execute(
      `SELECT id, case_id, section_id, scenario_id, persona, initial_position_id, chat_model, status, activity_type_version
         FROM case_chats WHERE id = ? AND student_id = ?`,
      [caseChatId, studentId]
    );
    const chat = chats[0];
    if (!chat) {
      return res.status(404).json({ data: null, error: { message: 'Chat not found' } });
    }
    // A graded, cancelled or killed chat is over: nothing more joins its conversation.
    if (['completed', 'canceled', 'killed'].includes(chat.status)) {
      return res.status(409).json({ data: null, error: { code: 'CHAT_ENDED', message: 'This chat has ended. Please start a new one.' } });
    }
    const modelId = chat.chat_model;
    const caseId = chat.case_id;
    if (!modelId) {
      return res.status(400).json({ data: null, error: { message: 'This chat has no model assigned' } });
    }
    const context = await loadChatContext(chat);
    const turns = await listTurns(caseChatId);
    // The chat's limits, enforced here as well as in the page so a stale page or a direct
    // request cannot pass them. Exchanges are answered student messages: refused hints,
    // refused openings and the wrap-up message never reach this route, so they never count.
    const maxExchanges = Number(context.chatOptions.max_exchanges) || 0;
    const limitAction = context.chatOptions.max_exchanges_action || 'end';
    const maxLength = Number(context.chatOptions.max_message_length) || 0;
    const exchangesBefore = turns.filter((t) => t.role === 'student').length;
    if (maxLength > 0 && message.length > maxLength) {
      return res.status(400).json({ data: null, error: { code: 'MESSAGE_TOO_LONG', message: `Please keep your message under ${maxLength} characters.` } });
    }
    // 'ask' lets the student choose to keep talking past the limit, so only 'end' is a hard cap.
    if (maxExchanges > 0 && limitAction !== 'ask' && exchangesBefore >= maxExchanges) {
      return res.status(409).json({ data: null, error: { code: 'EXCHANGE_LIMIT_REACHED', message: 'You have used all your responses for this chat.' } });
    }
    // The model is told it is answering the last message only when the chat then ends ('end'):
    // in 'ask' the student may keep talking, so the protagonist must not close the meeting.
    const isFinalExchange = maxExchanges > 0 && limitAction === 'end' && exchangesBefore + 1 === maxExchanges;
    // The type version this chat started on (case_chats.activity_type_version).
    const behaviour = context.behaviour;
    // A clicked position is the first student message, in exactly the position's wording (the
    // page saves initial_position_id before sending it). Only the model sees the note; the
    // stored turn is the message as sent.
    let pickedText = null;
    if ((behaviour.positionPickNote || behaviour.openingWordFloor) && chat.initial_position_id) {
      const [posRows] = await pool.execute(
        'SELECT position FROM scenario_positions WHERE position_id = ? AND scenario_id = ?',
        [chat.initial_position_id, chat.scenario_id]
      );
      pickedText = posRows[0]?.position?.trim() || null;
    }
    const isPick = (text) => pickedText !== null && pickedText === String(text).trim();
    const isPositionPick = Boolean(behaviour.positionPickNote) && exchangesBefore === 0 && isPick(message);
    // The word floor on the opening (types with traits.opening_word_floor; chat option
    // min_opening_words, utils/openingWords.js), enforced here as well as in the page, so a stale
    // page cannot spend a chat on "idk". The opening is the first student message that is not a
    // clicked position; once one has been answered, later replies are not floored.
    if (behaviour.openingWordFloor) {
      const minWords = minOpeningWords(context.chatOptions);
      const studentTurns = turns.filter((t) => t.role === 'student');
      const openingAnswered = studentTurns.some((t, i) => !(i === 0 && isPick(t.content)));
      if (minWords > 0 && !openingAnswered && !isPick(message) && countWords(message) < minWords) {
        return res.status(400).json({ data: null, error: { code: 'OPENING_TOO_SHORT', min_words: minWords, message: `Please start with an explanation of at least ${minWords} words.` } });
      }
    }
    const modelMessage = message
      + (isPositionPick ? behaviour.positionPickNote : '')
      + (isFinalExchange ? behaviour.finalTurnNote : '');
    const systemPrompt = buildChatSystemPrompt(context, sanitizeStudentName(studentName));
    const history = historyForModel(turns);
    const askedAt = new Date();
    const modelConfig = await getModelConfig(modelId);
    if (!modelConfig) {
      return res.status(404).json({ data: null, error: { message: 'Model not found' } });
    }

    const instructorId = await resolveInstructorForStudentCase(studentId, caseId);
    const sectionId = await resolveSectionForStudentCase(studentId, caseId);

    const startTime = Date.now();
    // Falls back to the ranked default models when modelId is rate-limited or times out.
    const { text, meta, modelIdUsed, backup } = await chatWithFallback({
      modelId,
      systemPrompt,
      history,
      // The final-turn note goes to the model only; the stored turn and transcript keep the
      // student's own words.
      message: modelMessage,
      config: { caseId, instructorId, sectionId, caseChatId, purpose: 'student_chat' },
    });
    const durationMs = Date.now() - startTime;

    if (backup) {
      recordBackupReply(caseChatId, studentId, modelIdUsed);
    }

    // Only answered exchanges join the conversation: a failed turn leaves no trace, and the
    // student simply sends again.
    await appendTurns(caseChatId, [
      { role: 'student', content: message, at: askedAt },
      { role: 'protagonist', content: text },
    ]);
    if (context.chatOptions.auto_save_transcript !== false) {
      writeTranscript(caseChatId, { protagonistName: protagonistLabel(context) })
        .catch((e) => console.error('[llm/chat] transcript write failed:', e.message));
    }

    // Log prompt if enabled (async, non-blocking)
    logPromptIfEnabled({
      logType: 'chat',
      studentId,
      caseId,
      modelId: modelIdUsed,
      systemPrompt,
      history,
      currentMessage: modelMessage, // what the model received, final-turn note included
      currentMessageAt: askedAt.getTime(),
      response: text,
      meta,
      durationMs
    }).catch(() => {}); // Fire and forget - errors handled internally

    res.json({ data: { text, meta: { ...meta, model_id: modelIdUsed, backup, exchanges_used: exchangesBefore + 1 } }, error: null });
  } catch (error) {
    if (error?.code === 'INSTRUCTOR_SETUP_INCOMPLETE') {
      return res.status(409).json({ data: null, error: { code: error.code, message: "This section isn't ready yet — your instructor still needs to finish setup.", provider: error.provider } });
    }
    if (error?.code === 'INSTRUCTOR_COST_CAP_EXCEEDED') {
      return res.status(409).json({ data: null, error: { code: error.code, message: "Your instructor's AI usage limit has been reached for this week — please contact them.", used: error.used, cap: error.cap } });
    }
    if (error?.code === 'MODEL_UNPRICED') {
      return res.status(409).json({ data: null, error: { code: error.code, message: 'This model has no pricing configured — please contact your instructor.', modelId: error.modelId } });
    }
    if (error?.code === 'ACTIVITY_TYPE_UNAVAILABLE') {
      return res.status(409).json({ data: null, error: { code: error.code, message: error.message } });
    }
    if (error?.status === 404) {
      return res.status(404).json({ data: null, error: { message: error.message } });
    }
    console.error('LLM chat error:', error);
    res.status(500).json({ data: null, error: { message: error.message || 'LLM chat failed' } });
  }
});

// Export loadCaseData and getModelConfig for use in other modules (e.g., evaluations)
export { loadCaseData, loadFileContent, getModelConfig };

export default router;

