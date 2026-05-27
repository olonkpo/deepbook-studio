/**
 * backend/routes/settings.js
 * Global settings key-value store + AI key management + Ollama status.
 */

'use strict';

const express = require('express');
const router  = express.Router();
const { getDb } = require('../db/database');
const ollamaService = require('../services/ollamaService');

// ── GET /api/settings  ────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  try {
    const db   = getDb();
    const rows = db.prepare('SELECT key, value FROM global_settings').all();
    const out  = Object.fromEntries(rows.map(r => [r.key, tryParseValue(r.value)]));

    // Add live AI status (never expose raw key)
    out.has_deepseek_key  = !!process.env.DEEPSEEK_API_KEY;
    out.deepseek_model    = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
    out.ollama_base_url   = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    out.ollama_model      = process.env.OLLAMA_DEFAULT_MODEL || 'llama3';

    res.json(out);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/settings/:key ────────────────────────────────────────────────────
router.get('/:key', (req, res) => {
  try {
    const db  = getDb();
    const row = db.prepare('SELECT value FROM global_settings WHERE key = ?').get(req.params.key);
    if (!row) return res.json({ value: null });
    res.json({ value: tryParseValue(row.value) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /api/settings  — batch upsert key-value pairs ────────────────────────
router.put('/', (req, res) => {
  try {
    const db  = getDb();
    const ins = db.prepare('INSERT OR REPLACE INTO global_settings (key, value) VALUES (?, ?)');
    const batch = db.transaction(pairs => pairs.forEach(([k, v]) => ins.run(k, stringify(v))));
    const pairs = Object.entries(req.body).filter(([k]) => k !== 'has_deepseek_key');
    batch(pairs);
    res.json({ saved: pairs.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /api/settings/:key ────────────────────────────────────────────────────
router.put('/:key', (req, res) => {
  try {
    const db = getDb();
    db.prepare('INSERT OR REPLACE INTO global_settings (key, value) VALUES (?, ?)').run(req.params.key, stringify(req.body.value));
    res.json({ saved: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/settings/keys — save DeepSeek API key ──────────────────────────
router.post('/keys', (req, res) => {
  const { provider, key } = req.body;
  if (!provider || !key?.trim()) {
    return res.status(400).json({ error: 'provider and key are required.' });
  }
  if (provider !== 'deepseek') {
    return res.status(400).json({ error: 'Only deepseek is supported via this endpoint.' });
  }
  try {
    // Set immediately in process.env so aiService picks it up
    process.env.DEEPSEEK_API_KEY = key.trim();
    // Persist across restarts in DB (plaintext — Phase 2 acceptable)
    const db = getDb();
    db.prepare('INSERT OR REPLACE INTO global_settings (key, value) VALUES (?, ?)').run('deepseek_api_key', key.trim());
    res.json({ success: true, message: 'DeepSeek API key saved.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/settings/ollama — Ollama health check ───────────────────────────
router.get('/ollama', async (req, res) => {
  try {
    const status = await ollamaService.checkStatus();
    res.json(status);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function tryParseValue(v) {
  if (v == null) return null;
  try { return JSON.parse(v); } catch { return v; }
}
function stringify(v) {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

module.exports = router;
