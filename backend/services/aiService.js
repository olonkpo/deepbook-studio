/**
 * backend/services/aiService.js
 * Provider abstraction layer — routes to the correct AI backend.
 *
 * Supported providers:
 * 'deepseek'   — DeepSeek (OpenAI-compatible)
 * 'openai'     — OpenAI (GPT-4o etc.)
 * 'openrouter' — OpenRouter (multi-model gateway, OpenAI-compatible)
 * 'claude'     — Anthropic Claude (Messages API)
 * 'gemini'     — Google Gemini (generateContent API)
 * 'ollama'     — Local Ollama
 * 'auto'       — Try the configured provider, fall back to Ollama
 */

const deepseek = require('./deepseekService');
const ollama   = require('./ollamaService');
const OpenAI   = require('openai');

// ── OpenAI-compatible client cache + factory ─────────────────────────────────
const _clientCache = {};

function _openaiCompatClient(provider) {
  const configs = {
    openai: {
      envKey:  'OPENAI_API_KEY',
      baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      default: process.env.OPENAI_MODEL    || 'gpt-4o',
    },
    openrouter: {
      envKey:  'OPENROUTER_API_KEY',
      baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
      default: process.env.OPENROUTER_MODEL    || 'deepseek/deepseek-chat',
    },
  };
  const cfg = configs[provider];
  if (!cfg) throw new Error(`No OpenAI-compat config for provider: ${provider}`);
  const apiKey = process.env[cfg.envKey];
  if (!apiKey) throw new Error(`${cfg.envKey} is not set. Add it in Settings.`);
  const cacheKey = `${provider}:${apiKey}`;
  if (!_clientCache[cacheKey]) {
    _clientCache[cacheKey] = { client: new OpenAI({ apiKey, baseURL: cfg.baseURL }), model: cfg.default };
  }
  return _clientCache[cacheKey];
}

// ── Claude (Anthropic Messages API) ──────────────────────────────────────────
async function _claudeGenerate(messages, opts = {}) {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) throw new Error('CLAUDE_API_KEY is not set. Add it in Settings.');
  const model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

  const systemMsg = messages.find(m => m.role === 'system')?.content;
  const userMsgs  = messages.filter(m => m.role !== 'system');

  const body = {
    model,
    max_tokens: opts.maxTokens || 16384,
    messages:   userMsgs,
    ...(systemMsg ? { system: systemMsg } : {}),
  };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error(`Claude API error: ${err.error?.message || res.statusText}`);
  }

  const data = await res.json();
  return { text: data.content?.[0]?.text || '', model: data.model, tokens: data.usage?.output_tokens || 0 };
}

// ── Gemini (Google generateContent API) ──────────────────────────────────────
async function _geminiGenerate(messages, opts = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set. Add it in Settings.');
  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

  const contents = messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));

  const systemInstruction = messages.find(m => m.role === 'system')?.content;

  const body = {
    contents,
    ...(systemInstruction ? { system_instruction: { parts: [{ text: systemInstruction }] } } : {}),
    generationConfig: { maxOutputTokens: opts.maxTokens || 16384, temperature: opts.temperature ?? 0.8 },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'content-type': 'application/json' },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error(`Gemini API error: ${err.error?.message || res.statusText}`);
  }

  const data = await res.json();
  return { text: data.candidates?.[0]?.content?.parts?.[0]?.text || '', model, tokens: data.usageMetadata?.candidatesTokenCount || 0 };
}

// ── Resolve provider for 'auto' mode ─────────────────────────────────────────
function _resolveProvider(providerMode) {
  const mode = (providerMode || 'auto').toLowerCase();
  if (mode !== 'auto') return mode;

  // Pick first provider that has a key configured
  const ORDER = ['deepseek', 'openai', 'openrouter', 'claude', 'gemini'];
  const ENV   = { deepseek: 'DEEPSEEK_API_KEY', openai: 'OPENAI_API_KEY', openrouter: 'OPENROUTER_API_KEY', claude: 'CLAUDE_API_KEY', gemini: 'GEMINI_API_KEY' };
  for (const p of ORDER) {
    if (process.env[ENV[p]]) return p;
  }
  return 'ollama'; // final fallback
}

