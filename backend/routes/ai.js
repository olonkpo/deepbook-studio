/**
 * backend/routes/ai.js
 * AI generation endpoints — DeepSeek (default) with Ollama fallback.
 * Supports streaming (generate/continue) and non-streaming (outline/rewrite).
 */

const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const aiService = require('../services/aiService');
const ollamaService = require('../services/ollamaService');

// ── Helper: get active workspace ────────────────────────────────────────────
function getActiveWorkspace(db) {
  return db.prepare('SELECT * FROM workspaces WHERE is_active = 1 LIMIT 1').get();
}

// ── Helper: save to generation history ──────────────────────────────────────
function saveHistory(db, { workspaceId, bookId, chapterId, type, prompt, result, provider, model }) {
  db.prepare(`
    INSERT INTO generation_history
      (workspace_id, book_id, chapter_id, type, prompt, result, provider, model)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(workspaceId, bookId || null, chapterId || null, type, prompt, result, provider, model || null);
}

// POST /api/ai/generate — streaming text generation
router.post('/generate', async (req, res) => {
  const { prompt, bookId, chapterId, context = '', tone = '', maxTokens = 800 } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required.' });

  const db = getDb();
  const workspace = getActiveWorkspace(db);
  if (!workspace) return res.status(400).json({ error: 'No active workspace.' });

  // Build the system + user message
  const systemPrompt = `You are a professional book writing assistant. Write engaging, vivid prose. ${tone ? `Tone: ${tone}.` : ''} Continue naturally from any provided context.`;
  const userMessage = context
    ? `Context (what came before):\n${context}\n\n---\nNow write the following:\n${prompt}`
    : prompt;

  try {
    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    let fullText = '';
    let usedProvider = '';

    const onChunk = (text) => {
      fullText += text;
      res.write(`data: ${JSON.stringify({ text })}\n\n`);
    };

    try {
      usedProvider = await aiService.streamGenerate(
        workspace.ai_provider,
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        { maxTokens },
        onChunk,
      );
    } catch (aiErr) {
      res.write(`data: ${JSON.stringify({ error: aiErr.message })}\n\n`);
      res.end();
      return;
    }

    // Save to history
    saveHistory(db, {
      workspaceId: workspace.id,
      bookId,
      chapterId,
      type: 'generate',
      prompt: userMessage,
      result: fullText,
      provider: usedProvider,
    });

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

// POST /api/ai/outline — generate a book outline (non-streaming)
router.post('/outline', async (req, res) => {
  const { title, genre, description, numChapters = 10 } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required.' });

  const db = getDb();
  const workspace = getActiveWorkspace(db);
  if (!workspace) return res.status(400).json({ error: 'No active workspace.' });

  const prompt = `Create a detailed ${numChapters}-chapter outline for a ${genre || 'fiction'} book titled "${title}".
${description ? `Book description: ${description}` : ''}

Return ONLY a JSON array with this exact structure — no extra text:
[
  { "position": 0, "title": "Chapter title", "summary": "2-3 sentence chapter summary" },
  ...
]`;

  try {
    const { text, provider } = await aiService.generate(workspace.ai_provider, [
      { role: 'system', content: 'You are a professional book outline creator. Return only valid JSON.' },
      { role: 'user', content: prompt },
    ], { maxTokens: 2000 });

    // Parse the JSON outline
    let outline;
    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      outline = JSON.parse(jsonMatch ? jsonMatch[0] : text);
    } catch {
      return res.status(422).json({ error: 'AI returned invalid outline format. Try again.', raw: text });
    }

    saveHistory(db, {
      workspaceId: workspace.id,
      type: 'outline',
      prompt,
      result: JSON.stringify(outline),
      provider,
    });

    res.json({ outline, provider });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/rewrite — rewrite / improve existing text
router.post('/rewrite', async (req, res) => {
  const { text, instruction = 'Improve the writing quality, clarity and flow.' } = req.body;
  if (!text) return res.status(400).json({ error: 'text is required.' });

  const db = getDb();
  const workspace = getActiveWorkspace(db);
  if (!workspace) return res.status(400).json({ error: 'No active workspace.' });

  const prompt = `Rewrite the following text. Instruction: ${instruction}\n\nText to rewrite:\n${text}`;

  try {
    const { text: rewritten, provider } = await aiService.generate(workspace.ai_provider, [
      { role: 'system', content: 'You are a professional editor. Return only the rewritten text, nothing else.' },
      { role: 'user', content: prompt },
    ], { maxTokens: 1200 });

    saveHistory(db, {
      workspaceId: workspace.id,
      type: 'rewrite',
      prompt,
      result: rewritten,
      provider,
    });

    res.json({ text: rewritten, provider });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/continue — continue writing from existing text
router.post('/continue', async (req, res) => {
  const { text, bookContext = '', maxTokens = 600 } = req.body;
  if (!text) return res.status(400).json({ error: 'text is required.' });

  const db = getDb();
  const workspace = getActiveWorkspace(db);
  if (!workspace) return res.status(400).json({ error: 'No active workspace.' });

  const prompt = `${bookContext ? `Book context: ${bookContext}\n\n` : ''}Continue this text naturally. Write only the continuation, no preamble:\n\n${text}`;

  try {
    const { text: continuation, provider } = await aiService.generate(workspace.ai_provider, [
      { role: 'system', content: 'You are a professional author. Continue the story naturally and seamlessly.' },
      { role: 'user', content: prompt },
    ], { maxTokens });

    saveHistory(db, {
      workspaceId: workspace.id,
      type: 'continue',
      prompt,
      result: continuation,
      provider,
    });

    res.json({ text: continuation, provider });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ai/providers — list providers and their online/offline status
router.get('/providers', async (req, res) => {
  const db = getDb();
  const workspace = getActiveWorkspace(db);

  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  const ollamaStatus = await ollamaService.checkStatus();

  res.json({
    current: workspace?.ai_provider || 'auto',
    providers: {
      deepseek: {
        available: !!deepseekKey,
        hasKey: !!deepseekKey,
        model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
        label: 'DeepSeek (online)',
      },
      ollama: {
        available: ollamaStatus.running,
        running: ollamaStatus.running,
        models: ollamaStatus.models || [],
        model: process.env.OLLAMA_DEFAULT_MODEL || 'llama3',
        label: 'Ollama (local/offline)',
      },
    },
  });
});

// POST /api/ai/provider — switch active provider for the active workspace
router.post('/provider', (req, res) => {
  const { provider } = req.body;
  if (!['deepseek', 'ollama', 'auto'].includes(provider)) {
    return res.status(400).json({ error: 'provider must be deepseek, ollama, or auto.' });
  }
  try {
    const db = getDb();
    const workspace = getActiveWorkspace(db);
    if (!workspace) return res.status(400).json({ error: 'No active workspace.' });

    db.prepare('UPDATE workspaces SET ai_provider = ? WHERE id = ?').run(provider, workspace.id);
    res.json({ success: true, provider });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ai/history — recent generation history for active workspace
router.get('/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  try {
    const db = getDb();
    const workspace = getActiveWorkspace(db);
    if (!workspace) return res.status(400).json({ error: 'No active workspace.' });

    const history = db.prepare(`
      SELECT id, type, prompt, provider, model, created_at
      FROM generation_history
      WHERE workspace_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(workspace.id, limit);

    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
