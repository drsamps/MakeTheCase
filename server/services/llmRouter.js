// LLM Router
// All LLM calls go through chatWithLLM / evaluateWithLLM / generateOutlineWithLLM.
// After each call returns, raw provider usage + computed est_cost_usd is
// recorded in model_usage via writeModelUsage (fire-and-forget).
// Weekly cost cap (assertWithinCostCap) is enforced for student_chat,
// case_writer outlines, and case_prep outlines; evaluations always proceed
// (but log EVAL_OVER_CAP when over cap so admins can audit after the fact).
import { GoogleGenAI, Type } from '@google/genai';
import { pool } from '../db.js';
import { resolveProviderKey } from './keyResolver.js';
import { assertWithinCostCap, getWeeklyUsage } from './usageGuard.js';
import { writeModelUsage, computeEstCost, getModelPricing } from './modelUsageWriter.js';

const OPENROUTER_HTTP_REFERER = process.env.OPENROUTER_HTTP_REFERER;
const OPENROUTER_X_TITLE = process.env.OPENROUTER_X_TITLE;

function buildOpenRouterHeaders(apiKey) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
  if (OPENROUTER_HTTP_REFERER) headers['HTTP-Referer'] = OPENROUTER_HTTP_REFERER;
  if (OPENROUTER_X_TITLE) headers['X-Title'] = OPENROUTER_X_TITLE;
  return headers;
}

