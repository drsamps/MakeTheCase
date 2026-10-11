import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db.js';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { requireAdminOrInstructor, getChatViewableSectionIds, isSectionInScope } from '../middleware/instructorAccess.js';
import { requireSelfStudent } from '../middleware/chatOwner.js';
import { loadChatContext, protagonistLabel } from '../services/chatPrompt.js';
import { listTurns, historyForGrading, writeTranscript } from '../services/chatTurns.js';
import { resolveSectionModel } from '../services/modelChoice.js';
import { inferPositionFromTranscript } from '../services/positionInference.js';
import { activityBehaviour } from '../services/activityTypes.js';
import { stripTurnTiming } from '../../utils/transcriptFormat.js';
import { getDefaultRubric, getRubricById } from '../services/rubricService.js';
import { evaluateWithLLM } from '../services/llmRouter.js';
import { logPromptIfEnabled } from '../services/promptLogger.js';
import { resolveInstructorForSection, resolveInstructorForCaseChat } from '../services/keyResolver.js';
import {
  parseEvaluationResponse,
  validateEvaluationResult,
  buildCorrectionPrompt,
  trimEvaluationResult,
} from '../services/evaluationNormalizer.js';

// Each activity type is judged by its own prompt (services/activityTypes.js): a teach-back
// student was teaching, not arguing, and the judge must ignore everything the listener said.
// The builders share one signature and one output contract, so the validation cascade below
// is the same for every type. The type is the case's, returned by loadCaseData().

const router = express.Router();

// Field list for SELECT queries (keeps things DRY)
// NOTE: transcript, persona, hints, chat_model removed - now in case_chats and transcripts tables
const EVAL_FIELDS = `id, created_at, student_id, case_id, case_chat_id, score, summary, criteria,
                     helpful, liked, improve, super_model, allow_rechat, rubric_id`;
// The same fields on alias `e`, for queries that join case_chats/students (which share column names)
const EVAL_FIELDS_E = EVAL_FIELDS.split(',').map(f => `e.${f.trim()}`).join(', ');

// An evaluation's section: its chat's section, else the student's enrolled section
// (evaluations with no case chat, and chats from before case_chats.section_id was filled in).
const EVAL_SCOPE_JOINS = `LEFT JOIN case_chats cc ON cc.id = e.case_chat_id
     LEFT JOIN students st ON st.id = e.student_id`;
const EVAL_SECTION_SQL = 'COALESCE(cc.section_id, st.section_id)';

