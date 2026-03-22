import { getSystemPrompt, getCoachPrompt, buildSystemPrompt, buildCoachPrompt, CaseData, DEFAULT_CASE_DATA, RubricForPrompt, SystemPromptOptions } from "../constants";
import { Message, EvaluationResult, CEOPersona, Rubric } from "../types";
import { getApiBaseUrl } from "./apiClient";

const parseOrThrow = async (response: Response) => {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(text || "Invalid response from server");
  }
};

export interface LLMChatSession {
  sendMessage: (options: { message: string }) => Promise<{ text: string }>;
}

export const detectProvider = (modelId: string) => {
  const id = (modelId || '').toLowerCase();
  if (id.startsWith('gpt') || id.startsWith('o1') || id.includes('openai')) return 'openai';
  if (id.startsWith('claude') || id.includes('anthropic')) return 'anthropic';
  return 'google';
};

const cleanJsonString = (input: string) => {
  let cleaned = input.trim();
  // Strip markdown fences the model may add.
  cleaned = cleaned.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  // Extract the first JSON object if extra text is present.
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }
  return cleaned;
};

const buildCriteriaFromAltSchema = (raw: any) => {
  if (
    raw &&
    (raw.q1_score !== undefined || raw.q2_score !== undefined || raw.q3_score !== undefined)
  ) {
    return [
      {
        question: 'Did the student appear to have studied the reading material?',
        score: Number.isFinite(Number(raw.q1_score)) ? Number(raw.q1_score) : 0,
        feedback: String(raw.q1_feedback || ''),
      },
      {
        question: 'Did the student provide solid answers to chatbot questions?',
        score: Number.isFinite(Number(raw.q2_score)) ? Number(raw.q2_score) : 0,
        feedback: String(raw.q2_feedback || ''),
      },
      {
        question: 'Did the student justify the answer using relevant reading information?',
        score: Number.isFinite(Number(raw.q3_score)) ? Number(raw.q3_score) : 0,
        feedback: String(raw.q3_feedback || ''),
      },
    ];
  }
  return null;
};

const normalizeEvaluationResult = (raw: any, rubric?: RubricForPrompt): EvaluationResult => {
  const criteriaFromSchema = Array.isArray(raw?.criteria)
    ? raw.criteria.map((c: any) => ({
        criteria_id: c?.criteria_id,
        question: String(c?.question || 'Question'),
        score: Number.isFinite(Number(c?.score)) ? Number(c.score) : 0,
        max_score: Number.isFinite(Number(c?.max_score)) ? Number(c.max_score) : undefined,
        feedback: String(c?.feedback || ''),
      }))
    : null;

  const criteriaFromEvalArray = Array.isArray(raw?.evaluation_criteria)
    ? raw.evaluation_criteria.map((c: any) => ({
        criteria_id: c?.criteria_id,
        question: String(c?.question || c?.criterion || 'Question'),
        score: Number.isFinite(Number(c?.score)) ? Number(c.score) : 0,
        max_score: Number.isFinite(Number(c?.max_score)) ? Number(c.max_score) : undefined,
        feedback: String(c?.feedback || ''),
      }))
    : null;

  let criteria =
    criteriaFromSchema || criteriaFromEvalArray || buildCriteriaFromAltSchema(raw) || [];

  // Fallback: if evaluation_criteria exists but did not map (e.g., non-array shape), coerce values.
  if (criteria.length === 0 && raw?.evaluation_criteria) {
    const list = Array.isArray(raw.evaluation_criteria)
      ? raw.evaluation_criteria
      : Object.values(raw.evaluation_criteria);
    criteria = list
      .filter(Boolean)
      .map((c: any) => ({
        criteria_id: c?.criteria_id,
        question: String(c?.question || c?.criterion || 'Question'),
        score: Number.isFinite(Number(c?.score)) ? Number(c.score) : 0,
        max_score: Number.isFinite(Number(c?.max_score)) ? Number(c.max_score) : undefined,
        feedback: String(c?.feedback || ''),
      }));
  }

  const totalScoreCandidate =
    raw?.totalScore ?? raw?.total_score ?? raw?.overall_score ?? raw?.score ?? null;
  const summedCriteria = criteria.reduce(
    (sum, item) => sum + (Number.isFinite(item.score) ? item.score : 0),
    0
  );
  const totalScore = Number.isFinite(Number(totalScoreCandidate))
    ? Number(totalScoreCandidate)
    : summedCriteria;

  const summary =
    (typeof raw?.summary === 'string' && raw.summary.trim() && raw.summary) ||
    (typeof raw?.overall_summary === 'string' && raw.overall_summary.trim() && raw.overall_summary) ||
    (typeof raw?.general_feedback === 'string' && raw.general_feedback.trim() && raw.general_feedback) ||
    (typeof raw?.overall_feedback === 'string' && raw.overall_feedback.trim() && raw.overall_feedback) ||
    'No summary provided.';

  const hintsCandidate =
    raw?.hints ?? raw?.hint_count ?? raw?.total_hints ?? raw?.hints_used ?? null;
  const hints = Number.isFinite(Number(hintsCandidate)) ? Number(hintsCandidate) : 0;

  // Include maxScore and rubric_id from rubric if provided
  const maxScore = rubric?.total_points ?? 15;
  const rubric_id = rubric?.rubric_id;

  return {
    criteria,
    totalScore,
    maxScore,
    summary,
    hints,
    rubric_id,
  };
};