function parseJsonSafe(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/**
 * Load supported_parameters, default_parameters, and parameter_settings for a model
 * and return the merged-and-filtered runtime parameter object. Admin overrides win
 * over vendor defaults; the result is filtered to keys the model actually supports.
 */
export async function resolveModelRuntimeConfiguration(modelId) {
  if (!modelId) return {};
  try {
    const [rows] = await pool.execute(
      'SELECT supported_parameters, default_parameters, parameter_settings FROM models WHERE model_id = ? LIMIT 1',
      [modelId]
    );
    if (!rows.length) return {};
    const row = rows[0];
    const supported = parseJsonSafe(row.supported_parameters, []);
    const defaults = parseJsonSafe(row.default_parameters, {}) || {};
    const overrides = parseJsonSafe(row.parameter_settings, {}) || {};
    const merged = { ...defaults, ...overrides };
    if (!Array.isArray(supported) || supported.length === 0) return merged;
    return Object.fromEntries(Object.entries(merged).filter(([k]) => supported.includes(k)));
  } catch (e) {
    console.warn('[LLMRouter] resolveModelRuntimeConfiguration failed:', e.message);
    return {};
  }
}

// ---------------------------------------------------------------------------
// Usage tracking helpers
// ---------------------------------------------------------------------------

async function lookupUseSystemKey(instructorId) {
  if (!instructorId) return false;
  try {
    const [rows] = await pool.execute(
      'SELECT use_system_key FROM instructors WHERE id = ? LIMIT 1',
      [instructorId]
    );
    return rows[0]?.use_system_key === 1;
  } catch {
    return false;
  }
}

function deriveCacheHit(provider, raw) {
  if (!raw) return false;
  if (provider === 'anthropic') return (raw.cache_read_input_tokens || 0) > 0;
  if (provider === 'google') return (raw.cachedContentTokenCount || 0) > 0;
  // openai + openrouter
  return ((raw.prompt_tokens_details?.cached_tokens ?? raw.cached_tokens) || 0) > 0;
}

/**
 * Fire-and-forget: look up pricing, compute est_cost, insert model_usage row.
 * Caller does not await. Errors are logged inside writeModelUsage.
 */
function trackUsageAsync({
  purpose, caseId = null, projectId = null, sectionId = null,
  modelId, provider, instructorId = null, rawUsage = null,
}) {
  (async () => {
    const useSystemKey = await lookupUseSystemKey(instructorId);
    const pricing = await getModelPricing(modelId);
    const estCost = computeEstCost(provider, rawUsage, pricing);
    const cacheHit = deriveCacheHit(provider, rawUsage);
    await writeModelUsage({
      purpose, caseId, projectId, sectionId,
      modelId, provider, instructorId, useSystemKey,
      cacheHit, estCostUsd: estCost, rawUsage,
    });
  })().catch(e => console.error('[MODEL_USAGE_TRACK_FAILED]', e.message));
}

/**
 * Build the {purpose, caseId, ...} context object from a call's `config` arg.
 * Defaults purpose to a per-function fallback when the caller didn't set it.
 */
function usageContext(config, defaultPurpose) {
  return {
    purpose: config.purpose || defaultPurpose,
    caseId: config.caseId || null,
    projectId: config.projectId || null,
    sectionId: config.sectionId || null,
    instructorId: config.instructorId || null,
  };
}

// Backwards-compatible cacheMetrics object for callers that still read meta.cacheMetrics
function legacyCacheMetrics(provider, raw) {
  if (!raw) return { cache_hit: false, input_tokens: 0, cached_tokens: 0, output_tokens: 0 };
  if (provider === 'anthropic') {
    return {
      cache_hit: (raw.cache_read_input_tokens || 0) > 0,
      input_tokens: raw.input_tokens || 0,
      cached_tokens: (raw.cache_creation_input_tokens || 0) + (raw.cache_read_input_tokens || 0),
      output_tokens: raw.output_tokens || 0,
    };
  }
  if (provider === 'google') {
    return {
      cache_hit: (raw.cachedContentTokenCount || 0) > 0,
      input_tokens: raw.promptTokenCount || 0,
      cached_tokens: raw.cachedContentTokenCount || 0,
      output_tokens: raw.candidatesTokenCount || 0,
    };
  }
  // openai + openrouter
  const cached = raw.prompt_tokens_details?.cached_tokens ?? raw.cached_tokens ?? 0;
  return {
    cache_hit: cached > 0,
    input_tokens: raw.prompt_tokens || 0,
    cached_tokens: cached,
    output_tokens: raw.completion_tokens || 0,
  };
}

// ---------------------------------------------------------------------------
// Provider detection + helpers
// ---------------------------------------------------------------------------

const detectProvider = (modelId = '', vendor = null) => {
  if (vendor && typeof vendor === 'string') {
    const v = vendor.toLowerCase();
    if (v === 'openai' || v === 'anthropic' || v === 'google' || v === 'openrouter') return v;
  }
  const id = modelId.toLowerCase();
  // OpenRouter model IDs always contain a slash (e.g. "openai/gpt-5"); direct vendor IDs never do.
  if (id.includes('/')) return 'openrouter';
  if (id.startsWith('gpt') || id.startsWith('o1') || id.includes('openai')) return 'openai';
  if (id.startsWith('claude') || id.includes('anthropic')) return 'anthropic';
  return 'google';
};

async function callOpenRouter({ modelId, messages, runtimeParams = {}, maxTokens, responseFormat, apiKey }) {
  if (!apiKey) throw new Error('OpenRouter API key is required');
  const payload = {
    model: modelId,
    messages,
    ...runtimeParams,
    // Required to populate data.usage.cost (authoritative USD cost from OpenRouter).
    usage: { include: true },
  };
  if (maxTokens !== undefined) payload.max_tokens = maxTokens;
  if (responseFormat) payload.response_format = responseFormat;

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: buildOpenRouterHeaders(apiKey),
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter error: ${text}`);
  }
  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content?.trim() || '';
  return { text, raw: data, rawUsage: data?.usage || null };
}

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

// ---------------------------------------------------------------------------
// chatWithLLM
// ---------------------------------------------------------------------------

export async function chatWithLLM({ modelId, vendor = null, systemPrompt, history = [], message, config = {} }) {
  const provider = detectProvider(modelId, vendor);
  // Weekly cost cap (no-op unless instructor uses system key + has a cap set)
  await assertWithinCostCap(config.instructorId, modelId);
  const runtimeParams = await resolveModelRuntimeConfiguration(modelId);
  const temperature = runtimeParams.temperature ?? config.temperature ?? null;
  const reasoningEffort = runtimeParams.reasoning_effort ?? config.reasoning_effort ?? null;
  const ctx = usageContext(config, 'student_chat');

  if (provider === 'openrouter') {
    const apiKey = await resolveProviderKey('openrouter', config.instructorId);
    const mergedParams = { ...runtimeParams };
    if (temperature !== null && temperature !== undefined && mergedParams.temperature === undefined) {
      mergedParams.temperature = Number(temperature);
    }
    const messages = [
      { role: 'system', content: systemPrompt },
      ...mapHistoryForOpenAI(history),
      { role: 'user', content: message },
    ];
    const { text, rawUsage } = await callOpenRouter({
      modelId,
      messages,
      runtimeParams: mergedParams,
      maxTokens: config.maxTokens,
      apiKey,
    });
    trackUsageAsync({ ...ctx, modelId, provider, rawUsage });
    return {
      text,
      meta: {
        provider,
        temperature: mergedParams.temperature ?? null,
        reasoning_effort: mergedParams.reasoning_effort ?? null,
        cacheMetrics: legacyCacheMetrics(provider, rawUsage),
      },
    };
  }

  if (provider === 'openai') {
    const apiKey = await resolveProviderKey('openai', config.instructorId);
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
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI error: ${text}`);
    }
    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content?.trim() || '';
    const rawUsage = data?.usage || null;
    trackUsageAsync({ ...ctx, modelId, provider, rawUsage });
    return { text, meta: { ...appliedParams, cacheMetrics: legacyCacheMetrics(provider, rawUsage) } };
  }

  if (provider === 'anthropic') {
    const apiKey = await resolveProviderKey('anthropic', config.instructorId);
    const systemContent = [
      {
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral' },
      },
    ];
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
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
    const rawUsage = data?.usage || null;
    trackUsageAsync({ ...ctx, modelId, provider, rawUsage });
    return {
      text,
      meta: {
        provider,
        temperature: temperature ?? null,
        reasoning_effort: null,
        cacheMetrics: legacyCacheMetrics(provider, rawUsage),
      },
    };
  }

  // Google Gemini
  const apiKey = await resolveProviderKey('google', config.instructorId);
  const ai = new GoogleGenAI({ apiKey });
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
  const rawUsage = response.usageMetadata || response.response?.usageMetadata || null;
  trackUsageAsync({ ...ctx, modelId, provider, rawUsage });
  return {
    text: response.text,
    meta: {
      provider,
      temperature: temperature ?? null,
      reasoning_effort: null,
      cacheMetrics: legacyCacheMetrics(provider, rawUsage),
    },
  };
}

