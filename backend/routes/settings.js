/**
 * backend/routes/settings.js
 * Per-workspace settings + AI key management + Ollama status.
 */

const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const ollamaService = require('../services/ollamaService');

// Helper: get active workspace
function getActiveWorkspace(db) {
  return db.prepare('SELECT * FROM workspaces WHERE is_active = 1 LIMIT 1').get();
}

// Helper: upsert a setting key
function upsertSetting(db, workspaceId, key, value) {
  db.prepare(`
    INSERT INTO settings (workspace_id, key, value)
    VALUES (?, ?, ?)
    ON CONFLICT(workspace_id, key) DO UPDATE SET value = excluded.value
  `).run(workspaceId, key, value);
}

// GET /api/settings — get all settings for active workspace
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const workspace = getActiveWorkspace(db);
    if (!workspace) return res.status(400).json({ error: 'No active workspace.' });

    const rows = db.prepare('SELECT key, value FROM settings WHERE workspace_id = ?').all(workspace.id);
    const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));

    // Include workspace-level fields
    settings.ai_provider  = workspace.ai_provider;
    settings.export_path  = workspace.export_path;
    settings.workspace_id = workspace.id;

    // Never expose raw API keys — only whether they exist
    settings.has_deepseek_key = !!(process.env.DEEPSEEK_API_KEY || settings.deepseek_key);
    delete settings.deepseek_key;

    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/settings — update settings for active workspace
router.put('/', (req, res) => {
  const allowedKeys = [
    'theme', 'font_size', 'editor_width', 'autosave_interval',
    'default_genre', 'default_tone', 'default_max_tokens',
    'ollama_model', 'show_word_count', 'export_include_cover',
  ];

  try {
    const db = getDb();
    const workspace = getActiveWorkspace(db);
    if (!workspace) return res.status(400).json({ error: 'No active workspace.' });

    // Update workspace-level fields
    if (req.body.ai_provider !== undefined) {
      db.prepare('UPDATE workspaces SET ai_provider = ? WHERE id = ?')
        .run(req.body.ai_provider, workspace.id);
    }
    if (req.body.export_path !== undefined) {
      db.prepare('UPDATE workspaces SET export_path = ? WHERE id = ?')
        .run(req.body.export_path, workspace.id);
    }

    // Update settings table
    for (const key of allowedKeys) {
      if (req.body[key] !== undefined) {
        upsertSetting(db, workspace.id, key, String(req.body[key]));
      }
    }

    res.json({ success: true, message: 'Settings updated.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/settings/keys — save API key
// Stores the key in the process environment (session) and in the settings table.
// For production: the Electron main process can write to the OS keychain.
router.post('/keys', (req, res) => {
  const { provider, key } = req.body;
  if (!provider || !key) {
    return res.status(400).json({ error: 'provider and key are required.' });
  }
  if (!['deepseek'].includes(provider)) {
    return res.status(400).json({ error: 'Unsupported provider. Only deepseek supported via this endpoint.' });
  }

  try {
    const db = getDb();
    const workspace = getActiveWorkspace(db);
    if (!workspace) return res.status(400).json({ error: 'No active workspace.' });

    // Set in process.env for immediate use
    process.env.DEEPSEEK_API_KEY = key;

    // Persist in settings table (encrypted storage is a Phase 5 enhancement)
    upsertSetting(db, workspace.id, `${provider}_key`, key);

    res.json({ success: true, message: `${provider} API key saved.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/settings/ollama — check if Ollama is running and list models
router.get('/ollama', async (req, res) => {
  try {
    const status = await ollamaService.checkStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