export const createChatSession = (
  studentName: string,
  persona: CEOPersona,
  modelId: string,
  history: Message[] = [],
  caseData?: CaseData,
  promptOptions?: SystemPromptOptions,
  studentId?: string
): LLMChatSession => {
  // Build prompt with case data at the TOP for LLM caching
  const systemPrompt = caseData
    ? buildSystemPrompt(studentName, persona, caseData, promptOptions)
    : getSystemPrompt(studentName, persona);
  let currentHistory = [...history];

  return {
    async sendMessage({ message }: { message: string }) {
      const response = await fetch(`${getApiBaseUrl()}/llm/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId,
          systemPrompt,
          history: currentHistory,
          message,
          caseId: caseData?.case_id,  // Pass caseId for metrics tracking
          studentId,  // Pass studentId for logging
        }),
      });

      const result = await parseOrThrow(response);
      if (!response.ok || result.error) {
        const msg = result?.error?.message || `Server returned ${response.status}`;
        throw new Error(msg);
      }

      const text = result.data?.text || '';
      currentHistory = [
        ...currentHistory,
        { role: 'user', content: message },
        { role: 'model', content: text },
      ];
      return { text };
    },
  };
};

const callEvalLLM = async (
  modelId: string,
  prompt: string,
  rubric?: RubricForPrompt,
  studentId?: string,
  caseId?: string
): Promise<EvaluationResult> => {
  const response = await fetch(`${getApiBaseUrl()}/llm/eval`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelId, prompt, studentId, caseId }),
  });

  const result = await parseOrThrow(response);
  if (!response.ok || result.error) {
    const msg = result?.error?.message || `Server returned ${response.status}`;
    throw new Error(msg);
  }

  const raw = result.data ?? '{}';
  const cleaned = typeof raw === 'string' ? cleanJsonString(raw) : JSON.stringify(raw);

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Invalid evaluation JSON: ${(err as Error).message}`);
  }

  return normalizeEvaluationResult(parsed, rubric);
};

const hasSubstantiveSummary = (result: EvaluationResult): boolean => {
  return (
    !!result.summary &&
    result.summary !== 'No summary provided.' &&
    result.summary.length > 50
  );
};

const buildRetryPrompt = (originalPrompt: string, firstResult: EvaluationResult): string => {
  const maxScore = firstResult.maxScore ?? 15;
  return `${originalPrompt}

=== SCORING CORRECTION — RETRY ===
A previous evaluation of this same transcript produced the following summary, but returned a total score of 0/${maxScore}. The summary clearly indicates the student engaged meaningfully, so a score of 0 is incorrect.

Previous summary:
"${firstResult.summary}"

Please re-evaluate the transcript carefully. For each criterion, assign an integer score reflecting the student's actual performance as described in your summary above. The "totalScore" field must equal the sum of all criteria scores (minus any hint penalties). Do NOT return 0 for scores unless the student truly demonstrated no competence.

Return ONLY valid JSON using the exact schema specified above.
=== END SCORING CORRECTION ===`;
};

export const getEvaluation = async (
  messages: Message[],
  studentFirstName: string,
  studentFullName: string,
  modelId: string,
  caseData?: CaseData,
  chatOptions?: any,
  rubric?: RubricForPrompt,
  studentId?: string
): Promise<EvaluationResult> => {
  const protagonistLabel = caseData?.protagonist || 'CEO';
  const chatHistory = messages
    .map((msg) => `${msg.role === "user" ? "Student" : protagonistLabel}: ${msg.content}`)
    .join("\n\n");

  const freeHints = chatOptions?.free_hints ?? 1;
  const caseId = caseData?.case_id;

  const prompt = caseData
    ? buildCoachPrompt(chatHistory, studentFullName, caseData, freeHints, rubric)
    : getCoachPrompt(chatHistory, studentFullName);

  const firstResult = await callEvalLLM(modelId, prompt, rubric, studentId, caseId);

  if (!firstResult.criteria.length || firstResult.totalScore === 0 || !firstResult.summary || firstResult.summary === 'No summary provided.') {
    console.warn('[eval] Normalized evaluation appears empty', {
      criteriaCount: firstResult.criteria.length,
      totalScore: firstResult.totalScore,
      summaryPreview: firstResult.summary?.slice(0, 120) || '',
    });
  }

  // Retry once if the score is 0 but the summary indicates meaningful engagement
  if (firstResult.totalScore === 0 && hasSubstantiveSummary(firstResult)) {
    console.warn('[eval] Score is 0 with substantive summary — retrying evaluation with scoring correction prompt');
    try {
      const retryPrompt = buildRetryPrompt(prompt, firstResult);
      const retryResult = await callEvalLLM(modelId, retryPrompt, rubric, studentId, caseId);

      if (retryResult.totalScore > 0) {
        console.log('[eval] Retry succeeded with score', retryResult.totalScore);
        return retryResult;
      }

      console.warn('[eval] Retry still returned score 0 — using first result with summary');
    } catch (retryErr) {
      console.warn('[eval] Retry failed, using first result:', (retryErr as Error).message);
    }
  }

  return firstResult;
};

