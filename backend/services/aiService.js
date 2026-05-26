/**
 * backend/services/aiService.js
 * Provider abstraction layer.
 *
 * Provider modes:
 *   'deepseek' — use DeepSeek only; fail if unavailable
 *   'ollama'   — use Ollama only; fail if not running
 *   'auto'     — try DeepSeek first, fall back to Ollama silently
 */

const deepseek = require('./deepseekService');
const ollama   = require('./ollamaService');

/**
 * Non-streaming generation.
 * @returns {Promise<{ text: string, provider: string, model: string }>}
 */
async function generate(providerMode, messages, opts = {}) {
  const mode = providerMode || 'auto';

  if (mode === 'ollama') {
    const result = await ollama.generate(messages, opts);
    return { ...result, provider: 'ollama' };
  }

  if (mode === 'deepseek') {
    const result = await deepseek.generate(messages, opts);
    return { ...result, provider: 'deepseek' };
  }

  // auto: try DeepSeek, fall back to Ollama
  try {
    const result = await deepseek.generate(messages, opts);
    return { ...result, provider: 'deepseek' };
  } catch (deepseekErr) {
    console.warn('[AI] DeepSeek failed, trying Ollama:', deepseekErr.message);

    const ollamaStatus = await ollama.checkStatus();
    if (!ollamaStatus.running) {
      throw new Error(
        'DeepSeek is unavailable and Ollama is not running. ' +
        'Check your API key or start Ollama for offline use.',
      );
    }

    const result = await ollama.generate(messages, opts);
    return { ...result, provider: 'ollama' };
  }
}

/**
 * Streaming generation — calls onChunk(text) for each delta.
 * @returns {Promise<string>} — the provider that was used
 */
async function streamGenerate(providerMode, messages, opts = {}, onChunk) {
  const mode = providerMode || 'auto';

  if (mode === 'ollama') {
    await ollama.streamGenerate(messages, opts, onChunk);
    return 'ollama';
  }

  if (mode === 'deepseek') {
    await deepseek.streamGenerate(messages, opts, onChunk);
    return 'deepseek';
  }

  // auto: try DeepSeek first, fall back to Ollama
  try {
    await deepseek.streamGenerate(messages, opts, onChunk);
    return 'deepseek';
  } catch (deepseekErr) {
    console.warn('[AI] DeepSeek stream failed, trying Ollama:', deepseekErr.message);

    const ollamaStatus = await ollama.checkStatus();
    if (!ollamaStatus.running) {
      throw new Error(
        'DeepSeek is unavailable and Ollama is not running. ' +
        'Check your API key or start Ollama for offline use.',
      );
    }

    await ollama.streamGenerate(messages, opts, onChunk);
    return 'ollama';
  }
}

module.exports = { generate, streamGenerate };