// GET /api/evaluations - Get evaluations in the caller's chat scope (optionally filter by student_id and/or case_id)
router.get('/', verifyToken, requireRole(['admin', 'instructor']), async (req, res) => {
  try {
    const { student_id, student_ids, case_id } = req.query;

    const scopedSectionIds = await getChatViewableSectionIds(req);
    if (scopedSectionIds && scopedSectionIds.length === 0) {
      return res.json({ data: [], error: null });
    }

    let query = `SELECT ${EVAL_FIELDS_E} FROM evaluations e`;
    const params = [];
    const conditions = [];

    if (scopedSectionIds) {
      query += ` ${EVAL_SCOPE_JOINS}`;
      conditions.push(`${EVAL_SECTION_SQL} IN (${scopedSectionIds.map(() => '?').join(',')})`);
      params.push(...scopedSectionIds);
    }
    
    if (student_id) {
      conditions.push('e.student_id = ?');
      params.push(student_id);
    } else if (student_ids) {
      // Support comma-separated list of student IDs
      const ids = student_ids.split(',');
      const placeholders = ids.map(() => '?').join(',');
      conditions.push(`e.student_id IN (${placeholders})`);
      params.push(...ids);
    }
    
    if (case_id) {
      conditions.push('e.case_id = ?');
      params.push(case_id);
    }
    
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    
    query += ' ORDER BY e.created_at DESC';
    
    const [rows] = await pool.execute(query, params);
    
    // Parse JSON criteria field
    const data = rows.map(row => ({
      ...row,
      criteria: row.criteria ? (typeof row.criteria === 'string' ? JSON.parse(row.criteria) : row.criteria) : null
    }));
    
    res.json({ data, error: null });
  } catch (error) {
    console.error('Error fetching evaluations:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/evaluations/check-completion/:studentId/:caseId - Check if student has completed a case or scenario
// Query params: scenario_id (optional) - filter by specific scenario
// Returns { completed: boolean, allow_rechat: boolean, evaluation_id: string | null }
router.get('/check-completion/:studentId/:caseId', requireSelfStudent('studentId'), async (req, res) => {
  try {
    const { studentId, caseId } = req.params;
    const { scenario_id } = req.query;

    let query;
    let params;

    // If scenario_id is provided, join with case_chats to filter by scenario
    if (scenario_id) {
      query = `SELECT e.id, e.allow_rechat FROM evaluations e
         JOIN case_chats cc ON e.case_chat_id = cc.id
         WHERE e.student_id = ? AND e.case_id = ? AND cc.scenario_id = ?
         ORDER BY e.created_at DESC LIMIT 1`;
      params = [studentId, caseId, scenario_id];
    } else {
      query = `SELECT id, allow_rechat FROM evaluations
         WHERE student_id = ? AND case_id = ?
         ORDER BY created_at DESC LIMIT 1`;
      params = [studentId, caseId];
    }

    const [rows] = await pool.execute(query, params);

    if (rows.length === 0) {
      return res.json({
        data: { completed: false, allow_rechat: false, evaluation_id: null },
        error: null
      });
    }

    const evaluation = rows[0];
    res.json({
      data: {
        completed: true,
        allow_rechat: !!evaluation.allow_rechat,
        evaluation_id: evaluation.id
      },
      error: null
    });
  } catch (error) {
    console.error('Error checking completion:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

/** helpful: 1-5 or null; liked/improve: trimmed text up to 2000 characters or null. */
function cleanFeedback(feedback = {}) {
  const helpful = Number.parseInt(feedback?.helpful, 10);
  const text = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 2000) : null);
  return {
    helpful: helpful >= 1 && helpful <= 5 ? helpful : null,
    liked: text(feedback?.liked),
    improve: text(feedback?.improve),
  };
}

// POST /api/evaluations/run - Grade a student's chat and save the evaluation.
// Body: { case_chat_id, feedback?: { helpful, liked, improve }, share_transcript? }.
// Students only, on their own chat (404 otherwise, so chat IDs can't be probed). The server
// grades ITS copy of the conversation (services/chatTurns.js) with the section's supervisor
// model and the assignment's rubric, saves the evaluation row itself and marks the chat
// completed; the browser supplies only the student's own feedback answers and transcript
// consent. A request carrying chatHistory is an outdated page (409 CLIENT_OUTDATED).
// MUST be placed before /:id routes
router.post('/run', verifyToken, requireRole(['student']), async (req, res) => {
  const { case_chat_id, chatHistory: clientHistory, feedback, share_transcript } = req.body || {};

  if (clientHistory !== undefined) {
    return res.status(409).json({ data: null, error: { code: 'CLIENT_OUTDATED', message: 'This page was updated. Please refresh it to continue.' } });
  }
  if (!case_chat_id) {
    return res.status(400).json({ data: null, error: { message: 'case_chat_id is required' } });
  }

  try {
    // 1. Look up case_chat details
    const [chatRows] = await pool.execute(
      `SELECT cc.id, cc.case_id, cc.student_id, cc.section_id, cc.scenario_id, cc.persona, cc.initial_position_id, s.full_name
       FROM case_chats cc
       JOIN students s ON cc.student_id = s.id
       WHERE cc.id = ?`,
      [case_chat_id]
    );
    if (!chatRows.length || chatRows[0].student_id !== req.user.id) {
      return res.status(404).json({ data: null, error: { message: 'Case chat not found' } });
    }
    const { case_id, student_id, section_id, full_name } = chatRows[0];

    const [existingEval] = await pool.execute('SELECT id FROM evaluations WHERE case_chat_id = ? LIMIT 1', [case_chat_id]);
    if (existingEval.length) {
      return res.status(409).json({ data: null, error: { code: 'ALREADY_EVALUATED', message: 'This chat has already been evaluated.' } });
    }

    // 2. The conversation to grade: the server's copy, never the browser's
    const context = await loadChatContext(chatRows[0]);
    const turns = await listTurns(case_chat_id);
    if (!turns.some((t) => t.role === 'student')) {
      return res.status(400).json({ data: null, error: { message: 'There is no conversation to evaluate yet.' } });
    }
    const chatHistory = historyForGrading(turns, protagonistLabel(context));
    const freeHints = context.chatOptions.free_hints ?? 1;
    const modelId = await resolveSectionModel(section_id, 'super_model');

    // 3. Get rubric: the assignment's, else the default (what the student app used to send)
    const [rubricRows] = await pool.execute(
      'SELECT rubric_id FROM section_cases WHERE section_id = ? AND case_id = ?',
      [section_id, case_id]
    );
    const assignedRubricId = rubricRows[0]?.rubric_id;
    let rubric = (assignedRubricId && await getRubricById(assignedRubricId)) || await getDefaultRubric();

    // 4. Load case data
    const { loadCaseData, getModelConfig } = await import('./llm.js');
    let caseData = await loadCaseData(case_id);
    if (!caseData) {
      return res.status(404).json({ data: null, error: { message: 'Case not found' } });
    }

    // Teach-back is judged against the audience the student chose, and against its own
    // criteria unless the assignment names a rubric (a rubric is always passed in here).
    const activity = activityBehaviour(caseData.activity_type);
    ({ caseData, rubric } = await activity.prepareEvalInputs({ caseChatId: case_chat_id, sectionId: section_id, caseId: case_id, caseData, rubric }));
    const expectedCriteria = rubric?.criteria?.length || (rubric?.criteria_prompt?.match(/Q\d+\./g) || []).length || 3;
    // Every successful exit goes through here so unverified "student quotes" never ship, and
    // so the saved evaluation is exactly what the student is shown.
    const sendResult = async (data) => {
      const result = activity.finishEvaluation(data, chatHistory, caseData.protagonist);
      const { helpful, liked, improve } = cleanFeedback(feedback);
      const evaluationId = uuidv4();
      await pool.execute(
        `INSERT INTO evaluations (id, student_id, case_id, case_chat_id, score, summary, criteria, helpful, liked, improve, super_model, allow_rechat, rubric_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE, ?)`,
        [evaluationId, student_id, case_id, case_chat_id, result.totalScore ?? 0, result.summary || null,
         result.criteria ? JSON.stringify(result.criteria) : null, helpful, liked, improve, modelId, result.rubric_id || null]
      );
      await pool.execute(
        `UPDATE case_chats SET status = 'completed', end_time = CURRENT_TIMESTAMP WHERE id = ?`,
        [case_chat_id]
      );
      // Same rule the browser used: save when auto-save is on (the default), the assignment
      // always saves, or the student agreed to share it.
      const opts = context.chatOptions;
      if (opts.auto_save_transcript !== false || opts.always_save_transcript || share_transcript) {
        await writeTranscript(case_chat_id, { protagonistName: protagonistLabel(context), savedWithPermission: Boolean(share_transcript) });
      }
      inferPositionAfterEvaluation(case_chat_id)
        .catch((e) => console.error('[AI Position Inference] Error during position inference:', e));
      return res.json({ data: { ...result, evaluation_id: evaluationId }, error: null });
    };

    // 5. Look up model config (for temperature/reasoning_effort)
    const modelConfig = await getModelConfig(modelId);
    if (!modelConfig) {
      return res.status(404).json({ data: null, error: { message: 'Model not found' } });
    }

    // 6. Build evaluation prompt
    const prompt = activity.buildCoachPrompt(chatHistory, full_name, caseData, freeHints, rubric);

    // 7. Call LLM
    const instructorId = await resolveInstructorForSection(section_id);
    const startTime = Date.now();
    const { text: rawResult, meta } = await evaluateWithLLM({ modelId, vendor: modelConfig.vendor, prompt, config: { ...modelConfig, instructorId, caseId: case_id, sectionId: section_id, purpose: 'evaluation' } });
    const durationMs = Date.now() - startTime;

    // Log prompt (async, non-blocking)
    logPromptIfEnabled({
      logType: 'eval',
      studentId: student_id,
      caseId: case_id,
      modelId,
      systemPrompt: prompt,
      response: rawResult,
      meta,
      durationMs
    }).catch(() => {});

    // 8. Parse and normalize
    let result;
    try {
      result = parseEvaluationResponse(rawResult, rubric);
    } catch (parseErr) {
      console.error('[Eval run] Failed to parse LLM result:', parseErr.message);
      return res.status(500).json({ data: null, error: { message: 'Failed to parse evaluation result', code: 'EVAL_PARSE_FAILED' } });
    }

    // 9. Validate
    let issues = validateEvaluationResult(result, expectedCriteria);

    // --- Three-step failure cascade ---

    // Step 1: Retry with correction prompt
    if (issues.length > 0) {
      console.warn('[Eval run] Validation issues on first attempt:', issues.map(i => i.code));
      try {
        const correctionPrompt = buildCorrectionPrompt(prompt, issues, expectedCriteria, result);
        const retryStartTime = Date.now();
        const { text: retryRaw, meta: retryMeta } = await evaluateWithLLM({ modelId, vendor: modelConfig.vendor, prompt: correctionPrompt, config: { ...modelConfig, instructorId, caseId: case_id, sectionId: section_id, purpose: 'evaluation' } });
        const retryDurationMs = Date.now() - retryStartTime;

        logPromptIfEnabled({
          logType: 'eval',
          studentId: student_id,
          caseId: case_id,
          modelId,
          systemPrompt: correctionPrompt,
          response: retryRaw,
          meta: retryMeta,
          durationMs: retryDurationMs
        }).catch(() => {});

        const retryResult = parseEvaluationResponse(retryRaw, rubric);
        const retryIssues = validateEvaluationResult(retryResult, expectedCriteria);

        if (retryIssues.length === 0) {
          console.log('[Eval run] Retry succeeded — validation passed');
          return await sendResult(retryResult);
        }

        // Retry didn't fully fix it; use retry result for Step 2 if it's better
        if (retryIssues.length < issues.length) {
          result = retryResult;
          issues = retryIssues;
        }
        console.warn('[Eval run] Retry still has issues:', retryIssues.map(i => i.code));
      } catch (retryErr) {
        console.warn('[Eval run] Retry failed:', retryErr.message);
      }
    }

    // Step 2: Trim/fix the result to match rubric criteria
    if (issues.some(i => i.code === 'WRONG_CRITERIA_COUNT') && rubric?.criteria?.length) {
      console.log('[Eval run] Attempting to trim/fix criteria to match rubric');
      const hintPenalty = Math.max(0, (result.hints || 0) - freeHints);
      const trimmed = trimEvaluationResult(result, rubric.criteria, hintPenalty);
      const trimIssues = validateEvaluationResult(trimmed, expectedCriteria);

      // Accept if criteria count is now correct (ignore ZERO_SCORE_WITH_SUMMARY — we did our best)
      const criticalIssues = trimIssues.filter(i => i.code !== 'ZERO_SCORE_WITH_SUMMARY');
      if (criticalIssues.length === 0) {
        console.log('[Eval run] Trim succeeded — returning fixed result');
        return await sendResult(trimmed);
      }

      // Use trimmed result even if not perfect, as long as we have criteria
      if (trimmed.criteria.length === expectedCriteria) {
        console.log('[Eval run] Trim partially succeeded — returning trimmed result with remaining issues');
        return await sendResult(trimmed);
      }
    }

    // If only ZERO_SCORE_WITH_SUMMARY remains, still return the result
    const criticalIssues = issues.filter(i => i.code !== 'ZERO_SCORE_WITH_SUMMARY');
    if (criticalIssues.length === 0) {
      return await sendResult(result);
    }

    // Step 3: Give up gracefully
    if (issues.length > 0 && result.criteria.length > 0 && result.summary && result.summary !== 'No summary provided.') {
      console.warn('[Eval run] Returning imperfect result (has criteria + summary)');
      return await sendResult(result);
    }

    console.error('[Eval run] Evaluation failed after all recovery attempts:', issues.map(i => i.code));
    return res.status(422).json({
      data: null,
      error: { message: 'Evaluation could not be completed automatically.', code: 'EVAL_VALIDATION_FAILED' }
    });

  } catch (error) {
    console.error('[Eval run] Error:', error.message);
    console.error('[Eval run] Stack:', error.stack);
    res.status(500).json({ data: null, error: { message: error.message || 'Evaluation failed' } });
  }
});

// POST /api/evaluations/re-evaluate - Re-evaluate a transcript without saving
// Admin only for now
// MUST be placed before /:id routes
router.post('/re-evaluate', verifyToken, requireRole(['admin']), async (req, res) => {
  const { case_chat_id, rubric_id, model_id, include_prompt } = req.body;

  if (!case_chat_id || !model_id) {
    return res.status(400).json({ data: null, error: { message: 'case_chat_id and model_id are required' } });
  }

  try {
    console.log('[Re-evaluate] Starting with case_chat_id:', case_chat_id, 'rubric_id:', rubric_id, 'model_id:', model_id);

    // 1. Get transcript
    const [transcriptRows] = await pool.execute(
      'SELECT transcript FROM transcripts WHERE case_chat_id = ?',
      [case_chat_id]
    );
    if (!transcriptRows.length || !transcriptRows[0].transcript) {
      return res.status(404).json({ data: null, error: { message: 'No transcript found for this chat' } });
    }
    const transcript = transcriptRows[0].transcript;
    console.log('[Re-evaluate] Step 1: Got transcript, length:', transcript.length);

    // 2. Get case_chat details
    const [chatRows] = await pool.execute(
      `SELECT cc.case_id, cc.student_id, cc.section_id, s.full_name, c.case_title
       FROM case_chats cc
       JOIN students s ON cc.student_id = s.id
       JOIN cases c ON cc.case_id = c.case_id
       WHERE cc.id = ?`,
      [case_chat_id]
    );
    if (!chatRows.length) {
      return res.status(404).json({ data: null, error: { message: 'Case chat not found' } });
    }
    const { case_id, student_id, section_id, full_name } = chatRows[0];
    console.log('[Re-evaluate] Step 2: Got case_id:', case_id, 'full_name:', full_name);

    // 3. Get rubric
    console.log('[Re-evaluate] Step 3: Getting rubric...');
    let rubric = rubric_id
      ? await getRubricById(rubric_id)
      : await getDefaultRubric();
    console.log('[Re-evaluate] Step 3: Got rubric:', rubric?.rubric_id);

    // 4. Load case data
    console.log('[Re-evaluate] Step 4: Loading case data...');
    const { loadCaseData } = await import('./llm.js');
    let caseData = await loadCaseData(case_id);
    if (!caseData) {
      return res.status(404).json({ data: null, error: { message: 'Case not found' } });
    }
    console.log('[Re-evaluate] Step 4: Got case data');
    const reEvalActivity = activityBehaviour(caseData.activity_type);
    ({ caseData, rubric } = await reEvalActivity.prepareEvalInputs({ caseChatId: case_chat_id, sectionId: section_id, caseId: case_id, caseData, rubric, rubricChosen: !!rubric_id }));

    // 5. Build evaluation prompt
    console.log('[Re-evaluate] Step 5: Building prompt...');
    // Turn timing ("| 12 after 3.52m") is for instructors; the evaluator must not see it.
    const prompt = reEvalActivity.buildCoachPrompt(stripTurnTiming(transcript), full_name, caseData, 0, rubric);
    console.log('[Re-evaluate] Step 5: Built prompt, length:', prompt.length);

    // 6. Call LLM for evaluation
    console.log('[Re-evaluate] Step 6: Calling LLM with model:', model_id);
    const { getModelConfig: getReEvalModelConfig } = await import('./llm.js');
    const reEvalModelConfig = await getReEvalModelConfig(model_id);
    const reEvalInstructorId = await resolveInstructorForCaseChat(case_chat_id);
    const reEvalStartTime = Date.now();
    const { text: evalResult, meta: evalMeta } = await evaluateWithLLM({ modelId: model_id, vendor: reEvalModelConfig?.vendor || null, prompt, config: { ...(reEvalModelConfig || {}), instructorId: reEvalInstructorId, caseId: case_id, sectionId: section_id, purpose: 'evaluation' } });
    const reEvalDurationMs = Date.now() - reEvalStartTime;
    console.log('[Re-evaluate] Step 6: Got LLM result');

    // Log prompt if enabled (async, non-blocking)
    logPromptIfEnabled({
      logType: 'eval',
      studentId: student_id,
      caseId: case_id,
      modelId: model_id,
      systemPrompt: prompt,
      response: evalResult,
      meta: evalMeta,
      durationMs: reEvalDurationMs
    }).catch(() => {}); // Fire and forget

    // 7. Parse and return result
    let parsed;
    try {
      let jsonStr = evalResult;
      if (typeof jsonStr === 'string') {
        // Strip markdown code fences if present
        jsonStr = jsonStr.trim();
        if (jsonStr.startsWith('```')) {
          jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
        }
        parsed = JSON.parse(jsonStr);
      } else {
        parsed = evalResult;
      }
    } catch (parseError) {
      console.error('Failed to parse evaluation result:', parseError);
      console.error('Raw result:', typeof evalResult === 'string' ? evalResult.substring(0, 200) : evalResult);
      return res.status(500).json({ data: null, error: { message: 'Failed to parse evaluation result' } });
    }

    res.json({
      data: {
        score: parsed.totalScore ?? parsed.score ?? 0,
        summary: parsed.summary || '',
        criteria: parsed.criteria || [],
        hints: parsed.hints || 0,
        rubric_id: rubric?.rubric_id,
        model_id: model_id,
        prompt: include_prompt ? prompt : undefined
      },
      error: null
    });

  } catch (error) {
    console.error('Re-evaluation error:', error.message);
    console.error('Re-evaluation stack:', error.stack);
    res.status(500).json({ data: null, error: { message: error.message || 'Re-evaluation failed' } });
  }
});

// GET /api/evaluations/preview-prompt - Get the evaluation prompt preview
// Admin only for now
router.get('/preview-prompt', verifyToken, requireRole(['admin']), async (req, res) => {
  const { case_chat_id, rubric_id } = req.query;
  console.log('[Preview-prompt] Starting with case_chat_id:', case_chat_id, 'rubric_id:', rubric_id);

  if (!case_chat_id) {
    return res.status(400).json({ data: null, error: { message: 'case_chat_id is required' } });
  }

  try {
    // Get transcript
    console.log('[Preview-prompt] Step 1: Getting transcript...');
    const [transcriptRows] = await pool.execute(
      'SELECT transcript FROM transcripts WHERE case_chat_id = ?',
      [case_chat_id]
    );
    if (!transcriptRows.length || !transcriptRows[0].transcript) {
      return res.status(404).json({ data: null, error: { message: 'No transcript found' } });
    }
    console.log('[Preview-prompt] Step 1: Got transcript');

    // Get case_chat details
    console.log('[Preview-prompt] Step 2: Getting case_chat details...');
    const [chatRows] = await pool.execute(
      `SELECT cc.case_id, cc.section_id, s.full_name
       FROM case_chats cc
       JOIN students s ON cc.student_id = s.id
       WHERE cc.id = ?`,
      [case_chat_id]
    );
    if (!chatRows.length) {
      return res.status(404).json({ data: null, error: { message: 'Case chat not found' } });
    }
    const { case_id, section_id, full_name } = chatRows[0];
    console.log('[Preview-prompt] Step 2: Got case_id:', case_id, 'full_name:', full_name);

    // Get rubric and case data, build prompt
    console.log('[Preview-prompt] Step 3: Getting rubric...');
    let rubric = rubric_id ? await getRubricById(rubric_id) : await getDefaultRubric();
    console.log('[Preview-prompt] Step 3: Got rubric:', rubric?.rubric_id);

    console.log('[Preview-prompt] Step 4: Loading case data...');
    const { loadCaseData } = await import('./llm.js');
    let caseData = await loadCaseData(case_id);
    console.log('[Preview-prompt] Step 4: Got case data:', !!caseData);
    const previewActivity = activityBehaviour(caseData?.activity_type);
    ({ caseData, rubric } = await previewActivity.prepareEvalInputs({ caseChatId: case_chat_id, sectionId: section_id, caseId: case_id, caseData, rubric, rubricChosen: !!rubric_id }));

    console.log('[Preview-prompt] Step 5: Building prompt...');
    const prompt = previewActivity.buildCoachPrompt(
      stripTurnTiming(transcriptRows[0].transcript),
      full_name,
      caseData || {},  // Handle null case data
      0,
      rubric
    );
    console.log('[Preview-prompt] Step 5: Built prompt, length:', prompt.length);

    res.json({ data: { prompt }, error: null });
  } catch (error) {
    console.error('Preview prompt error:', error.message);
    console.error('Preview prompt stack:', error.stack);
    res.status(500).json({ data: null, error: { message: error.message || 'Failed to generate prompt preview' } });
  }
});

// PATCH /api/evaluations/:id/allow-rechat - Toggle allow_rechat status (admin only)
// IMPORTANT: This route must be defined BEFORE /:id to ensure proper route matching
router.patch('/:id/allow-rechat', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { allow_rechat } = req.body;
    
    if (typeof allow_rechat !== 'boolean') {
      return res.status(400).json({ data: null, error: { message: 'allow_rechat must be a boolean' } });
    }
    
    await pool.execute(
      'UPDATE evaluations SET allow_rechat = ? WHERE id = ?',
      [allow_rechat ? 1 : 0, id]
    );
    
    const [rows] = await pool.execute(
      `SELECT ${EVAL_FIELDS} FROM evaluations WHERE id = ?`,
      [id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Evaluation not found' } });
    }
    
    const row = rows[0];
    const data = {
      ...row,
      criteria: row.criteria ? (typeof row.criteria === 'string' ? JSON.parse(row.criteria) : row.criteria) : null
    };
    
    res.json({ data, error: null });
  } catch (error) {
    console.error('Error updating allow_rechat:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/evaluations/:id - Get single evaluation (staff; 404 outside the caller's chat scope)
router.get('/:id', verifyToken, requireRole(['admin', 'instructor']), async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT ${EVAL_FIELDS_E}, ${EVAL_SECTION_SQL} AS scope_section_id
       FROM evaluations e
       ${EVAL_SCOPE_JOINS}
       WHERE e.id = ?`,
      [req.params.id]
    );
    
    const scopedSectionIds = await getChatViewableSectionIds(req);
    if (rows.length === 0 || !isSectionInScope(scopedSectionIds, rows[0].scope_section_id)) {
      return res.status(404).json({ data: null, error: { message: 'Evaluation not found' } });
    }
    
    const { scope_section_id, ...row } = rows[0];
    const data = {
      ...row,
      criteria: row.criteria ? (typeof row.criteria === 'string' ? JSON.parse(row.criteria) : row.criteria) : null
    };
    
    res.json({ data, error: null });
  } catch (error) {
    console.error('Error fetching evaluation:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// PATCH /api/evaluations/:id - Update evaluation fields (for re-evaluation)
// Admin only for now
router.patch('/:id', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { score, summary, criteria, rubric_id, super_model } = req.body;

    const updates = [];
    const values = [];

    if (score !== undefined) { updates.push('score = ?'); values.push(score); }
    if (summary !== undefined) { updates.push('summary = ?'); values.push(summary); }
    if (criteria !== undefined) {
      updates.push('criteria = ?');
      values.push(JSON.stringify(criteria));
    }
    if (rubric_id !== undefined) { updates.push('rubric_id = ?'); values.push(rubric_id); }
    if (super_model !== undefined) { updates.push('super_model = ?'); values.push(super_model); }

    if (updates.length === 0) {
      return res.status(400).json({ data: null, error: { message: 'No fields to update' } });
    }

    values.push(id);
    await pool.execute(
      `UPDATE evaluations SET ${updates.join(', ')} WHERE id = ?`,
      values
    );

    // Return updated evaluation
    const [rows] = await pool.execute(
      `SELECT ${EVAL_FIELDS} FROM evaluations WHERE id = ?`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Evaluation not found' } });
    }

    const row = rows[0];
    res.json({
      data: {
        ...row,
        criteria: row.criteria ? (typeof row.criteria === 'string' ? JSON.parse(row.criteria) : row.criteria) : null
      },
      error: null
    });
  } catch (error) {
    console.error('Error updating evaluation:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// AI position inference after a chat is graded: when the scenario's settings ask for an
// ai_inferred position and the chat has none yet, infer it from the saved transcript. Moved
// from the old POST /api/evaluations (removed: the browser no longer saves evaluations; /run
// does). Runs after the response is sent; failures are logged, never shown to the student.
async function inferPositionAfterEvaluation(case_chat_id) {
  const [chatRows] = await pool.execute(
    `SELECT cc.*, cs.chat_options_override, c.case_title, t.transcript
     FROM case_chats cc
     LEFT JOIN case_scenarios cs ON cc.scenario_id = cs.id
     LEFT JOIN cases c ON cc.case_id = c.case_id
     LEFT JOIN transcripts t ON t.case_chat_id = cc.id
     WHERE cc.id = ?`,
    [case_chat_id]
  );

  if (chatRows.length > 0) {
    const chat = chatRows[0];
    const scenarioSettings = chat.chat_options_override ? JSON.parse(chat.chat_options_override) : {};
    const transcriptText = chat.transcript;

    // Check if AI inference is needed
    const needsInference =
      scenarioSettings.position_tracking_enabled === true &&
      scenarioSettings.position_capture_method === 'ai_inferred' &&
      (!chat.initial_position || !chat.final_position) &&
      transcriptText; // Make sure we have a transcript to analyze

    if (needsInference) {
      const positionOptions = scenarioSettings.position_options || ['for', 'against'];

      // Get case data for the prompt
      const [caseRows] = await pool.execute(
        `SELECT case_title, arguments_for, arguments_against
         FROM cases WHERE case_id = ?`,
        [chat.case_id]
      );

      const caseData = caseRows.length > 0 ? caseRows[0] : {};
      if (chat.case_title) caseData.case_title = chat.case_title;

      // Get chat question from scenario
      if (chat.scenario_id) {
        const [scenarioRows] = await pool.execute(
          `SELECT chat_question FROM case_scenarios WHERE id = ?`,
          [chat.scenario_id]
        );
        if (scenarioRows.length > 0) {
          caseData.chat_question = scenarioRows[0].chat_question;
        }
      }

      // Infer position using AI
      const modelId = chat.chat_model || 'gemini-1.5-flash'; // Use chat model or default
      const inferenceInstructorId = await resolveInstructorForSection(chat.section_id);
      const inferenceResult = await inferPositionFromTranscript(
        transcriptText,
        caseData,
        positionOptions,
        modelId,
        inferenceInstructorId
      );

      if (inferenceResult && inferenceResult.position) {
        // Update case_chat with inferred position
        await pool.execute(
          `UPDATE case_chats
           SET initial_position = ?, final_position = ?, position_method = 'ai_inferred'
           WHERE id = ?`,
          [inferenceResult.position, inferenceResult.position, case_chat_id]
        );

        // Log the inferred position
        await pool.execute(
          `INSERT INTO chat_position_logs (case_chat_id, position_type, position_value, recorded_by, notes)
           VALUES (?, 'initial', ?, 'ai', ?)`,
          [case_chat_id, inferenceResult.position, `AI inference (confidence: ${inferenceResult.confidence.toFixed(2)}): ${inferenceResult.reasoning}`]
        );

        console.log(`[AI Position Inference] Chat ${case_chat_id}: ${inferenceResult.position} (confidence: ${inferenceResult.confidence.toFixed(2)})`);
      } else {
        console.warn(`[AI Position Inference] Failed to infer position for chat ${case_chat_id}`);
      }
    }
  }
}

// DELETE /api/evaluations/:id - Delete evaluation (admin only - for testing/cleanup)
router.delete('/:id', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    
    const [existing] = await pool.execute('SELECT id FROM evaluations WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Evaluation not found' } });
    }
    
    await pool.execute('DELETE FROM evaluations WHERE id = ?', [id]);
    
    res.json({ data: { deleted: true }, error: null });
  } catch (error) {
    console.error('Error deleting evaluation:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

export default router;
