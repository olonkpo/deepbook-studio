/**
 * backend/server.js
 * Express API server — entry point.
 * Runs on localhost:3001 and serves both the API and the frontend static files.
 */

require('dotenv').config();

// Restore persisted DeepSeek key from DB on startup
(function restoreApiKey() {
  try {
    const { getDb } = require('./db/database');
    const row = getDb().prepare("SELECT value FROM global_settings WHERE key = 'deepseek_api_key'").get();
    if (row?.value && !process.env.DEEPSEEK_API_KEY) {
      process.env.DEEPSEEK_API_KEY = row.value;
      console.log('[Server] DeepSeek API key restored from DB.');
    }
  } catch (_) { /* DB may not exist on very first cold start */ }
})();

const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({ origin: `http://localhost:${PORT}` }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Serve frontend static files ───────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// ── Health check (Electron polls this to know backend is ready) ───────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() });
});

// ── API Routes ────────────────────────────────────────────────────────────────
const workspacesRouter = require('./routes/workspaces');
const booksRouter      = require('./routes/books');
const chaptersRouter   = require('./routes/chapters');
const continuityRouter = require('./routes/continuity');
const aiRouter         = require('./routes/ai');
const exportRouter     = require('./routes/export');
const settingsRouter   = require('./routes/settings');

// Workspaces
app.use('/api/workspaces', workspacesRouter);

// Books — nested under workspace AND as a top-level resource
app.use('/api/workspaces/:workspaceId/books', booksRouter);
app.get('/api/books/:id',    booksRouter.getBookById);
app.put('/api/books/:id',    booksRouter.updateBook);
app.delete('/api/books/:id', booksRouter.deleteBook);

// Chapters — routes define their own full paths
app.use('/api', chaptersRouter);

// Continuity facts, codex entries, chat conversations + messages
app.use('/api', continuityRouter);

// AI
app.use('/api/ai', aiRouter);

// Export
app.use('/api/export', exportRouter);

// Settings
app.use('/api/settings', settingsRouter);

// ── 404 handler for unknown API routes ───────────────────────────────────────
app.use('/api/*', (_req, res) => {
  res.status(404).json({ error: 'API route not found.' });
});

// ── SPA fallback — all non-API routes serve index.html ───────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

// ── Global error handler ─────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[Server Error]', err);
  res.status(500).json({
    error: 'Internal server error.',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, '127.0.0.1', () => {
  console.log(`[Backend] DeepBook Studio API  →  http://localhost:${PORT}`);
  console.log(`[Backend] Environment          →  ${process.env.NODE_ENV || 'development'}`);
  console.log(`[Backend] DeepSeek key         →  ${process.env.DEEPSEEK_API_KEY ? 'set ✓' : 'not set'}`);
});

module.exports = app;
