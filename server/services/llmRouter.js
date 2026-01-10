// LLM Router - Updated with increased token limits for complete outlines (8K-16K)
// Preview now supports styled headings and print functionality
// Now includes prompt caching support for Anthropic and cache metrics tracking
import { GoogleGenAI } from '@google/genai';
import { pool } from '../db.js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Track cache metrics in database
async function trackCacheMetrics(caseId, provider, modelId, cacheMetrics, requestType = 'chat') {
  if (!caseId || !cacheMetrics) return;
  try {
    await pool.execute(
      `INSERT INTO llm_cache_metrics (case_id, provider, model_id, cache_hit, input_tokens, cached_tokens, output_tokens, request_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        caseId,
        provider,
        modelId,
        cacheMetrics.cache_hit ? 1 : 0,
        cacheMetrics.input_tokens || null,
        cacheMetrics.cached_tokens || null,
        cacheMetrics.output_tokens || null,
        requestType
      ]
    );
  } catch (e) {
    // Don't fail the request if metrics tracking fails
    console.warn('[LLMRouter] Failed to track cache metrics:', e.message);
  }
}

const detectProvider = (modelId = '') => {
  const id = modelId.toLowerCase();
  if (id.startsWith('gpt') || id.startsWith('o1') || id.includes('openai')) return 'openai';
  if (id.startsWith('claude') || id.includes('anthropic')) return 'anthropic';
  return 'google';
};

const mapHistoryForOpenAI = (history = []) =>
  history.map((h) => ({
    role: h.role === 'model' ? 'assistant' : 'user',
    content: h.content,
  }));

const mapHistoryForAnthropic = (history = []) =>
  history.map((h) => ({
    role: h.role === 'model' ? 'assistant' : 'user',
    content: [{ type: 'text', text: h.content }],
  }));

const isOpenAIReasoning = (modelId = '') => {
  const id = modelId.toLowerCase();
  return id.startsWith('o1') || id.startsWith('gpt-5');
};

export async function chatWithLLM({ modelId, systemPrompt, history = [], message, config = {} }) {
  const provider = detectProvider(modelId);
  const temperature = config.temperature ?? null;
  const reasoningEffort = config.reasoning_effort ?? null;

  if (provider === 'openai') {
    if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set on the server');
    const reasoningModel = isOpenAIReasoning(modelId);
    const payload = {
      model: modelId,
      messages: [
        { role: 'system', content: systemPrompt },
        ...mapHistoryForOpenAI(history),
        { role: 'user', content: message },
      ],
    };
    if (!reasoningModel && temperature !== null && temperature !== undefined) {
      payload.temperature = Number(temperature);
    }
    if (reasoningModel && reasoningEffort) {
      payload.reasoning_effort = reasoningEffort;
    }
    const appliedParams = {
      provider,
      temperature: payload.temperature ?? null,
      reasoning_effort: payload.reasoning_effort ?? null,
    };
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI error: ${text}`);
    }
    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content?.trim() || '';

    // OpenAI automatic caching metrics (available in newer API versions)
    const cacheMetrics = {
      cache_hit: (data.usage?.cached_tokens || 0) > 0,
      input_tokens: data.usage?.prompt_tokens || 0,
      cached_tokens: data.usage?.cached_tokens || 0,
      output_tokens: data.usage?.completion_tokens || 0,
    };

    // Track metrics if caseId is provided
    if (config.caseId) {
      trackCacheMetrics(config.caseId, provider, modelId, cacheMetrics, 'chat');
    }

    return { text, meta: { ...appliedParams, cacheMetrics } };
  }

  if (provider === 'anthropic') {
    if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set on the server');

    // Use prompt caching for Anthropic
    // Structure system prompt with cache_control for static content
    const systemContent = [
      {
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral' } // Cache the system prompt
      }
    ];

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31', // Enable prompt caching
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: 1024,
        system: systemContent,
        messages: [
          ...mapHistoryForAnthropic(history),
          { role: 'user', content: [{ type: 'text', text: message }] },
        ],
        ...(temperature !== null && temperature !== undefined ? { temperature: Number(temperature) } : {}),
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Anthropic error: ${text}`);
    }
    const data = await response.json();
    const text = data?.content?.[0]?.text?.trim() || '';

    // Extract cache metrics from response
    const cacheMetrics = {
      cache_hit: (data.usage?.cache_read_input_tokens || 0) > 0,
      input_tokens: data.usage?.input_tokens || 0,
      cached_tokens: (data.usage?.cache_creation_input_tokens || 0) + (data.usage?.cache_read_input_tokens || 0),
      output_tokens: data.usage?.output_tokens || 0,
    };

    // Track metrics if caseId is provided in config
    if (config.caseId) {
      trackCacheMetrics(config.caseId, provider, modelId, cacheMetrics, 'chat');
    }

    return {
      text,
      meta: {
        provider,
        temperature: temperature ?? null,
        reasoning_effort: null,
        cacheMetrics
      }
    };
  }

  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set on the server');
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  const formattedHistory = history.map((msg) => ({
    role: msg.role,
    parts: [{ text: msg.content }],
  }));
  const chat = ai.chats.create({
    model: modelId,
    history: formattedHistory,
    config: {
      systemInstruction: systemPrompt,
      ...(temperature !== null && temperature !== undefined ? { temperature: Number(temperature) } : {}),
      topP: 0.9,
    },
  });
  const response = await chat.sendMessage({ message });

  // Extract usage metrics from Gemini response
  // Gemini provides usageMetadata with promptTokenCount, candidatesTokenCount, totalTokenCount
  const usageMetadata = response.usageMetadata || response.response?.usageMetadata || {};
  const cacheMetrics = {
    cache_hit: false, // Gemini context caching requires explicit setup, standard calls don't cache
    input_tokens: usageMetadata.promptTokenCount || 0,
    cached_tokens: usageMetadata.cachedContentTokenCount || 0, // If context caching is enabled
    output_tokens: usageMetadata.candidatesTokenCount || 0,
  };

  // Track metrics if caseId is provided
  if (config.caseId) {
    trackCacheMetrics(config.caseId, provider, modelId, cacheMetrics, 'chat');
  }

  return {
    text: response.text,
    meta: {
      provider,
      temperature: temperature ?? null,
      reasoning_effort: null,
      cacheMetrics
    }
  };
}

export async function evaluateWithLLM({ modelId, prompt, config = {} }) {
  const provider = detectProvider(modelId);
  const temperature = config.temperature ?? null;
  const reasoningEffort = config.reasoning_effort ?? null;
  const reasoningModel = isOpenAIReasoning(modelId);

  if (provider === 'openai') {
    if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set on the server');
    const payload = {
      model: modelId,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Return only JSON matching the expected evaluation schema.' },
        { role: 'user', content: prompt },
      ],
    };
    if (!reasoningModel && temperature !== null && temperature !== undefined) {
      payload.temperature = Number(temperature);
    }
    if (reasoningModel && reasoningEffort) {
      payload.reasoning_effort = reasoningEffort;
    }
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI error: ${text}`);
    }
    const data = await response.json();
    return data?.choices?.[0]?.message?.content || '{}';
  }

  if (provider === 'anthropic') {
    if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set on the server');
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: 1024,
        system: 'Return only JSON matching the expected evaluation schema.',
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
        ...(temperature !== null && temperature !== undefined ? { temperature: Number(temperature) } : {}),
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Anthropic error: ${text}`);
    }
    const data = await response.json();
    return data?.content?.[0]?.text || '{}';
  }

  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set on the server');
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  const generation = await ai.models.generateContent({
    model: modelId,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      ...(temperature !== null && temperature !== undefined ? { temperature: Number(temperature) } : {}),
    },
  });

  // Normalize across SDK shapes.
  const candidate =
    typeof generation?.response?.text === 'function'
      ? generation.response.text()
      : typeof generation?.response?.text === 'string'
        ? generation.response.text
        : generation?.response?.candidates?.[0]?.content?.parts?.[0]?.text
          || (typeof generation?.text === 'function' ? generation.text() : generation?.text)
          || '';

  if (!candidate) {
    throw new Error('Gemini returned an empty evaluation response');
  }

  // Ensure we always return a string (text() may already be a string).
  return typeof candidate === 'string' ? candidate : String(candidate);
}

/**
 * Generate a detailed outline using an LLM
 * Similar to chatWithLLM but optimized for outline generation with higher token limits
 * @param {Object} params - {modelId, prompt, config}
 * @returns {Promise<{text: string, meta: Object}>} - Generated outline and metadata
 */
export async function generateOutlineWithLLM({ modelId, prompt, config = {} }) {
  const provider = detectProvider(modelId);
  const temperature = config.temperature ?? null;
  const reasoningEffort = config.reasoning_effort ?? null;
  const reasoningModel = isOpenAIReasoning(modelId);

  if (provider === 'openai') {
    if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set on the server');
    const payload = {
      model: modelId,
      messages: [
        { role: 'user', content: prompt },
      ],
      max_tokens: 16000, // OpenAI GPT-4 supports higher limits for detailed outlines
    };
    if (!reasoningModel && temperature !== null && temperature !== undefined) {
      payload.temperature = Number(temperature);
    }
    if (reasoningModel && reasoningEffort) {
      payload.reasoning_effort = reasoningEffort;
    }
    const appliedParams = {
      provider,
      temperature: payload.temperature ?? null,
      reasoning_effort: payload.reasoning_effort ?? null,
    };
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI error: ${text}`);
    }
    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content?.trim() || '';
    return { text, meta: appliedParams };
  }

  if (provider === 'anthropic') {
    if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set on the server');
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: 8192, // Increased for detailed case outlines (Claude supports up to 8192)
        messages: [
          { role: 'user', content: [{ type: 'text', text: prompt }] },
        ],
        ...(temperature !== null && temperature !== undefined ? { temperature: Number(temperature) } : {}),
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Anthropic error: ${text}`);
    }
    const data = await response.json();
    const text = data?.content?.[0]?.text?.trim() || '';
    return { text, meta: { provider, temperature: temperature ?? null, reasoning_effort: null } };
  }

  // Google Gemini
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set on the server');
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  const generation = await ai.models.generateContent({
    model: modelId,
    contents: prompt,
    config: {
      maxOutputTokens: 8192, // Gemini supports up to 8192 tokens for detailed outlines
      ...(temperature !== null && temperature !== undefined ? { temperature: Number(temperature) } : {}),
      topP: 0.9,
    },
  });

  const candidate =
    typeof generation?.response?.text === 'function'
      ? generation.response.text()
      : typeof generation?.response?.text === 'string'
        ? generation.response.text
        : generation?.response?.candidates?.[0]?.content?.parts?.[0]?.text
          || (typeof generation?.text === 'function' ? generation.text() : generation?.text)
          || '';

  if (!candidate) {
    throw new Error('Gemini returned an empty outline');
  }

  const text = typeof candidate === 'string' ? candidate : String(candidate);
  return { text, meta: { provider, temperature: temperature ?? null, reasoning_effort: null } };
}

