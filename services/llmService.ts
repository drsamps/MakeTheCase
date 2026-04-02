import { getSystemPrompt, buildSystemPrompt, CaseData, DEFAULT_CASE_DATA, SystemPromptOptions } from "../constants";
import { Message, EvaluationResult, CEOPersona } from "../types";
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

/**
 * Run an evaluation via the backend endpoint.
 * Prompt building, LLM call, normalization, validation, and retry all happen server-side.
 */
export const getEvaluation = async (
  messages: Message[],
  caseChatId: string,
  modelId: string,
  protagonistLabel: string = 'CEO',
  rubricId?: number,
): Promise<EvaluationResult> => {
  const chatHistory = messages
    .map((msg) => `${msg.role === "user" ? "Student" : protagonistLabel}: ${msg.content}`)
    .join("\n\n");

  const response = await fetch(`${getApiBaseUrl()}/evaluations/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ case_chat_id: caseChatId, chatHistory, modelId, rubricId }),
  });

  const result = await parseOrThrow(response);

  if (!response.ok || result.error) {
    const err = result?.error || {};
    const error = new Error(err.message || `Server returned ${response.status}`);
    (error as any).code = err.code;
    throw error;
  }

  return result.data as EvaluationResult;
};

