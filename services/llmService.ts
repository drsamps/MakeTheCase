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

  const raw = result.data || '{}';
  return JSON.parse(raw) as EvaluationResult;
};