// ── Non-streaming generation ──────────────────────────────────────────────────
async function generate(providerMode, messages, opts = {}) {
  const provider = _resolveProvider(providerMode);

  if (provider === 'ollama') {
    const r = await ollama.generate(messages, opts);
    return { ...r, provider: 'ollama' };
  }
  if (provider === 'deepseek') {
    const r = await deepseek.generate(messages, opts);
    return { ...r, provider: 'deepseek' };
  }
  if (provider === 'claude') {
    const r = await _claudeGenerate(messages, opts);
    return { ...r, provider: 'claude' };
  }
  if (provider === 'gemini') {
    const r = await _geminiGenerate(messages, opts);
    return { ...r, provider: 'gemini' };
  }
  if (provider === 'openai' || provider === 'openrouter') {
    const { client, model } = _openaiCompatClient(provider);
    const response = await client.chat.completions.create({
      model,
      messages,
      max_tokens:  opts.maxTokens || 16384,
      temperature: opts.temperature ?? 0.8,
      stream:      false,
    });
    return { text: response.choices[0]?.message?.content || '', model: response.model, tokens: response.usage?.total_tokens || 0, provider };
  }

  throw new Error(`Unknown provider: ${provider}`);
}

// ── Streaming generation ──────────────────────────────────────────────────────
async function streamGenerate(providerMode, messages, opts = {}, onChunk) {
  const provider = _resolveProvider(providerMode);

  if (provider === 'ollama') {
    await ollama.streamGenerate(messages, opts, onChunk);
    return 'ollama';
  }
  if (provider === 'deepseek') {
    await deepseek.streamGenerate(messages, opts, onChunk);
    return 'deepseek';
  }

  // Claude / Gemini: non-streaming fallback (full streaming TBD)
  if (provider === 'claude' || provider === 'gemini') {
    const result = await generate(provider, messages, opts);
    onChunk(result.text);
    return provider;
  }

  // OpenAI / OpenRouter: real token-by-token streaming
  if (provider === 'openai' || provider === 'openrouter') {
    const { client, model } = _openaiCompatClient(provider);
    const stream = await client.chat.completions.create({
      model,
      messages,
      max_tokens:  opts.maxTokens || 16384,
      temperature: opts.temperature ?? 0.8,
      stream:      true,
    });
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) onChunk(delta);
    }
    return provider;
  }

  // Generic fallback
  const result = await generate(provider, messages, opts);
  onChunk(result.text);
  return provider;
}

// ── Provider availability status ─────────────────────────────────────────────
function getProviderStatus() {
  const ENV = {
    deepseek:    'DEEPSEEK_API_KEY',  openai: 'OPENAI_API_KEY',
    openrouter:  'OPENROUTER_API_KEY', claude: 'CLAUDE_API_KEY', gemini: 'GEMINI_API_KEY',
  };
  const MODELS = {
    deepseek:   process.env.DEEPSEEK_MODEL   || 'deepseek-chat',
    openai:     process.env.OPENAI_MODEL     || 'gpt-4o',
    openrouter: process.env.OPENROUTER_MODEL || 'deepseek/deepseek-chat',
    claude:     process.env.CLAUDE_MODEL     || 'claude-sonnet-4-6',
    gemini:     process.env.GEMINI_MODEL     || 'gemini-2.0-flash',
  };
  const LABELS = { deepseek: 'DeepSeek', openai: 'OpenAI', openrouter: 'OpenRouter', claude: 'Claude', gemini: 'Gemini' };

  const out = {};
  for (const [p, envVar] of Object.entries(ENV)) {
    out[p] = { available: !!process.env[envVar], hasKey: !!process.env[envVar], model: MODELS[p], label: LABELS[p] };
  }
  return out;
}

module.exports = { generate, streamGenerate, getProviderStatus };
