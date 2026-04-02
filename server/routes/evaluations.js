import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db.js';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { requireAdminOrInstructor } from '../middleware/instructorAccess.js';
import { inferPositionFromTranscript } from '../services/positionInference.js';
import { buildCoachPrompt } from '../services/promptBuilder.js';
import { getDefaultRubric, getRubricById } from '../services/rubricService.js';
import { evaluateWithLLM } from '../services/llmRouter.js';
import { logPromptIfEnabled } from '../services/promptLogger.js';
import {
  parseEvaluationResponse,
  validateEvaluationResult,
  buildCorrectionPrompt,
  trimEvaluationResult,
} from '../services/evaluationNormalizer.js';

const router = express.Router();

// Field list for SELECT queries (keeps things DRY)
// NOTE: transcript, persona, hints, chat_model removed - now in case_chats and transcripts tables
const EVAL_FIELDS = `id, created_at, student_id, case_id, case_chat_id, score, summary, criteria,
                     helpful, liked, improve, super_model, allow_rechat, rubric_id`;

// GET /api/evaluations - Get all evaluations (optionally filter by student_id and/or case_id)
router.get('/', async (req, res) => {
  try {
    const { student_id, student_ids, case_id } = req.query;
    
    let query = `SELECT ${EVAL_FIELDS} FROM evaluations`;
    const params = [];
    const conditions = [];
    
    if (student_id) {
      conditions.push('student_id = ?');
      params.push(student_id);
    } else if (student_ids) {
      // Support comma-separated list of student IDs
      const ids = student_ids.split(',');
      const placeholders = ids.map(() => '?').join(',');
      conditions.push(`student_id IN (${placeholders})`);
      params.push(...ids);
    }
    
    if (case_id) {
      conditions.push('case_id = ?');
      params.push(case_id);
    }
    
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    
    query += ' ORDER BY created_at DESC';
    
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
router.get('/check-completion/:studentId/:caseId', async (req, res) => {
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

// POST /api/evaluations/run - Run a student evaluation (prompt built server-side)
// MUST be placed before /:id routes
router.post('/run', async (req, res) => {
  const { case_chat_id, chatHistory, modelId, rubricId } = req.body;

  if (!case_chat_id || !chatHistory || !modelId) {
    return res.status(400).json({ data: null, error: { message: 'case_chat_id, chatHistory, and modelId are required' } });
  }

  try {
    // 1. Look up case_chat details
    const [chatRows] = await pool.execute(
      `SELECT cc.case_id, cc.student_id, cc.section_id, s.full_name
       FROM case_chats cc
       JOIN students s ON cc.student_id = s.id
       WHERE cc.id = ?`,
      [case_chat_id]
    );
    if (!chatRows.length) {
      return res.status(404).json({ data: null, error: { message: 'Case chat not found' } });
    }
    const { case_id, student_id, section_id, full_name } = chatRows[0];

    // 2. Look up chat_options from section_cases for free_hints
    let freeHints = 1;
    if (section_id && case_id) {
      const [scRows] = await pool.execute(
        'SELECT chat_options FROM section_cases WHERE section_id = ? AND case_id = ?',
        [section_id, case_id]
      );
      if (scRows.length && scRows[0].chat_options) {
        try {
          const opts = typeof scRows[0].chat_options === 'string'
            ? JSON.parse(scRows[0].chat_options)
            : scRows[0].chat_options;
          freeHints = opts.free_hints ?? 1;
        } catch { /* keep default */ }
      }
    }

    // 3. Get rubric
    const rubric = rubricId ? await getRubricById(rubricId) : await getDefaultRubric();
    const expectedCriteria = rubric?.criteria?.length || (rubric?.criteria_prompt?.match(/Q\d+\./g) || []).length || 3;

    // 4. Load case data
    const { loadCaseData, getModelConfig } = await import('./llm.js');
    const caseData = await loadCaseData(case_id);
    if (!caseData) {
      return res.status(404).json({ data: null, error: { message: 'Case not found' } });
    }

    // 5. Look up model config (for temperature/reasoning_effort)
    const modelConfig = await getModelConfig(modelId);
    if (!modelConfig) {
      return res.status(404).json({ data: null, error: { message: 'Model not found' } });
    }

    // 6. Build evaluation prompt
    const prompt = buildCoachPrompt(chatHistory, full_name, caseData, freeHints, rubric);

    // 7. Call LLM
    const startTime = Date.now();
    const { text: rawResult, meta } = await evaluateWithLLM({ modelId, prompt, config: modelConfig });
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
        const { text: retryRaw, meta: retryMeta } = await evaluateWithLLM({ modelId, prompt: correctionPrompt, config: modelConfig });
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
          return res.json({ data: retryResult, error: null });
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
        return res.json({ data: trimmed, error: null });
      }

      // Use trimmed result even if not perfect, as long as we have criteria
      if (trimmed.criteria.length === expectedCriteria) {
        console.log('[Eval run] Trim partially succeeded — returning trimmed result with remaining issues');
        return res.json({ data: trimmed, error: null });
      }
    }

    // If only ZERO_SCORE_WITH_SUMMARY remains, still return the result
    const criticalIssues = issues.filter(i => i.code !== 'ZERO_SCORE_WITH_SUMMARY');
    if (criticalIssues.length === 0) {
      return res.json({ data: result, error: null });
    }

    // Step 3: Give up gracefully
    if (issues.length > 0 && result.criteria.length > 0 && result.summary && result.summary !== 'No summary provided.') {
      console.warn('[Eval run] Returning imperfect result (has criteria + summary)');
      return res.json({ data: result, error: null });
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
    const { case_id, student_id, full_name } = chatRows[0];
    console.log('[Re-evaluate] Step 2: Got case_id:', case_id, 'full_name:', full_name);

    // 3. Get rubric
    console.log('[Re-evaluate] Step 3: Getting rubric...');
    const rubric = rubric_id
      ? await getRubricById(rubric_id)
      : await getDefaultRubric();
    console.log('[Re-evaluate] Step 3: Got rubric:', rubric?.rubric_id);

    // 4. Load case data
    console.log('[Re-evaluate] Step 4: Loading case data...');
    const { loadCaseData } = await import('./llm.js');
    const caseData = await loadCaseData(case_id);
    if (!caseData) {
      return res.status(404).json({ data: null, error: { message: 'Case not found' } });
    }
    console.log('[Re-evaluate] Step 4: Got case data');

    // 5. Build evaluation prompt
    console.log('[Re-evaluate] Step 5: Building prompt...');
    const prompt = buildCoachPrompt(transcript, full_name, caseData, 0, rubric);
    console.log('[Re-evaluate] Step 5: Built prompt, length:', prompt.length);

    // 6. Call LLM for evaluation
    console.log('[Re-evaluate] Step 6: Calling LLM with model:', model_id);
    const reEvalStartTime = Date.now();
    const { text: evalResult, meta: evalMeta } = await evaluateWithLLM({ modelId: model_id, prompt });
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
      `SELECT cc.case_id, s.full_name
       FROM case_chats cc
       JOIN students s ON cc.student_id = s.id
       WHERE cc.id = ?`,
      [case_chat_id]
    );
    if (!chatRows.length) {
      return res.status(404).json({ data: null, error: { message: 'Case chat not found' } });
    }
    const { case_id, full_name } = chatRows[0];
    console.log('[Preview-prompt] Step 2: Got case_id:', case_id, 'full_name:', full_name);

    // Get rubric and case data, build prompt
    console.log('[Preview-prompt] Step 3: Getting rubric...');
    const rubric = rubric_id ? await getRubricById(rubric_id) : await getDefaultRubric();
    console.log('[Preview-prompt] Step 3: Got rubric:', rubric?.rubric_id);

    console.log('[Preview-prompt] Step 4: Loading case data...');
    const { loadCaseData } = await import('./llm.js');
    const caseData = await loadCaseData(case_id);
    console.log('[Preview-prompt] Step 4: Got case data:', !!caseData);

    console.log('[Preview-prompt] Step 5: Building prompt...');
    const prompt = buildCoachPrompt(
      transcriptRows[0].transcript,
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

// GET /api/evaluations/:id - Get single evaluation
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT ${EVAL_FIELDS} FROM evaluations WHERE id = ?`,
      [req.params.id]
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

// POST /api/evaluations - Create new evaluation
router.post('/', async (req, res) => {
  try {
    const {
      student_id, case_id, case_chat_id, score, summary, criteria,
      helpful, liked, improve, super_model, transcript, rubric_id
    } = req.body;

    if (!student_id || score === undefined) {
      return res.status(400).json({ data: null, error: { message: 'Student ID and score are required' } });
    }

    if (!case_chat_id) {
      return res.status(400).json({ data: null, error: { message: 'case_chat_id is required' } });
    }

    const id = uuidv4();
    const criteriaJson = criteria ? JSON.stringify(criteria) : null;

    await pool.execute(
      `INSERT INTO evaluations (id, student_id, case_id, case_chat_id, score, summary, criteria, helpful, liked, improve, super_model, allow_rechat, rubric_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE, ?)`,
      [id, student_id, case_id || null, case_chat_id, score, summary || null, criteriaJson,
       helpful || null, liked || null, improve || null, super_model || null, rubric_id || null]
    );

    // Update the case_chat status to completed
    await pool.execute(
      `UPDATE case_chats SET status = 'completed', end_time = CURRENT_TIMESTAMP WHERE id = ?`,
      [case_chat_id]
    );

    // AI Position Inference: If position tracking is enabled with ai_inferred method and no position set yet
    try {
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
        const transcriptText = chat.transcript || transcript; // Use transcript from DB or passed in

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
          const inferenceResult = await inferPositionFromTranscript(
            transcriptText,
            caseData,
            positionOptions,
            modelId
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
    } catch (inferenceError) {
      // Log error but don't fail the evaluation creation
      console.error('[AI Position Inference] Error during position inference:', inferenceError);
    }

    // Return the created evaluation
    const [rows] = await pool.execute(
      `SELECT ${EVAL_FIELDS} FROM evaluations WHERE id = ?`,
      [id]
    );

    const row = rows[0];
    const data = {
      ...row,
      criteria: row.criteria ? (typeof row.criteria === 'string' ? JSON.parse(row.criteria) : row.criteria) : null
    };

    res.status(201).json({ data, error: null });
  } catch (error) {
    console.error('Error creating evaluation:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

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
