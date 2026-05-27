/**
 * backend/routes/settings.js
 * Global settings key-value store + AI key management + Ollama status.
 *
 * Route order matters — specific named routes (/ollama, /keys) must come
 * BEFORE the /:key wildcard or Express will match the wildcard first.
 */

'use strict';

const express = require('express');
const router  = express.Router();
const { getDb } = require('../db/database');
const ollamaService = require('../services/ollamaService');

// Providers that use an API key (not Ollama which is local, not 'none')
const KEY_PROVIDERS = ['deepseek', 'gemini', 'claude', 'openai', 'openrouter'];

// Map provider name → env var name (used to load keys into process.env)
const PROVIDER_ENV = {
  deepseek:   'DEEPSEEK_API_KEY',
  gemini:     'GEMINI_API_KEY',
  claude:     'CLAUDE_API_KEY',
  openai:     'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
};

// ── GET /api/settings  ────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  try {
    const db   = getDb();
    const rows = db.prepare('SELECT key, value FROM global_settings').all();
    const out  = Object.fromEntries(rows.map(r => [r.key, tryParseValue(r.value)]));

    // Expose which providers have keys (never expose raw keys)
    for (const [provider, envVar] of Object.entries(PROVIDER_ENV)) {
      out[`has_${provider}_key`] = !!process.env[envVar];
    }
    out.ollama_base_url  = process.env.OLLAMA_BASE_URL        || 'http://localhost:11434';
    out.ollama_model     = process.env.OLLAMA_DEFAULT_MODEL   || 'llama3';

    res.json(out);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/settings/ollama — Ollama health check ────────────────────────────
// MUST be before /:key to avoid being shadowed by the wildcard route
router.get('/ollama', async (req, res) => {
  try {
    const status = await ollamaService.checkStatus();
    res.json(status);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/settings/keys — save any provider API key server-side ───────────
// MUST be before /:key for the same reason
router.post('/keys', (req, res) => {
  const { provider, key } = req.body;
  if (!provider || !key?.trim()) {
    return res.status(400).json({ error: 'provider and key are required.' });
  }
  if (!KEY_PROVIDERS.includes(provider)) {
    return res.status(400).json({ error: `provider must be one of: ${KEY_PROVIDERS.join(', ')}` });
  }
  try {
    const cleanKey = key.trim();
    const envVar   = PROVIDER_ENV[provider];

    // Set immediately so aiService picks it up without restart
    process.env[envVar] = cleanKey;

    // Persist across restarts in the global_settings table
    const db = getDb();
    db.prepare('INSERT OR REPLACE INTO global_settings (key, value) VALUES (?, ?)')
      .run(`${provider}_api_key`, cleanKey);

    res.json({ success: true, message: `${provider} API key saved.` });
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
    // Filter out read-only status fields
    const pairs = Object.entries(req.body).filter(([k]) =>
      !k.startsWith('has_') && !['ollama_base_url', 'ollama_model'].includes(k)
    );
    const batch = db.transaction(p => p.forEach(([k, v]) => ins.run(k, stringify(v))));
    batch(pairs);
    res.json({ saved: pairs.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /api/settings/:key ────────────────────────────────────────────────────
router.put('/:key', (req, res) => {
  try {
    const db = getDb();
    db.prepare('INSERT OR REPLACE INTO global_settings (key, value) VALUES (?, ?)')
      .run(req.params.key, stringify(req.body.value));
    res.json({ saved: true });
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

// ── Exported helper: restore all provider keys from DB into process.env ───────
// Called by server.js at startup
function restoreAllApiKeys(db) {
  for (const [provider, envVar] of Object.entries(PROVIDER_ENV)) {
    try {
      const row = db.prepare(`SELECT value FROM global_settings WHERE key = ?`).get(`${provider}_api_key`);
      if (row?.value && !process.env[envVar]) {
        process.env[envVar] = row.value;
        console.log(`[Server] ${provider} API key restored from DB.`);
      }
    } catch (_) { /* ignore — DB may not exist yet on first cold start */ }
  }
}

module.exports = router;
module.exports.restoreAllApiKeys = restoreAllApiKeys;
