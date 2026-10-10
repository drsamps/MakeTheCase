import { Message, EvaluationResult } from "../types";
import { getApiBaseUrl, getAuthHeaders } from "./apiClient";

const parseOrThrow = async (response: Response) => {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(text || "Invalid response from server");
  }
};

export interface LLMChatReply {
  text: string;
  /** Model that actually answered (a ranked backup when `backup` is true). */
  modelId: string;
  backup: boolean;
}

export interface LLMChatSession {
  sendMessage: (options: { message: string }) => Promise<LLMChatReply>;
}

export const detectProvider = (modelId: string) => {
  const id = (modelId || '').toLowerCase();
  if (id.startsWith('gpt') || id.startsWith('o1') || id.includes('openai')) return 'openai';
  if (id.startsWith('claude') || id.includes('anthropic')) return 'anthropic';
  return 'google';
};

/**
 * A student chat session. The server builds the system prompt from the chat record
 * (server/services/chatPrompt.js), so the browser sends only the chat id, the student's
 * first name and the conversation; the model comes from the chat record too. `modelId` is
 * only the label used when a reply does not name the model that answered.
 */
export const createChatSession = (
  studentName: string,
  modelId: string,
  history: Message[],
  caseChatId: string
): LLMChatSession => {
  let currentHistory = [...history];

  return {
    async sendMessage({ message }: { message: string }) {
      // `at` / `messageAt` (client clock) only label turns in the prompt log; the server
      // passes {role, content} alone to the model.
      const messageAt = Date.now();
      const response = await fetch(`${getApiBaseUrl()}/llm/chat`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          caseChatId,
          studentName,
          history: currentHistory,
          message,
          messageAt,
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
        { role: 'user', content: message, at: messageAt },
        { role: 'model', content: text, at: Date.now() },
      ];
      return {
        text,
        modelId: result.data?.meta?.model_id || modelId,
        backup: Boolean(result.data?.meta?.backup),
      };
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
    headers: getAuthHeaders(),
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

