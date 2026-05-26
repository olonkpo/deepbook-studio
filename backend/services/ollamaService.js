/**
 * backend/services/ollamaService.js
 * Ollama local API — offline AI fallback.
 * Uses Node.js built-in fetch (Node 20+).
 */

const OLLAMA_BASE = () => process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const DEFAULT_MODEL = () => process.env.OLLAMA_DEFAULT_MODEL || 'llama3';

/**
 * Check if Ollama is running and return available models.
 */
async function checkStatus() {
  try {
    const res = await fetch(`${OLLAMA_BASE()}/api/tags`, {
      signal: AbortSignal.timeout(3000), // 3-second timeout
    });
    if (!res.ok) return { running: false, models: [] };

    const data = await res.json();
    const models = (data.models || []).map(m => m.name);
    return { running: true, models };
  } catch {
    return { running: false, models: [] };
  }
}

/**
 * Convert OpenAI-format messages to a single Ollama prompt string.
 */
function messagesToPrompt(messages) {
  return messages
    .map(m => {
      if (m.role === 'system')    return `[System]: ${m.content}`;
      if (m.role === 'user')      return `[User]: ${m.content}`;
      if (m.role === 'assistant') return `[Assistant]: ${m.content}`;
      return m.content;
    })
    .join('\n\n') + '\n\n[Assistant]:';
}

/**
 * Non-streaming generation.
 */
async function generate(messages, opts = {}) {
  const model = opts.model || DEFAULT_MODEL();
  const prompt = messagesToPrompt(messages);

  const res = await fetch(`${OLLAMA_BASE()}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: {
        num_predict: opts.maxTokens || 1000,
        temperature: opts.temperature ?? 0.8,
      },
    }),
    signal: AbortSignal.timeout(120_000), // 2-minute timeout for local models
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Ollama error: ${err}`);
  }

  const data = await res.json();
  return {
    text: data.response || '',
    model,
    tokens: data.eval_count || 0,
  };
}

/**
 * Streaming generation — calls onChunk(text) for each token.
 */
async function streamGenerate(messages, opts = {}, onChunk) {
  const model = opts.model || DEFAULT_MODEL();
  const prompt = messagesToPrompt(messages);

  const res = await fetch(`${OLLAMA_BASE()}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: true,
      options: {
        num_predict: opts.maxTokens || 800,
        temperature: opts.temperature ?? 0.8,
      },
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Ollama error: ${err}`);
  }

  // Ollama streams NDJSON (one JSON object per line)
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.response) onChunk(obj.response);
      } catch { /* ignore malformed lines */ }
    }
  }

  return { model };
}

module.exports = { checkStatus, generate, streamGenerate };