// ---------------------------------------------------------------------------
// evaluateWithLLM — always proceeds; logs EVAL_OVER_CAP for audit when over cap
// ---------------------------------------------------------------------------

async function logEvalOverCapIfNeeded(config) {
  if (!config.instructorId) return;
  try {
    const { overCap, costUsed, cap } = await getWeeklyUsage(config.instructorId);
    if (overCap) {
      console.warn(
        `[EVAL_OVER_CAP] instructor=${config.instructorId} case=${config.caseId || ''} cost=$${costUsed.toFixed(4)}/$${(cap || 0).toFixed(2)}`
      );
    }
  } catch (e) {
    console.warn('[EVAL_OVER_CAP check failed]', e.message);
  }
}

export async function evaluateWithLLM({ modelId, vendor = null, prompt, config = {} }) {
  const provider = detectProvider(modelId, vendor);
  // Evaluations are NEVER blocked by the cap — a student finishing a case
  // shouldn't fail because earlier calls blew the budget. But we log if over.
  await logEvalOverCapIfNeeded(config);
  const runtimeParams = await resolveModelRuntimeConfiguration(modelId);
  const temperature = runtimeParams.temperature ?? config.temperature ?? null;
  const reasoningEffort = runtimeParams.reasoning_effort ?? config.reasoning_effort ?? null;
  const reasoningModel = isOpenAIReasoning(modelId);
  const ctx = usageContext(config, 'evaluation');

  if (provider === 'openrouter') {
    const apiKey = await resolveProviderKey('openrouter', config.instructorId);
    const mergedParams = { ...runtimeParams };
    if (temperature !== null && temperature !== undefined && mergedParams.temperature === undefined) {
      mergedParams.temperature = Number(temperature);
    }
    const messages = [
      { role: 'system', content: 'Return only JSON matching the expected evaluation schema.' },
      { role: 'user', content: prompt },
    ];
    const { text, rawUsage } = await callOpenRouter({
      modelId,
      messages,
      runtimeParams: mergedParams,
      responseFormat: { type: 'json_object' },
      apiKey,
    });
    trackUsageAsync({ ...ctx, modelId, provider, rawUsage });
    return {
      text: text || '{}',
      meta: {
        provider,
        temperature: mergedParams.temperature ?? null,
        reasoning_effort: mergedParams.reasoning_effort ?? null,
        cacheMetrics: legacyCacheMetrics(provider, rawUsage),
      },
    };
  }

  if (provider === 'openai') {
    const apiKey = await resolveProviderKey('openai', config.instructorId);
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
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI error: ${errorText}`);
    }
    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content || '{}';
    const rawUsage = data?.usage || null;
    trackUsageAsync({ ...ctx, modelId, provider, rawUsage });
    return {
      text,
      meta: {
        provider,
        temperature: payload.temperature ?? null,
        reasoning_effort: payload.reasoning_effort ?? null,
        cacheMetrics: legacyCacheMetrics(provider, rawUsage),
      },
    };
  }

  if (provider === 'anthropic') {
    const apiKey = await resolveProviderKey('anthropic', config.instructorId);
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
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
      const errorText = await response.text();
      throw new Error(`Anthropic error: ${errorText}`);
    }
    const data = await response.json();
    const text = data?.content?.[0]?.text || '{}';
    const rawUsage = data?.usage || null;
    trackUsageAsync({ ...ctx, modelId, provider, rawUsage });
    return {
      text,
      meta: {
        provider,
        temperature: temperature ?? null,
        reasoning_effort: null,
        cacheMetrics: legacyCacheMetrics(provider, rawUsage),
      },
    };
  }

  // Google Gemini
  const apiKey = await resolveProviderKey('google', config.instructorId);
  const ai = new GoogleGenAI({ apiKey });
  const generation = await ai.models.generateContent({
    model: modelId,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
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
                max_score: { type: Type.NUMBER },
                feedback: { type: Type.STRING },
              },
              required: ['question', 'score', 'feedback'],
            },
          },
          totalScore: { type: Type.NUMBER },
          summary: { type: Type.STRING },
          hints: { type: Type.NUMBER },
        },
        required: ['criteria', 'totalScore', 'summary', 'hints'],
      },
      ...(temperature !== null && temperature !== undefined ? { temperature: Number(temperature) } : {}),
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
    throw new Error('Gemini returned an empty evaluation response');
  }
  const rawUsage = generation.usageMetadata || generation.response?.usageMetadata || null;
  trackUsageAsync({ ...ctx, modelId, provider, rawUsage });
  const text = typeof candidate === 'string' ? candidate : String(candidate);
  return {
    text,
    meta: {
      provider,
      temperature: temperature ?? null,
      reasoning_effort: null,
      cacheMetrics: legacyCacheMetrics(provider, rawUsage),
    },
  };
}

// ---------------------------------------------------------------------------
// generateOutlineWithLLM
// ---------------------------------------------------------------------------

export async function generateOutlineWithLLM({ modelId, vendor = null, prompt, config = {} }) {
  const provider = detectProvider(modelId, vendor);
  await assertWithinCostCap(config.instructorId, modelId);
  const runtimeParams = await resolveModelRuntimeConfiguration(modelId);
  const temperature = runtimeParams.temperature ?? config.temperature ?? null;
  const reasoningEffort = runtimeParams.reasoning_effort ?? config.reasoning_effort ?? null;
  const reasoningModel = isOpenAIReasoning(modelId);
  const overrideMaxTokens = Number.isFinite(config.maxTokens) ? Number(config.maxTokens) : null;
  const ctx = usageContext(config, 'case_writer');

  if (provider === 'openrouter') {
    const apiKey = await resolveProviderKey('openrouter', config.instructorId);
    const mergedParams = { ...runtimeParams };
    if (temperature !== null && temperature !== undefined && mergedParams.temperature === undefined) {
      mergedParams.temperature = Number(temperature);
    }
    const messages = [{ role: 'user', content: prompt }];
    const { text, rawUsage } = await callOpenRouter({
      modelId,
      messages,
      runtimeParams: mergedParams,
      maxTokens: overrideMaxTokens ?? 16000,
      apiKey,
    });
    trackUsageAsync({ ...ctx, modelId, provider, rawUsage });
    return {
      text,
      meta: {
        provider,
        temperature: mergedParams.temperature ?? null,
        reasoning_effort: mergedParams.reasoning_effort ?? null,
      },
    };
  }

  if (provider === 'openai') {
    const apiKey = await resolveProviderKey('openai', config.instructorId);
    const tokenCap = overrideMaxTokens ?? 16000;
    const payload = {
      model: modelId,
      messages: [{ role: 'user', content: prompt }],
      ...(reasoningModel
        ? { max_completion_tokens: tokenCap }
        : { max_tokens: tokenCap }),
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
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI error: ${text}`);
    }
    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content?.trim() || '';
    const rawUsage = data?.usage || null;
    trackUsageAsync({ ...ctx, modelId, provider, rawUsage });
    return { text, meta: appliedParams };
  }

  if (provider === 'anthropic') {
    const apiKey = await resolveProviderKey('anthropic', config.instructorId);
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: overrideMaxTokens ?? 8192,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
        ...(temperature !== null && temperature !== undefined ? { temperature: Number(temperature) } : {}),
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Anthropic error: ${text}`);
    }
    const data = await response.json();
    const text = data?.content?.[0]?.text?.trim() || '';
    const rawUsage = data?.usage || null;
    trackUsageAsync({ ...ctx, modelId, provider, rawUsage });
    return { text, meta: { provider, temperature: temperature ?? null, reasoning_effort: null } };
  }

  // Google Gemini
  const apiKey = await resolveProviderKey('google', config.instructorId);
  const ai = new GoogleGenAI({ apiKey });
  const generation = await ai.models.generateContent({
    model: modelId,
    contents: prompt,
    config: {
      maxOutputTokens: overrideMaxTokens ?? 8192,
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
  const rawUsage = generation.usageMetadata || generation.response?.usageMetadata || null;
  trackUsageAsync({ ...ctx, modelId, provider, rawUsage });
  const text = typeof candidate === 'string' ? candidate : String(candidate);
  return { text, meta: { provider, temperature: temperature ?? null, reasoning_effort: null } };
}
