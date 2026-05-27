/**
 * backend/routes/ai.js
 * AI generation — all providers routed through aiService.
 * POST /api/ai/generate  — non-streaming (returns {text})
 * POST /api/ai/stream    — SSE streaming
 * GET  /api/ai/providers — all provider statuses
 * POST /api/ai/provider  — switch active provider
 * GET  /api/ai/history   — recent generation log
 */

'use strict';

const express = require('express');
const router  = express.Router();
const { getDb } = require('../db/database');
const aiService     = require('../services/aiService');
const ollamaService = require('../services/ollamaService');

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

function getActiveWorkspace(db) {
  return db.prepare('SELECT * FROM workspaces WHERE is_active = 1 LIMIT 1').get();
}

function resolveProvider(db, workspaceId) {
  if (workspaceId) {
    const ws = db.prepare('SELECT ai_provider FROM workspaces WHERE id = ?').get(workspaceId);
    if (ws) return ws.ai_provider || 'auto';
  }
  const active = getActiveWorkspace(db);
  return active?.ai_provider || 'auto';
}

function saveHistory(db, { workspaceId, type, prompt, result, provider }) {
  try {
    db.prepare(`
      INSERT INTO generation_history (id, workspace_id, type, prompt, result, provider)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(uid(), workspaceId, type, (prompt || '').substring(0, 4000), (result || '').substring(0, 8000), provider);
  } catch (_) { /* history is non-critical */ }
}

// ── POST /api/ai/generate  — non-streaming, returns {text} ───────────────────
// This is the primary endpoint used by the Orchestrator and all step functions.
router.post('/generate', async (req, res) => {
  const { prompt, workspaceId, maxTokens = 16384 } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required.' });

  const db       = getDb();
  const provider = resolveProvider(db, workspaceId);
  const wsId     = workspaceId || getActiveWorkspace(db)?.id;

  try {
    const { text, provider: usedProvider } = await aiService.generate(
      provider,
      [{ role: 'user', content: prompt }],
      { maxTokens },
    );

    if (wsId) saveHistory(db, { workspaceId: wsId, type: 'generate', prompt, result: text, provider: usedProvider });

    res.json({ text, provider: usedProvider });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/ai/stream  — SSE streaming ─────────────────────────────────────
router.post('/stream', async (req, res) => {
  const { prompt, workspaceId, maxTokens = 16384 } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required.' });

  const db       = getDb();
  const provider = resolveProvider(db, workspaceId);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let fullText = '';
  try {
    const usedProvider = await aiService.streamGenerate(
      provider,
      [{ role: 'user', content: prompt }],
      { maxTokens },
      (chunk) => {
        fullText += chunk;
        res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
      },
    );
    const wsId = workspaceId || getActiveWorkspace(db)?.id;
    if (wsId) saveHistory(db, { workspaceId: wsId, type: 'stream', prompt, result: fullText, provider: usedProvider });
    res.write('data: [DONE]\n\n');
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
  }
  res.end();
});

// ── POST /api/ai/outline  — structured JSON outline ──────────────────────────
router.post('/outline', async (req, res) => {
  const { prompt, workspaceId, maxTokens = 6000 } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required.' });

  const db       = getDb();
  const provider = resolveProvider(db, workspaceId);

  try {
    const { text, provider: usedProvider } = await aiService.generate(provider,
      [{ role: 'user', content: prompt }], { maxTokens });
    res.json({ text, provider: usedProvider });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/ai/providers ─────────────────────────────────────────────────────
router.get('/providers', async (req, res) => {
  try {
    const db           = getDb();
    const workspace    = getActiveWorkspace(db);
    const ollamaStatus = await ollamaService.checkStatus();
    const apiProviders = aiService.getProviderStatus();

    res.json({
      current: workspace?.ai_provider || 'auto',
      providers: {
        ...apiProviders,
        ollama: {
          available: ollamaStatus.running,
          running:   ollamaStatus.running,
          models:    ollamaStatus.models || [],
          model:     process.env.OLLAMA_DEFAULT_MODEL || 'llama3',
          label:     'Ollama (local)',
        },
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/ai/provider ─────────────────────────────────────────────────────
const VALID_PROVIDERS = ['deepseek', 'openai', 'openrouter', 'claude', 'gemini', 'ollama', 'auto'];
router.post('/provider', (req, res) => {
  const { provider } = req.body;
  if (!VALID_PROVIDERS.includes(provider)) {
    return res.status(400).json({ error: `provider must be one of: ${VALID_PROVIDERS.join(', ')}` });
  }
  try {
    const db = getDb();
    const ws = getActiveWorkspace(db);
    if (!ws) return res.status(400).json({ error: 'No active workspace.' });
    db.prepare('UPDATE workspaces SET ai_provider = ? WHERE id = ?').run(provider, ws.id);
    res.json({ success: true, provider });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/ai/history ───────────────────────────────────────────────────────
router.get('/history', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  try {
    const db = getDb();
    const ws = getActiveWorkspace(db);
    if (!ws) return res.status(400).json({ error: 'No active workspace.' });
    const history = db.prepare(`
      SELECT id, type, provider, created_at FROM generation_history
      WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?
    `).all(ws.id, limit);
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
