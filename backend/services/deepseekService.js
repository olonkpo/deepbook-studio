/**
 * backend/services/deepseekService.js
 * DeepSeek API via the OpenAI-compatible interface.
 */

const OpenAI = require('openai');

let client = null;

function getClient() {
  if (!client || client.apiKey !== process.env.DEEPSEEK_API_KEY) {
    if (!process.env.DEEPSEEK_API_KEY) {
      throw new Error('DEEPSEEK_API_KEY is not set. Add it in Settings.');
    }
    client = new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
    });
  }
  return client;
}

const DEFAULT_MODEL = () => process.env.DEEPSEEK_MODEL || 'deepseek-chat';

/**
 * Non-streaming completion.
 * @param {Array} messages - OpenAI-format message array
 * @param {Object} opts - { maxTokens, temperature }
 * @returns {Promise<{ text: string, model: string, tokens: number }>}
 */
async function generate(messages, opts = {}) {
  const openai = getClient();
  const response = await openai.chat.completions.create({
    model: DEFAULT_MODEL(),
    messages,
    max_tokens: opts.maxTokens || 1000,
    temperature: opts.temperature ?? 0.8,
    stream: false,
  });

  return {
    text: response.choices[0]?.message?.content || '',
    model: response.model,
    tokens: response.usage?.total_tokens || 0,
  };
}

/**
 * Streaming completion — calls onChunk(text) for each delta.
 * @returns {Promise<{ model: string }>}
 */
async function streamGenerate(messages, opts = {}, onChunk) {
  const openai = getClient();
  const stream = await openai.chat.completions.create({
    model: DEFAULT_MODEL(),
    messages,
    max_tokens: opts.maxTokens || 800,
    temperature: opts.temperature ?? 0.8,
    stream: true,
  });

  let model = DEFAULT_MODEL();
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) onChunk(delta);
    if (chunk.model) model = chunk.model;
  }

  return { model };
}

/**
 * Quick connectivity test — returns true if the key works.
 */
async function testConnection() {
  try {
    await generate([{ role: 'user', content: 'Hi' }], { maxTokens: 5 });
    return true;
  } catch {
    return false;
  }
}

module.exports = { generate, streamGenerate, testConnection };
