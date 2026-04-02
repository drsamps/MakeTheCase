/**
 * Evaluation Normalizer Service
 * Handles parsing, normalization, validation, and trimming of LLM evaluation results.
 * Consolidated from the frontend llmService.ts logic.
 */

/**
 * Strip markdown code fences and extract the first JSON object from raw LLM output.
 */
export function cleanJsonString(input) {
  let cleaned = (input || '').trim();
  cleaned = cleaned.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }
  return cleaned;
}

/**
 * Legacy alt-schema handler: some older models return q1_score/q1_feedback style fields.
 */
function buildCriteriaFromAltSchema(raw) {
  if (raw && (raw.q1_score !== undefined || raw.q2_score !== undefined || raw.q3_score !== undefined)) {
    return [
      { question: 'Did the student appear to have studied the reading material?', score: safeInt(raw.q1_score), feedback: String(raw.q1_feedback || '') },
      { question: 'Did the student provide solid answers to chatbot questions?', score: safeInt(raw.q2_score), feedback: String(raw.q2_feedback || '') },
      { question: 'Did the student justify the answer using relevant reading information?', score: safeInt(raw.q3_score), feedback: String(raw.q3_feedback || '') },
    ];
  }
  return null;
}

function safeInt(val) {
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Normalize raw parsed LLM JSON into a standard EvaluationResult shape.
 * Handles multiple response schemas models may produce.
 *
 * @param {Object} raw - The parsed JSON from the LLM
 * @param {Object|null} rubric - Optional rubric for maxScore/rubric_id
 * @returns {{ criteria, totalScore, maxScore, summary, hints, rubric_id }}
 */
export function normalizeEvaluationResult(raw, rubric = null) {
  const mapCriterion = (c) => ({
    criteria_id: c?.criteria_id,
    question: String(c?.question || c?.criterion || 'Question'),
    score: safeInt(c?.score),
    max_score: Number.isFinite(Number(c?.max_score)) ? Number(c.max_score) : undefined,
    feedback: String(c?.feedback || ''),
  });

  let criteria = null;

  if (Array.isArray(raw?.criteria)) {
    criteria = raw.criteria.map(mapCriterion);
  } else if (Array.isArray(raw?.evaluation_criteria)) {
    criteria = raw.evaluation_criteria.map(mapCriterion);
  } else {
    criteria = buildCriteriaFromAltSchema(raw);
  }

  if (!criteria && raw?.evaluation_criteria) {
    const list = Array.isArray(raw.evaluation_criteria) ? raw.evaluation_criteria : Object.values(raw.evaluation_criteria);
    criteria = list.filter(Boolean).map(mapCriterion);
  }

  criteria = criteria || [];

  const totalScoreCandidate = raw?.totalScore ?? raw?.total_score ?? raw?.overall_score ?? raw?.score ?? null;
  const summedCriteria = criteria.reduce((sum, c) => sum + (Number.isFinite(c.score) ? c.score : 0), 0);
  const totalScore = Number.isFinite(Number(totalScoreCandidate)) ? Number(totalScoreCandidate) : summedCriteria;

  const summary =
    (typeof raw?.summary === 'string' && raw.summary.trim() && raw.summary) ||
    (typeof raw?.overall_summary === 'string' && raw.overall_summary.trim() && raw.overall_summary) ||
    (typeof raw?.general_feedback === 'string' && raw.general_feedback.trim() && raw.general_feedback) ||
    (typeof raw?.overall_feedback === 'string' && raw.overall_feedback.trim() && raw.overall_feedback) ||
    'No summary provided.';

  const hintsCandidate = raw?.hints ?? raw?.hint_count ?? raw?.total_hints ?? raw?.hints_used ?? null;
  const hints = Number.isFinite(Number(hintsCandidate)) ? Number(hintsCandidate) : 0;

  const maxScore = rubric?.total_points ?? 15;
  const rubric_id = rubric?.rubric_id;

  return { criteria, totalScore, maxScore, summary, hints, rubric_id };
}

/**
 * Parse raw LLM output string into a normalized EvaluationResult.
 */
export function parseEvaluationResponse(rawText, rubric = null) {
  const cleaned = typeof rawText === 'string' ? cleanJsonString(rawText) : JSON.stringify(rawText);
  const parsed = JSON.parse(cleaned);
  return normalizeEvaluationResult(parsed, rubric);
}

/**
 * Validation issues found in an evaluation result.
 * @typedef {Object} ValidationIssue
 * @property {string} code - machine-readable issue code
 * @property {string} message - human-readable description
 */

/**
 * Validate an evaluation result against expected criteria count and data quality.
 * @param {Object} result - normalized EvaluationResult
 * @param {number} expectedCriteria - how many criteria the rubric defines
 * @returns {ValidationIssue[]} - empty array if valid
 */
export function validateEvaluationResult(result, expectedCriteria) {
  const issues = [];

  if (result.criteria.length !== expectedCriteria) {
    issues.push({
      code: 'WRONG_CRITERIA_COUNT',
      message: `contained ${result.criteria.length} criteria but the rubric specifies exactly ${expectedCriteria}`,
    });
  }

  if (!result.summary || result.summary === 'No summary provided.' || result.summary.trim().length < 10) {
    issues.push({ code: 'MISSING_SUMMARY', message: 'missing or empty summary' });
  }

  for (let i = 0; i < result.criteria.length; i++) {
    const c = result.criteria[i];
    if (!Number.isFinite(c.score)) {
      issues.push({ code: 'INVALID_SCORE', message: `criterion ${i + 1} has non-numeric score` });
    }
  }

  if (result.totalScore === 0 && result.summary && result.summary !== 'No summary provided.' && result.summary.length > 50) {
    issues.push({
      code: 'ZERO_SCORE_WITH_SUMMARY',
      message: `totalScore was 0 despite a substantive summary`,
    });
  }

  return issues;
}

/**
 * Build a correction/retry prompt to append to the original evaluation prompt.
 */
export function buildCorrectionPrompt(originalPrompt, issues, expectedCriteria, previousResult) {
  const issueList = issues.map(i => `- ${i.message}`).join('\n');

  let prompt = `${originalPrompt}

=== EVALUATION CORRECTION — RETRY ===
Your previous response had the following problems:
${issueList}

Re-evaluate using ONLY the ${expectedCriteria} criteria listed in the rubric above. Return exactly ${expectedCriteria} criteria entries — no more, no fewer.`;

  if (issues.some(i => i.code === 'ZERO_SCORE_WITH_SUMMARY') && previousResult?.summary) {
    prompt += `

Your previous summary was: "${previousResult.summary}"
Please assign integer scores that reflect the student's actual performance as described in this summary. Do NOT return 0 for scores unless the student truly demonstrated no competence.`;
  }

  prompt += `

Return ONLY valid JSON using the exact schema specified above.
=== END EVALUATION CORRECTION ===`;

  return prompt;
}

/**
 * Attempt to salvage an evaluation result with the wrong criteria count by
 * matching returned criteria to rubric criteria via question text similarity,
 * dropping extras or filling placeholders for missing ones.
 *
 * @param {Object} result - normalized EvaluationResult
 * @param {Array} rubricCriteria - array of rubric criterion objects with question_text, max_points
 * @param {number} hintPenalty - points deducted for hints (already computed)
 * @returns {Object} - trimmed EvaluationResult
 */
export function trimEvaluationResult(result, rubricCriteria, hintPenalty = 0) {
  if (!rubricCriteria || rubricCriteria.length === 0) return result;

  const matched = [];

  for (const rubricCrit of rubricCriteria) {
    const rubricText = (rubricCrit.question_text || rubricCrit.name || '').toLowerCase();

    let bestMatch = null;
    let bestScore = -1;

    for (const returnedCrit of result.criteria) {
      const returnedText = (returnedCrit.question || '').toLowerCase();
      // Simple substring similarity: count shared significant words
      const rubricWords = new Set(rubricText.split(/\s+/).filter(w => w.length > 3));
      let overlap = 0;
      for (const word of returnedText.split(/\s+/)) {
        if (rubricWords.has(word)) overlap++;
      }
      if (overlap > bestScore) {
        bestScore = overlap;
        bestMatch = returnedCrit;
      }
    }

    if (bestMatch && bestScore > 0) {
      matched.push({
        ...bestMatch,
        max_score: rubricCrit.max_points || bestMatch.max_score,
        criteria_id: rubricCrit.criteria_id,
      });
    } else {
      matched.push({
        criteria_id: rubricCrit.criteria_id,
        question: rubricCrit.question_text || rubricCrit.name || 'Question',
        score: 0,
        max_score: rubricCrit.max_points || 5,
        feedback: 'Could not be evaluated automatically.',
      });
    }
  }

  const summedScore = matched.reduce((sum, c) => sum + (c.score || 0), 0);
  const totalScore = Math.max(0, summedScore - hintPenalty);

  return {
    ...result,
    criteria: matched,
    totalScore,
  };
}
