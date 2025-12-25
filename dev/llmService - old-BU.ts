import { GoogleGenAI, Chat, Type } from "@google/genai";
import { getSystemPrompt, getCoachPrompt } from "../constants";
import { Message, EvaluationResult, CEOPersona } from "../types";

type Provider = "google" | "openai" | "anthropic";

export interface LLMChatSession {
  sendMessage: (options: { message: string }) => Promise<{ text: string }>;
}

const getEnv = (key: string) => {
  if (typeof import.meta !== "undefined" && (import.meta as any).env?.[key] !== undefined) {
    return (import.meta as any).env?.[key];
  }
  if (typeof process !== "undefined" && process.env?.[key] !== undefined) {
    return process.env?.[key];
  }
  return undefined;
};

const GEMINI_API_KEY = getEnv("VITE_GEMINI_API_KEY") || getEnv("GEMINI_API_KEY") || getEnv("API_KEY");
const OPENAI_API_KEY = getEnv("VITE_OPENAI_API_KEY");
const ANTHROPIC_API_KEY = getEnv("VITE_ANTHROPIC_API_KEY");

let googleClient: GoogleGenAI | null = null;

const getGoogleClient = (): GoogleGenAI => {
  if (!GEMINI_API_KEY) {
    throw new Error("Missing Gemini API key (VITE_GEMINI_API_KEY)");
  }
  if (!googleClient) {
    googleClient = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  }
  return googleClient;
};

export const detectProvider = (modelId: string): Provider => {
  const id = modelId.toLowerCase();
  if (id.startsWith("gpt") || id.startsWith("o1") || id.includes("openai")) return "openai";
  if (id.startsWith("claude") || id.includes("anthropic")) return "anthropic";
  return "google";
};

const parseJSON = (text: string) => {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error("Failed to parse JSON response from model");
  }
};

/* ---------------------- Google (Gemini) ---------------------- */
class GoogleChatSession implements LLMChatSession {
  private chat: Chat;

  constructor(studentName: string, persona: CEOPersona, modelId: string, history: Message[]) {
    const systemInstruction = getSystemPrompt(studentName, persona);
    const formattedHistory = history.map((msg) => ({
      role: msg.role,
      parts: [{ text: msg.content }],
    }));
    const ai = getGoogleClient();
    this.chat = ai.chats.create({
      model: modelId,
      history: formattedHistory,
      config: {
        systemInstruction,
        temperature: 0.7,
        topP: 0.9,
      },
    });
  }

  async sendMessage({ message }: { message: string }): Promise<{ text: string }> {
    const response = await this.chat.sendMessage({ message });
    return { text: response.text };
  }
}

/* ---------------------- OpenAI ---------------------- */
class OpenAIChatSession implements LLMChatSession {
  private modelId: string;
  private systemPrompt: string;
  private history: { role: "system" | "user" | "assistant"; content: string }[];

  constructor(studentName: string, persona: CEOPersona, modelId: string, history: Message[]) {
    if (!OPENAI_API_KEY) throw new Error("Missing OpenAI API key (VITE_OPENAI_API_KEY)");
    this.modelId = modelId;
    this.systemPrompt = getSystemPrompt(studentName, persona);
    this.history = [
      { role: "system", content: this.systemPrompt },
      ...history.map((msg) => ({ role: msg.role === "model" ? "assistant" : "user", content: msg.content })),
    ];
  }

  private buildMessages(nextUserMessage: string) {
    return [...this.history, { role: "user", content: nextUserMessage }];
  }

  async sendMessage({ message }: { message: string }): Promise<{ text: string }> {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: this.modelId,
        messages: this.buildMessages(message),
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI error: ${errorText}`);
    }

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content?.trim() || "";
    this.history.push({ role: "user", content: message });
    this.history.push({ role: "assistant", content: text });
    return { text };
  }
}

/* ---------------------- Anthropic ---------------------- */
class AnthropicChatSession implements LLMChatSession {
  private modelId: string;
  private systemPrompt: string;
  private history: { role: "user" | "assistant"; content: string }[];

  constructor(studentName: string, persona: CEOPersona, modelId: string, history: Message[]) {
    if (!ANTHROPIC_API_KEY) throw new Error("Missing Anthropic API key (VITE_ANTHROPIC_API_KEY)");
    this.modelId = modelId;
    this.systemPrompt = getSystemPrompt(studentName, persona);
    this.history = history.map((msg) => ({
      role: msg.role === "model" ? "assistant" : "user",
      content: msg.content,
    }));
  }

  private buildMessages(nextUserMessage: string) {
    return [
      ...this.history.map((h) => ({
        role: h.role,
        content: [{ type: "text", text: h.content }],
      })),
      { role: "user", content: [{ type: "text", text: nextUserMessage }] },
    ];
  }

  async sendMessage({ message }: { message: string }): Promise<{ text: string }> {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY as string,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.modelId,
        max_tokens: 1024,
        system: this.systemPrompt,
        messages: this.buildMessages(message),
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic error: ${errorText}`);
    }

    const data = await response.json();
    const text = data?.content?.[0]?.text?.trim() || "";
    this.history.push({ role: "user", content: message });
    this.history.push({ role: "assistant", content: text });
    return { text };
  }
}

/* ---------------------- Shared API ---------------------- */
export const createChatSession = (
  studentName: string,
  persona: CEOPersona,
  modelId: string,
  history: Message[] = []
): LLMChatSession => {
  const provider = detectProvider(modelId);
  if (provider === "openai") {
    return new OpenAIChatSession(studentName, persona, modelId, history);
  }
  if (provider === "anthropic") {
    return new AnthropicChatSession(studentName, persona, modelId, history);
  }
  return new GoogleChatSession(studentName, persona, modelId, history);
};

export const getEvaluation = async (
  messages: Message[],
  studentFirstName: string,
  studentFullName: string,
  modelId: string
): Promise<EvaluationResult> => {
  const provider = detectProvider(modelId);
  const chatHistory = messages
    .map((msg) => `${msg.role === "user" ? "Student" : "CEO"}: ${msg.content}`)
    .join("\n\n");
  const prompt = getCoachPrompt(chatHistory, studentFullName);

  if (provider === "openai") {
    if (!OPENAI_API_KEY) throw new Error("Missing OpenAI API key (VITE_OPENAI_API_KEY)");
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: modelId,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "Return only JSON matching the expected evaluation schema." },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI error: ${text}`);
    }
    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content || "{}";
    return parseJSON(text) as EvaluationResult;
  }

  if (provider === "anthropic") {
    if (!ANTHROPIC_API_KEY) throw new Error("Missing Anthropic API key (VITE_ANTHROPIC_API_KEY)");
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY as string,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: 1024,
        system: "Return only JSON matching the expected evaluation schema.",
        messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
        temperature: 0.2,
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Anthropic error: ${text}`);
    }
    const data = await response.json();
    const text = data?.content?.[0]?.text || "{}";
    return parseJSON(text) as EvaluationResult;
  }

  const ai = getGoogleClient();
  const response = await ai.models.generateContent({
    model: modelId,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          criteria: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                question: { type: Type.STRING },
                score: { type: Type.NUMBER },
                feedback: { type: Type.STRING },
              },
              required: ["question", "score", "feedback"],
            },
          },
          totalScore: { type: Type.NUMBER },
          summary: { type: Type.STRING },
          hints: { type: Type.NUMBER },
        },
        required: ["criteria", "totalScore", "summary", "hints"],
      },
    },
  });

  const jsonString = response.text;
  return JSON.parse(jsonString) as EvaluationResult;
};

