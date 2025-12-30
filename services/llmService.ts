import { getSystemPrompt, getCoachPrompt } from "../constants";
import { Message, EvaluationResult, CEOPersona } from "../types";

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

const normalizeEvaluationResult = (raw: any): EvaluationResult => {
  const criteriaFromSchema = Array.isArray(raw?.criteria)
    ? raw.criteria.map((c: any) => ({
        question: String(c?.question || 'Question'),
        score: Number.isFinite(Number(c?.score)) ? Number(c.score) : 0,
        feedback: String(c?.feedback || ''),
      }))
    : null;

  const criteriaFromEvalArray = Array.isArray(raw?.evaluation_criteria)
    ? raw.evaluation_criteria.map((c: any) => ({
        question: String(c?.question || c?.criterion || 'Question'),
        score: Number.isFinite(Number(c?.score)) ? Number(c.score) : 0,
        feedback: String(c?.feedback || ''),
      }))
    : null;

  const criteria = criteriaFromSchema || criteriaFromEvalArray || buildCriteriaFromAltSchema(raw) || [];

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

  return {
    criteria,
    totalScore,
    summary,
    hints,
  };
};

export const createChatSession = (
  studentName: string,
  persona: CEOPersona,
  modelId: string,
  history: Message[] = []
): LLMChatSession => {
  const systemPrompt = getSystemPrompt(studentName, persona);
  let currentHistory = [...history];

  return {
    async sendMessage({ message }: { message: string }) {
      const response = await fetch('/api/llm/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId,
          systemPrompt,
          history: currentHistory,
          message,
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

export const getEvaluation = async (
  messages: Message[],
  studentFirstName: string,
  studentFullName: string,
  modelId: string
): Promise<EvaluationResult> => {
  const chatHistory = messages
    .map((msg) => `${msg.role === "user" ? "Student" : "CEO"}: ${msg.content}`)
    .join("\n\n");
  const prompt = getCoachPrompt(chatHistory, studentFullName);

  const response = await fetch('/api/llm/eval', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelId, prompt }),
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

  const normalized = normalizeEvaluationResult(parsed);

  if (!normalized.criteria.length || normalized.totalScore === 0 || !normalized.summary || normalized.summary === 'No summary provided.') {
    console.warn('[eval] Normalized evaluation appears empty', {
      criteriaCount: normalized.criteria.length,
      totalScore: normalized.totalScore,
      summaryPreview: normalized.summary?.slice(0, 120) || '',
      rawPreview: cleaned.slice(0, 200),
    });
  }

  return normalized;
};

