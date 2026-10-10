import { EvaluationResult } from "../types";
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
 * A student chat session. The server builds the system prompt and keeps the conversation
 * (server/services/chatPrompt.js, chatTurns.js), so the browser sends only the chat id, the
 * student's first name and the new message; the model comes from the chat record too.
 * `modelId` is only the label used when a reply does not name the model that answered.
 */
export const createChatSession = (
  studentName: string,
  modelId: string,
  caseChatId: string
): LLMChatSession => ({
  async sendMessage({ message }: { message: string }) {
    const response = await fetch(`${getApiBaseUrl()}/llm/chat`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ caseChatId, studentName, message }),
    });

    const result = await parseOrThrow(response);
    if (!response.ok || result.error) {
      const msg = result?.error?.message || `Server returned ${response.status}`;
      throw new Error(msg);
    }

    return {
      text: result.data?.text || '',
      modelId: result.data?.meta?.model_id || modelId,
      backup: Boolean(result.data?.meta?.backup),
    };
  },
});

export interface EvaluationFeedback {
  helpful: number | null;
  liked: string | null;
  improve: string | null;
}

/**
 * Grade the chat and save the evaluation. The server grades its own copy of the conversation
 * with the section's supervisor model and the assignment's rubric, and saves the evaluation
 * row itself; the browser sends only the student's feedback answers and whether they agreed
 * to share the transcript. The result carries `evaluation_id`.
 */
export const getEvaluation = async (
  caseChatId: string,
  feedback: EvaluationFeedback,
  shareTranscript: boolean,
): Promise<EvaluationResult> => {
  const response = await fetch(`${getApiBaseUrl()}/evaluations/run`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ case_chat_id: caseChatId, feedback, share_transcript: shareTranscript }),
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
